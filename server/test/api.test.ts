import { beforeAll, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { normalizeCard } from "../src/cards/card";
import { buildPngCard } from "../src/cards/io";
import { type MeaEvent, subscribe } from "../src/lib/events";
import { placeholderAvatar } from "../src/lib/png-encode";
import { markPublic } from "../src/services/auth";
import { freshDb } from "./helpers";

let app: ReturnType<typeof createApp>;
const local = { requestIP: () => ({ address: "127.0.0.1", family: "IPv4", port: 5000 }) };
const remote = { requestIP: () => ({ address: "100.101.102.103", family: "IPv4", port: 5000 }) };

async function api<T = any>(method: string, path: string, body?: unknown, opts: { server?: object; headers?: Record<string, string> } = {}): Promise<{ status: number; json: T; res: Response }> {
  const init: RequestInit = { method, headers: { ...(body !== undefined && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {}), ...opts.headers } };
  if (body !== undefined) init.body = body instanceof FormData ? body : JSON.stringify(body);
  const res = await app.fetch(new Request(`http://localhost${path}`, init), opts.server ?? local);
  const text = await res.clone().text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json, res };
}

function waitFor(pred: (e: MeaEvent) => boolean, timeout = 5000) {
  return new Promise<MeaEvent>((resolve, reject) => {
    const t = setTimeout(() => {
      off();
      reject(new Error("timeout waiting for event"));
    }, timeout);
    const off = subscribe((e) => {
      if (pred(e)) {
        clearTimeout(t);
        off();
        resolve(e);
      }
    });
  });
}

let characterId = "";
let chatId = "";

beforeAll(async () => {
  freshDb();
  app = createApp();
});

