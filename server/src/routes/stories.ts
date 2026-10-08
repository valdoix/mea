import { Hono } from "hono";
import { z } from "zod";
import { body } from "../lib/http";
import { mustChat } from "../services/chats";
import {
  autoTitle,
  chatExtras,
  createCollection,
  deleteCollection,
  globalSearch,
  listCollections,
  lockTitle,
  renameCollection,
  reorderCollections,
  setChatCollection,
  setCover,
  storyStats,
} from "../services/stories";

/** Your library (Phase 3): titles and covers, collections, stats, and search across everything. */
export const stories = new Hono();

// ---------- titles and covers (LIB-04) ----------

stories.get("/chats/:id/extras", (c) => {
  mustChat(c.req.param("id"));
  return c.json(chatExtras(c.req.param("id")));
});

stories.post("/chats/:id/title/auto", (c) => {
  const id = c.req.param("id");
  mustChat(id);
  lockTitle(id, false);
  return c.json({ title: autoTitle(id) ?? mustChat(id).title, ...chatExtras(id) });
});

stories.put("/chats/:id/cover", async (c) => {
  const id = c.req.param("id");
  mustChat(id);
  const input = await body(c, z.object({ imageId: z.string().nullable() }));
  setCover(id, input.imageId);
  return c.json(chatExtras(id));
});

// ---------- collections (LIB-06) ----------

stories.get("/collections", (c) => c.json({ collections: listCollections() }));
stories.post("/collections", async (c) => {
  const input = await body(c, z.object({ name: z.string().trim().min(1).max(60) }));
  return c.json(createCollection(input.name), 201);
});
stories.patch("/collections/:id", async (c) => {
  const input = await body(c, z.object({ name: z.string().trim().min(1).max(60) }));
  renameCollection(c.req.param("id"), input.name);
  return c.json({ collections: listCollections() });
});
stories.delete("/collections/:id", (c) => {
  deleteCollection(c.req.param("id"));
  return c.json({ collections: listCollections() });
});
stories.post("/collections/order", async (c) => {
  const input = await body(c, z.object({ ids: z.array(z.string()).max(200) }));
  reorderCollections(input.ids);
  return c.json({ collections: listCollections() });
});
stories.put("/chats/:id/collections/:cid", async (c) => {
  const input = await body(c, z.object({ member: z.boolean() }));
  mustChat(c.req.param("id"));
  return c.json({ collections: setChatCollection(c.req.param("id"), c.req.param("cid"), input.member) });
});

// ---------- stats (LIB-07) ----------

stories.get("/chats/:id/stats", (c) => {
  mustChat(c.req.param("id"));
  return c.json(storyStats(c.req.param("id")));
});
stories.get("/stats", (c) => c.json(storyStats()));

// ---------- search everything (LIB-05) ----------

stories.get("/search/all", (c) => {
  const kinds = (c.req.query("kinds") ?? "").split(",").filter(Boolean) as ("message" | "character" | "lore" | "memory" | "summary")[];
  return c.json(globalSearch(c.req.query("q") ?? "", { limit: Number(c.req.query("limit")) || undefined, kinds }));
});
