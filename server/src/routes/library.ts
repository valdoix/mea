import { Hono } from "hono";
import { z } from "zod";
import { emptyCard, normalizeCard } from "../cards/card";
import { badRequest, body, must } from "../lib/http";
import {
  allFolders,
  allTags,
  createCharacter,
  exportCharacter,
  getCard,
  getCharacter,
  listCharacters,
  listVersions,
  restoreCharacter,
  restoreVersion,
  softDeleteCharacter,
  tokenCounts,
  updateCharacter,
} from "../services/characters";
import { getImage, imagePath, saveImage, setThumbnail } from "../services/images";
import { importFile } from "../services/importer";
import { detectMode } from "../services/mode";
import { createPersona, getPersona, listPersonas, restorePersona, softDeletePersona, updatePersona } from "../services/personas";

export const library = new Hono();

const modeSchema = z.enum(["companion", "narrator"]).nullable();

// ---------- Characters ----------

library.get("/characters", (c) => {
  const q = c.req.query();
  return c.json({
    characters: listCharacters({
      q: q.q,
      tag: q.tag,
      folder: q.folder,
      favorite: q.favorite === "1",
      sort: (q.sort as "recent" | "name" | "created" | "updated") || "recent",
      deleted: q.deleted === "1",
    }),
    tags: allTags(),
    folders: allFolders(),
  });
});

library.post("/characters", async (c) => {
  const input = await body(c, z.object({ card: z.record(z.string(), z.unknown()).optional(), name: z.string().optional() }));
  const card = input.card ? normalizeCard({ spec: "chara_card_v3", data: input.card }).data : emptyCard(input.name || "New character");
  const id = createCharacter(card);
  return c.json(getCharacter(id), 201);
});

library.get("/characters/:id", (c) => c.json(must(getCharacter(c.req.param("id")), "Character not found")));

library.put("/characters/:id", async (c) => {
  const id = c.req.param("id");
  const input = await body(
    c,
    z.object({
      card: z.record(z.string(), z.unknown()).optional(),
      note: z.string().optional(),
      tags: z.array(z.string()).optional(),
      folder: z.string().nullable().optional(),
      favorite: z.boolean().optional(),
      defaultPersonaId: z.string().nullable().optional(),
      mode: modeSchema.optional(),
      avatarId: z.string().nullable().optional(),
      gallery: z.array(z.string()).optional(),
    }),
  );
  let card;
  if (input.card) {
    try {
      card = normalizeCard({ spec: "chara_card_v3", data: input.card }).data;
    } catch (e) {
      throw badRequest((e as Error).message);
    }
  }
  must(updateCharacter(id, { ...input, card }) || undefined, "Character not found");
  return c.json(getCharacter(id));
});

library.delete("/characters/:id", (c) => {
  softDeleteCharacter(c.req.param("id"));
  return c.json({ ok: true });
});

library.post("/characters/:id/restore", (c) => {
  restoreCharacter(c.req.param("id"));
  return c.json(getCharacter(c.req.param("id")));
});

library.get("/characters/:id/versions", (c) => c.json({ versions: listVersions(c.req.param("id")) }));

library.post("/characters/:id/versions/:vid/restore", (c) => {
  must(restoreVersion(c.req.param("id"), c.req.param("vid")) || undefined, "Version not found");
  return c.json(getCharacter(c.req.param("id")));
});

/** Live token counts while editing (CHAR-03). */
library.post("/characters/tokens", async (c) => {
  const input = await body(c, z.object({ card: z.record(z.string(), z.unknown()) }));
  const card = { ...emptyCard(), ...(input.card as object) } as ReturnType<typeof emptyCard>;
  return c.json(tokenCounts(card));
});

library.get("/characters/:id/mode-guess", (c) => c.json(detectMode(must(getCard(c.req.param("id")), "Character not found"))));

