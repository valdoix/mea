import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { markPublic } from "../src/services/auth";
import { normalizeTunnelAddress, saveTunnelAddress } from "../src/services/tunnel";
import { freshDb } from "./helpers";

let app: ReturnType<typeof createApp>;
const local = { requestIP: () => ({ address: "127.0.0.1", family: "IPv4", port: 5000 }) };
const remote = { requestIP: () => ({ address: "100.101.102.103", family: "IPv4", port: 5000 }) };
const servers: ReturnType<typeof Bun.serve>[] = [];

/** A stand-in for a tunnel: forwards to Mea's tunnel door (or, wrongly, its main door), or shows its own login. */
function fakeTunnel(kind: "tunnel" | "main" | "login") {
  const s = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      if (kind === "login") return Response.redirect("https://app.pangolin.net/auth/resource/abc", 302);
      if (kind === "tunnel") markPublic(req);
      return app.fetch(req, kind === "tunnel" ? local : remote);
    },
  });
  servers.push(s);
  return `http://127.0.0.1:${s.port}`;
}

async function setAddress(address: string | null, server: object = local) {
  const res = await app.fetch(
    new Request("http://localhost/api/devices/tunnel-address", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address }) }),
    server,
  );
  return { status: res.status, json: (await res.json()) as { tunnel: Record<string, unknown>; error?: string } };
}

beforeAll(() => {
  freshDb();
  app = createApp();
});
afterAll(() => {
  for (const s of servers) s.stop(true);
});

describe("tunnel address (Pangolin)", () => {
  test("addresses are normalized; only https, except on this computer", () => {
    expect(normalizeTunnelAddress("mea.mea123.my.id")).toBe("https://mea.mea123.my.id");
    expect(normalizeTunnelAddress(" https://mea.mea123.my.id/pair?code=ABCD ")).toBe("https://mea.mea123.my.id");
    expect(normalizeTunnelAddress("http://mea.mea123.my.id")).toBeNull();
    expect(normalizeTunnelAddress("not an address")).toBeNull();
    expect(normalizeTunnelAddress("http://127.0.0.1:9999")).toBe("http://127.0.0.1:9999");
  });

  test("ping says which door a request came in at", async () => {
    const main = (await (await app.fetch(new Request("http://localhost/api/ping"), local)).json()) as { door: string };
    expect(main.door).toBe("main");
    const req = new Request("http://localhost/api/ping");
    markPublic(req);
    expect(((await (await app.fetch(req, local)).json()) as { door: string }).door).toBe("tunnel");
  });

  test("a tunnel to the tunnel door works and becomes the pairing address", async () => {
    const url = fakeTunnel("tunnel");
    const { status, json } = await setAddress(url);
    expect(status).toBe(200);
    expect(json.tunnel).toMatchObject({ provider: "pangolin", address: url, url, reachable: true, problem: null, wrongPort: null, running: true });
    const pairing = (await (await app.fetch(new Request("http://localhost/api/devices/pairing", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }), local)).json()) as { url: string };
    expect(pairing.url.startsWith(`${url}/pair?code=`)).toBe(true);
  });

  test("a tunnel to the trusted main port is refused as an address", async () => {
    const url = fakeTunnel("main");
    const { json } = await setAddress(url);
    expect(json.tunnel).toMatchObject({ url: null, reachable: false, wrongPort: url });
  });

  test("the tunnel's own login page in the way is named", async () => {
    const { json } = await setAddress(fakeTunnel("login"));
    expect(json.tunnel).toMatchObject({ reachable: false, problem: "login" });
  });

  test("an address that doesn't answer stays the pairing address, marked unreachable", async () => {
    const s = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("") });
    const url = `http://127.0.0.1:${s.port}`;
    s.stop(true);
    const { json } = await setAddress(url);
    expect(json.tunnel).toMatchObject({ url, reachable: false, problem: "unreachable" });
  });

  test("only the host computer can change it; bad input is refused; null clears it", async () => {
    expect((await setAddress("https://evil.example", remote)).status).toBe(401);
    const tunneled = new Request("http://localhost/api/devices/tunnel-address", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: "https://evil.example" }) });
    markPublic(tunneled);
    expect((await app.fetch(tunneled, local)).status).toBe(401);
    expect((await setAddress("http://mea.example.com")).status).toBe(400);
    const cleared = await setAddress(null);
    expect(cleared.json.tunnel).toMatchObject({ address: null, reachable: null });
    // The address never goes to the browser with the other settings.
    const settings = (await (await app.fetch(new Request("http://localhost/api/settings"), local)).json()) as Record<string, unknown>;
    expect("tunnel.address" in settings).toBe(false);
  });
});

describe("pairing with a tunnel", () => {
  test("the pairing link uses the saved address without waiting on it, unless it was found on the main port", async () => {
    const pair = async () => ((await (await app.fetch(new Request("http://localhost/api/devices/pairing", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }), local)).json()) as { url: string }).url;
    const slow = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Promise<Response>(() => {}) });
    servers.push(slow);
    const slowUrl = `http://127.0.0.1:${slow.port}`;
    // Saved without a check (as the install script's PUT would be before the tunnel is up).
    saveTunnelAddress(slowUrl);
    const started = Date.now();
    expect((await pair()).startsWith(`${slowUrl}/pair?code=`)).toBe(true);
    expect(Date.now() - started).toBeLessThan(3000);

    const main = fakeTunnel("main");
    await setAddress(main);
    expect((await pair()).startsWith(main)).toBe(false);
    await setAddress(null);
  });
});
