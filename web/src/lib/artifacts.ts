/**
 * The visual toolkit (VTK): the tags a reply uses for things that pass in front of the reader —
 * letters, screens, a mind in uproar, an achievement — taught by the Mea preset's Visual toolkit
 * control (server prompt/mea.ts keeps the same list). They are cut out before Markdown runs and
 * drawn here from escaped text only, so a reply can't smuggle markup in through them. The one
 * exception is <vtk>, a visual the model designs itself: render.ts sanitizes and scopes it.
 * With the toolkit off, the words stay and only the dressing goes.
 */

export const ARTIFACT_KINDS = [
  // paper & objects
  "letter", "note", "clipping", "poster", "ticket", "map", "photo", "journal", "receipt", "menu", "dossier", "sign", "tarot",
  // screens
  "texts", "chat", "feed", "poll", "email", "call", "terminal", "radio",
  // drama & game
  "mind", "reaction", "achievement", "inspect", "status", "entrance", "clash", "passage", "memory", "bond", "heartbeat", "spell",
  // the model's own
  "vtk",
] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export interface Artifact {
  kind: ArtifactKind;
  attrs: Record<string, string>;
  body: string;
}

/** Draws a model-made visual (<vtk>) into sanitized, scoped HTML; null when it can't. */
export type FreeformDrawer = (body: string, scope: string) => string | null;

const KINDS = ARTIFACT_KINDS.join("|");
const PAIRED = new RegExp(`<(${KINDS})\\b([^>]*)>([\\s\\S]*?)<\\/\\1\\s*>`, "gi");
const SELF = new RegExp(`<(${KINDS})\\b([^>]*?)\\/>`, "gi");
// A tag the model opened and never closed runs to the next blank line. Not <vtk>: its HTML can hold blank lines.
const OPEN_KINDS = ARTIFACT_KINDS.filter((k) => k !== "vtk").join("|");
const UNCLOSED = new RegExp(`<(${OPEN_KINDS})\\b([^>]*)>\\n*((?:(?!\\n[ \\t]*\\n)[\\s\\S])*)`, "gi");
const STRAY_CLOSE = new RegExp(`<\\/(?:${OPEN_KINDS})\\s*>`, "gi");
const TOKEN = (i: number) => `MEAARTIFACT${i}END`;

function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of s.matchAll(/([a-z][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi)) out[m[1]!.toLowerCase()] = (m[2] ?? m[3] ?? m[4] ?? "").trim();
  for (const m of s.matchAll(/(?:^|\s)([a-z][\w-]*)(?=\s|$)(?!\s*=)/gi)) if (!(m[1]!.toLowerCase() in out)) out[m[1]!.toLowerCase()] = "true";
  return out;
}

/**
 * Cuts the artifacts out, leaving a token paragraph where each one stood. On a finished reply
 * (`finished`), a tag the model forgot to close still draws, up to the next blank line.
 */
export function extractArtifacts(text: string, finished = false): { text: string; found: Artifact[] } {
  const found: Artifact[] = [];
  const take = (kind: string, attrs: string, body: string) => {
    found.push({ kind: kind.toLowerCase() as ArtifactKind, attrs: parseAttrs(attrs), body: body.replace(/^\n+|\s+$/g, "") });
    return `\n\n${TOKEN(found.length - 1)}\n\n`;
  };
  let out = text.replace(PAIRED, (_m, k: string, a: string, b: string) => take(k, a, b)).replace(SELF, (_m, k: string, a: string) => take(k, a, ""));
  if (finished) out = out.replace(UNCLOSED, (_m, k: string, a: string, b: string) => take(k, a, b)).replace(STRAY_CLOSE, "");
  return { text: out, found };
}

/** While a reply streams, a visual of the model's own that hasn't closed yet shows as a sketch in progress. */
export function pendingVisual(text: string): string {
  return text.replace(/<vtk\b[^>]*>(?![\s\S]*<\/vtk\s*>)[\s\S]*$/i, "\n\nMEAVTKPENDING\n\n");
}

/** Puts each artifact back where its token paragraph is. */
export function placeArtifacts(html: string, found: Artifact[], dressed: boolean, freeform?: FreeformDrawer | null): string {
  return html
    .replace(/<p>\s*MEAVTKPENDING\s*<\/p>|MEAVTKPENDING/g, dressed ? `<div class="art-sketching" aria-label="Drawing a visual"><i></i><i></i><i></i></div>` : "")
    .replace(/<p>\s*MEAARTIFACT(\d+)END\s*<\/p>|MEAARTIFACT(\d+)END/g, (_m, a?: string, b?: string) => {
      const art = found[Number(a ?? b)];
      if (!art) return "";
      return dressed ? drawArtifact(art, freeform) : plainArtifact(art);
    });
}

// ---------- text effects: <fx kind="shake">words</fx> ----------

export const FX_KINDS = ["shake", "tremble", "glitch", "whisper", "shout", "rage", "arcane", "blood", "ghost", "haze", "memory", "crossed", "neon", "ancient", "handwritten", "redact", "wave", "sparkle", "echo"] as const;
const FX = new RegExp(`<fx\\b([^>]*)>((?:(?!\\n\\s*\\n)[\\s\\S])*?)<\\/fx\\s*>`, "gi");

/** One effect around already-safe inner HTML. Wave and sparkle move letter by letter. */
function fxSpan(kind: string, inner: string, plainText?: string): string {
  if (!(FX_KINDS as readonly string[]).includes(kind)) return inner;
  if ((kind === "wave" || kind === "sparkle") && plainText !== undefined && plainText.length <= 48) {
    let i = 0;
    inner = [...plainText].map((ch) => (/\s/.test(ch) ? ch : `<span style="--i:${i++}">${esc(ch)}</span>`)).join("");
  }
  return `<span class="fx fx-${kind}"${kind === "redact" ? ` tabindex="0" title="Redacted"` : ""}>${inner}</span>`;
}

/**
 * Text effects in a reply's prose, turned into spans before Markdown (which keeps inline HTML,
 * and the sanitizer then checks it). Off, the words stay plain. A tag that never closes, or one
 * still streaming, is dropped.
 */
