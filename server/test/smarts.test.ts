import { beforeAll, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { htmlToText, publicUrl, workName } from "../src/creator/research";
import { covers, ideaChanges, lastPerSection, misfiledSections, splitPeople, withDropNote, withLookups } from "../src/creator/smarts";
import { createCreatorDraft, getCreatorDraft, patchCreator, reviewCreator, runCreatorJob, writeBible, queueFields } from "../src/creator/creator";
import { createDraft, getDraft, namesInText, patchDraft, planOutline, queueWrite, reviewDraft, runStudioJob, uncovered } from "../src/lore/studio";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { registerJob } from "../src/services/jobs";
import { freshDb } from "./helpers";

let app: ReturnType<typeof createApp>;
const local = { requestIP: () => ({ address: "127.0.0.1", family: "IPv4", port: 5000 }) };
async function api<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> {
  const res = await app.fetch(new Request(`http://localhost${path}`, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined }), local);
  return { status: res.status, json: (await res.json()) as T };
}

beforeAll(async () => {
  freshDb();
  // The tests drive the writers themselves; the queue's copies do nothing.
  for (const kind of ["lore.studio", "lore.embed", "creator.write"]) registerJob(kind, async () => {});
  app = createApp();
  const conn = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
  await syncModels(conn);
  createProfile({ name: "Story", connectionId: conn, modelId: "mock/storyteller", params: { context_target: 4000 } });
});

describe("names", () => {
  test("people lumped together are split; titles written differently still match", () => {
    expect(splitPeople("Taissa Turner & Van Palmer")).toEqual(["Taissa Turner", "Van Palmer"]);
    expect(splitPeople("Gen, Melissa & Crystal")).toEqual(["Gen", "Melissa", "Crystal"]);
    expect(splitPeople("The Holloways and the Taylors")).toEqual(["The Holloways and the Taylors"]);
    expect(covers(["Natalie Scatorccio"], "Natalie")).toBe(true);
    expect(covers(["Coach Ben Scott"], "Ben Scott")).toBe(true);
    expect(covers(["Coach Bill Martinez"], "Ben Scott")).toBe(false);
    expect(namesInText("Keep the rest canon. Jackie and Laura Lee argue; later Laura Lee prays. Water is cold.")).toContain("Laura Lee");
    expect(namesInText("Keep the rest canon. Water is cold.")).not.toContain("Keep");
  });
});

describe("research", () => {
  test("only public pages are fetched; wiki HTML becomes clean text", () => {
    for (const bad of ["http://localhost:7766/api", "http://127.0.0.1/", "http://192.168.1.4/", "http://10.0.0.1", "file:///etc/passwd", "http://[::1]/", "http://mea.local/"]) expect(publicUrl(bad)).toBeNull();
    expect(publicUrl("https://yellowjackets.fandom.com/wiki/Laura_Lee")?.hostname).toBe("yellowjackets.fandom.com");
    const html = `<p>Laura Lee is a <b>Yellowjacket</b>.<sup>[1]</sup></p><h2>Contents</h2><ul><li>1 Profile</li></ul><script>x()</script><p>She prays &amp; hopes.</p>`;
    const text = htmlToText(html);
    expect(text).toContain("Laura Lee is a Yellowjacket .");
    expect(text).toContain("She prays & hopes.");
    expect(text).not.toContain("x()");
    expect(workName("Yellowjackets (TV series, 2021)")).toBe("Yellowjackets");
  });

  test("the co-writer looks pages up once, then answers with them", async () => {
    const asked: string[] = [];
    const r = await withLookups(
      async (looked) => {
        asked.push(looked);
        return looked ? { reply: "In canon she dies in the lake.", lookup: [] } : { reply: "", lookup: ["Laura Lee"] };
      },
      async (q) => ({ title: `${q} (Wiki)`, url: "https://x.fandom.com/wiki/Laura_Lee", text: "She flies the plane." }),
    );
    expect(asked.length).toBe(2);
    expect(asked[1]).toContain("She flies the plane.");
    expect(r.data.reply).toBe("In canon she dies in the lake.");
    expect(r.sources.map((p) => ({ title: p.title, url: p.url }))).toEqual([{ title: "Laura Lee (Wiki)", url: "https://x.fandom.com/wiki/Laura_Lee" }]);
  });
});

