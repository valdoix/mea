import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { all, now, one, run } from "../src/db/db";
import { setSetting } from "../src/lib/settings";
import { decodeBase64Image, defaultSize, imageBody, isToolModel, pricePerImage, toImageModel } from "../src/providers/images";
import { NanoGPTProvider } from "../src/providers/nanogpt";
import { ProviderError } from "../src/providers/types";
import { createConnection } from "../src/services/connections";
import { purgeUnreferencedImages, saveImage } from "../src/services/images";
import { batchView, imageModels, keepImage, runImageJob, startImageBatch, syncImageModels } from "../src/services/imagegen";
import { placeholderAvatar } from "../src/lib/png-encode";
import { freshDb } from "./helpers";

// Shapes as NanoGPT's catalog sends them (GET /api/v1/images/models, November 2026), trimmed.
const KLEIN = {
  id: "blackforestlabs/flux-3/klein/text-to-image",
  name: "FLUX.3 Klein",
  category: "image",
  tags: ["text-to-image", "image-edit"],
  architecture: { input_modalities: ["text", "image"], output_modalities: ["image"] },
  pricing: { per_image: { "768x768": 0.008, "1024x1024": 0.009, "2048x2048": 0.014 }, currency: "USD" },
  capabilities: { image_generation: true, image_to_image: true, inpainting: false, nsfw: false },
  supported_parameters: { max_prompt_characters: null, resolutions: ["768x768", "1024x1024", "2048x2048"], max_images: 4, max_output_images: 4, max_input_images: 10, input_image_constraints: { max_items: 10 } },
};
const SEEDREAM = {
  id: "bytedance/seedream-v5.0-flash/edit",
  name: "Seedream 5.0 Flash Edit",
  pricing: { per_image: { "1k": 0.027, "16:9": 0.027, "1:1": 0.027 } },
  capabilities: { image_generation: true, image_to_image: true, nsfw: false },
  supported_parameters: { resolutions: ["2k", "1.5k", "1k"], aspect_ratio: ["1:1", "16:9", "9:16"], max_images: 4, max_input_images: 10 },
};
const UPSCALER = { id: "topaz-image-upscale", name: "Topaz Image Upscale", category: "image", tags: ["upscale"], pricing: { per_image: { auto: 0.01 } }, capabilities: { image_generation: true, image_to_image: true } };
const OLD_STYLE = { id: "hidream", name: "HiDream", pricing: { per_image: { "1024x1024": 0.0153 } }, supported_parameters: { resolution: { type: "enum", values: ["1024x1024"] }, n: { type: "range", min: 1, max: 2 } } };

describe("the image catalog", () => {
  test("reads prices, sizes, references and limits", () => {
    const k = toImageModel(KLEIN);
    expect(k.prices["1024x1024"]).toBe(0.009);
    expect(k.sizes).toContain("2048x2048");
    expect(k.maxImages).toBe(4);
    expect(k.maxInputImages).toBe(10);
    expect(k.capabilities).toEqual({ generate: true, edit: true, inpainting: false, nsfw: false });
    const s = toImageModel(SEEDREAM);
    expect(s.aspectRatios).toEqual(["1:1", "16:9", "9:16"]);
    const o = toImageModel(OLD_STYLE);
    expect(o.sizes).toEqual(["1024x1024"]);
    expect(o.maxImages).toBe(2);
    expect(o.maxInputImages).toBe(0);
  });

  test("tools make no picture from a prompt", () => {
    expect(isToolModel(toImageModel(UPSCALER))).toBe(true);
    expect(isToolModel(toImageModel(KLEIN))).toBe(false);
  });

  test("prices and default sizes", () => {
    const k = toImageModel(KLEIN);
    expect(pricePerImage(k, "2048x2048")).toBe(0.014);
    expect(pricePerImage(k, "nope")).toBe(0.008);
    expect(defaultSize(k)).toBe("1024x1024");
    expect(defaultSize(toImageModel(SEEDREAM))).toBe("1k");
  });

  test("the request body", () => {
    const ref = { mime: "image/png", bytes: new Uint8Array([1, 2, 3]) };
    expect(imageBody({ model: "m", prompt: "p", n: 2, size: "16:9" })).toEqual({ model: "m", prompt: "p", n: 2, response_format: "b64_json", size: "16:9", aspect_ratio: "16:9" });
    expect(imageBody({ model: "m", prompt: "p", size: "auto", seed: 7, references: [ref] })).toEqual({ model: "m", prompt: "p", n: 1, response_format: "b64_json", seed: 7, imageDataUrl: "data:image/png;base64,AQID" });
    expect(imageBody({ model: "m", prompt: "p", references: [ref, ref] }).imageDataUrls).toHaveLength(2);
    expect([...decodeBase64Image("data:image/png;base64,AQID")]).toEqual([1, 2, 3]);
  });
});