library.get("/characters/:id/export", async (c) => {
  const format = (c.req.query("format") ?? "png") as "png" | "json" | "charx";
  const spec = (c.req.query("spec") ?? "v3") as "v2" | "v3";
  if (!["png", "json", "charx"].includes(format)) throw badRequest("Unknown format");
  const out = must(await exportCharacter(c.req.param("id"), format, spec), "Character not found");
  return new Response(out.bytes, {
    headers: { "Content-Type": out.mime, "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(out.filename)}` },
  });
});

// ---------- Personas ----------

const personaData = z.object({
  pronouns: z.string().optional(),
  description: z.string().optional(),
  appearance: z.string().optional(),
  personality: z.string().optional(),
  background: z.string().optional(),
});

library.get("/personas", (c) => c.json({ personas: listPersonas({ deleted: c.req.query("deleted") === "1" }) }));

library.post("/personas", async (c) => {
  const input = await body(c, z.object({ name: z.string().trim().min(1), data: personaData.optional(), avatarId: z.string().nullable().optional(), isDefault: z.boolean().optional() }));
  return c.json(getPersona(createPersona(input)), 201);
});

library.get("/personas/:id", (c) => c.json(must(getPersona(c.req.param("id")), "Persona not found")));

library.put("/personas/:id", async (c) => {
  const input = await body(c, z.object({ name: z.string().trim().min(1).optional(), data: personaData.optional(), avatarId: z.string().nullable().optional(), isDefault: z.boolean().optional() }));
  must(updatePersona(c.req.param("id"), input) || undefined, "Persona not found");
  return c.json(getPersona(c.req.param("id")));
});

library.delete("/personas/:id", (c) => {
  softDeletePersona(c.req.param("id"));
  return c.json({ ok: true });
});

library.post("/personas/:id/restore", (c) => {
  restorePersona(c.req.param("id"));
  return c.json(getPersona(c.req.param("id")));
});

// ---------- Images ----------

/** Upload: the client crops and sends a PNG plus a small WebP thumbnail and palette (CHAR-05). */
library.post("/images", async (c) => {
  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest("No file uploaded");
  const thumb = form.get("thumb");
  const palette = form.get("palette");
  const id = await saveImage(new Uint8Array(await file.arrayBuffer()), {
    width: Number(form.get("width")) || undefined,
    height: Number(form.get("height")) || undefined,
    palette: typeof palette === "string" ? (JSON.parse(palette) as string[]) : undefined,
    thumb: thumb instanceof File ? new Uint8Array(await thumb.arrayBuffer()) : undefined,
  });
  return c.json({ id }, 201);
});

library.post("/images/:id/thumb", async (c) => {
  const form = await c.req.formData();
  const thumb = form.get("thumb");
  if (!(thumb instanceof File)) throw badRequest("No thumbnail");
  const palette = form.get("palette");
  await setThumbnail(c.req.param("id"), new Uint8Array(await thumb.arrayBuffer()), typeof palette === "string" ? JSON.parse(palette) : undefined);
  return c.json({ ok: true });
});

library.get("/images/:id", async (c) => {
  const img = must(getImage(c.req.param("id")), "Image not found");
  const wantThumb = c.req.query("thumb") === "1" && img.thumb_file;
  const file = Bun.file(imagePath(wantThumb ? img.thumb_file! : img.file));
  if (!(await file.exists())) throw badRequest("Image file missing");
  return new Response(file, {
    headers: {
      "Content-Type": wantThumb ? file.type : img.mime,
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Has-Thumb": img.thumb_file ? "1" : "0",
    },
  });
});

library.get("/images/:id/info", (c) => {
  const img = must(getImage(c.req.param("id")), "Image not found");
  return c.json({ id: img.id, mime: img.mime, width: img.width, height: img.height, hasThumb: Boolean(img.thumb_file), palette: JSON.parse(img.palette) });
});

// ---------- Import (DATA-01) ----------

library.post("/import", async (c) => {
  const form = await c.req.formData();
  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  if (!files.length) throw badRequest("No file uploaded");
  const results = [];
  for (const f of files) {
    try {
      results.push({ file: f.name, ok: true, ...(await importFile(new Uint8Array(await f.arrayBuffer()), f.name)) });
    } catch (e) {
      results.push({ file: f.name, ok: false, error: (e as Error).message });
    }
  }
  return c.json({ results });
});