describe("the Lore Studio plans everyone", () => {
  test("a census comes first; Everything plans all of it; coverage lists what's left", async () => {
    const d = createDraft({ kind: "idea", text: "A harbour story MOCK_CANON. Jackie Taylor and James Holloway grew up together. Natalie Scatorccio smokes behind the gym.", options: { size: "small" } });
    await planOutline(d.id);
    let cur = getDraft(d.id)!;
    expect(cur.basedOn).toBe("Mock Show (TV)");
    expect(cur.census!.map((e) => e.name)).toEqual(expect.arrayContaining(["Jackie Taylor", "James Holloway", "Laura Lee", "Van Palmer"]));
    // The small plan can't hold everyone, so the rest is listed…
    const left = uncovered(cur).map((e) => e.name);
    // …and "Add" plans exactly those.
    if (left.length) {
      await planOutline(d.id, { names: left });
      cur = getDraft(d.id)!;
      expect(uncovered(cur)).toEqual([]);
    }
    // Everything: every census name gets an entry, plus the ideas that hold the world together.
    patchDraft(d.id, { options: { size: "complete" } });
    await planOutline(d.id, { mode: "replace" });
    cur = getDraft(d.id)!;
    for (const name of ["Laura Lee", "Van Palmer", "Natalie Scatorccio"]) expect(cur.items.some((i) => covers([i.title], name))).toBe(true);
    expect(uncovered(cur)).toEqual([]);
  });

  test("suggested answers, stale entries, the editor's pass and the co-writer", async () => {
    const d = createDraft({ kind: "idea", text: "Port Ellis, a fog-bound harbour. Mira keeps the lighthouse." });
    const rb = await api("POST", `/api/lore-studio/${d.id}/readback`);
    expect(rb.json.draft.questions[0].suggestions.length).toBe(3);
    await planOutline(d.id);
    queueWrite(d.id);
    await runStudioJob(d.id);
    let cur = getDraft(d.id)!;
    const first = cur.items.find((i) => i.entry)!;
    expect(first.basis).toMatch(/^o:/);
    expect(reviewDraft(d.id).stale).toEqual({});
    // A new overview leaves every written entry out of date, with the reason.
    patchDraft(d.id, { overview: `${cur.overview} The lighthouse is dark now.` });
    expect(reviewDraft(d.id).stale[first.id]).toEqual(["the overview"]);

    // The editor's pass: a rewrite fix and a missing entry.
    const crit = await api("POST", `/api/lore-studio/${d.id}/critique`);
    const issues = crit.json.draft.critique as { id: string; kind: string; add: unknown }[];
    expect(issues.map((i) => i.kind)).toEqual(["flat", "gap"]);
    const gap = issues.find((i) => i.add)!;
    const applied = await api("POST", `/api/lore-studio/${d.id}/critique/${gap.id}`);
    expect(applied.json.draft.items.some((i: { title: string }) => i.title === "The Ferry")).toBe(true);
    expect(applied.json.draft.critique.length).toBe(1);

    // The co-writer proposes; nothing changes until you accept, and you pick which.
    const before = getDraft(d.id)!.overview;
    const p = await api("POST", `/api/lore-studio/${d.id}/cowrite`, { message: "Make the overview darker, rewrite it, and add a keeper" });
    const prop = p.json.draft.proposal;
    expect(prop.changes.map((c: { kind: string }) => c.kind)).toEqual(["overview", "rewrite", "add"]);
    expect(getDraft(d.id)!.overview).toBe(before);
    const keep = prop.changes.filter((c: { kind: string }) => c.kind !== "add").map((c: { id: string }) => c.id);
    const done = await api("POST", `/api/lore-studio/${d.id}/cowrite/apply`, { accept: keep });
    cur = getDraft(d.id)!;
    expect(cur.overview).toStartWith("New overview:");
    expect(cur.items.some((i) => i.title === "The Lighthouse Keeper")).toBe(false);
    expect(cur.items.some((i) => i.status === "queued" && i.steer.includes("darker"))).toBe(true);
    expect(cur.proposal).toBeNull();
    expect(done.json.draft.chat.map((t: { role: string }) => t.role)).toEqual(["user", "mea", "mea"]);
  });
});

