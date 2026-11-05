import { Hono } from "hono";
import { z } from "zod";
import { badRequest, body } from "../lib/http";
import { getSetting } from "../lib/settings";
import { compilePrompt, directionSchema, familyOf, knowsFaces, PortraitRuleError, STYLE_INFO } from "../portraits/compile";
import { deleteLook, getLook, lookSchema, ownerSchema, saveLook, STYLES } from "../portraits/look";
import { directions, readBack } from "../portraits/writer";
import { imageModel } from "../services/imagegen";

/** docs/28 Part 2: the prompt writer. The Portrait Studio (Part 3) is its first user. */
export const portraits = new Hono();

portraits.get("/portraits/styles", (c) => c.json({ styles: STYLES.map((id) => ({ id, label: STYLE_INFO[id].label })) }));

portraits.post("/portraits/readback", async (c) => {
  const input = await body(c, z.object({ idea: z.string().max(2000), ownerType: ownerSchema.nullish(), ownerId: z.string().nullish() }));
  if (!input.idea.trim() && !(input.ownerType && input.ownerId)) throw badRequest("Write an idea first");
  return c.json(await readBack(input));
});

portraits.post("/portraits/directions", async (c) => {
  const input = await body(c, z.object({ look: lookSchema, idea: z.string().max(2000).default(""), era: z.string().max(200).optional(), steer: z.string().max(400).optional() }));
  return c.json({ directions: await directions(input) });
});

/** The prompt for a model, put together by code. A rule it can't keep (§5) is a 400 with the reason. */
portraits.post("/portraits/compile", async (c) => {
  const input = await body(
    c,
    z.object({
      look: lookSchema,
      direction: directionSchema,
      model: z.string().min(1).max(200),
      connectionId: z.string().nullish(),
      style: z.enum(STYLES).nullish(),
      realPeople: z.array(z.string().max(80)).max(12).default([]),
    }),
  );
  const conn = input.connectionId ?? getSetting("images.config").connectionId;
  const info = (conn ? imageModel(conn, input.model) : null) ?? { id: input.model, tags: [], maxPromptChars: null };
  try {
    return c.json({ ...compilePrompt({ look: input.look, direction: input.direction, model: info, style: input.style, realPeople: input.realPeople }), model: input.model });
  } catch (e) {
    if (e instanceof PortraitRuleError) throw badRequest(e.message, { rule: e.rule });
    throw e;
  }
});

/** What the writer knows about a model: its prompt family, and whether it draws real faces (§5 rule 3). */
portraits.get("/portraits/models/:id{.+}", (c) => {
  const id = c.req.param("id");
  const conn = getSetting("images.config").connectionId;
  const info = (conn ? imageModel(conn, id) : null) ?? { id, tags: [] };
  return c.json({ id, family: familyOf(info), knowsFaces: knowsFaces(id) });
});

portraits.get("/portraits/looks/:ownerType/:ownerId", (c) => {
  const type = ownerSchema.parse(c.req.param("ownerType"));
  return c.json({ look: getLook(type, c.req.param("ownerId")) });
});

portraits.put("/portraits/looks/:ownerType/:ownerId", async (c) => {
  const type = ownerSchema.parse(c.req.param("ownerType"));
  const { look } = await body(c, z.object({ look: z.unknown() }));
  return c.json({ look: saveLook(type, c.req.param("ownerId"), look) });
});

portraits.delete("/portraits/looks/:ownerType/:ownerId", (c) => {
  deleteLook(ownerSchema.parse(c.req.param("ownerType")), c.req.param("ownerId"));
  return c.json({ ok: true });
});
