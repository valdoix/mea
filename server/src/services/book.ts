import { readFileSync } from "node:fs";
import { strToU8, zipSync } from "fflate";
import { all, parseJson } from "../db/db";
import { notFound } from "../lib/http";
import { cleanText } from "../memory/text";
import { getCard, getCharacterRow } from "./characters";
import { getChatRow } from "./chats";
import { getImage, imagePath } from "./images";
import { getDefaultPersona, getPersona } from "./personas";

/**
 * Book export (DATA-04): the story compiled into chapters, using the chapter titles (SUM-14) and
 * in-story times, with scene breaks between scenes. HTML (also the source of the PDF, printed by
 * the browser) and EPUB 3. "Clean prose" drops out-of-character asides, stage directions and
 * markup; your messages stay part of the story, set apart in italics (or with names, script-style).
 */

export interface BookOptions {
  /** Drop OOC asides and markup, turn *actions* into italics. */
  clean: boolean;
  /** "prose": your messages in italics, no names. "names": every message under its speaker's name. */
  voices: "prose" | "names";
  /** Include your messages at all. */
  includeUser: boolean;
}

interface Para {
  html: string;
  who: "user" | "char" | "note";
  name: string;
}
interface Chapter {
  title: string;
  subtitle: string;
  scenes: Para[][];
}
interface Book {
  title: string;
  byline: string;
  dates: string;
  chapters: Chapter[];
  cover: { bytes: Uint8Array; mime: string; ext: string } | null;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** One message's text as paragraphs of (X)HTML-safe inline markup. */
function paragraphs(text: string, clean: boolean): string[] {
  let t = clean ? cleanText(text) : text;
  if (clean) {
    t = t
      .replace(/\((?:OOC|ooc|Ooc)\s*[:\-–—]?[^)]*\)/g, "")
      .replace(/^\s*(?:OOC|\[OOC\])\s*[:\-–—].*$/gim, "")
      .replace(/\[[^\]]*(?:OOC|out of character)[^\]]*\]/gi, "");
  }
  return t
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) =>
      esc(p)
        .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
        .replace(/\*([^*\n]+)\*/g, "<em>$1</em>")
        .replace(/_([^_\n]+)_/g, "<em>$1</em>")
        .replace(/\n/g, "<br/>"),
    );
}

function buildBook(chatId: string, o: BookOptions): Book {
  const chat = getChatRow(chatId);
  if (!chat || chat.deleted_at) throw notFound("Chat not found");
  const card = chat.character_id ? getCard(chat.character_id) : undefined;
  const persona = getPersona(chat.persona_id) ?? getDefaultPersona();
  const charName = card?.name ?? "Character";
  const userName = persona?.name ?? "You";
  const rows = all<{ id: string; seq: number; role: string; name: string | null; hidden: number; created_at: number; content: string; meta: string }>(
    `SELECT m.id, m.seq, m.role, m.name, m.hidden, m.created_at, s.content, s.meta FROM messages m JOIN swipes s ON s.message_id = m.id AND s.idx = m.active_swipe
     WHERE m.chat_id = ? AND m.deleted_at IS NULL AND s.status != 'error' AND TRIM(s.content) != '' ORDER BY m.seq`,
    chatId,
  );
  const chapters = all<{ start_seq: number; title: string; story_time: string | null }>("SELECT start_seq, title, story_time FROM summaries WHERE chat_id = ? AND level = 'chapter' ORDER BY start_seq", chatId);
  const sceneStarts = new Set(all<{ start_seq: number }>("SELECT start_seq FROM summaries WHERE chat_id = ? AND level = 'scene'", chatId).map((r) => r.start_seq));
  const chapterStarts = new Map(chapters.map((c, i) => [c.start_seq, { ...c, n: i + 1 }]));

  const out: Chapter[] = [];
  let cur: Chapter | null = null;
  const startChapter = (title: string, subtitle: string) => {
    cur = { title, subtitle, scenes: [[]] };
    out.push(cur);
  };
  for (const r of rows) {
    const ch = chapterStarts.get(r.seq);
    if (ch || !cur) startChapter(ch?.title || `Chapter ${ch?.n ?? out.length + 1}`, ch?.story_time ?? "");
    const c = cur!;
    if (!ch && sceneStarts.has(r.seq) && c.scenes.at(-1)!.length) c.scenes.push([]);
    const meta = parseJson<{ director?: boolean; timeskip?: number }>(r.meta, {});
    if (r.hidden && o.clean) continue;
    if (r.role === "system") {
      // A time skip is a scene break with its line; other notes are left out of a clean book.
      if (meta.timeskip) {
        if (c.scenes.at(-1)!.length) c.scenes.push([]);
        c.scenes.at(-1)!.push(...paragraphs(r.content, true).map((html) => ({ html: `<em>${html.replace(/<\/?em>/g, "")}</em>`, who: "note" as const, name: "" })));
      } else if (!o.clean) c.scenes.at(-1)!.push(...paragraphs(r.content, false).map((html) => ({ html, who: "note" as const, name: "Note" })));
      continue;
    }
    if (r.role === "user" && (!o.includeUser || (meta.director && o.clean))) continue;
    const who = r.role === "user" ? "user" : "char";
    const name = r.role === "user" ? userName : (r.name ?? charName);
    for (const html of paragraphs(r.content, o.clean)) c.scenes.at(-1)!.push({ html, who, name });
  }
  for (const c of out) c.scenes = c.scenes.filter((s) => s.length);

  // A cover: the chat's own cover, else the character's portrait.
  const coverId = chat.cover_image_id ?? (chat.character_id ? getCharacterRow(chat.character_id)?.avatar_id : null) ?? null;
  let cover: Book["cover"] = null;
  const img = coverId ? getImage(coverId) : undefined;
  if (img && ["image/jpeg", "image/png", "image/webp"].includes(img.mime)) {
    try {
      const bytes = new Uint8Array(readFileSync(imagePath(img.file)));
      cover = { bytes, mime: img.mime, ext: img.mime === "image/jpeg" ? "jpg" : img.mime.slice(6) };
    } catch {
      cover = null;
    }
  }
  const first = rows[0]?.created_at;
  const last = rows.at(-1)?.created_at;
  const fmt = (t: number) => new Date(t).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  return {
    title: chat.title || `${charName} and ${userName}`,
    byline: `${charName} & ${userName}`,
    dates: first && last ? (fmt(first) === fmt(last) ? fmt(first) : `${fmt(first)} – ${fmt(last)}`) : "",
    chapters: out,
    cover,
  };
}

