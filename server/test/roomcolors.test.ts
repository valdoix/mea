import { beforeAll, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { getSetting } from "../src/lib/settings";
import { freshDb } from "./helpers";

let app: ReturnType<typeof createApp>;
const local = { requestIP: () => ({ address: "127.0.0.1", family: "IPv4", port: 5000 }) };
const put = (body: unknown) => app.fetch(new Request("http://localhost/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), local);

beforeAll(() => {
  freshDb();
  app = createApp();
});

describe("room colours (J2)", () => {
  test("your colours are kept per room, by day and by night", async () => {
    const res = await put({ "appearance.colors": { citadel: { day: { bg: "#f0e6d0", text: "#1a1a1a" }, night: { accent: "#ff7744" } } } });
    expect(res.status).toBe(200);
    expect(getSetting("appearance.colors")).toEqual({ citadel: { day: { bg: "#f0e6d0", text: "#1a1a1a" }, night: { accent: "#ff7744" } } });
  });

  test("only the room's colours, and only real colours", async () => {
    expect((await put({ "appearance.colors": { citadel: { day: { "font-ui": "#000000" } } } })).status).toBe(400);
    expect((await put({ "appearance.colors": { citadel: { day: { bg: "red; background: url(x)" } } } })).status).toBe(400);
  });
});
