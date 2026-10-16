import { Hono } from "hono";
import { z } from "zod";
import { variantPlanOf } from "../creator/creator";
import { ROW_STATES, ROW_TYPES, type RowState, type RowType } from "../creator/variantcore";
import { body } from "../lib/http";
import { versionKind } from "../services/linked";
import { createUniverse, deleteUniverse, joinUniverse, leaveUniverse, listUniverses, mergeIntoUniverse, universeDetail, updateUniverse } from "../services/universes";

/**
 * Universes (docs/14, part 4).
 * - GET    /universes                      every universe, with who's in it
 * - POST   /universes                      a new one (name, premise, kind)
 * - GET    /universes/:id                  one, with its map, members and world book
 * - PUT    /universes/:id                  name, premise, kind and map rows
 * - DELETE /universes/:id                  members stay versions and keep the world book
 * - POST   /universes/:id/join             a version joins ({ kind, id })
 * - POST   /{characters,personas}/:id/leave-universe   it leaves, keeping a copy of the world
 */
export const universes = new Hono();

const mapPatch = z.object({
  id: z.string().optional(),
  type: z.enum(ROW_TYPES as [RowType, ...RowType[]]).optional(),
  from: z.string().max(200).optional(),
  to: z.string().max(300).optional(),
  state: z.enum(ROW_STATES as [RowState, ...RowState[]]).optional(),
  note: z.string().max(300).optional(),
  remove: z.boolean().optional(),
});

universes.get("/universes", (c) => c.json({ universes: listUniverses() }));

universes.post("/universes", async (c) => {
  const input = await body(c, z.object({ name: z.string().max(120), premise: z.string().max(8000).optional(), kind: versionKind.nullable().optional() }));
  return c.json(universeDetail(createUniverse(input).id), 201);
});

universes.get("/universes/:id", (c) => c.json(universeDetail(c.req.param("id"))));

universes.put("/universes/:id", async (c) => {
  const input = await body(c, z.object({ name: z.string().max(120).optional(), premise: z.string().max(8000).optional(), kind: versionKind.nullable().optional(), map: z.array(mapPatch).max(300).optional() }));
  updateUniverse(c.req.param("id"), input);
  return c.json(universeDetail(c.req.param("id")));
});

universes.delete("/universes/:id", (c) => {
  deleteUniverse(c.req.param("id"));
  return c.json({ ok: true });
});

universes.post("/universes/:id/join", async (c) => {
  const input = await body(c, z.object({ kind: z.enum(["character", "persona"]), id: z.string().min(1) }));
  joinUniverse(input.kind, input.id, c.req.param("id"));
  // A version made in the studio brings its map decisions into the shared map, as saving there does.
  const plan = variantPlanOf(input.kind, input.id);
  if (plan) mergeIntoUniverse(c.req.param("id"), plan.map);
  return c.json(universeDetail(c.req.param("id")));
});

for (const path of ["characters", "personas"] as const)
  universes.post(`/${path}/:id/leave-universe`, (c) => c.json({ ok: true, ...(leaveUniverse(path === "personas" ? "persona" : "character", c.req.param("id")) ?? { copyBookId: null }) }));