const PNG = placeholderAvatar(16, 16);
const B64 = Buffer.from(PNG).toString("base64");

describe("NanoGPT's image calls", () => {
  let main: ReturnType<typeof Bun.serve>;
  let mirror: ReturnType<typeof Bun.serve>;
  let mirrorHits = 0;
  let lastBody: any = null;

  beforeAll(() => {
    main = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/api/v1/images/models") return Response.json({ object: "list", data: [KLEIN, UPSCALER] });
        if (url.pathname === "/pic.png") return new Response(PNG, { headers: { "Content-Type": "image/png" } });
        if (url.pathname === "/api/v1/images/generations") {
          lastBody = await req.json();
          if (lastBody.prompt === "broke") return new Response(JSON.stringify({ error: { message: "Insufficient balance" } }), { status: 402 });
          if (lastBody.prompt === "slow gateway") return new Response("gateway timeout", { status: 504 });
          if (lastBody.prompt === "host down") return new Response("unavailable", { status: 503 });
          if (lastBody.prompt === "as a link") return Response.json({ data: [{ url: `${base(main)}/pic.png` }], cost: 0.02 });
          return Response.json({ created: 1, data: Array.from({ length: lastBody.n }, () => ({ b64_json: B64 })), cost: 0.018, paymentSource: "USD", remainingBalance: 4.2 });
        }
        return new Response("not found", { status: 404 });
      },
    });
    mirror = Bun.serve({
      port: 0,
      fetch() {
        mirrorHits++;
        return Response.json({ data: [{ b64_json: B64 }], cost: 0.009 });
      },
    });
  });
  afterAll(() => {
    main.stop(true);
    mirror.stop(true);
  });
  const base = (s: ReturnType<typeof Bun.serve>) => `http://127.0.0.1:${s.port}`;
  const provider = () => new NanoGPTProvider({ baseUrl: `${base(main)}/api/v1`, apiKey: "k" }, base(mirror));

  test("lists the catalog", async () => {
    const models = await provider().listImageModels();
    expect(models.map((m) => m.id)).toEqual([KLEIN.id, UPSCALER.id]);
  });

  test("returns pictures and the cost", async () => {
    const res = await provider().generateImage({ model: KLEIN.id, prompt: "a lighthouse", n: 2, size: "1024x1024" });
    expect(res.images).toHaveLength(2);
    expect(res.images[0]![0]).toBe(0x89);
    expect(res.cost).toBe(0.018);
    expect(lastBody).toMatchObject({ model: KLEIN.id, n: 2, size: "1024x1024", response_format: "b64_json" });
  });

  test("downloads a picture sent as a link", async () => {
    const res = await provider().generateImage({ model: KLEIN.id, prompt: "as a link" });
    expect(res.images[0]!.length).toBe(PNG.length);
  });

  test("a key that can't pay is a billing error", async () => {
    const err = await provider().generateImage({ model: KLEIN.id, prompt: "broke" }).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).kind).toBe("billing");
  });

  test("a 504 isn't sent to the mirror (it may still be drawing, and would bill twice)", async () => {
    mirrorHits = 0;
    const err = await provider().generateImage({ model: KLEIN.id, prompt: "slow gateway" }).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(mirrorHits).toBe(0);
  });

  test("a 503 goes to the mirror (nothing was drawn)", async () => {
    mirrorHits = 0;
    const res = await provider().generateImage({ model: KLEIN.id, prompt: "host down" });
    expect(mirrorHits).toBe(1);
    expect(res.cost).toBe(0.009);
  });
});