describe("API end to end (mock provider)", () => {
  test("setup: connection, models, profile", async () => {
    const conn = await api("POST", "/api/connections", { name: "Mock", kind: "mock", billing: "subscription" });
    expect(conn.status).toBe(201);
    expect(conn.json.connection.modelCount).toBe(3);
    const profile = await api("POST", "/api/profiles", { name: "Story", connectionId: conn.json.connection.id, modelId: "mock/storyteller", params: { temperature: 0.9 } });
    expect(profile.status).toBe(201);
    const profiles = await api("GET", "/api/profiles");
    expect(profiles.json.storyProfileId).toBe(profile.json.id);
  });

  test("import a PNG card with an embedded lorebook", async () => {
    const { data } = normalizeCard({
      spec: "chara_card_v2",
      data: {
        name: "Mira",
        description: "Keeper of the lighthouse.",
        first_mes: "Hello, {{user}}. Welcome to the lighthouse.",
        alternate_greetings: ["Oh! A visitor."],
        character_book: { entries: [{ keys: ["lantern"], content: "The lantern was her mother's.", extensions: {}, enabled: true, insertion_order: 100 }] },
      },
    });
    const form = new FormData();
    form.append("file", new File([buildPngCard(data, placeholderAvatar(8, 8))], "mira.png", { type: "image/png" }));
    const r = await api("POST", "/api/import", form);
    expect(r.json.results[0]).toMatchObject({ ok: true, kind: "character", name: "Mira" });
    expect(r.json.results[0].lorebookId).toBeTruthy();
    characterId = r.json.results[0].id;
    const ch = await api("GET", `/api/characters/${characterId}`);
    expect(ch.json.lorebooks).toHaveLength(1);
    expect(ch.json.avatarId).toBeTruthy();
    expect(ch.json.tokens.permanent).toBeGreaterThan(0);
  });

  test("persona + chat with greetings as swipes", async () => {
    await api("POST", "/api/personas", { name: "Ash", data: { description: "A wandering cartographer." } });
    const chat = await api("POST", "/api/chats", { characterId });
    expect(chat.status).toBe(201);
    chatId = chat.json.id;
    expect(chat.json.mode).toBe("companion");
    const msgs = await api("GET", `/api/chats/${chatId}/messages`);
    expect(msgs.json.messages).toHaveLength(1);
    expect(msgs.json.messages[0].content).toBe("Hello, Ash. Welcome to the lighthouse.");
    expect(msgs.json.messages[0].swipes).toHaveLength(2);
  });

  test("send → streamed reply saved server-side", async () => {
    const deltas: string[] = [];
    const off = subscribe((e) => {
      if (e.type === "gen.delta") deltas.push(e.text);
    });
    const ended = waitFor((e) => e.type === "gen.end");
    const r = await api("POST", `/api/chats/${chatId}/send`, { content: "I hold up the old lantern." });
    expect(r.status).toBe(200);
    expect(r.json.generationId).toBeTruthy();
    const end = (await ended) as Extract<MeaEvent, { type: "gen.end" }>;
    off();
    expect(end.status).toBe("done");
    const msg = await api("GET", `/api/messages/${r.json.messageId}`);
    expect(msg.json.content).toContain("The lamp flickers");
    // The speaker marks stream in (the page hides them) and come out of the saved reply into meta.
    expect(deltas.join("").replace(/\[spk=[^\]\n]*\]|\[\/spk\]/g, "")).toBe(msg.json.content);
    expect(msg.json.content).not.toContain("[spk=");
    expect(msg.json.meta.speakers[0]).toEqual({ text: '"You came back,"', name: "Mira", tone: "tender" });
    expect(msg.json.meta.model).toBe("mock/storyteller");
    expect(msg.json.reasoning).toContain("Mock reasoning");

    const gen = await api("GET", `/api/generations/${r.json.generationId}`);
    const loreTrace = gen.json.trace.lore as { comment: string; status: string; reason: string }[];
    expect(loreTrace.find((t) => t.status === "active")?.reason).toBe('key "lantern"');
    expect(JSON.stringify(gen.json.request.messages)).toContain("The lantern was her mother's.");
  });

  test("swipe with feedback, switch swipes, continue", async () => {
    const last = (await api("GET", `/api/chats/${chatId}/last`)).json;
    const ended = waitFor((e) => e.type === "gen.end");
    const sw = await api("POST", `/api/messages/${last.id}/swipe`, { feedback: "more dialogue" });
    expect(sw.json.swipeIdx).toBe(1);
    await ended;
    const gen = await api("GET", `/api/generations/${sw.json.generationId}`);
    expect(JSON.stringify(gen.json.request.messages)).toContain("more dialogue");
    const back = await api("PATCH", `/api/messages/${last.id}`, { activeSwipe: 0 });
    expect(back.json.activeSwipe).toBe(0);

    const before = back.json.content as string;
    const ended2 = waitFor((e) => e.type === "gen.end");
    await api("POST", `/api/messages/${last.id}/continue`);
    await ended2;
    const after = (await api("GET", `/api/messages/${last.id}`)).json.content as string;
    expect(after.startsWith(before)).toBe(true);
    expect(after.length).toBeGreaterThan(before.length);
  });

  test("delete a swipe: later versions move down, the last one stays", async () => {
    const last = (await api("GET", `/api/chats/${chatId}/last`)).json;
    const ended = waitFor((e) => e.type === "gen.end");
    expect((await api("POST", `/api/messages/${last.id}/swipe`, {})).status).toBe(200);
    await ended;
    const three = (await api("GET", `/api/messages/${last.id}`)).json;
    expect(three.swipeCount).toBe(3);
    const texts = three.swipes.map((s: any) => s.content as string);

    await api("PATCH", `/api/messages/${last.id}`, { activeSwipe: 1 });
    const two = await api("DELETE", `/api/messages/${last.id}/swipes/1`);
    expect(two.status).toBe(200);
    expect(two.json.swipeCount).toBe(2);
    expect(two.json.swipes.map((s: any) => s.idx)).toEqual([0, 1]);
    expect(two.json.swipes.map((s: any) => s.content)).toEqual([texts[0], texts[2]]);
    expect(two.json.activeSwipe).toBe(1);
    expect(two.json.content).toBe(texts[2]);

    const one = await api("DELETE", `/api/messages/${last.id}/swipes/0`);
    expect(one.json.swipeCount).toBe(1);
    expect(one.json.activeSwipe).toBe(0);
    expect(one.json.content).toBe(texts[2]);

    expect((await api("DELETE", `/api/messages/${last.id}/swipes/5`)).status).toBe(404);
    expect((await api("DELETE", `/api/messages/${last.id}/swipes/0`)).status).toBe(400);
  });

  test("a deleted message reads as gone, so open chats drop it", async () => {
    const last = (await api("GET", `/api/chats/${chatId}/last`)).json;
    await api("DELETE", `/api/messages/${last.id}`);
    expect((await api("GET", `/api/messages/${last.id}`)).status).toBe(404);
    await api("POST", `/api/messages/${last.id}/restore`);
    expect((await api("GET", `/api/messages/${last.id}`)).status).toBe(200);
  });

  test("edit, hide, delete and restore", async () => {
    const last = (await api("GET", `/api/chats/${chatId}/last`)).json;
    const edited = await api("PUT", `/api/messages/${last.id}`, { content: "Edited reply." });
    expect(edited.json.content).toBe("Edited reply.");
    const hidden = await api("PATCH", `/api/messages/${last.id}`, { hidden: true });
    expect(hidden.json.hidden).toBe(true);
    const preview = await api("GET", `/api/chats/${chatId}/prompt-preview`);
    expect(JSON.stringify(preview.json.messages)).not.toContain("Edited reply.");
    await api("DELETE", `/api/messages/${last.id}`);
    expect((await api("GET", `/api/chats/${chatId}/messages`)).json.messages.some((m: any) => m.id === last.id)).toBe(false);
    await api("POST", `/api/messages/${last.id}/restore`);
    expect((await api("GET", `/api/chats/${chatId}/messages`)).json.messages.some((m: any) => m.id === last.id)).toBe(true);
  });

  test("impersonate streams a draft", async () => {
    const r = await api("POST", `/api/chats/${chatId}/draft`, { kind: "impersonate" });
    expect(r.status).toBe(200);
    const chunks = String(r.json)
      .split("\n")
      .filter((l) => l.startsWith("data: "))
      .map((l) => JSON.parse(l.slice(6)) as { text?: string; done?: boolean });
    expect(chunks.map((c) => c.text ?? "").join("")).toContain("I keep my promises");
    expect(chunks.at(-1)?.done).toBe(true);
  });

  test("exports: JSONL, Markdown, HTML, card PNG", async () => {
    const jsonl = await api("GET", `/api/chats/${chatId}/export?format=jsonl`);
    const lines = String(jsonl.json).trim().split("\n");
    expect(JSON.parse(lines[0]!).character_name).toBe("Mira");
    expect(JSON.parse(lines[1]!).mes).toContain("Welcome to the lighthouse");
    expect(String((await api("GET", `/api/chats/${chatId}/export?format=md`)).json)).toContain("**Mira:**");
    expect(String((await api("GET", `/api/chats/${chatId}/export?format=html`)).json)).toContain("<article");
    const png = await api("GET", `/api/characters/${characterId}/export?format=png`);
    expect(png.res.headers.get("content-type")).toBe("image/png");
  });

  test("usage is tracked", async () => {
    const u = await api("GET", "/api/usage?days=1");
    expect(u.json.byDay[0].requests).toBeGreaterThanOrEqual(4);
  });

  test("remote devices must pair; pairing grants access", async () => {
    expect((await api("GET", "/api/characters", undefined, { server: remote })).status).toBe(401);
    expect((await api("POST", "/api/devices/pairing", {}, { server: remote })).status).toBe(401);
    const pairing = await api("POST", "/api/devices/pairing", {});
    expect(pairing.json.code).toHaveLength(8);
    expect(pairing.json.qrSvg).toContain("<svg");
    const bad = await api("POST", "/api/pair", { code: "WRONG123", name: "Phone" }, { server: remote });
    expect(bad.status).toBe(400);
    const ok = await api("POST", "/api/pair", { code: pairing.json.code, name: "Pixel" }, { server: remote });
    expect(ok.status).toBe(200);
    const cookie = ok.res.headers.get("set-cookie")!.split(";")[0]!;
    expect((await api("GET", "/api/characters", undefined, { server: remote, headers: { cookie } })).status).toBe(200);
    // A code works once.
    expect((await api("POST", "/api/pair", { code: pairing.json.code, name: "Again" }, { server: remote })).status).toBe(400);
    // Proxied requests from localhost (Tailscale Serve) are not trusted without the cookie.
    expect((await api("GET", "/api/characters", undefined, { headers: { "x-forwarded-for": "100.1.2.3" } })).status).toBe(401);
    // The tunnel's port: from localhost with no proxy headers, and still not trusted.
    const tunneled = () => {
      const req = new Request("http://localhost/api/characters");
      markPublic(req);
      return app.fetch(req, local);
    };
    expect((await tunneled()).status).toBe(401);
    const viaTunnel = new Request("http://localhost/api/devices/pairing", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    markPublic(viaTunnel);
    expect((await app.fetch(viaTunnel, local)).status).toBe(401);
  });

  test("cross-site writes are blocked", async () => {
    const r = await api("POST", "/api/personas", { name: "Evil" }, { headers: { origin: "https://evil.example", host: "localhost" } });
    expect(r.status).toBe(403);
  });

  test("trash: soft-deleted characters can be restored", async () => {
    await api("DELETE", `/api/characters/${characterId}`);
    expect((await api("GET", "/api/characters")).json.characters).toHaveLength(0);
    expect((await api("GET", "/api/trash")).json.characters).toHaveLength(1);
    await api("POST", `/api/characters/${characterId}/restore`);
    expect((await api("GET", "/api/characters")).json.characters).toHaveLength(1);
  });
});
