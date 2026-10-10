import { beforeAll, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { checkPersona } from "../src/creator/checks";
import { createCreatorDraft, creatorReadback, getCreatorDraft, queueFields, reviewCreator, runCreatorJob, writeBible } from "../src/creator/creator";
import { personaSlip, unslipPersona, WHO_IS_WHO } from "../src/creator/smarts";
import { all } from "../src/db/db";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { registerJob } from "../src/services/jobs";
import { freshDb } from "./helpers";

let app: ReturnType<typeof createApp>;
const local = { requestIP: () => ({ address: "127.0.0.1", family: "IPv4", port: 5000 }) };
async function api<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> {
  const res = await app.fetch(new Request(`http://localhost${path}`, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined }), local);
  return { status: res.status, json: (await res.json()) as T };
}
/** The system prompt of the latest request of one kind. */
const sent = (kind: string) => {
  const r = all<{ request: string }>("SELECT request FROM generations WHERE kind = ? ORDER BY started_at DESC, rowid DESC LIMIT 1", kind)[0];
  return r ? r.request : "";
};

beforeAll(async () => {
  freshDb();
  for (const kind of ["lore.studio", "lore.embed", "creator.write"]) registerJob(kind, async () => {});
  app = createApp();
  const conn = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
  await syncModels(conn);
  createProfile({ name: "Story", connectionId: conn, modelId: "mock/storyteller", params: { context_target: 4000 } });
});

describe("who is who", () => {
  test("card words in a persona are caught, and a slipped {{char}} becomes their name", () => {
    expect(personaSlip("{{char}} keeps a knife.")).toContain("never {{char}}");
    expect(personaSlip("<START>\n{{user}}: hi")).toContain("no example dialogue");
    expect(personaSlip("Ash keeps a knife.")).toBeNull();
    expect(unslipPersona("{{char}} keeps a knife; {{ char }} never says why.", "Ash")).toBe("Ash keeps a knife; Ash never says why.");
    expect(checkPersona("Ash grew up with {{user}} in the docks.").map((i) => i.kind)).toEqual(["card-words"]);
    expect(checkPersona("Ash grew up in the docks.")).toEqual([]);
  });

  test("every persona step is told it's the player's own character, and card prompts never reach it", async () => {
    const p = createCreatorDraft({ kind: "persona", idea: "Ash, a dock worker who reads tides.", options: { tone: "MOCK_SLIP" } });
    await creatorReadback(p.id);
    const readback = sent("creator:readback");
    expect(readback).toContain("This is a PERSONA");
    expect(readback).not.toContain("what they want from {{user}}, the line");
    await writeBible(p.id);
    expect(sent("creator:bible")).toContain("This is a PERSONA");
    expect(sent("creator:bible")).toContain("Persona craft");
    queueFields(p.id);
    await runCreatorJob(p.id);
    expect(sent("creator:description")).toContain("This is a PERSONA");
    expect(sent("creator:description")).toContain("no {{char}} or {{user}} macros");
    // The mock slipped {{char}} in; it comes out as the name.
    const d = getCreatorDraft(p.id)!;
    expect(d.fields.find((f) => f.key === "description")!.value).toContain("Ash hides it well.");
    expect(d.fields.every((f) => !f.value.includes("{{char}}"))).toBe(true);
    expect(Object.values(reviewCreator(p.id).issues).flat().filter((i) => i.kind === "card-words")).toEqual([]);

    await api("POST", `/api/creator/${p.id}/critique`);
    expect(sent("creator:critique")).toContain("anything written as if this were a character card");
    expect(sent("creator:critique")).not.toContain("greetings that repeat each other");
    await api("POST", `/api/creator/${p.id}/cowrite`, { message: "Is her age consistent?" });
    const cw = sent("creator:cowrite");
    expect(cw).toContain("This is a PERSONA");
    expect(cw).not.toContain("a greeting, the description");
    expect(cw).toContain("length: lean|standard|rich");
    expect(cw).not.toContain("mode: companion|narrator");

    // A character card keeps its card framing.
    const c = createCreatorDraft({ kind: "character", idea: "Mira, a lighthouse keeper." });
    await creatorReadback(c.id);
    expect(sent("creator:readback")).toContain(WHO_IS_WHO.character);
  });

  test("a persona written as a card (or the reverse) is noticed, and can switch kind in place", async () => {
    const c = createCreatorDraft({ kind: "character", idea: "I'm a night nurse at St. Brigid's, I keep a flask in my locker." });
    const read = await creatorReadback(c.id);
    expect(read.kindHint).toEqual({ kind: "persona", why: `It says "I'm".` });
    const switched = (await api("POST", `/api/creator/${c.id}/kind`, { kind: "persona" })).json.draft;
    expect(switched.kind).toBe("persona");
    expect(switched.name).toBe("New persona");
    expect(switched.kindHint).toBeNull();
    expect(switched.fields.map((f: { key: string }) => f.key)).toEqual(["description", "appearance", "personality", "background", "pronouns"]);
    expect(switched.questions).toEqual([]);
    // Once you've said what it is, the read-back stops suggesting otherwise.
    await creatorReadback(c.id);
    expect(getCreatorDraft(c.id)!.kindHint).toBeNull();

    const p = createCreatorDraft({ kind: "persona", idea: "A gruff ranger for the AI to play. MOCK_CARD" });
    expect((await creatorReadback(p.id)).kindHint?.kind).toBe("character");
    await api("PUT", `/api/creator/${p.id}`, { dismissKindHint: true });
    expect(getCreatorDraft(p.id)!.kindHint).toBeNull();
    await creatorReadback(p.id);
    expect(getCreatorDraft(p.id)!.kindHint).toBeNull();
    expect(getCreatorDraft(p.id)!.kind).toBe("persona");
  });
});

