/**
 * In-story artifacts: the tags a reply uses for things that pass in front of the reader
 * (<letter>, <texts>, <clipping>…, taught by the Mea preset's Artifacts control). They are cut
 * out before Markdown runs and drawn here from escaped text only, so a reply can't smuggle
 * markup in through them. With artifacts off, the words stay and only the dressing goes.
 */

export const ARTIFACT_KINDS = ["letter", "note", "clipping", "texts", "poster", "ticket", "radio", "map", "photo"] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export interface Artifact {
  kind: ArtifactKind;
  attrs: Record<string, string>;
  body: string;
}

const KINDS = ARTIFACT_KINDS.join("|");
const PAIRED = new RegExp(`<(${KINDS})\\b([^>]*)>([\\s\\S]*?)<\\/\\1\\s*>`, "gi");
const SELF = new RegExp(`<(${KINDS})\\b([^>]*?)\\/>`, "gi");
const TOKEN = (i: number) => `MEAARTIFACT${i}END`;

function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of s.matchAll(/([a-z][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi)) out[m[1]!.toLowerCase()] = (m[2] ?? m[3] ?? m[4] ?? "").trim();
  for (const m of s.matchAll(/(?:^|\s)([a-z][\w-]*)(?=\s|$)(?!\s*=)/gi)) if (!(m[1]!.toLowerCase() in out)) out[m[1]!.toLowerCase()] = "true";
  return out;
}

/** Cuts the artifacts out, leaving a token paragraph where each one stood. */
export function extractArtifacts(text: string): { text: string; found: Artifact[] } {
  const found: Artifact[] = [];
  const take = (kind: string, attrs: string, body: string) => {
    found.push({ kind: kind.toLowerCase() as ArtifactKind, attrs: parseAttrs(attrs), body: body.replace(/^\n+|\s+$/g, "") });
    return `\n\n${TOKEN(found.length - 1)}\n\n`;
  };
  const out = text.replace(PAIRED, (_m, k: string, a: string, b: string) => take(k, a, b)).replace(SELF, (_m, k: string, a: string) => take(k, a, ""));
  return { text: out, found };
}

/** Puts each artifact back where its token paragraph is. */
export function placeArtifacts(html: string, found: Artifact[], dressed: boolean): string {
  return html.replace(/<p>\s*MEAARTIFACT(\d+)END\s*<\/p>|MEAARTIFACT(\d+)END/g, (_m, a?: string, b?: string) => {
    const art = found[Number(a ?? b)];
    if (!art) return "";
    return dressed ? drawArtifact(art) : plainArtifact(art);
  });
}

// ---------- drawing ----------

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** Escaped text with *italic* and **bold**, paragraphs on blank lines, breaks on single ones. */
function prose(s: string): string {
  const inline = (t: string) =>
    esc(t)
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
      .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, "$1<i>$2</i>")
      .replace(/\n/g, "<br>");
  return s
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${inline(p)}</p>`)
    .join("");
}
const attr = (a: Artifact, k: string) => a.attrs[k]?.trim() ?? "";
/** A stable number per artifact (tilts, seeds) so re-renders don't jitter. */
function seed(a: Artifact): number {
  let h = 2166136261;
  for (const ch of `${a.kind}${a.body}${JSON.stringify(a.attrs)}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return Math.abs(h);
}
const tilt = (a: Artifact, max: number) => (((seed(a) % 1000) / 1000) * 2 - 1) * max;

function plainArtifact(a: Artifact): string {
  const head = [attr(a, "from") && `From ${attr(a, "from")}`, attr(a, "paper"), attr(a, "with") && `Messages with ${attr(a, "with")}`, attr(a, "of"), attr(a, "caption")].filter(Boolean).join(" · ");
  return `<blockquote class="art-plain">${head ? `<p><i>${esc(head)}</i></p>` : ""}${prose(a.body)}</blockquote>`;
}

const SEAL = `<svg class="art-seal" viewBox="0 0 64 64" aria-hidden="true"><path d="M32 3c6 0 8 4 13 5s9 1 11 6-1 8 1 13 5 8 2 13-7 4-9 9-4 9-10 10-9-3-14-2-10 3-13-2 0-9-3-13-7-6-5-12 6-6 7-11 1-10 6-12 8 1 12-1 4-3 9-3z" fill="var(--seal, #9c1d34)"/><circle cx="32" cy="32" r="17" fill="none" stroke="#0005" stroke-width="2"/><circle cx="26" cy="24" r="6" fill="#fff2"/></svg>`;

export function drawArtifact(a: Artifact): string {
  const t = tilt(a, 2.2).toFixed(2);
  const wrap = (cls: string, inner: string, label: string) => `<figure class="art art-${cls}" style="--tilt:${t}deg" role="group" aria-label="${esc(label)}">${inner}</figure>`;
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
      const rows = a.body.split("\n").map((l) => l.trim()).filter(Boolean);
      let bubbles = "";
      rows.forEach((l, i) => {
        const m = l.match(/^([^:]{1,40}):\s*(.*)$/);
        const who = m?.[1]?.trim() ?? "";
        const said = m ? m[2]! : l;
        const me = /^(me|you|i)$/i.test(who);
        const typing = i === rows.length - 1 && /^(…|\.\.\.)$/.test(said.trim());
        bubbles += typing ? `<div class="art-typing" aria-label="typing"><i></i><i></i><i></i></div>` : `<div class="art-bub ${me ? "me" : "them"}">${esc(said)}</div>`;
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
      const no = attr(a, "no") || String(seed(a) % 1_000_000).padStart(6, "0");
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
      return wrap("photo", `<div class="art-ph" style="${photoStyle(a)}">${photoFigures(a)}</div><div class="art-cap">${esc(attr(a, "caption") || attr(a, "of") || a.body)}</div>`, `Photograph${attr(a, "of") ? `: ${attr(a, "of")}` : ""}`);
  }
}

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
function photoStyle(a: Artifact): string {
  const d = `${attr(a, "of")} ${attr(a, "caption")} ${a.body}`.toLowerCase();
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
function photoFigures(a: Artifact): string {
  const d = `${attr(a, "of")} ${attr(a, "caption")}`.toLowerCase();
  const n = /\b(three|trio|family|friends|crowd|group)\b/.test(d) ? 3 : /\b(two|and|&|couple|pair|both|us|me and)\b/.test(d) ? 2 : /\b(she|he|they|portrait|girl|boy|man|woman|person|me)\b/.test(d) ? 1 : 0;
  const tower = /lighthouse|tower|castle|keep|spire/.test(d) ? `<path d="M76 61 l2 -22 h4 l2 22z" />` : "";
  const people = Array.from({ length: n }, (_, i) => {
    const x = 36 + i * 8;
    return `<circle cx="${x}" cy="${65 - (i % 2)}" r="2.7"/><path d="M${x - 2.6} ${67.5 - (i % 2)}h5.2l1.1 12h-7.4z"/>`;
  }).join("");
  return tower || people ? `<svg viewBox="0 0 100 100" aria-hidden="true"><g fill="#140f24">${tower}${people}</g></svg>` : "";
}
