/**
 * The image bake-off (docs/28 Part 1): the same prompts on several models, side by side, so the
 * default models are picked by looking, not by reputation.
 *
 *   bun scripts/image-bakeoff.ts [--base http://127.0.0.1:7766] [--models a,b,c] [--go]
 *
 * It talks to a running Mea (from this computer, which needs no pairing), using the connection set in
 * Settings → Images. Without --go it only prints what it would send and the total price: nothing is
 * drawn and nothing is spent. With --go every prompt goes to every model once, as one picture each
 * (pay-as-you-go), and a table of price, time and picture links is printed, ready for docs/28 §2.2.
 * The pictures stay in Mea for 30 days (Settings → Pictures → Recent pictures).
 */

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const BASE = (flag("--base") ?? "http://127.0.0.1:7766").replace(/\/+$/, "");
const GO = args.includes("--go");

/** Prose models get prose; tag models (anime) get tags, as Part 2's compiler will write them. */
const PROMPTS: { id: string; idea: string; family: "prose" | "tags"; prompt: string }[] = [
  {
    id: "canon",
    idea: "buffy summers, 20 years old",
    family: "prose",
    prompt:
      "Portrait of a 20-year-old woman, petite and athletic, with long straight blonde hair worn loose, hazel-green eyes and fair skin, wearing a small silver cross necklace. She wears a black leather jacket over a fitted top in late-1990s style and holds a wooden stake at her side. Night in an old cemetery, mist between the headstones, cool moonlight from the left and a warm streetlamp behind her. Confident half-smile, steady gaze at the viewer. Waist-up, three-quarter view, shallow depth of field, cinematic painted realism.",
  },
  {
    id: "original",
    idea: "a lighthouse keeper in her thirties, weathered and kind",
    family: "prose",
    prompt:
      "Portrait of a woman in her mid-thirties, a lighthouse keeper, sturdy build, short dark curly hair streaked with salt, grey eyes, freckled sun-weathered skin, a small scar through her left eyebrow. She wears a heavy navy wool coat and a knitted scarf. Inside the lamp room at dusk, warm lamplight on one side of her face, the cold blue sea through the glass behind her. A tired, kind smile. Head and shoulders, soft storybook painting, pastel colours.",
  },
  {
    id: "anime",
    idea: "an anime-style persona: a young man who is a librarian mage",
    family: "tags",
    prompt:
      "adult man, 25 years old, solo, slim, messy silver hair, amber eyes, round glasses, dark blue robe with gold embroidery, holding an open glowing book, library, tall bookshelves, floating candles, warm light, upper body, looking at viewer, gentle smile, anime style, masterpiece, best quality",
  },
];

/** docs/28 §2.2's shortlist. Each is tried at its square size near 1024. */
const DEFAULT_MODELS = [
  "blackforestlabs/flux-3/klein/text-to-image",
  "qwen-image-3",
  "bytedance/seedream-v5.0-flash",
  "z-image-base",
  "nano-banana-2",
  "nano-banana-pro",
  "black-forest-labs/flux-3/text-to-image",
  "anima/text-to-image",
];
const TAG_MODELS = /anima|illustrious|animagine|pony|sdxl|xl\b/i;

interface Model {
  id: string;
  name: string;
  prices: Record<string, number>;
  sizes: string[];
  capabilities: { nsfw: boolean };
}
interface Batch {
  id: string;
  status: "queued" | "running" | "done" | "error";
  error: string | null;
  cost: number | null;
  estimate: number | null;
  images: { id: string }[];
  createdAt: number;
  finishedAt: number | null;
}

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status} ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

const sizeFor = (m: Model) => {
  const keys = Object.keys(m.prices).length ? Object.keys(m.prices) : m.sizes;
  return keys.find((k) => /^1024[x*]1024$/.test(k)) ?? keys.find((k) => /^1k$/i.test(k)) ?? keys.find((k) => k === "1:1") ?? keys.find((k) => k !== "auto") ?? keys[0];
};
const priceAt = (m: Model, size: string | undefined) => (size && m.prices[size] != null ? m.prices[size]! : (m.prices.auto ?? (Object.values(m.prices).length ? Math.min(...Object.values(m.prices)) : null)));
const usd = (v: number | null | undefined) => (v == null ? "?" : `$${v.toFixed(v < 0.01 ? 4 : 3)}`);

const catalog = await api<{ connectionId: string | null; models: Model[] }>("GET", "/api/imagegen/models");
if (!catalog.connectionId) throw new Error("No connection is set for pictures: Settings → Pictures first.");
if (!catalog.models.length) throw new Error("The image catalog is empty: load it in Settings → Pictures first.");
const wanted = (flag("--models")?.split(",").map((s) => s.trim()).filter(Boolean) ?? DEFAULT_MODELS).filter(Boolean);
const models = wanted.map((id) => catalog.models.find((m) => m.id === id) ?? null);
for (const [i, m] of models.entries()) if (!m) console.warn(`Not in the catalog (skipped): ${wanted[i]}`);

const plan = models
  .filter((m): m is Model => Boolean(m))
  .flatMap((m) => PROMPTS.filter((p) => p.family === (TAG_MODELS.test(m.id) ? "tags" : "prose")).map((p) => ({ m, p, size: sizeFor(m) })));
const total = plan.reduce((s, x) => s + (priceAt(x.m, x.size) ?? 0), 0);

console.log(`${plan.length} pictures on ${new Set(plan.map((x) => x.m.id)).size} models, about ${usd(total)} in all (pay-as-you-go).`);
for (const x of plan) console.log(`  ${x.p.id.padEnd(8)} ${x.m.name} at ${x.size ?? "default"} · ${usd(priceAt(x.m, x.size))}`);
if (!GO) {
  console.log("\nNothing was sent. Run again with --go to draw them.");
  process.exit(0);
}

const rows: string[] = [];
for (const x of plan) {
  const started = Date.now();
  let b: Batch;
  try {
    b = await api<Batch>("POST", "/api/imagegen/generate", { model: x.m.id, prompt: x.p.prompt, n: 1, size: x.size ?? null, kind: "bakeoff" });
    while (b.status === "queued" || b.status === "running") {
      await Bun.sleep(1500);
      b = await api<Batch>("GET", `/api/imagegen/batches/${b.id}`);
      if (Date.now() - started > 6 * 60_000) throw new Error("still drawing after 6 minutes");
    }
  } catch (e) {
    rows.push(`| ${x.p.id} | ${x.m.name} | ${x.size ?? ""} | ${usd(priceAt(x.m, x.size))} | — | — | failed: ${(e as Error).message.slice(0, 80)} |`);
    console.log(`✗ ${x.p.id} · ${x.m.name}: ${(e as Error).message}`);
    continue;
  }
  const secs = ((b.finishedAt ?? Date.now()) - b.createdAt) / 1000;
  const links = b.images.map((im) => `[picture](${BASE}/api/images/${im.id})`).join(" ");
  rows.push(`| ${x.p.id} | ${x.m.name} | ${x.size ?? ""} | ${usd(priceAt(x.m, x.size))} | ${usd(b.cost)} | ${secs.toFixed(0)} s | ${b.status === "done" ? links : `failed: ${b.error?.slice(0, 80)}`} |`);
  console.log(`${b.status === "done" ? "✓" : "✗"} ${x.p.id} · ${x.m.name} · ${usd(b.cost)} · ${secs.toFixed(0)} s${b.error ? ` · ${b.error}` : ""}`);
}

console.log("\n| Prompt | Model | Size | Listed | Charged | Time | Result |\n|---|---|---|---|---|---|---|");
for (const r of rows) console.log(r);