describe("a more capable co-writer", () => {
  test("it answers questions, changes the shape and canon, writes the rest, and sees what's flagged", async () => {
    const d = createCreatorDraft({ kind: "character", idea: "Mira, a lighthouse keeper who owes the harbour guild." });
    await creatorReadback(d.id);
    // Answers an open question.
    const a = (await api("POST", `/api/creator/${d.id}/cowrite`, { message: "Answer the first question for me" })).json.draft;
    const ans = a.proposal.changes.find((c: { kind: string }) => c.kind === "answer");
    expect(ans.label).toContain("Answer");
    await api("POST", `/api/creator/${d.id}/cowrite/apply`, { accept: [ans.id] });
    expect(getCreatorDraft(d.id)!.questions.find((q) => q.id === ans.target)!.answer).toBe("To be forgiven by her sister.");

    // Shape: "first person" is read as first; canon is set.
    const s = (await api("POST", `/api/creator/${d.id}/cowrite`, { message: "Make it shorter, in first person, and follow canon" })).json.draft;
    expect(s.proposal.changes.map((c: { kind: string; target: string; after: string }) => `${c.kind}:${c.target}=${c.after}`)).toEqual(["option:length=lean", "option:pov=first", "basedOn:basedOn=Mock Show (TV)"]);
    await api("POST", `/api/creator/${d.id}/cowrite/apply`, { accept: s.proposal.changes.map((c: { id: string }) => c.id) });
    const cur = getCreatorDraft(d.id)!;
    expect(cur.options.length).toBe("lean");
    expect(cur.options.pov).toBe("first");
    expect(cur.basedOn).toBe("Mock Show (TV)");

    // Writing the rest goes to the background writer (only once there's a bible).
    expect((await api("POST", `/api/creator/${d.id}/cowrite`, { message: "Write the rest" })).json.draft.proposal).toBeNull();
    await writeBible(d.id);
    const w = (await api("POST", `/api/creator/${d.id}/cowrite`, { message: "Write the rest" })).json.draft;
    const write = w.proposal.changes[0];
    expect(write.kind).toBe("write");
    expect(write.after).toContain("Greeting");
    const applied = (await api("POST", `/api/creator/${d.id}/cowrite/apply`, { accept: [write.id] })).json.draft;
    expect(applied.fields.every((f: { status: string }) => f.status === "queued")).toBe(true);
    await runCreatorJob(d.id);

    // It's told what's out of date, so "fix what's flagged" can act on it.
    const voice = getCreatorDraft(d.id)!.bible.find((b) => b.key === "voice")!;
    await api("PUT", `/api/creator/${d.id}`, { bible: { voice: `${voice.text} She hums when she lies.` } });
    const f = (await api("POST", `/api/creator/${d.id}/cowrite`, { message: "Fix what's flagged" })).json.draft;
    expect(sent("creator:cowrite")).toContain("THE STATE OF THE DRAFT");
    expect(f.proposal.changes[0].after).toBe("Fixed: {{char}} is up to date.");
  });

  test("a persona's co-writer can't set card-only options", async () => {
    const p = createCreatorDraft({ kind: "persona", idea: "Ash, a dock worker who reads tides." });
    const r = (await api("POST", `/api/creator/${p.id}/cowrite`, { message: "Make it shorter, in first person" })).json.draft;
    expect(r.proposal.changes.map((c: { target: string }) => c.target)).toEqual(["length"]);
  });
});
