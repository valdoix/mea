import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { normalizeCard } from "../cards/card";
import { asCardLike, checkCardFields, draftGreeting, draftRules, fieldAssist, reviewCard, sortNotes, VOICE_SITUATIONS, voiceSamples, voiceToExamples } from "../creator/tools";
import { badRequest, body, must } from "../lib/http";
import { BENCH_PROBES, streamBench } from "../services/bench";
import { getCharacterRow } from "../services/characters";
import { detectMode } from "../services/mode";
import { createVariant, deleteVariant, draftVariant, getVariant, listVariants, type OwnerType, updateVariant } from "../services/variants";

/** Card tools (CHAR-11…17, PER-04) and variants (CHAR-06, PER-05). */
export const cardtools = new Hono();

const kind = z.enum(["character", "persona"]);
const card = z.record(z.string(), z.unknown());
const pov = z.enum(["first", "second", "third"]);
const tense = z.enum(["present", "past"]);

cardtools.post("/card-tools/assist", async (c) => {
  const input = await body(
    c,
    z.object({
      kind,
      field: z.string().max(40),
      action: z.enum(["expand", "condense", "rewrite", "prose", "pov", "edit", "unpuppet"]),
      text: z.string().min(1).max(40_000),
      card,
      instruction: z.string().max(2000).optional(),
      pov: pov.optional(),
      tense: tense.optional(),
    }),
  );
  if (input.action === "edit" && !input.instruction?.trim()) throw badRequest("Say what to change");
  return c.json(await fieldAssist({ ...input, card: asCardLike(input.card) }));
});

cardtools.post("/card-tools/sort", async (c) => {
  const input = await body(c, z.object({ kind, notes: z.string().min(1).max(100_000), card }));
  return c.json(await sortNotes({ ...input, card: asCardLike(input.card) }));
});

cardtools.post("/card-tools/check", async (c) => {
  const input = await body(c, z.object({ kind, card, pov: pov.optional(), deep: z.boolean().optional() }));
  const cl = asCardLike(input.card);
  return c.json({ issues: checkCardFields(input.kind, cl, input.pov ?? "third"), review: input.deep ? await reviewCard(input.kind, cl) : null });
});

cardtools.post("/card-tools/greeting", async (c) => {
  const input = await body(c, z.object({ card, situation: z.string().max(1000).default(""), pov: pov.default("third"), tense: tense.default("present") }));
  return c.json({ text: await draftGreeting({ ...input, card: asCardLike(input.card) }) });
});

cardtools.post("/card-tools/rules", async (c) => {
  const input = await body(c, z.object({ card }));
  return c.json({ text: await draftRules(asCardLike(input.card)) });
});

cardtools.get("/card-tools/voice/situations", (c) => c.json({ situations: VOICE_SITUATIONS, probes: BENCH_PROBES }));

cardtools.post("/card-tools/voice", async (c) => {
  const input = await body(
    c,
    z.object({ card, situations: z.array(z.string().max(60)).max(10).default([]), count: z.number().int().min(1).max(3).default(1), kept: z.array(z.object({ situation: z.string(), line: z.string() })).max(60).optional() }),
  );
  return c.json({ lines: await voiceSamples({ ...input, card: asCardLike(input.card) }) });
});

cardtools.post("/card-tools/voice/examples", async (c) => {
  const input = await body(c, z.object({ kept: z.array(z.object({ cue: z.string(), line: z.string() })).max(60) }));
  return c.json({ text: voiceToExamples(input.kept) });
});

/** The test bench (CHAR-16): streams one reply to a sandbox conversation. Nothing is saved. */
cardtools.post("/card-tools/bench", async (c) => {
  const input = await body(
    c,
    z.object({
      characterId: z.string().nullable().optional(),
      card,
      personaId: z.string().nullable().optional(),
      personaVariantId: z.string().nullable().optional(),
      mode: z.enum(["companion", "narrator"]).optional(),
      messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(20_000) })).max(60),
    }),
  );
  const data = normalizeCard({ spec: "chara_card_v3", data: input.card }).data;
  const mode = input.mode ?? (input.characterId ? getCharacterRow(input.characterId)?.mode : null) ?? detectMode(data).mode;
  const iterator = streamBench({ characterId: input.characterId ?? null, card: data, mode, personaId: input.personaId, personaVariantId: input.personaVariantId, messages: input.messages }, c.req.raw.signal);
  return streamSSE(c, async (stream) => {
    for await (const chunk of iterator) await stream.writeSSE({ data: JSON.stringify(chunk) });
  });
});

// ---------- variants ----------

const overlay = z.record(z.string(), z.union([z.string().max(40_000), z.array(z.string().max(40_000)).max(20)]));
const owner = (t: string) => (t === "personas" ? "persona" : "character") as OwnerType;

for (const path of ["characters", "personas"] as const) {
  cardtools.get(`/${path}/:id/variants`, (c) => c.json({ variants: listVariants(owner(path), c.req.param("id")) }));
  cardtools.post(`/${path}/:id/variants`, async (c) => {
    const input = await body(c, z.object({ name: z.string().max(80), note: z.string().max(500).optional(), overlay: overlay.optional(), avatarId: z.string().nullable().optional() }));
    return c.json(createVariant(owner(path), c.req.param("id"), input), 201);
  });
  /** Proposes a variant from an idea ("winter outfit", "modern AU"): only the fields that must change. */
  cardtools.post(`/${path}/:id/variants/draft`, async (c) => {
    const input = await body(c, z.object({ idea: z.string().min(1).max(1000) }));
    return c.json(await draftVariant(owner(path), c.req.param("id"), input.idea));
  });
}

cardtools.put("/variants/:id", async (c) => {
  const input = await body(c, z.object({ name: z.string().max(80).optional(), note: z.string().max(500).optional(), overlay: overlay.optional(), avatarId: z.string().nullable().optional() }));
  return c.json(updateVariant(c.req.param("id"), input));
});

cardtools.get("/variants/:id", (c) => c.json(must(getVariant(c.req.param("id")), "Variant not found")));

cardtools.delete("/variants/:id", (c) => {
  deleteVariant(c.req.param("id"));
  return c.json({ ok: true });
});