export function applyFx(text: string, dressed: boolean): string {
  if (!/<\/?fx\b/i.test(text)) return text;
  return text
    .replace(FX, (_m, attrs: string, inner: string) => {
      if (!dressed) return inner;
      const kind = (parseAttrs(attrs).kind ?? "").toLowerCase();
      return fxSpan(kind, inner, /[<&*_`[]/.test(inner) ? undefined : inner);
    })
    .replace(/<\/?fx\b[^>]*>?/gi, "");
}

// ---------- drawing helpers ----------

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Escaped text with *italic*, **bold**, ~~struck~~, [[redacted]] and text effects. */
function inline(t: string): string {
  const parts: string[] = [];
  let at = 0;
  for (const m of t.matchAll(FX)) {
    parts.push(marks(t.slice(at, m.index)));
    const kind = (parseAttrs(m[1]!).kind ?? "").toLowerCase();
    parts.push(fxSpan(kind, marks(m[2]!), m[2]!));
    at = m.index! + m[0].length;
  }
  parts.push(marks(t.slice(at).replace(/<\/?fx\b[^>]*>?/gi, "")));
  return parts.join("");
}
function marks(t: string): string {
  return esc(t)
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, "$1<i>$2</i>")
    .replace(/~~(.+?)~~/g, "<s>$1</s>")
    .replace(/\[\[(.+?)\]\]/g, `<span class="art-redact" tabindex="0" title="Redacted">$1</span>`)
    .replace(/\n/g, "<br>");
}
/** Paragraphs on blank lines, breaks on single ones. */
function prose(s: string): string {
  return s
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${inline(p)}</p>`)
    .join("");
}
const rows = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);
const attr = (a: Artifact, k: string) => a.attrs[k]?.trim() ?? "";
const KV = /^([^:]{1,32}):\s*(.+)$/;
/** "40/100", "40%" or "0.4" → a fraction, else null. */
function ratio(v: string): number | null {
  const m = v.trim().match(/^(-?\d+(?:\.\d+)?)\s*(?:(\/)\s*(\d+(?:\.\d+)?)|(%))?$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (m[2]) return Math.max(0, Math.min(1, n / Math.max(1, Number(m[3]))));
  if (m[4]) return Math.max(0, Math.min(1, n / 100));
  return null;
}
/** A price at the end of a line: "Ale — 3 coppers", "Bread ..... 2.50", "Soup: free". */
function priced(l: string): { item: string; price: string } | null {
  const m = l.match(/^(.+?)\s*(?:—|–|\.{2,}|…|:|\s-\s|\s{2,})\s*(\S.{0,20})$/);
  if (!m || !/\d|free|gratis|on the house/i.test(m[2]!)) return null;
  return { item: m[1]!.trim(), price: m[2]!.trim() };
}
/** A stable number per artifact (tilts, seeds) so re-renders don't jitter. */
function seed(a: Artifact): number {
  let h = 2166136261;
  for (const ch of `${a.kind}${a.body}${JSON.stringify(a.attrs)}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return Math.abs(h);
}
function hashHue(s: string): number {
  let h = 0;
  for (const ch of s.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 360;
}
const tilt = (a: Artifact, max: number) => (((seed(a) % 1000) / 1000) * 2 - 1) * max;
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => [...w][0]!.toUpperCase())
    .join("") || "?";
const isMe = (who: string) => /^(me|you|i)$/i.test(who.trim());

let fontsWanted = false;
/** The display faces the toolkit's showier pieces use, fetched the first time one is drawn. */
function wantFonts() {
  if (fontsWanted || typeof document === "undefined") return;
  fontsWanted = true;
  void import("@fontsource/cinzel-decorative/400.css");
  void import("@fontsource/cinzel-decorative/700.css");
  void import("@fontsource/neonderthaw/400.css");
  void import("@fontsource/monoton/400.css");
  void import("@fontsource/space-mono/400.css");
  void import("@fontsource/space-mono/700.css");
}

function plainArtifact(a: Artifact): string {
  const head = [
    attr(a, "from") && `From ${attr(a, "from")}`,
    attr(a, "paper"),
    attr(a, "with") && `Messages with ${attr(a, "with")}`,
    attr(a, "channel"),
    attr(a, "subject"),
    attr(a, "shop") || attr(a, "place"),
    attr(a, "name"),
    attr(a, "who"),
    attr(a, "title"),
    attr(a, "card"),
    attr(a, "q"),
    attr(a, "of"),
    attr(a, "caption"),
  ]
    .filter(Boolean)
    .join(" · ");
  const body = a.kind === "vtk" ? visualWords(a.body) : a.body;
  return `<blockquote class="art-plain">${head ? `<p><i>${esc(head)}</i></p>` : ""}${prose(body)}</blockquote>`;
}

/** The words a model-made visual shows, without its markup. */
function visualWords(html: string): string {
  return html
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

const SEAL = `<svg class="art-seal" viewBox="0 0 64 64" aria-hidden="true"><path d="M32 3c6 0 8 4 13 5s9 1 11 6-1 8 1 13 5 8 2 13-7 4-9 9-4 9-10 10-9-3-14-2-10 3-13-2 0-9-3-13-7-6-5-12 6-6 7-11 1-10 6-12 8 1 12-1 4-3 9-3z" fill="var(--seal, #9c1d34)"/><circle cx="32" cy="32" r="17" fill="none" stroke="#0005" stroke-width="2"/><circle cx="26" cy="24" r="6" fill="#fff2"/></svg>`;

const ICON = {
  heart: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.8 4.5c2.1 0 3.6 1.2 4.2 2.4h2c.6-1.2 2.1-2.4 4.2-2.4 3.8 0 5.9 3.9 4.4 7.3C19.5 16.4 12 21 12 21z"/></svg>`,
  comment: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`,
  repost: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9V7h11l-3-3M19 15v2H8l3 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  share: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 3 10 14M21 3l-7 18-4-7-7-4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`,
  phone: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 10.8a15 15 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 0 1 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1z"/></svg>`,
  play: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>`,
  reply: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 9V5l-7 7 7 7v-4c5 0 8.5 1.6 11 5-1-5-4-10-11-11z"/></svg>`,
  check: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>`,
  trophy: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h10v3a5 5 0 0 1-10 0zM5 5H3v2a4 4 0 0 0 4 4M19 5h2v2a4 4 0 0 1-4 4M12 12v4M8 20h8l-1-4H9z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`,
};

export function drawArtifact(a: Artifact, freeform?: FreeformDrawer | null): string {
  const s = seed(a);
  const wrap = (cls: string, inner: string, label: string, tiltMax = 2.2, extra = "") =>
    `<figure class="art art-${cls}" style="--tilt:${tilt(a, tiltMax).toFixed(2)}deg${extra}" role="group" aria-label="${esc(label)}">${inner}</figure>`;
  switch (a.kind) {
    case "letter": {
      const raven = /raven|scroll/i.test(attr(a, "kind"));
      const sig = attr(a, "from");
      const seal = attr(a, "seal");
      return wrap(
        raven ? "scroll" : "letter",
        `${attr(a, "date") ? `<div class="art-date">${esc(attr(a, "date"))}</div>` : ""}${attr(a, "to") ? `<p class="art-salute">${esc(attr(a, "to"))},</p>` : ""}<div class="art-body">${prose(a.body)}</div>${sig ? `<div class="art-sig">${esc(sig)}</div>` : ""}${seal || raven ? `<div class="art-sealwrap" title="${esc(seal || "sealed")}">${SEAL}</div>` : ""}`,
        `${raven ? "Scroll" : "Letter"}${sig ? ` from ${sig}` : ""}`,
      );
    }
    case "note":
      return wrap("note", `<div class="art-body">${prose(a.body)}</div>${attr(a, "from") ? `<div class="art-sig">— ${esc(attr(a, "from"))}</div>` : ""}`, `Note${attr(a, "from") ? ` from ${attr(a, "from")}` : ""}`);
    case "clipping": {
      const lines = a.body.split("\n");
      const hi = lines.findIndex((l) => /^#+\s/.test(l));
      const headline = hi >= 0 ? lines[hi]!.replace(/^#+\s*/, "") : attr(a, "headline");
      const rest = hi >= 0 ? lines.filter((_, i) => i !== hi).join("\n") : a.body;
      return wrap(
        "clipping",
        `<div class="art-mast">${esc(attr(a, "paper") || "The Courier")}</div><div class="art-dateline"><span>${esc(attr(a, "date") || "")}</span><span>One penny</span></div>${headline ? `<h4>${esc(headline)}</h4>` : ""}<div class="art-cols">${prose(rest)}</div>`,
        `Clipping from ${attr(a, "paper") || "a paper"}`,
      );
    }
    case "texts": {
      const list = rows(a.body);
      let bubbles = "";
      list.forEach((l, i) => {
        const m = l.match(/^([^:]{1,40}):\s*(.*)$/);
        const who = m?.[1]?.trim() ?? "";
        const said = m ? m[2]! : l;
        const typing = i === list.length - 1 && /^(…|\.\.\.)$/.test(said.trim());
        bubbles += typing ? `<div class="art-typing" aria-label="typing"><i></i><i></i><i></i></div>` : `<div class="art-bub ${isMe(who) ? "me" : "them"}" style="animation-delay:${(i * 0.08).toFixed(2)}s">${inline(said)}</div>`;
      });
      return wrap("phone", `<div class="art-scr"><div class="art-who"><b>${esc(attr(a, "with") || "Messages")}</b>${attr(a, "at") ? esc(attr(a, "at")) : ""}</div>${bubbles}</div>`, `Messages with ${attr(a, "with") || "someone"}`);
    }
    case "poster": {
      const kind = attr(a, "kind") || "notice";
      const title = kind.toLowerCase() === "wanted" ? "WANTED" : kind.toLowerCase() === "bill" ? "TONIGHT" : "NOTICE";
      return wrap(
        "poster",
        `<div class="art-w">${title}</div>${attr(a, "who") ? `<div class="art-name">${esc(attr(a, "who"))}</div>` : ""}<div class="art-body">${prose(a.body)}</div>${attr(a, "reward") ? `<div class="art-rew">${esc(attr(a, "reward"))}</div>` : ""}`,
        `${title.toLowerCase()} poster`,
      );
    }
    case "ticket": {
      const no = attr(a, "no") || String(s % 1_000_000).padStart(6, "0");
      return wrap(
        "ticket",
        `<div class="art-tmain"><div class="art-co">${esc(attr(a, "line") || "Admit one")}</div><div class="art-rt">${esc(attr(a, "from") || "")}${attr(a, "to") ? ` ⟶ ${esc(attr(a, "to"))}` : ""}</div><div class="art-fine">${esc(a.body)}</div><div class="art-no">№ ${esc(no)}</div></div><div class="art-stub"><span>ADMIT ONE</span></div>`,
        "Ticket",
      );
    }
    case "radio":
      return wrap("radio", `<div class="art-hd"><span>${esc(attr(a, "channel") ? `CH ${attr(a, "channel")}` : "RX")}</span><span>${esc(attr(a, "signal") || "▮▮▮▯")}</span></div><div class="art-body">${prose(a.body)}</div><span class="art-cur"></span>`, "Transmission");
    case "map":
      return wrap("map", drawMap(a), `Map${attr(a, "of") ? ` of ${attr(a, "of")}` : ""}`);
    case "photo":
      return wrap("photo", `<div class="art-ph" style="${photoStyle(`${attr(a, "of")} ${attr(a, "caption")} ${a.body}`)}">${photoFigures(`${attr(a, "of")} ${attr(a, "caption")}`)}</div><div class="art-cap">${esc(attr(a, "caption") || attr(a, "of") || a.body)}</div>`, `Photograph${attr(a, "of") ? `: ${attr(a, "of")}` : ""}`);
    case "journal":
      return wrap("journal", drawJournal(a, s), `Journal${attr(a, "who") ? ` of ${attr(a, "who")}` : ""}`, 1.6);
    case "receipt":
      return wrap("receipt", drawReceipt(a, s), `Receipt${attr(a, "shop") ? ` from ${attr(a, "shop")}` : ""}`, 1.8, `;clip-path:${zigzag(s)}`);
    case "menu":
      return wrap("menu", drawMenu(a), `Menu${attr(a, "place") ? ` at ${attr(a, "place")}` : ""}`, 1.2);
    case "dossier":
      wantFonts();
      return wrap("dossier", drawDossier(a, s), `File on ${attr(a, "name") || "someone"}`, 1.4);
    case "sign":
      wantFonts();
      return drawSign(a, wrap);
    case "tarot":
      wantFonts();
      return wrap("tarot", drawTarot(a), `Tarot: ${attr(a, "card") || "a card"}`, 2.5);
    case "chat":
      return wrap("chat", drawChat(a), `${attr(a, "app") || "Chat"}${attr(a, "channel") ? ` #${attr(a, "channel")}` : ""}`, 0.8);
    case "feed":
      return wrap("feed", drawFeed(a), `Post by ${attr(a, "who") || attr(a, "handle") || "someone"}`, 0.8);
    case "poll":
      return wrap("poll", drawPoll(a), `Poll: ${attr(a, "q")}`, 0.8);
    case "email":
      return wrap("email", drawEmail(a), `Email: ${attr(a, "subject")}`, 0.6);
    case "call":
      return wrap("call", drawCall(a, s), `Call${attr(a, "from") ? ` from ${attr(a, "from")}` : ""}`, 0.8);
    case "terminal":
      wantFonts();
      return wrap("terminal", drawTerminal(a), "Terminal", 0.5);
    case "mind":
      return wrap("mind", drawMind(a, s), `Inside ${attr(a, "of") || "a mind"}`, 0.6, `;--mood-a:${MOODS[mood(a)]![0]};--mood-b:${MOODS[mood(a)]![1]};--mood-c:${MOODS[mood(a)]![2]}`);
    case "reaction":
      return wrap("reaction", `<div class="art-face" aria-hidden="true">${esc([...(attr(a, "face") || "😳")].slice(0, 4).join(""))}</div><div class="art-think">${attr(a, "who") ? `<b>${esc(attr(a, "who"))}</b>` : ""}${prose(a.body)}</div>`, `Reaction${attr(a, "who") ? `: ${attr(a, "who")}` : ""}`, 3);
    case "achievement":
      return wrap("achievement", drawAchievement(a), `Achievement: ${attr(a, "title")}`, 0);
    case "inspect":
      wantFonts();
      return wrap("inspect", drawInspect(a), `Item: ${attr(a, "name")}`, 1, `;--rar:${RARITY[rarity(a)]![0]};--rar2:${RARITY[rarity(a)]![1]}`);
    case "status":
      wantFonts();
      return wrap("status", drawStatus(a), `Status${attr(a, "who") ? ` of ${attr(a, "who")}` : ""}`, 0);
    case "entrance":
      wantFonts();
      return wrap("entrance", drawEntrance(a), `Enter ${attr(a, "name") || "someone"}`, 0, `;--hue:${hashHue(attr(a, "name") || a.body)}`);
    case "clash":
      return wrap("clash", drawClash(a, s), `Clash${attr(a, "a") && attr(a, "b") ? `: ${attr(a, "a")} against ${attr(a, "b")}` : ""}`, 0);
    case "passage":
      return wrap("passage", drawPassage(a), `Time passes${attr(a, "to") ? ` to ${attr(a, "to")}` : ""}`, 0);
    case "memory":
      return wrap("memory", drawMemory(a), `Memory${attr(a, "of") ? ` of ${attr(a, "of")}` : ""}`, 2);
    case "bond": {
      const down = /down|worse|broke|lost|-/i.test(attr(a, "shift"));
      const who = attr(a, "who") || "They";
      const line = a.body.trim() ? prose(a.body) : `<p>${esc(who)} will remember that.</p>`;
      return wrap("bond", `<span class="art-bicon ${down ? "down" : "up"}" aria-hidden="true">${down ? "↘" : "↗"}</span><div class="art-btext">${a.body.trim() ? `<b>${esc(who)}</b>` : ""}${line}</div>`, `${who} will remember that`, 0);
    }
    case "heartbeat":
      return wrap("heartbeat", drawHeartbeat(a), `Heartbeat${attr(a, "who") ? ` of ${attr(a, "who")}` : ""}`, 0);
    case "spell":
      wantFonts();
      return wrap("spell", drawSpell(a, s), `Spell${attr(a, "name") ? `: ${attr(a, "name")}` : ""}`, 0, `;--sch:${SCHOOL[school(a)]![0]};--sch2:${SCHOOL[school(a)]![1]}`);
    case "vtk": {
      const scope = `vtk-${s.toString(36)}`;
      const drawn = freeform?.(a.body, scope);
      if (!drawn) return plainArtifact(a);
      return `<figure class="art art-vtk ${scope}" role="group" aria-label="${esc(attr(a, "title") || attr(a, "kind") || "A visual")}">${drawn}</figure>`;
    }
  }
}

// ---------- paper ----------

function drawMap(a: Artifact): string {
  const steps = a.body.split("\n").map((l) => l.replace(/^[\s→>*-]+/, "").trim()).filter(Boolean).slice(0, 8);
  const r = mulberry(seed(a));
  const pts = steps.map((_, i) => [30 + (i / Math.max(1, steps.length - 1)) * 190 + (r() - 0.5) * 20, 180 - (i / Math.max(1, steps.length - 1)) * 130 + (r() - 0.5) * 50]);
  const d = pts.map(([x, y], i) => (i ? ` S ${x! - 20} ${y! + 18}, ${x} ${y}` : `M ${x} ${y}`)).join("");
  const last = pts.at(-1) ?? [200, 50];
  const labels = steps.map((s, i) => `<text x="${pts[i]![0]! + 6}" y="${pts[i]![1]! - 6}" class="art-mlabel">${esc(s.slice(0, 28))}</text>`).join("");
  return `<svg viewBox="0 0 250 220" class="art-msvg"><text x="14" y="18" class="art-mtitle">${esc(attr(a, "of") || "")}</text><path d="${d}" class="art-route"/>${labels}<g class="art-x" transform="translate(${last[0]} ${last[1]})"><path d="M-7 -7 7 7M7 -7 -7 7"/></g>${attr(a, "mark") ? `<text x="${Math.min(170, last[0]! - 30)}" y="${last[1]! + 22}" class="art-mmark">${esc(attr(a, "mark"))}</text>` : ""}<g transform="translate(222 190)" class="art-rose"><circle r="12"/><path d="M0-14 3 0 0 14-3 0z"/></g></svg>`;
}

function mulberry(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A photograph painted from its description: light from time words, ground from place words. */
function photoStyle(text: string): string {
  const d = text.toLowerCase();
  const sky = /night|stars|moon|midnight/.test(d)
    ? "#0d1430 0%, #23264f 55%"
    : /sunset|dusk|evening|golden/.test(d)
      ? "#43356b 0%, #c8607a 46%, #ffb08a 58%"
      : /dawn|sunrise|morning/.test(d)
        ? "#6f86c4 0%, #f6b49a 55%"
        : /snow|winter|frost/.test(d)
          ? "#9fb0c6 0%, #e6ecf2 58%"
          : /rain|storm|grey|gray|fog/.test(d)
            ? "#5a6170 0%, #9aa2ae 58%"
            : "#5d9be0 0%, #bfe0f5 58%";
  const ground = /sea|beach|shore|shingle|harbou?r|lake|river|ocean|coast/.test(d)
    ? "#3d4a7a 60%, #233457 100%"
    : /forest|wood|garden|field|meadow|park|grass/.test(d)
      ? "#2e4a33 60%, #1c2e20 100%"
      : /snow|winter/.test(d)
        ? "#e8edf2 60%, #c7d1dc 100%"
        : /desert|sand|dune/.test(d)
          ? "#c99a64 60%, #8a6440 100%"
          : /city|street|room|kitchen|bar|inn|hall|house|castle/.test(d)
            ? "#3a3248 60%, #241e30 100%"
            : "#46525e 60%, #2b333b 100%";
  const sun = /sunset|dusk|golden|sunrise|dawn/.test(d) ? "radial-gradient(circle at 62% 58%, #ffe7a4, #ff9c6a 10%, transparent 20%), " : /night|moon/.test(d) ? "radial-gradient(circle at 70% 24%, #f4f1ff, #f4f1ff 5%, transparent 7%), " : "";
  return `background:${sun}linear-gradient(180deg, ${sky}, ${ground})`;
}
function photoFigures(text: string): string {
  const d = text.toLowerCase();
  const n = /\b(three|trio|family|friends|crowd|group)\b/.test(d) ? 3 : /\b(two|and|&|couple|pair|both|us|me and)\b/.test(d) ? 2 : /\b(she|he|they|portrait|girl|boy|man|woman|person|me|selfie)\b/.test(d) ? 1 : 0;
  const tower = /lighthouse|tower|castle|keep|spire/.test(d) ? `<path d="M76 61 l2 -22 h4 l2 22z" />` : "";
  const people = Array.from({ length: n }, (_, i) => {
    const x = 36 + i * 8;
    return `<circle cx="${x}" cy="${65 - (i % 2)}" r="2.7"/><path d="M${x - 2.6} ${67.5 - (i % 2)}h5.2l1.1 12h-7.4z"/>`;
  }).join("");
  return tower || people ? `<svg viewBox="0 0 100 100" aria-hidden="true"><g fill="#140f24">${tower}${people}</g></svg>` : "";
}

const DOODLES = [
  `<path d="M20 4l4.7 9.6 10.6 1.5-7.7 7.5 1.8 10.5L20 28.1l-9.4 5 1.8-10.5-7.7-7.5 10.6-1.5z"/>`,
  `<path d="M20 34S5 25 5 15a7.5 7.5 0 0 1 15-2 7.5 7.5 0 0 1 15 2c0 10-15 19-15 19z"/>`,
  `<path d="M20 20m-2 0a2 2 0 1 1 4 0a4 4 0 1 1-8 0a6 6 0 1 1 12 0a8 8 0 1 1-16 0a10 10 0 1 1 20 0a12 12 0 1 1-24 0"/>`,
  `<path d="M20 8a4 4 0 1 1 0 8a4 4 0 1 1 0-8zm0 8v18M20 22c-4-3-9-2-10 1m10 3c4-3 9-2 10 1"/>`,
  `<path d="M6 30c6-14 10-14 14 0s8 14 14 0"/>`,
];
function drawJournal(a: Artifact, s: number): string {
  const doodle = DOODLES[s % DOODLES.length]!;
  return `<div class="art-jhead"><span>${esc(attr(a, "who"))}</span><span>${esc(attr(a, "date"))}</span></div><div class="art-body">${prose(a.body)}</div><svg class="art-doodle" viewBox="0 0 40 40" aria-hidden="true">${doodle}</svg>`;
}

/** A torn thermal-paper edge, the same each time for the same receipt. */
function zigzag(s: number): string {
  const r = mulberry(s);
  const teeth = 18;
  const pts = ["0 0", "100% 0"];
  for (let i = teeth; i >= 0; i--) pts.push(`${((i / teeth) * 100).toFixed(2)}% calc(100% - ${i % 2 ? 0 : 7 + Math.round(r() * 3)}px)`);
  return `polygon(${pts.join(",")})`;
}
function barcode(s: number): string {
  const r = mulberry(s ^ 0x5bd1e995);
  let x = 0;
  let bars = "";
  while (x < 118) {
    const w = 1 + Math.floor(r() * 3);
    if (r() > 0.35) bars += `<rect x="${x}" width="${w}" height="26"/>`;
    x += w + 1;
  }
  return `<svg class="art-barcode" viewBox="0 0 120 26" preserveAspectRatio="none" aria-hidden="true">${bars}</svg>`;
}
function drawReceipt(a: Artifact, s: number): string {
  const list = rows(a.body);
  let items = "";
  let total = "";
  const foot: string[] = [];
  for (const l of list) {
    const p = priced(l);
    if (p && /^(total|sum|due|balance|amount)\b/i.test(p.item)) total = `<div class="art-rrow art-rtotal"><span>${esc(p.item.toUpperCase())}</span><span>${esc(p.price)}</span></div>`;
    else if (p) items += `<div class="art-rrow"><span>${inline(p.item)}</span><span>${esc(p.price)}</span></div>`;
    else foot.push(l);
  }
  return `<div class="art-rshop">${esc(attr(a, "shop") || "Receipt")}</div>${attr(a, "date") ? `<div class="art-rdate">${esc(attr(a, "date"))}</div>` : ""}<div class="art-rrule"></div>${items}${total ? `<div class="art-rrule"></div>${total}` : ""}${foot.length ? `<div class="art-rfoot">${foot.map(inline).join("<br>")}</div>` : ""}${barcode(s)}<div class="art-rno">${String(s % 100000000).padStart(8, "0")}</div>`;
}
function drawMenu(a: Artifact): string {
  let out = "";
  for (const l of rows(a.body)) {
    if (/^#+\s/.test(l)) out += `<h5>${esc(l.replace(/^#+\s*/, ""))}</h5>`;
    else {
      const p = priced(l);
      out += p ? `<div class="art-dish"><span>${inline(p.item)}</span><i></i><span>${esc(p.price)}</span></div>` : `<div class="art-desc">${inline(l)}</div>`;
    }
  }
  return `<div class="art-mhead">${esc(attr(a, "place") || "Bill of fare")}</div><div class="art-orn" aria-hidden="true">❦</div>${out}`;
}
function drawDossier(a: Artifact, s: number): string {
  let fields = "";
  const notes: string[] = [];
  for (const l of rows(a.body)) {
    const m = l.match(KV);
    if (m && !/\s{2,}/.test(m[1]!) && m[1]!.split(" ").length <= 4) fields += `<dt>${esc(m[1]!)}</dt><dd>${inline(m[2]!)}</dd>`;
    else notes.push(l);
  }
  const status = attr(a, "status");
  return `<div class="art-dtab">FILE № ${esc(attr(a, "file") || String(s % 10000).padStart(4, "0"))}</div><div class="art-dpaper"><div class="art-dname">${esc(attr(a, "name") || "UNKNOWN")}</div>${fields ? `<dl>${fields}</dl>` : ""}${notes.length ? `<div class="art-dnotes">${prose(notes.join("\n"))}</div>` : ""}${status ? `<div class="art-stamp">${esc(status)}</div>` : ""}</div><svg class="art-clip" viewBox="0 0 20 52" aria-hidden="true"><path d="M6 44V10a4 4 0 0 1 8 0v34a6 6 0 0 1-12 0V14" fill="none" stroke="#9aa3ad" stroke-width="2.4" stroke-linecap="round"/></svg>`;
}
function drawSign(a: Artifact, wrap: (cls: string, inner: string, label: string, t?: number, extra?: string) => string): string {
  const kind = (attr(a, "kind") || "wood").toLowerCase();
  const k = ["neon", "wood", "stone", "brass", "street"].includes(kind) ? kind : "wood";
  const words = rows(a.body).map(inline).join("<br>");
  const screws = k === "brass" ? `<i class="art-screw"></i><i class="art-screw"></i><i class="art-screw"></i><i class="art-screw"></i>` : "";
  return wrap(`sign art-sign-${k}`, `${screws}<div class="art-swords">${words}</div>`, `Sign: ${a.body.slice(0, 60)}`, k === "neon" ? 0 : 1.5, k === "neon" ? `;--neon:hsl(${hashHue(a.body)} 100% 62%)` : "");
}

const TAROT: [RegExp, string][] = [
  [/sun/i, `<circle cx="50" cy="50" r="14"/><g stroke="currentColor" stroke-width="3">${Array.from({ length: 12 }, (_, i) => `<path d="M50 50L${50 + 30 * Math.cos((i * Math.PI) / 6)} ${50 + 30 * Math.sin((i * Math.PI) / 6)}"/>`).join("")}</g>`],
  [/moon/i, `<path d="M58 22a30 30 0 1 0 0 56 24 24 0 1 1 0-56z"/>`],
  [/star/i, `<path d="M50 14l9 26h27l-22 16 8 27-22-16-22 16 8-27-22-16h27z"/>`],
  [/tower/i, `<path d="M38 86V34l-4-8h32l-4 8v52z"/><path d="M60 10 48 30h8l-8 16" stroke="#ffd36b" stroke-width="3" fill="none"/>`],
  [/death|skull/i, `<path d="M50 18c-17 0-26 12-26 26 0 9 5 15 9 18v12h34V62c4-3 9-9 9-18 0-14-9-26-26-26z"/><circle cx="40" cy="46" r="6" fill="var(--tbg)"/><circle cx="60" cy="46" r="6" fill="var(--tbg)"/>`],
  [/lover|heart/i, `<path d="M50 80S20 62 20 40a14 14 0 0 1 30-6 14 14 0 0 1 30 6c0 22-30 40-30 40z"/>`],
  [/wheel|fortune/i, `<circle cx="50" cy="50" r="28" fill="none" stroke="currentColor" stroke-width="5"/><g stroke="currentColor" stroke-width="3">${Array.from({ length: 8 }, (_, i) => `<path d="M50 50L${50 + 28 * Math.cos((i * Math.PI) / 4)} ${50 + 28 * Math.sin((i * Math.PI) / 4)}"/>`).join("")}</g>`],
  [/hermit|lantern/i, `<path d="M42 30h16l4 8v26l-4 8H42l-4-8V38z"/><path d="M50 18v12" stroke="currentColor" stroke-width="3"/><circle cx="50" cy="51" r="7" fill="#ffe28a"/>`],
  [/devil|demon/i, `<path d="M28 20l12 20h20l12-20-4 26c4 4 6 9 6 14 0 13-11 22-24 22S26 73 26 60c0-5 2-10 6-14z"/>`],
  [/world|universe/i, `<ellipse cx="50" cy="50" rx="22" ry="32" fill="none" stroke="currentColor" stroke-width="5"/><circle cx="50" cy="50" r="8"/>`],
  [/sword|justice/i, `<path d="M48 12h4v54h-4zM36 66h28v5H36zM47 71h6v14h-6z"/>`],
  [/cup|chalice/i, `<path d="M30 22h40c0 22-8 34-20 34S30 44 30 22zM47 56h6v18h-6zM36 74h28v6H36z"/>`],
];
function drawTarot(a: Artifact): string {
  const card = attr(a, "card") || "The Fool";
  const art = TAROT.find(([re]) => re.test(card))?.[1] ?? `<path d="M50 26c-20 0-34 24-34 24s14 24 34 24 34-24 34-24-14-24-34-24z" fill="none" stroke="currentColor" stroke-width="4"/><circle cx="50" cy="50" r="10"/>`;
  const reversed = a.attrs.reversed !== undefined && a.attrs.reversed !== "false";
  return `<div class="art-tcard" tabindex="0"><div class="art-tface art-tfront"><div class="art-tno">${esc(attr(a, "no") || "")}</div><svg class="art-tart${reversed ? " rev" : ""}" viewBox="0 0 100 100" aria-hidden="true">${art}</svg><div class="art-tname">${esc(card)}</div>${reversed ? `<div class="art-trev">reversed</div>` : ""}</div><div class="art-tface art-tback"><div class="art-tname">${esc(card)}</div>${prose(a.body)}</div></div>`;
}

// ---------- screens ----------

function drawChat(a: Artifact): string {
  let out = "";
  let last = "";
  for (const l of rows(a.body)) {
    const m = l.match(/^([^:]{1,40}):\s*(.*)$/);
    const who = m?.[1]?.trim() ?? "";
    const said = m ? m[2]! : l;
    const name = isMe(who) ? "You" : who || "…";
    const hue = hashHue(name);
    if (name !== last) out += `<div class="art-cmsg"><span class="art-cav" style="--h:${hue}">${esc(initials(name))}</span><div><b style="--h:${hue}">${esc(name)}</b><p>${inline(said)}</p></div></div>`;
    else out += `<div class="art-cmsg art-cmore"><span></span><div><p>${inline(said)}</p></div></div>`;
    last = name;
  }
  return `<div class="art-chead"><span class="art-chash">#</span>${esc(attr(a, "channel") || "general")}${attr(a, "app") ? `<small>${esc(attr(a, "app"))}</small>` : ""}</div><div class="art-clog">${out}</div>`;
}
function drawFeed(a: Artifact): string {
  const [post = "", ...rest] = a.body.split(/\n\s*-{3,}\s*\n/);
  const comments = rows(rest.join("\n"))
    .map((l) => {
      const m = l.match(/^([^:]{1,40}):\s*(.*)$/);
      return m ? `<div class="art-fcom"><b>${esc(m[1]!.trim())}</b> ${inline(m[2]!)}</div>` : `<div class="art-fcom">${inline(l)}</div>`;
    })
    .join("");
  const who = attr(a, "who") || attr(a, "handle") || "someone";
  const pic = /insta|gram|photo|pic/i.test(attr(a, "app")) ? `<div class="art-fpic" style="${photoStyle(post)}">${photoFigures(post)}</div>` : "";
  const verified = a.attrs.verified !== undefined && a.attrs.verified !== "false";
  return `<div class="art-fhead"><span class="art-cav" style="--h:${hashHue(who)}">${esc(initials(who))}</span><div><b>${esc(who)}${verified ? `<span class="art-tick" title="Verified">${ICON.check}</span>` : ""}</b><small>${esc([attr(a, "handle") && `@${attr(a, "handle").replace(/^@/, "")}`, attr(a, "time")].filter(Boolean).join(" · "))}</small></div><span class="art-fapp">${esc(attr(a, "app"))}</span></div>${pic}<div class="art-fpost">${prose(post)}</div><div class="art-fbar"><span class="art-fheart">${ICON.heart}${esc(attr(a, "likes") || "")}</span><span>${ICON.comment}${rest.length ? rows(rest.join("\n")).length : ""}</span><span>${ICON.repost}</span><span>${ICON.share}</span></div>${comments ? `<div class="art-fcoms">${comments}</div>` : ""}`;
}
function drawPoll(a: Artifact): string {
  const opts = rows(a.body).map((l) => {
    const m = l.match(/^(.+?)\s*(?:—|–|-|:|\s)\s*(\d+(?:\.\d+)?)\s*%?$/);
    return m ? { label: m[1]!.trim(), pct: Math.min(100, Number(m[2])) } : { label: l, pct: 0 };
  });
  const top = Math.max(...opts.map((o) => o.pct), 0);
  const bars = opts
    .map((o, i) => `<div class="art-popt${o.pct === top && top > 0 ? " win" : ""}" style="--w:${o.pct / 100};--d:${(i * 0.12).toFixed(2)}s"><i></i><span>${inline(o.label)}${o.pct === top && top > 0 ? ICON.check : ""}</span><b>${o.pct}%</b></div>`)
    .join("");
  return `<div class="art-pq">${esc(attr(a, "q") || "Poll")}</div>${bars}<div class="art-pfoot">${esc(attr(a, "votes") ? `${attr(a, "votes")} votes · ` : "")}Final results</div>`;
}
function drawEmail(a: Artifact): string {
  const from = attr(a, "from") || "Unknown sender";
  return `<div class="art-ebar"><i></i><i></i><i></i><span>Inbox</span></div><div class="art-esub">${esc(attr(a, "subject") || "(no subject)")}</div><div class="art-emeta"><span class="art-cav" style="--h:${hashHue(from)}">${esc(initials(from))}</span><div><b>${esc(from)}</b><small>to ${esc(attr(a, "to") || "me")}</small></div><small>${esc(attr(a, "at"))}</small></div><div class="art-ebody">${prose(a.body)}</div><div class="art-eact"><span>${ICON.reply} Reply</span><span>${ICON.share} Forward</span></div>`;
}
function drawCall(a: Artifact, s: number): string {
  const kind = (attr(a, "kind") || "incoming").toLowerCase();
  const from = attr(a, "from") || "Unknown";
  const av = `<span class="art-callav" style="--h:${hashHue(from)}">${esc(initials(from))}</span>`;
  if (kind.startsWith("voice")) {
    const r = mulberry(s);
    const wave = Array.from({ length: 34 }, (_, i) => `<i style="--h:${(0.2 + r() * 0.8).toFixed(2)};--d:${(i * 0.05).toFixed(2)}s"></i>`).join("");
    return `<div class="art-vm"><span class="art-vplay">${ICON.play}</span><div class="art-vwave" aria-hidden="true">${wave}</div><small>${esc(attr(a, "length") || "0:42")}</small></div><div class="art-vhead">Voicemail · <b>${esc(from)}</b>${attr(a, "at") ? ` · ${esc(attr(a, "at"))}` : ""}</div>${a.body.trim() ? `<div class="art-vtext">${prose(a.body)}</div>` : ""}`;
  }
  if (kind.startsWith("miss") || kind.startsWith("end")) {
    const missed = kind.startsWith("miss");
    return `<div class="art-cline${missed ? " missed" : ""}">${av}<div><b>${esc(from)}</b><small>${missed ? "Missed call" : `Call ended${attr(a, "length") ? ` · ${esc(attr(a, "length"))}` : ""}`}${attr(a, "at") ? ` · ${esc(attr(a, "at"))}` : ""}</small></div><span class="art-cicon">${ICON.phone}</span></div>${a.body.trim() ? `<div class="art-vtext">${prose(a.body)}</div>` : ""}`;
  }
  return `<div class="art-ring">${av}</div><div class="art-cname">${esc(from)}</div><div class="art-csub">${esc(attr(a, "at") || "incoming call…")}</div>${a.body.trim() ? `<div class="art-vtext">${prose(a.body)}</div>` : ""}<div class="art-cbtns"><span class="no">${ICON.phone}</span><span class="yes">${ICON.phone}</span></div>`;
}
function drawTerminal(a: Artifact): string {
  const host = attr(a, "host") || "localhost";
  const user = attr(a, "user") || "user";
  let cmds = 0;
  const out = rows(a.body)
    .map((l) => {
      if (/^[$>]\s?/.test(l)) {
        const cmd = l.replace(/^[$>]\s?/, "");
        const d = (cmds++ * 0.9).toFixed(1);
        return `<div class="art-tline"><span class="art-tps">${esc(user)}@${esc(host)}:~$</span> <span class="art-ttype" style="--n:${Math.min(60, cmd.length)};--d:${d}s">${esc(cmd)}</span></div>`;
      }
      const cls = /^!/.test(l) ? "art-terr" : /^#/.test(l) ? "art-tdim" : "art-tout";
      return `<div class="art-tline ${cls}" style="--d:${(cmds * 0.9).toFixed(1)}s">${esc(l.replace(/^!\s?/, ""))}</div>`;
    })
    .join("");
  return `<div class="art-tbar"><i></i><i></i><i></i><span>${esc(user)}@${esc(host)}</span></div><div class="art-tscr">${out}<span class="art-tcur"></span></div>`;
}

// ---------- drama & game ----------

const MOODS: Record<string, [string, string, string]> = {
  calm: ["#2b4a6b", "#5e8fb3", "#cfe6ff"],
  panic: ["#5a0f1c", "#d6334d", "#ffe1e6"],
  giddy: ["#6b2a63", "#ff7ec8", "#fff0fa"],
  love: ["#5c1835", "#ff6f91", "#ffe3ec"],
  rage: ["#3d0606", "#ff3b1f", "#ffd9cc"],
  grief: ["#1c2230", "#58627a", "#d8deea"],
  dread: ["#0d0f12", "#3c4a3a", "#cfe0c8"],
  shame: ["#3d2a14", "#c4743a", "#ffe8d2"],
};
const mood = (a: Artifact) => {
  const m = attr(a, "mood").toLowerCase();
  return m in MOODS ? m : "panic";
};
function drawMind(a: Artifact, s: number): string {
  const r = mulberry(s);
  const bits = rows(a.body)
    .slice(0, 24)
    .map((l, i) => {
      const rot = ((r() - 0.5) * 14).toFixed(1);
      const dx = ((r() - 0.5) * 10).toFixed(0);
      const st = `--r:${rot}deg;--x:${dx}px;--d:${(i * 0.09).toFixed(2)}s`;
      if (/^!/.test(l)) return `<span class="art-scream" style="${st};--sz:${(1.6 + r() * 1).toFixed(2)}em">${inline(l.replace(/^!+\s*/, ""))}</span>`;
      if (/^\?/.test(l)) return `<span class="art-spiral" style="${st}">${inline(l.replace(/^\?+\s*/, ""))}</span>`;
      if (/^~/.test(l)) return `<span class="art-drift" style="${st}">${inline(l.replace(/^~+\s*/, ""))}</span>`;
      if (/^x\s/i.test(l)) return `<span class="art-crushed" style="${st}">${inline(l.replace(/^x\s+/i, ""))}</span>`;
      if (!/[A-Za-z]{2,}/.test(l) && [...l].length <= 24) return `<span class="art-debris" style="${st};--sz:${(2 + r() * 1.4).toFixed(2)}em">${esc(l)}</span>`;
      return `<span class="art-thought" style="${st};--sz:${(0.95 + r() * 0.4).toFixed(2)}em">${inline(l)}</span>`;
    })
    .join("");
  return `<div class="art-mindof">inside ${esc(attr(a, "of") || "a head")}</div><div class="art-mindfield">${bits}</div>`;
}
function drawAchievement(a: Artifact): string {
  const icon = attr(a, "icon");
  return `<div class="art-ach"><span class="art-achicon">${icon ? esc([...icon].slice(0, 3).join("")) : ICON.trophy}</span><div class="art-achtext"><small>Achievement unlocked</small><b>“${esc(attr(a, "title") || "Well, that happened")}”</b>${a.body.trim() ? `<div class="art-achdesc">${prose(a.body)}</div>` : ""}</div>${attr(a, "points") ? `<span class="art-achpts">${esc(attr(a, "points").replace(/\s*g$/i, ""))}<i>G</i></span>` : ""}</div>`;
}

const RARITY: Record<string, [string, string]> = {
  common: ["#b9bec7", "#6f7682"],
  uncommon: ["#5ee08a", "#1f7a43"],
  rare: ["#58a6ff", "#1f4f9c"],
  epic: ["#c77dff", "#6a1fb0"],
  legendary: ["#ffb341", "#b45a00"],
  cursed: ["#ff4d6d", "#3d0a1c"],
};
const rarity = (a: Artifact) => {
  const r = attr(a, "rarity").toLowerCase();
  return r in RARITY ? r : "common";
};
function drawInspect(a: Artifact): string {
  let stats = "";
  const flavor: string[] = [];
  const desc: string[] = [];
  for (const l of rows(a.body)) {
    if (/^>/.test(l)) {
      flavor.push(l.replace(/^>\s*/, ""));
      continue;
    }
    const m = l.match(KV);
    if (m && m[1]!.split(" ").length <= 4) {
      const v = m[2]!.trim();
      const f = ratio(v);
      const sign = /^\+/.test(v) ? " up" : /^[-−]/.test(v) ? " down" : "";
      stats += `<div class="art-stat"><span>${esc(m[1]!)}</span>${f !== null ? `<i class="art-sbar" style="--w:${f.toFixed(3)}"></i>` : ""}<b class="${sign}">${esc(v)}</b></div>`;
    } else desc.push(l);
  }
  const icon = attr(a, "icon");
  return `<div class="art-ihead"><span class="art-iicon">${icon ? esc([...icon].slice(0, 3).join("")) : "✦"}</span><div><b>${esc(attr(a, "name") || "Unknown object")}</b><small>${esc(rarity(a))}${attr(a, "kind") ? ` · ${esc(attr(a, "kind"))}` : ""}</small></div></div>${stats ? `<div class="art-stats">${stats}</div>` : ""}${desc.length ? `<div class="art-idesc">${prose(desc.join("\n"))}</div>` : ""}${flavor.length ? `<div class="art-iflav">${flavor.map((f) => `<p>${inline(f)}</p>`).join("")}</div>` : ""}`;
}

function barColor(label: string): string {
  if (/hp|health|life|blood|vigou?r/i.test(label)) return "#ff4d6d";
  if (/mp|mana|magic|focus|aether|will/i.test(label)) return "#4da3ff";
  if (/sta|stamina|energy|breath|fatigue/i.test(label)) return "#5ee08a";
  if (/san|sanity|nerve|composure|calm/i.test(label)) return "#c77dff";
  if (/xp|exp/i.test(label)) return "#ffd23f";
  return `hsl(${hashHue(label)} 80% 62%)`;
}
function bars(lines: string[]): { bars: string; rest: string[] } {
  let out = "";
  const rest: string[] = [];
  for (const l of lines) {
    const m = l.match(KV);
    const f = m ? ratio(m[2]!) : null;
    if (m && f !== null) out += `<div class="art-bar" style="--c:${barColor(m[1]!)};--w:${f.toFixed(3)}"><span>${esc(m[1]!)}</span><i></i><b>${esc(m[2]!.trim())}</b></div>`;
    else rest.push(l);
  }
  return { bars: out, rest };
}
function drawStatus(a: Artifact): string {
  const { bars: b, rest } = bars(rows(a.body));
  let chips = "";
  const conds: string[] = [];
  for (const l of rest) {
    const m = l.match(KV);
    if (m) chips += `<span class="art-chip"><small>${esc(m[1]!)}</small>${inline(m[2]!)}</span>`;
    else conds.push(l);
  }
  return `<div class="art-shead"><b>${esc(attr(a, "who") || "Status")}</b>${attr(a, "level") ? `<span>Lv ${esc(attr(a, "level"))}</span>` : ""}</div>${b}${chips ? `<div class="art-chips">${chips}</div>` : ""}${conds.length ? `<div class="art-conds">${conds.map((c) => `<span>${inline(c)}</span>`).join("")}</div>` : ""}`;
}
function drawEntrance(a: Artifact): string {
  const name = attr(a, "name") || "???";
  const letters = [...name].map((ch, i) => (ch === " " ? " " : `<span style="--i:${i}">${esc(ch)}</span>`)).join("");
  let chips = "";
  const tag: string[] = [];
  for (const l of rows(a.body)) {
    const m = l.match(KV);
    if (m && m[1]!.split(" ").length <= 3) chips += `<span class="art-chip"><small>${esc(m[1]!)}</small>${inline(m[2]!)}</span>`;
    else tag.push(l);
  }
  return `<div class="art-estripes" aria-hidden="true"></div>${attr(a, "title") ? `<div class="art-etitle">${esc(attr(a, "title"))}</div>` : ""}<div class="art-ename">${letters}</div>${tag.length ? `<div class="art-etag">${prose(tag.join("\n"))}</div>` : ""}${chips ? `<div class="art-chips">${chips}</div>` : ""}`;
}
function drawClash(a: Artifact, s: number): string {
  const r = mulberry(s);
  const { bars: b, rest } = bars(rows(a.body));
  const beats = rest
    .map((l) => {
      const letters = l.replace(/[^A-Za-z]/g, "");
      if (letters.length >= 2 && letters === letters.toUpperCase() && /[A-Z]/.test(letters)) {
        return `<div class="art-impact" style="--r:${((r() - 0.5) * 16).toFixed(1)}deg;--h:${Math.floor(r() * 50)}"><svg viewBox="0 0 200 90" aria-hidden="true"><path d="${starburst(r)}"/></svg><span>${esc(l)}</span></div>`;
      }
      return `<div class="art-beat">${inline(l)}</div>`;
    })
    .join("");
  const vs = attr(a, "a") || attr(a, "b") ? `<div class="art-vs"><span>${esc(attr(a, "a"))}</span><b>VS</b><span>${esc(attr(a, "b"))}</span></div>` : "";
  return `${vs}${b ? `<div class="art-cbars">${b}</div>` : ""}<div class="art-beats">${beats}</div>`;
}
function starburst(r: () => number): string {
  const n = 14;
  let d = "";
  for (let i = 0; i < n * 2; i++) {
    const ang = (i / (n * 2)) * Math.PI * 2;
    const rad = i % 2 ? 0.55 + r() * 0.1 : 0.9 + r() * 0.1;
    d += `${i ? "L" : "M"}${(100 + Math.cos(ang) * 98 * rad).toFixed(1)} ${(45 + Math.sin(ang) * 44 * rad).toFixed(1)}`;
  }
  return `${d}Z`;
}
function drawPassage(a: Artifact): string {
  const kind = (attr(a, "kind") || "clock").toLowerCase();
  const from = attr(a, "from");
  const to = attr(a, "to");
  const span = `<div class="art-pspan"><span>${esc(from)}</span><i></i><span>${esc(to)}</span></div>`;
  const cap = a.body.trim() ? `<div class="art-pcap">${prose(a.body)}</div>` : "";
  if (kind.startsWith("cal")) {
    return `<div class="art-cal"><div class="art-cpage art-cto"><small>${esc(monthOf(to))}</small><b>${esc(dayOf(to))}</b></div><div class="art-cpage art-cfrom"><small>${esc(monthOf(from))}</small><b>${esc(dayOf(from))}</b></div></div>${span}${cap}`;
  }
  if (kind.startsWith("sea")) {
    return `<div class="art-seasons" aria-hidden="true"><span>❄</span><span>✿</span><span>☀</span><span>❦</span><i></i></div>${span}${cap}`;
  }
  if (kind.startsWith("jour") || kind.startsWith("trav")) {
    return `<div class="art-journey" aria-hidden="true"><i></i><b></b></div>${span}${cap}`;
  }
  const ticks = Array.from({ length: 12 }, (_, i) => `<path d="M50 ${i % 3 ? 8 : 6}V${i % 3 ? 12 : 15}" transform="rotate(${i * 30} 50 50)"/>`).join("");
  return `<svg class="art-clock" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="46"/><g class="art-cticks">${ticks}</g><path class="art-hh" d="M50 50V28"/><path class="art-mh" d="M50 50V14"/><circle cx="50" cy="50" r="3"/></svg>${span}${cap}`;
}
const dayOf = (s: string) => s.match(/\b\d{1,2}\b/)?.[0] ?? (s.split(/\s+/)[0] || "·");
const monthOf = (s: string) => s.replace(/\b\d{1,2}\b/, "").trim() || " ";
function drawMemory(a: Artifact): string {
  const body = rows(a.body)
    .map((l) => (/^~/.test(l) ? `<p class="art-blur">${inline(l.replace(/^~+\s*/, ""))}</p>` : `<p>${inline(l)}</p>`))
    .join("");
  return `<div class="art-memhead">${esc([attr(a, "when"), attr(a, "of")].filter(Boolean).join(" · ") || "before")}</div><div class="art-membody">${body}</div><div class="art-grain" aria-hidden="true"></div>`;
}
function drawHeartbeat(a: Artifact): string {
  const bpm = Math.max(30, Math.min(220, Number(attr(a, "bpm").replace(/\D/g, "")) || 96));
  const beat = (60 / bpm).toFixed(3);
  const path = "M0 30H40l6-4 6 4h8l5 18 7-42 6 30 5-6H120l6-4 6 4h8l5 18 7-42 6 30 5-6H200";
  return `<div class="art-hbhead"><span class="art-hbheart" style="--beat:${beat}s">${ICON.heart}</span><b>${bpm}</b><small>bpm${attr(a, "who") ? ` · ${esc(attr(a, "who"))}` : ""}</small></div><svg class="art-ecg" viewBox="0 0 200 60" preserveAspectRatio="none" aria-hidden="true" style="--beat:${beat}s"><path class="base" d="${path}"/><path class="sweep" d="${path}" pathLength="100"/></svg>${a.body.trim() ? `<div class="art-hbtext">${prose(a.body)}</div>` : ""}`;
}

const SCHOOL: Record<string, [string, string]> = {
  fire: ["#ff7a2f", "#ffd36b"],
  frost: ["#7fd6ff", "#e8fbff"],
  shadow: ["#9b6bff", "#2a1550"],
  holy: ["#ffe28a", "#fff8dc"],
  nature: ["#6be08a", "#d9ffc4"],
  arcane: ["#c77dff", "#7fd6ff"],
  blood: ["#ff2e4d", "#5c0010"],
};
const school = (a: Artifact) => {
  const s = attr(a, "school").toLowerCase();
  return s in SCHOOL ? s : "arcane";
};
const RUNES = "ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ";
function drawSpell(a: Artifact, s: number): string {
  const text = `${attr(a, "name")} ${a.body}`.toLowerCase().replace(/[^a-z]/g, "");
  const runes = [...(text || "arcana")].map((c) => RUNES[(c.charCodeAt(0) - 97) % RUNES.length]).join("").slice(0, 40).padEnd(24, "ᛟ");
  const pts = 5 + (s % 4);
  const star = Array.from({ length: pts }, (_, i) => {
    const ang = (i * 2 * Math.PI * 2) / pts - Math.PI / 2;
    return `${(50 + 26 * Math.cos(ang)).toFixed(1)} ${(50 + 26 * Math.sin(ang)).toFixed(1)}`;
  }).join(" L");
  const id = `sp${s.toString(36)}`;
  return `<svg class="art-sigil" viewBox="0 0 100 100" aria-hidden="true"><defs><path id="${id}" d="M50 50m-38 0a38 38 0 1 1 76 0a38 38 0 1 1-76 0"/></defs><g class="art-ring1"><circle cx="50" cy="50" r="44"/><circle cx="50" cy="50" r="33"/><text><textPath href="#${id}">${esc(runes)}</textPath></text></g><g class="art-ring2"><path d="M${star}Z"/><circle cx="50" cy="50" r="9"/></g></svg>${attr(a, "name") ? `<div class="art-spname">${esc(attr(a, "name"))}</div>` : ""}<div class="art-spinc">${prose(a.body)}</div>`;
}
