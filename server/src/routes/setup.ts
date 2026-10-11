import { Hono } from "hono";
import { body } from "../lib/http";
import { applySetup, previewOpening, saveUsual, setupSchema, setupView, skipSetup, usual } from "../services/setup";
import { mustChat } from "../services/chats";

/** F1: Session Zero. */
export const setup = new Hono();

setup.get("/chats/:id/setup", (c) => {
  mustChat(c.req.param("id"));
  return c.json(setupView(c.req.param("id")));
});

setup.post("/chats/:id/setup", async (c) => c.json(applySetup(c.req.param("id"), await body(c, setupSchema))));

setup.post("/chats/:id/setup/skip", (c) => c.json(skipSetup(c.req.param("id"))));

/** A sample of the opening in this tone (one cheap call). */
setup.post("/chats/:id/setup/preview", async (c) => c.json(await previewOpening(c.req.param("id"), await body(c, setupSchema.pick({ tone: true, persona: true, genres: true })))));

/** Save as my usual / Use my usual. */
setup.get("/setup/usual", (c) => c.json({ answers: usual() }));
setup.post("/setup/usual", async (c) => {
  saveUsual(await body(c, setupSchema));
  return c.json({ ok: true });
});
