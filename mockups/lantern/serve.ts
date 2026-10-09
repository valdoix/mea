// Tiny static server for the Lantern prototype: bun mockups/lantern/serve.ts
const root = import.meta.dir;
Bun.serve({
  port: Number(process.env.PORT) || 5190,
  fetch(req) {
    const path = new URL(req.url).pathname;
    const file = Bun.file(root + (path === "/" ? "/index.html" : decodeURIComponent(path)));
    return file.exists().then((ok) => (ok ? new Response(file, { headers: { "Cache-Control": "no-store" } }) : new Response("Not found", { status: 404 })));
  },
});
console.log("Lantern prototype on http://localhost:5190");