describe("brainstorming the expanded idea", () => {
  const exp = {
    use: true,
    steer: "",
    sections: [
      { id: "p", heading: "Premise", text: "Old premise." },
      { id: "f", heading: "Powers and Factions", text: "The Trio build devices." },
      { id: "h", heading: "Story Hooks", text: "Old hooks." },
    ],
  };
  test("section changes survive how the model happens to write them", () => {
    // The text in "content", the heading in "entry", spelled a little differently.
    expect(ideaChanges({ kind: "section", text: "", content: "No Trio.", entry: "**[Powers & Factions]**" }, "", exp)).toMatchObject([{ kind: "section", target: "f", label: "Concept · Powers and Factions", after: "No Trio." }]);
    // A section that repeats its heading loses it; an unknown heading is a new section; the same text is no change.
    expect(ideaChanges({ kind: "concept", section: "Premise", text: "[Premise]\nNew premise." }, "", exp)).toMatchObject([{ target: "p", after: "New premise." }]);
    expect(ideaChanges({ kind: "section", section: "Weather", text: "Fog." }, "", exp)).toMatchObject([{ target: "", label: "Concept · Weather (new)" }]);
    expect(ideaChanges({ kind: "section", section: "Premise", text: "Old premise." }, "", exp)).toEqual([]);
  });
  test("every section in one block is split back into one change per section, wherever it was filed", () => {
    const block = "---\n\n**[Premise]**\nBuffy claws out of her grave.\n\n**Gabriel** finds her.\n\n## Powers & Factions\nNo Trio.\n\nStory Hooks\nThe grave scene opens it.\n\n---";
    const want = [
      { target: "p", after: "Buffy claws out of her grave.\n\n**Gabriel** finds her." },
      { target: "f", after: "No Trio." },
      { target: "h", after: "The grave scene opens it." },
    ];
    expect(ideaChanges({ kind: "section", section: "Overview", text: block }, "", exp)).toMatchObject(want);
    expect(ideaChanges({ kind: "idea", text: block }, "An idea.", exp)).toMatchObject(want);
    expect(misfiledSections(block, exp)).toMatchObject(want);
    // A real overview stays an overview.
    expect(misfiledSections("Buffy is back.\n\nPremise\nIt opens at the grave.", exp)).toEqual([]);
  });
  test("the last change to a section wins, and dropped changes are owned up to", () => {
    const one = ideaChanges({ kind: "section", section: "Premise", text: "First." }, "", exp);
    const two = ideaChanges({ kind: "section", section: "premise", text: "Second." }, "", exp);
    expect(lastPerSection([...one, ...two]).map((c) => c.after)).toEqual(["Second."]);
    expect(withDropNote("Done.", 2, 2)).toBe("Done.");
    expect(withDropNote("Done.", 3, 0)).toContain("nothing to apply");
  });
  test("the co-writer changes and adds sections of 'Expand my idea' in both studios", async () => {
    const lore = createDraft({ kind: "idea", text: "Port Ellis, a fog-bound harbour." });
    await api("POST", `/api/lore-studio/${lore.id}/expand`);
    const p = await api("POST", `/api/lore-studio/${lore.id}/cowrite`, { message: "Brainstorm the concept with me" });
    const changes = p.json.draft.proposal.changes as { id: string; kind: string; label: string }[];
    expect(changes.map((c) => c.label)).toEqual(["Concept · Central tension", "Concept · Weather (new)"]);
    await api("POST", `/api/lore-studio/${lore.id}/cowrite/apply`, { accept: changes.map((c) => c.id) });
    const exp = getDraft(lore.id)!.expansion!;
    expect(exp.sections.find((s) => s.heading === "Central tension")!.text).toStartWith("Sharper:");
    expect(exp.sections.at(-1)).toMatchObject({ heading: "Weather", text: "The fog has a will." });

    const ch = createCreatorDraft({ kind: "character", idea: "Wren, a lighthouse keeper." });
    await api("POST", `/api/creator/${ch.id}/expand`);
    const q = await api("POST", `/api/creator/${ch.id}/cowrite`, { message: "Let's push the concept's voice" });
    const c2 = q.json.draft.proposal.changes as { id: string; label: string }[];
    expect(c2.map((c) => c.label)).toEqual(["Concept · Voice"]);
    await api("POST", `/api/creator/${ch.id}/cowrite/apply`, { accept: c2.map((c) => c.id) });
    expect(getCreatorDraft(ch.id)!.expansion!.sections.find((s) => s.heading === "Voice")!.text).toStartWith("Brainstormed:");
  });
});