describe("requests for pictures", () => {
  let conn = "";
  beforeEach(async () => {
    freshDb();
    conn = createConnection({ name: "Mock", kind: "mock", billing: "paygo" });
    setSetting("images.config", { connectionId: conn, defaults: { portrait: null, edit: null, anime: null, plate: null }, nsfw: false });
    await syncImageModels();
  });

  test("the catalog hides tools and adult-content models unless asked", () => {
    expect(imageModels(conn).models.map((m) => m.id)).toEqual(["mock/editor", "mock/painter"]);
    expect(imageModels(conn, { nsfw: true }).models.map((m) => m.id)).toContain("mock/after-dark");
    expect(imageModels(conn, { tools: true }).models.map((m) => m.id)).toContain("mock/upscaler");
  });

  test("a subscription key is refused before anything is sent", () => {
    const sub = createConnection({ name: "Sub", kind: "mock", billing: "subscription" });
    expect(() => startImageBatch({ connectionId: sub, model: "mock/painter", prompt: "x" })).toThrow(/pay-as-you-go/);
  });

  test("checks the model's limits for free", () => {
    expect(() => startImageBatch({ model: "mock/painter", prompt: "x", size: "640x480" })).toThrow(/doesn't draw at 640x480/);
    expect(() => startImageBatch({ model: "mock/editor", prompt: "x", n: 3 })).toThrow(/at most 2 pictures/);
    expect(() => startImageBatch({ model: "mock/after-dark", prompt: "x" })).toThrow(/hidden/);
    expect(() => startImageBatch({ model: "mock/painter", prompt: "x", references: ["nope"] })).toThrow(/reference pictures/);
  });

  test("draws, saves, records the cost", async () => {
    const b = startImageBatch({ model: "mock/painter", prompt: "a lighthouse at dusk", n: 2, size: "1024x1536" });
    expect(b.status).toBe("queued");
    expect(b.estimate).toBe(0.03);
    run("DELETE FROM jobs"); // the test runs the job itself
    await runImageJob({ batchId: b.id }, { id: "job" });
    const done = batchView(b.id)!;
    expect(done.status).toBe("done");
    expect(done.images).toHaveLength(2);
    expect(done.images[0]!.height).toBeGreaterThan(done.images[0]!.width!);
    expect(done.cost).toBe(0.03);
    const g = one<{ kind: string; task: string; cost: number; billing: string }>("SELECT kind, task, cost, billing FROM generations WHERE kind = 'image'");
    expect(g).toMatchObject({ kind: "image", task: "images", cost: 0.03, billing: "paygo" });
  });

  test("a failure is shown, not retried", async () => {
    const b = startImageBatch({ model: "mock/painter", prompt: "MOCK_IMAGE_FAIL" });
    expect(one<{ max_attempts: number }>("SELECT max_attempts FROM jobs WHERE id = (SELECT job_id FROM image_batches WHERE id = ?)", b.id)?.max_attempts).toBe(1);
    run("DELETE FROM jobs");
    await runImageJob({ batchId: b.id }, { id: "job" });
    expect(batchView(b.id)).toMatchObject({ status: "error", images: [] });
    expect(batchView(b.id)!.error).toMatch(/refused/);
  });

  test("a request that was already running when Mea stopped is never sent again", async () => {
    const b = startImageBatch({ model: "mock/painter", prompt: "x" });
    run("DELETE FROM jobs");
    run("UPDATE image_batches SET status = 'running' WHERE id = ?", b.id);
    await runImageJob({ batchId: b.id }, { id: "job" });
    expect(batchView(b.id)).toMatchObject({ status: "error", images: [] });
    expect(all("SELECT 1 FROM generations WHERE kind = 'image'")).toHaveLength(0);
  });

  test("reference pictures are sent and kept", async () => {
    const ref = await saveImage(PNG);
    const b = startImageBatch({ model: "mock/editor", prompt: "the same woman, in winter", references: [ref] });
    run("DELETE FROM jobs");
    await runImageJob({ batchId: b.id }, { id: "job" });
    expect(batchView(b.id)).toMatchObject({ status: "done", references: [ref] });
    run("UPDATE images SET created_at = ? WHERE id = ?", now() - 40 * 86400_000, ref);
    purgeUnreferencedImages();
    expect(one("SELECT 1 FROM images WHERE id = ?", ref)).toBeTruthy();
  });

  test("unkept pictures go after 30 days; kept ones stay", async () => {
    const b = startImageBatch({ model: "mock/painter", prompt: "x", n: 2 });
    run("DELETE FROM jobs");
    await runImageJob({ batchId: b.id }, { id: "job" });
    const [a, c] = batchView(b.id)!.images.map((i) => i.id);
    keepImage(c!);
    const old = now() - 31 * 86400_000;
    run("UPDATE images SET created_at = ?", old);
    purgeUnreferencedImages();
    expect(one("SELECT 1 FROM images WHERE id = ?", a!)).toBeTruthy(); // the recipe is recent
    run("UPDATE image_recipes SET created_at = ?", old);
    purgeUnreferencedImages();
    expect(one("SELECT 1 FROM images WHERE id = ?", a!)).toBeFalsy();
    expect(one("SELECT 1 FROM images WHERE id = ?", c!)).toBeTruthy();
  });
});
