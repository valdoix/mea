import { Hono } from "hono";
import { z } from "zod";
import { body } from "../lib/http";
import { compareWithOriginal, copyAsVersion, detachVersion, type LinkKind, linkInfo, linkVersion, updateLink, versionKind } from "../services/linked";

/**
 * Linked versions (docs/14, part 1). `/family` because `/characters/:id/versions` is a card's History.
 * - GET  /{characters,personas}/:id/family          the original it came from and its versions
 * - POST /{characters,personas}/:id/family          make a version by copying it as it is now
 * - PUT  /{characters,personas}/:id/link            label, kind and anchors of a version
 * - POST /{characters,personas}/:id/link            link it to an original (`originId`)
 * - POST /{characters,personas}/:id/detach          cut the link
 * - GET  /{characters,personas}/:id/compare         the version next to its original
 */
export const linked = new Hono();

const anchors = z.array(z.string().max(300)).max(20);
const label = z.string().max(80);
const kindOf = (path: string): LinkKind => (path === "personas" ? "persona" : "character");

for (const path of ["characters", "personas"] as const) {
  const kind = kindOf(path);
  linked.get(`/${path}/:id/family`, (c) => c.json(linkInfo(kind, c.req.param("id"))));

  linked.post(`/${path}/:id/family`, async (c) => {
    const input = await body(c, z.object({ name: z.string().max(120).optional(), label: label.optional(), kind: versionKind.nullable().optional(), anchors: anchors.optional() }));
    const id = copyAsVersion(kind, c.req.param("id"), input);
    return c.json({ id, link: linkInfo(kind, id) }, 201);
  });

  linked.post(`/${path}/:id/link`, async (c) => {
    const input = await body(c, z.object({ originId: z.string().min(1), label: label.optional(), kind: versionKind.nullable().optional(), anchors: anchors.optional() }));
    linkVersion(kind, c.req.param("id"), input.originId, input);
    return c.json(linkInfo(kind, c.req.param("id")));
  });

  linked.put(`/${path}/:id/link`, async (c) => {
    const input = await body(c, z.object({ label: label.optional(), kind: versionKind.nullable().optional(), anchors: anchors.optional() }));
    updateLink(kind, c.req.param("id"), input);
    return c.json(linkInfo(kind, c.req.param("id")));
  });

  linked.post(`/${path}/:id/detach`, (c) => {
    const { originId } = detachVersion(kind, c.req.param("id"));
    return c.json({ ok: true, originId });
  });

  linked.get(`/${path}/:id/compare`, (c) => c.json(compareWithOriginal(kind, c.req.param("id"))));
}