describe("the creator", () => {
  test("suggested answers, stale fields, the editor's pass and the co-writer", async () => {
    const d = createCreatorDraft({ kind: "character", idea: "Wren, a lighthouse keeper with a debt." });
    const rb = await api("POST", `/api/creator/${d.id}/readback`);
    expect(rb.json.draft.questions[0].suggestions).toEqual(["To be forgiven", "To leave", "To be chosen first"]);
    await writeBible(d.id);
    queueFields(d.id, { keys: ["description", "first_mes", "tags"] });
    await runCreatorJob(d.id);
    expect(reviewCreator(d.id).stale).toEqual({});
    // A new voice dates the fields that read it, and only those.
    const voice = getCreatorDraft(d.id)!.bible.find((b) => b.key === "voice")!;
    patchCreator(d.id, { bible: { voice: `${voice.text} She hums when she lies.` } });
    const stale = reviewCreator(d.id).stale;
    expect(stale.description).toEqual(["Voice"]);
    expect(stale.first_mes).toEqual(["Voice"]);
    expect(stale.tags).toBeUndefined();
    // Your own edit brings a field up to date.
    patchCreator(d.id, { fields: { description: "Edited by hand." } });
    expect(reviewCreator(d.id).stale.description).toBeUndefined();

    const crit = await api("POST", `/api/creator/${d.id}/critique`);
    const note = crit.json.draft.fieldCheck[0];
    expect(note.field).toBe("first_mes");
    const applied = await api("POST", `/api/creator/${d.id}/critique/${note.id}`);
    expect(applied.json.draft.fields.find((f: { key: string }) => f.key === "first_mes").status).toBe("queued");
    await runCreatorJob(d.id);

    const p = await api("POST", `/api/creator/${d.id}/cowrite`, { message: "Make her 41" });
    const changes = p.json.draft.proposal.changes as { id: string; kind: string; target: string }[];
    expect(changes.map((c) => `${c.kind}:${c.target}`)).toEqual(["bible:identity", "field:description", "rewrite:first_mes"]);
    await api("POST", `/api/creator/${d.id}/cowrite/apply`, { accept: changes.map((c) => c.id) });
    const cur = getCreatorDraft(d.id)!;
    expect(cur.bible.find((b) => b.key === "identity")!.text).toBe("Now 41 years old.");
    expect(cur.fields.find((f) => f.key === "description")!.value).toBe("She is 41.");
    expect(cur.fields.find((f) => f.key === "first_mes")!.status).toBe("queued");
    expect(cur.proposal).toBeNull();
    // Nothing to change: an answer, no proposal.
    const q = await api("POST", `/api/creator/${d.id}/cowrite`, { message: "Is her age consistent?" });
    expect(q.json.draft.proposal).toBeNull();
    expect(q.json.draft.chat.at(-1).text).toBe("Nothing contradicts that.");
  });
});