function chapterBody(c: Chapter, o: BookOptions, xhtml: boolean) {
  const br = xhtml ? "<br/>" : "<br>";
  return c.scenes
    .map((scene) =>
      scene
        .map((p) => {
          const html = xhtml ? p.html : p.html.replace(/<br\/>/g, br);
          if (o.voices === "names" && p.who !== "note") return `<p class="${p.who}"><span class="speaker">${esc(p.name)}</span> ${html}</p>`;
          return `<p class="${p.who}">${html}</p>`;
        })
        .join("\n"),
    )
    .join(`\n<p class="break" aria-hidden="true">⁂</p>\n`);
}

const STYLE = `
body{margin:0;font-family:"Lora","Literata",Georgia,serif;line-height:1.65;color:#2e2629;background:#fffdfb}
main{max-width:36rem;margin:0 auto;padding:3rem 1.5rem 5rem}
.title{text-align:center;margin:3rem 0 4rem}
.title h1{font-size:2.2rem;font-weight:600;margin:0 0 .6rem}
.title .by{font-style:italic;color:#6b5a62}
.title .dates{font-size:.85rem;color:#8a7880;margin-top:.4rem}
.title img{max-width:60%;border-radius:12px;margin:0 auto 2rem;display:block}
nav ol{padding-left:1.2rem} nav a{color:inherit}
section.chapter{margin-top:4rem}
h2{font-weight:600;font-size:1.5rem;text-align:center;margin:0 0 .3rem}
.when{text-align:center;color:#8a7880;font-size:.85rem;margin:0 0 2rem}
p{margin:0;text-indent:1.4em}
h2+.when+p,p.break+p,.when+p{text-indent:0}
p.user{font-style:italic;color:#4f4148}
p.user em{font-style:normal}
p.note{text-align:center;text-indent:0;color:#6b5a62}
p.break{text-align:center;text-indent:0;margin:1.2rem 0;color:#b48a9b}
.speaker{font-variant:small-caps;letter-spacing:.04em;font-style:normal;font-weight:600;margin-right:.3em}
@media print{body{background:#fff}main{max-width:none;padding:0}section.chapter{page-break-before:always;margin-top:0}nav{page-break-after:always}@page{margin:2.2cm 2cm}}
`;

/** One standalone HTML book. With `print`, it opens the print dialog (save as PDF). */
export function bookHtml(chatId: string, o: BookOptions, opts: { print?: boolean } = {}) {
  const b = buildBook(chatId, o);
  const cover = b.cover ? `<img src="data:${b.cover.mime};base64,${Buffer.from(b.cover.bytes).toString("base64")}" alt="">` : "";
  const toc = b.chapters.length > 1 ? `<nav><h2>Contents</h2><ol>${b.chapters.map((c, i) => `<li><a href="#ch${i + 1}">${esc(c.title)}</a></li>`).join("")}</ol></nav>` : "";
  const chapters = b.chapters
    .map((c, i) => `<section class="chapter" id="ch${i + 1}"><h2>${esc(c.title)}</h2>${c.subtitle ? `<p class="when">${esc(c.subtitle)}</p>` : `<p class="when"></p>`}\n${chapterBody(c, o, false)}</section>`)
    .join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(b.title)}</title><style>${STYLE}</style></head>
