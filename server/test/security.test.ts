import { beforeAll, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { freshDb } from "./helpers";

let app: ReturnType<typeof createApp>;
const local = { requestIP: () => ({ address: "127.0.0.1", family: "IPv4", port: 5000 }) };
const remote = { requestIP: () => ({ address: "100.101.102.103", family: "IPv4", port: 5000 }) };

async function call(method: string, path: string, opts: { body?: unknown; server?: object; headers?: Record<string, string>; host?: string } = {}) {
  const headers: Record<string, string> = { ...(opts.body !== undefined && !(opts.body instanceof FormData) ? { "Content-Type": "application/json" } : {}), ...opts.headers };
  const init: RequestInit = { method, headers };
  if (opts.body !== undefined) init.body = opts.body instanceof FormData ? opts.body : JSON.stringify(opts.body);
  return app.fetch(new Request(`http://${opts.host ?? "localhost"}${path}`, init), opts.server ?? local);
}

async function pairedCookie() {
  const pairing = (await (await call("POST", "/api/devices/pairing", { body: {} })).json()) as { code: string };
  const ok = await call("POST", "/api/pair", { body: { code: pairing.code, name: "Phone" }, server: remote });
  return ok.headers.get("set-cookie")!.split(";")[0]!;
}

beforeAll(() => {
  freshDb();
  app = createApp();
});

describe("security (SEC-07..10)", () => {
  test("a rebound DNS name from loopback isn't the host computer", async () => {
    const evil = "evil.example:7766";
    const r = await call("POST", "/api/personas", { body: { name: "Rebound" }, host: evil, headers: { host: evil, origin: `http://${evil}` } });
    expect(r.status).toBe(401);
    expect((await call("GET", "/api/connections", { host: evil, headers: { host: evil } })).status).toBe(401);
    // Loopback names still are.
    expect((await call("GET", "/api/connections", { host: "127.0.0.1:7766", headers: { host: "127.0.0.1:7766" } })).status).toBe(200);
    expect((await call("GET", "/api/connections", { host: "[::1]:7766", headers: { host: "[::1]:7766" } })).status).toBe(200);
  });

  test("another site can't post to the share target", async () => {
    const fd = new FormData();
    fd.append("file", new File(["{}"], "c.json"));
    const r = await call("POST", "/share-target", { body: fd, headers: { origin: "https://evil.example" } });
    expect(r.status).toBe(403);
    const fd2 = new FormData();
    fd2.append("file", new File(["{}"], "c.json"));
    expect((await call("POST", "/share-target", { body: fd2, headers: { "sec-fetch-site": "cross-site" } })).status).toBe(403);
  });

  test("a paired device can't take host-only actions", async () => {
    const cookie = await pairedCookie();
    const asPhone = { server: remote, headers: { cookie } };
    expect((await call("POST", "/api/vault/enable", { ...asPhone, body: { passphrase: "something long" } })).status).toBe(403);
    expect((await call("PUT", "/api/backups/mirror", { ...asPhone, body: { dir: "C:\\Temp" } })).status).toBe(403);
    expect((await call("POST", "/api/trash/empty", { ...asPhone, body: {} })).status).toBe(403);
    expect((await call("POST", "/api/backups/x.db/restore", { ...asPhone, body: {} })).status).toBe(403);
    expect((await call("PUT", "/api/connections/abc", { ...asPhone, body: { baseUrl: "https://evil.example/v1" } })).status).toBe(403);
    // With a new key typed in, it's allowed through (and 404s here: no such connection).
    expect((await call("PUT", "/api/connections/abc", { ...asPhone, body: { baseUrl: "https://example.com/v1", apiKey: "sk-new" } })).status).not.toBe(403);
    // Another device can't be revoked from the phone; the phone itself can.
    expect((await call("DELETE", "/api/devices/someone-else", asPhone)).status).toBe(403);
  });

  test("only the newest pairing code works", async () => {
    const first = (await (await call("POST", "/api/devices/pairing", { body: {} })).json()) as { code: string };
    await call("POST", "/api/devices/pairing", { body: {} });
    expect((await call("POST", "/api/pair", { body: { code: first.code, name: "Old" }, server: remote })).status).toBe(400);
  });

  test("bad setting values are refused", async () => {
    expect((await call("PUT", "/api/settings", { body: { "backup.hourlyKeep": -1 } })).status).toBe(400);
    expect((await call("PUT", "/api/settings", { body: { "routing.timeouts": { story: "soon" } } })).status).toBe(400);
    expect((await call("PUT", "/api/settings", { body: { "lore.defaults": "nope" } })).status).toBe(400);
    expect((await call("PUT", "/api/settings", { body: { "backup.hourlyKeep": 12 } })).status).toBe(200);
    expect((await call("PUT", "/api/settings", { body: { "regex.scripts": [{ id: "slow", name: "Slow", find: "/(a+)+$/", replace: "", targets: ["ai"], mode: "prompt", enabled: true }] } })).status).toBe(400);
  });
});
