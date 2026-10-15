import { type Context, Hono } from "hono";
import { z } from "zod";
import { getAgency, setAgency } from "../creator/books";
import { body } from "../lib/http";
import { getEnrichRun, restoreEnriched, startEnrich, stopEnrich } from "../lore/enrich";
import { growAnswer, growDirections, growQuestion } from "../lore/grow";
import { addPerson, answerPerson, enoughAnswers, fleshExtra, listPeople, personDirections, personQuestion, promotePerson, proposePeople, removePerson, weavePerson } from "../lore/people";

/**
 * Growing a saved lorebook (Lumiverse's hub, adapted): "Add lore" one question at a time, enriching
 * the entries in place, a world's people from a name to their own card, and a narrator's world agency.
 */
export const lorecraft = new Hono();

async function opts<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  return (await c.req.text()).trim() ? body(c, schema) : schema.parse({});
}

const source = z.enum(["idea", "typed", "picked", "extended"]).optional();
const steer = z.object({ steer: z.string().max(1000).optional(), avoid: z.array(z.string().max(1000)).max(30).optional() }).default({});

// ---------- add lore ----------

lorecraft.post("/lorebooks/:id/grow/question", async (c) => c.json(await growQuestion(c.req.param("id"), await opts(c, steer))));
lorecraft.post("/lorebooks/:id/grow/directions", async (c) => {
  const input = await body(c, z.object({ question: z.string().min(1).max(2000), why: z.string().max(1000).optional(), steer: z.string().max(1000).optional(), avoid: z.array(z.string().max(2000)).max(30).optional() }));
  return c.json({ directions: await growDirections(c.req.param("id"), input) });
});
lorecraft.post("/lorebooks/:id/grow/answer", async (c) => {
  const input = await body(c, z.object({ question: z.string().min(1).max(2000), answer: z.string().min(1).max(8000), source }));
  return c.json(await growAnswer(c.req.param("id"), input));
});

// ---------- enrich ----------

lorecraft.get("/lorebooks/:id/enrich", (c) => c.json({ run: getEnrichRun(c.req.param("id")) }));
lorecraft.post("/lorebooks/:id/enrich", async (c) => {
  const input = await opts(c, z.object({ entryIds: z.array(z.string()).max(2000).optional() }).default({}));
  return c.json({ run: startEnrich(c.req.param("id"), input) });
});
lorecraft.post("/lorebooks/:id/enrich/stop", (c) => c.json({ run: stopEnrich(c.req.param("id")) }));
lorecraft.post("/lorebooks/:id/enrich/:entryId/restore", (c) => c.json({ run: restoreEnriched(c.req.param("id"), c.req.param("entryId")) }));

// ---------- people ----------

const people = (bookId: string) => ({ people: listPeople(bookId), enough: enoughAnswers() });

lorecraft.get("/lorebooks/:id/people", (c) => c.json(people(c.req.param("id"))));
lorecraft.post("/lorebooks/:id/people", async (c) => {
  const input = await body(c, z.object({ name: z.string().trim().min(1).max(80), hook: z.string().max(300).optional() }));
  addPerson(c.req.param("id"), input);
  return c.json(people(c.req.param("id")), 201);
});
lorecraft.post("/lorebooks/:id/people/propose", async (c) => {
  await proposePeople(c.req.param("id"));
  return c.json(people(c.req.param("id")));
});
lorecraft.delete("/people/:pid", (c) => {
  removePerson(c.req.param("pid"));
  return c.json({ ok: true });
});
lorecraft.post("/people/:pid/extra", async (c) => c.json({ person: await fleshExtra(c.req.param("pid")) }));
lorecraft.post("/people/:pid/question", async (c) => c.json({ person: await personQuestion(c.req.param("pid"), (await opts(c, steer)).steer) }));
lorecraft.post("/people/:pid/answer", async (c) => {
  const input = await body(c, z.object({ qid: z.string(), answer: z.string().min(1).max(8000), source }));
  return c.json({ person: answerPerson(c.req.param("pid"), input.qid, input.answer, input.source) });
});
lorecraft.post("/people/:pid/directions", async (c) => {
  const input = await body(c, z.object({ qid: z.string(), steer: z.string().max(1000).optional() }));
  return c.json({ person: await personDirections(c.req.param("pid"), input.qid, input.steer) });
});
lorecraft.post("/people/:pid/weave", async (c) => c.json({ person: await weavePerson(c.req.param("pid")) }));
lorecraft.post("/people/:pid/promote", (c) => c.json(promotePerson(c.req.param("pid"))));

// ---------- world agency ----------

lorecraft.get("/characters/:id/agency", (c) => c.json({ agency: getAgency(c.req.param("id")) }));
lorecraft.put("/characters/:id/agency", async (c) => {
  const input = await body(c, z.object({ enabled: z.boolean(), agenda: z.string().max(1200), holds: z.array(z.string().max(300)).max(8) }));
  return c.json({ agency: setAgency(c.req.param("id"), input) });
});