<body><main><div class="title">${cover}<h1>${esc(b.title)}</h1><div class="by">${esc(b.byline)}</div>${b.dates ? `<div class="dates">${esc(b.dates)}</div>` : ""}</div>${toc}
${chapters}
</main>${opts.print ? "<script>addEventListener('load',()=>setTimeout(()=>print(),300))</script>" : ""}</body></html>`;
}

/** An EPUB 3 book (with an NCX table of contents for older readers). */
export function bookEpub(chatId: string, o: BookOptions): Uint8Array {
  const b = buildBook(chatId, o);
  const uid = `urn:mea:${chatId}`;
  const modified = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const xhtml = (title: string, body: string) =>
    `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en" lang="en"><head><meta charset="utf-8"/><title>${esc(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body>${body}</body></html>`;
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {};
  files.mimetype = [strToU8("application/epub+zip"), { level: 0 }];
  files["META-INF/container.xml"] = strToU8(
    `<?xml version="1.0" encoding="utf-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  );
  files["OEBPS/style.css"] = strToU8(STYLE.replace(/@media print\{[^]*$/, ""));
  const items: string[] = [];
  const spine: string[] = [];
  if (b.cover) {
    files[`OEBPS/cover.${b.cover.ext}`] = [b.cover.bytes, { level: 0 }];
    items.push(`<item id="cover-image" href="cover.${b.cover.ext}" media-type="${b.cover.mime}" properties="cover-image"/>`);
  }
  files["OEBPS/title.xhtml"] = strToU8(
    xhtml(b.title, `<div class="title">${b.cover ? `<img src="cover.${b.cover.ext}" alt=""/>` : ""}<h1>${esc(b.title)}</h1><div class="by">${esc(b.byline)}</div>${b.dates ? `<div class="dates">${esc(b.dates)}</div>` : ""}</div>`),
  );
  items.push(`<item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>`);
  spine.push(`<itemref idref="title"/>`);
  b.chapters.forEach((c, i) => {
    const id = `ch${i + 1}`;
    files[`OEBPS/${id}.xhtml`] = strToU8(xhtml(c.title, `<section class="chapter" epub:type="chapter"><h2>${esc(c.title)}</h2><p class="when">${esc(c.subtitle)}</p>\n${chapterBody(c, o, true)}</section>`));
    items.push(`<item id="${id}" href="${id}.xhtml" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="${id}"/>`);
  });
  files["OEBPS/nav.xhtml"] = strToU8(
    xhtml("Contents", `<nav epub:type="toc" id="toc"><h2>Contents</h2><ol>${b.chapters.map((c, i) => `<li><a href="ch${i + 1}.xhtml">${esc(c.title)}</a></li>`).join("")}</ol></nav>`),
  );
  items.push(`<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`);
  files["OEBPS/toc.ncx"] = strToU8(
    `<?xml version="1.0" encoding="utf-8"?>\n<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="${uid}"/></head><docTitle><text>${esc(b.title)}</text></docTitle><navMap>${b.chapters
      .map((c, i) => `<navPoint id="np${i + 1}" playOrder="${i + 1}"><navLabel><text>${esc(c.title)}</text></navLabel><content src="ch${i + 1}.xhtml"/></navPoint>`)
      .join("")}</navMap></ncx>`,
  );
  items.push(`<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`, `<item id="css" href="style.css" media-type="text/css"/>`);
  files["OEBPS/content.opf"] = strToU8(
    `<?xml version="1.0" encoding="utf-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="en"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">${uid}</dc:identifier><dc:title>${esc(b.title)}</dc:title><dc:creator>${esc(b.byline)}</dc:creator><dc:language>en</dc:language><meta property="dcterms:modified">${modified}</meta>${b.cover ? `<meta name="cover" content="cover-image"/>` : ""}</metadata><manifest>${items.join("")}</manifest><spine toc="ncx">${spine.join("")}</spine></package>`,
  );
  return zipSync(files as Parameters<typeof zipSync>[0], { level: 6 });
}

/** How the book would come out, for the export dialog. */
export function bookOutline(chatId: string, o: BookOptions) {
  const b = buildBook(chatId, o);
  return { title: b.title, chapters: b.chapters.map((c) => ({ title: c.title, subtitle: c.subtitle, scenes: c.scenes.length, paragraphs: c.scenes.reduce((n, s) => n + s.length, 0) })) };
}
