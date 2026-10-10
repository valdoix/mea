import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { now } from "../db/db";

/**
 * Web research for the studios: canon from the source's Fandom wiki and Wikipedia (MediaWiki APIs,
 * no scraping), plus any page you paste (a fan wiki, a meta post). The studios distil what's
 * gathered into a canon brief, and look up single pages (a character, a place) when writing an
 * entry or answering in the co-writer. Every fetch is best effort: offline, the studios carry on.
 */

const UA = "Mea/0.1 (personal roleplay app; canon research for lorebooks)";
const TIMEOUT = 12_000;

export interface Wiki {
  name: string;
  /** The MediaWiki API endpoint. */
  api: string;
  /** Page URLs: base + encoded title. */
  base: string;
  kind: "fandom" | "wikipedia" | "mediawiki";
}

export interface Source {
  title: string;
  url: string;
  kind: string;
  chars: number;
}

export interface Research {
  /** What it was gathered for ("Yellowjackets (TV series)"). */
  basedOn: string;
  at: number;
  wikis: Wiki[];
  sources: Source[];
  /** Every character page the wiki lists, so the census can't miss anyone. */
  names: string[];
  /** The distilled canon (and fanon) reference every step reads. */
  brief: string;
}

export interface Gathered {
  wikis: Wiki[];
  sources: Source[];
  names: string[];
  text: string;
}

// ---------- fetching, safely ----------

/** M8: true for an address on this machine, the local network, or a reserved range (IPv4 or IPv6). */
export function privateIp(ip: string): boolean {
  const a = ip.toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  if (isIP(a) === 6) {
    // IPv4-mapped / -compatible / NAT64 forms carry an IPv4 address: check that.
    const tail = a.match(/^(?:::ffff:(?:0:)?|::|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    if (tail) return privateIp(tail);
    const hex = a.match(/^(?:::ffff:(?:0:)?|::|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex) {
      const hi = parseInt(hex[1]!, 16);
      const lo = parseInt(hex[2]!, 16);
      return privateIp(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    if (a === "::" || a === "::1") return true;
    const first = parseInt(a.split(":")[0] || "0", 16);
    // fc00::/7 unique local, fe80::/10 link-local, fec0::/10 site-local, ff00::/8 multicast.
    return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xffc0) === 0xfec0 || (first & 0xff00) === 0xff00;
  }
  if (isIP(a) !== 4) return true; // not an address: treat as unsafe
  const [p, q] = a.split(".").map(Number) as [number, number];
  return (
    p === 0 || p === 10 || p === 127 || p >= 224 ||
    (p === 100 && q >= 64 && q <= 127) ||
    (p === 169 && q === 254) ||
    (p === 172 && q >= 16 && q <= 31) ||
    (p === 192 && (q === 168 || a.startsWith("192.0.0.") || a.startsWith("192.0.2."))) ||
    (p === 198 && (q === 18 || q === 19 || q === 51)) ||
    (p === 203 && a.startsWith("203.0.113."))
  );
}

/** Only public http(s) pages: never this machine or the local network. */
export function publicUrl(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return null;
  // M8: address literals (the URL parser has already normalised "0x7f.1" and the like).
  if (isIP(h) && privateIp(h)) return null;
  if (/^\d+$/.test(h)) return null;
  return u;
}

/** M8: the host must also resolve only to public addresses (catches names like 127.0.0.1.nip.io). */
async function resolvesPublic(u: URL): Promise<boolean> {
  const h = u.hostname.replace(/^\[|\]$/g, "");
  if (isIP(h)) return !privateIp(h);
  try {
    const addrs = await dnsLookup(h, { all: true, verbatim: true });
    return addrs.length > 0 && addrs.every((x) => !privateIp(x.address));
  } catch {
    return false;
  }
}

const MAX_BODY = 3_000_000;
const MAX_HOPS = 5;

/** M8: reads at most `max` bytes of a body, then stops the download. */
async function readCapped(res: Response, max = MAX_BODY): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < max) {
      const { done, value } = await reader.read();
      if (done) break;
      const part = value.subarray(0, max - size);
      chunks.push(part);
      size += part.length;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.length;
  }
  return new TextDecoder().decode(all);
}

async function fetchText(url: string, accept = "application/json"): Promise<string | null> {
  if (process.env.MEA_OFFLINE === "1") return null;
  const signal = AbortSignal.timeout(TIMEOUT);
  try {
    // M8: redirects are followed by hand, and every hop is checked before it's fetched.
    let next = url;
    for (let hop = 0; hop <= MAX_HOPS; hop++) {
      const u = publicUrl(next);
      if (!u || !(await resolvesPublic(u))) return null;
      const res = await fetch(u.href, { headers: { "User-Agent": UA, Accept: accept }, signal, redirect: "manual" });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        await res.body?.cancel().catch(() => {});
        if (!loc) return null;
        next = new URL(loc, u).href;
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        return null;
      }
      return await readCapped(res);
    }
    return null;
  } catch {
    return null;
  }
}

async function api<T = any>(wiki: Wiki, params: Record<string, string>): Promise<T | null> {
  const q = new URLSearchParams({ format: "json", formatversion: "2", ...params });
  const t = await fetchText(`${wiki.api}?${q}`);
  if (!t) return null;
  try {
    return JSON.parse(t) as T;
  } catch {
    return null;
  }
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", mdash: "—", ndash: "–", hellip: "…" };

const SKIPPED = new Set(["script", "style", "noscript", "nav", "footer", "header", "aside", "figure", "sup"]);
const LINE_ENDS = new Set(["p", "div", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6"]);

/**
 * M8: tags out, in one pass. Skipped elements (scripts, navigation boxes, references, edit links)
 * are dropped with their content, nesting counted; block ends become line breaks. No regex here
 * scans past the tag it's looking at, so this is linear even on hostile HTML (unclosed tags).
 */
function stripTags(html: string): string {
  const out: string[] = [];
  const n = html.length;
  let i = 0;
  let skip: string | null = null;
  let depth = 0;
  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt < 0) {
      if (!skip) out.push(html.slice(i));
      break;
    }
    if (!skip && lt > i) out.push(html.slice(i, lt));
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      i = end < 0 ? n : end + 3;
      continue;
    }
    const gt = html.indexOf(">", lt + 1);
    if (gt < 0) break; // an unclosed tag: the rest is markup
    const tag = html.slice(lt + 1, Math.min(gt, lt + 400));
    i = gt + 1;
    const m = /^(\/?)([a-zA-Z][a-zA-Z0-9]*)/.exec(tag);
    if (!m) {
      if (!skip) out.push(" ");
      continue;
    }
    const closing = m[1] === "/";
    const name = m[2]!.toLowerCase();
    const selfClosing = html[gt - 1] === "/";
    if (skip) {
      if (name === skip && !selfClosing) depth += closing ? -1 : 1;
      if (depth === 0) {
        skip = null;
        out.push(" ");
      }
      continue;
    }
    if (!closing && !selfClosing) {
      const cls = name === "table" || name === "span" ? (/class\s*=\s*["']?([^"'>]*)/i.exec(tag)?.[1] ?? "") : "";
      if (SKIPPED.has(name) || (name === "table" && /navbox|infobox|metadata|ambox/i.test(cls)) || (name === "span" && cls.startsWith("mw-editsection"))) {
        skip = name;
        depth = 1;
        continue;
      }
    }
    if (name === "br" || (closing && LINE_ENDS.has(name))) out.push("\n");
    else if (!closing && name === "li") out.push("\n- ");
    else if (!closing && /^h\d$/.test(name)) out.push("\n\n## ");
    else out.push(" ");
  }
  return out.join("");
}

/** The first <name …>…</name> element of a page (lower-cased copy for searching), linear time. */
function firstElement(html: string, lower: string, names: string[]): { start: number; inner: number; end: number } | null {
  let best: { start: number; name: string } | null = null;
  for (const name of names) {
    let at = lower.indexOf(`<${name}`);
    // "<main" must not match "<mainframe": the next character ends the tag name.
    while (at >= 0 && /[a-z0-9]/.test(lower[at + name.length + 1] ?? "")) at = lower.indexOf(`<${name}`, at + 1);
    if (at >= 0 && (!best || at < best.start)) best = { start: at, name };
  }
  if (!best) return null;
  const inner = html.indexOf(">", best.start);
  const end = lower.indexOf(`</${best.name}>`, best.start);
  if (inner < 0 || end < 0) return null;
  return { start: best.start, inner: inner + 1, end: end + best.name.length + 3 };
}

/** Readable text from a page's HTML: no scripts, navigation boxes, references or edit links. */
export function htmlToText(html: string): string {
  return stripTags(html)
    .replace(/&(#?\w+);/g, (m, e: string) => ENTITIES[e.toLowerCase()] ?? (e.startsWith("#") ? String.fromCharCode(Number(e.slice(1)) || 32) : m))
    .replace(/\[(\d+|edit|citation needed)\]/gi, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    // The table of contents and wiki banners say nothing about the story.
    .replace(/## Contents\n+(?:- [\d.]+ [^\n]*\n+)+/g, "")
    .replace(/^.*(?:do not put FALSE|UNCONFIRMED INFORMATION|This article is a stub|spoilers? ahead).*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------- the wikis ----------

const WIKIPEDIA: Wiki = { name: "Wikipedia", api: "https://en.wikipedia.org/w/api.php", base: "https://en.wikipedia.org/wiki/", kind: "wikipedia" };

/** "Yellowjackets (TV series, 2021)" → "Yellowjackets". */
export const workName = (basedOn: string) => basedOn.replace(/\([^)]*\)/g, "").replace(/\b(AU|fanfic(tion)?|universe)\b/gi, "").replace(/\s+/g, " ").trim();

/** The work's Fandom wiki, if it has one: tried by name ("yellowjackets.fandom.com"). */
export async function findFandom(basedOn: string): Promise<Wiki | null> {
  const name = workName(basedOn);
  if (!name) return null;
  const plain = name.toLowerCase().replace(/^the\s+/, "");
  const slugs = [...new Set([plain.replace(/[^a-z0-9]+/g, ""), plain.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), plain.split(/\s+/)[0]!.replace(/[^a-z0-9]/g, "")])].filter((s) => s.length >= 2);
  for (const slug of slugs) {
    const wiki: Wiki = { name: `${name} Wiki`, api: `https://${slug}.fandom.com/api.php`, base: `https://${slug}.fandom.com/wiki/`, kind: "fandom" };
    const info = await api<{ query?: { general?: { sitename?: string } } }>(wiki, { action: "query", meta: "siteinfo" });
    const site = info?.query?.general?.sitename;
    if (site) return { ...wiki, name: site };
  }
  return null;
}

/** A pasted wiki link (Fandom, Wikipedia or another MediaWiki) as a wiki plus the page it points at. */
function wikiOf(u: URL): { wiki: Wiki; title: string } | null {
  const m = u.pathname.match(/^\/wiki\/(.+)$/);
  if (!m) return null;
  const title = decodeURIComponent(m[1]!).replace(/_/g, " ");
  if (u.hostname.endsWith(".fandom.com")) return { wiki: { name: u.hostname.split(".")[0]!, api: `https://${u.hostname}/api.php`, base: `https://${u.hostname}/wiki/`, kind: "fandom" }, title };
  if (u.hostname.endsWith("wikipedia.org")) return { wiki: { name: "Wikipedia", api: `https://${u.hostname}/w/api.php`, base: `https://${u.hostname}/wiki/`, kind: "wikipedia" }, title };
  return { wiki: { name: u.hostname, api: `${u.origin}/w/api.php`, base: `${u.origin}/wiki/`, kind: "mediawiki" }, title };
}

export async function searchWiki(wiki: Wiki, query: string, limit = 5): Promise<string[]> {
  const r = await api<{ query?: { search?: { title: string }[] } }>(wiki, { action: "query", list: "search", srsearch: query, srlimit: String(limit), srnamespace: "0" });
  return r?.query?.search?.map((s) => s.title) ?? [];
}

/** One page as plain text (Wikipedia's own plain extract where it has one). */
export async function pageText(wiki: Wiki, title: string, max = 8000): Promise<string> {
  if (wiki.kind === "wikipedia") {
    const r = await api<{ query?: { pages?: { extract?: string }[] } }>(wiki, { action: "query", prop: "extracts", explaintext: "1", redirects: "1", titles: title });
    const t = r?.query?.pages?.[0]?.extract;
    if (t) return t.replace(/\n{3,}/g, "\n\n").slice(0, max);
  }
  const r = await api<{ parse?: { text?: string } }>(wiki, { action: "parse", page: title, prop: "text", redirects: "1", disableeditsection: "1" });
  return r?.parse?.text ? htmlToText(r.parse.text).slice(0, max) : "";
}

async function categoryMembers(wiki: Wiki, category: string, limit = 500): Promise<string[]> {
  const out: string[] = [];
  let cont: string | undefined;
  for (let i = 0; i < 4 && out.length < limit; i++) {
    const r = await api<{ query?: { categorymembers?: { title: string; ns: number }[] }; continue?: { cmcontinue?: string } }>(wiki, { action: "query", list: "categorymembers", cmtitle: `Category:${category}`, cmlimit: "200", cmnamespace: "0", ...(cont ? { cmcontinue: cont } : {}) });
    out.push(...(r?.query?.categorymembers?.map((m) => m.title) ?? []));
    cont = r?.continue?.cmcontinue;
    if (!cont) break;
  }
  return out;
}

/** A page from any site, as text (a wiki link goes through its API). */
async function anyPage(raw: string, max = 12_000): Promise<{ source: Source; text: string } | null> {
  const u = publicUrl(raw);
  if (!u) return null;
  const w = wikiOf(u);
  if (w) {
    const text = await pageText(w.wiki, w.title, max);
    if (text) return { source: { title: `${w.title} (${w.wiki.name})`, url: u.href, kind: w.wiki.kind, chars: text.length }, text };
  }
  const html = await fetchText(u.href, "text/html,application/xhtml+xml");
  if (!html) return null;
  // M8: found with indexOf, not backtracking regexes.
  const lower = html.replace(/[A-Z]+/g, (s) => s.toLowerCase()); // ASCII only, so indexes line up
  const t = firstElement(html, lower, ["title"]);
  const title = (t ? html.slice(t.inner, Math.min(t.end - "</title>".length, t.inner + 1000)) : "").replace(/<[^>]*>/g, "").trim().slice(0, 200) || u.hostname;
  const m = firstElement(html, lower, ["main", "article"]);
  const main = m ? html.slice(m.start, m.end) : html;
  const text = htmlToText(main).slice(0, max);
  return text.length > 200 ? { source: { title, url: u.href, kind: "web", chars: text.length }, text } : null;
}

const pageUrl = (wiki: Wiki, title: string) => `${wiki.base}${encodeURIComponent(title.replace(/ /g, "_"))}`;

/**
 * Gathers canon for a work: Wikipedia's article and character list, the Fandom wiki's character
 * roster and overview pages, the pages about `focus` (a character being made), and your links.
 */
export async function gather(basedOn: string, opts: { urls?: string[]; focus?: string[]; maxChars?: number } = {}): Promise<Gathered> {
  const max = opts.maxChars ?? 70_000;
  const name = workName(basedOn);
  const wikis: Wiki[] = [];
  const sources: Source[] = [];
  const parts: string[] = [];
  let names: string[] = [];
  const add = (title: string, url: string, kind: string, text: string, cap: number) => {
    const t = text.trim().slice(0, cap);
    if (t.length < 80) return;
    sources.push({ title, url, kind, chars: t.length });
    parts.push(`### ${title}\n${t}`);
  };

  const tasks: Promise<void>[] = [];
  if (name) {
    tasks.push(
      (async () => {
        const hits = await searchWiki(WIKIPEDIA, basedOn, 3);
        const main = hits[0];
        if (main) {
          wikis.push(WIKIPEDIA);
          add(`${main} (Wikipedia)`, pageUrl(WIKIPEDIA, main), "wikipedia", await pageText(WIKIPEDIA, main, 9000), 9000);
        }
        const list = (await searchWiki(WIKIPEDIA, `List of ${name} characters`, 3)).find((t) => /characters/i.test(t) && t.toLowerCase().includes(name.toLowerCase().split(" ")[0]!));
        if (list) add(`${list} (Wikipedia)`, pageUrl(WIKIPEDIA, list), "wikipedia", await pageText(WIKIPEDIA, list, 16_000), 16_000);
      })(),
      (async () => {
        const fandom = await findFandom(basedOn);
        if (!fandom) return;
        wikis.unshift(fandom);
        names = [...new Set([...(await categoryMembers(fandom, "Characters")), ...(await categoryMembers(fandom, "Main characters", 100))])].filter((t) => !/^(list of|characters?$)/i.test(t));
        for (const title of ["Characters", name]) {
          const hit = (await searchWiki(fandom, title, 1))[0];
          if (hit && !sources.some((s) => s.url === pageUrl(fandom, hit))) add(`${hit} (${fandom.name})`, pageUrl(fandom, hit), "fandom", await pageText(fandom, hit, 9000), 9000);
        }
      })(),
    );
  }
  for (const u of (opts.urls ?? []).slice(0, 8))
    tasks.push(
      (async () => {
        const p = await anyPage(u);
        if (p) add(p.source.title, p.source.url, p.source.kind, p.text, 12_000);
      })(),
    );
  await Promise.all(tasks);
  // Pages about the person (or place) being made, once the wikis are known.
  for (const f of (opts.focus ?? []).slice(0, 3)) {
    const page = await lookup(wikis, f, 7000);
    if (page) add(page.title, page.url, page.kind, page.text, 7000);
  }
  let text = parts.join("\n\n");
  if (names.length) text = `CHARACTER PAGES ON THE WIKI: ${names.join(", ")}\n\n${text}`;
  return { wikis, sources, names, text: text.slice(0, max) };
}

/** The best page on the known wikis (Fandom first) about a name or topic. */
export async function lookup(wikis: Wiki[], query: string, max = 6000, strict = false): Promise<{ title: string; url: string; kind: string; text: string } | null> {
  for (const wiki of wikis) {
    const hits = await searchWiki(wiki, query, 3);
    // Prefer an exact or containing title over the search engine's first guess; strict takes only those.
    const q = query.toLowerCase().replace(/^the\s+/, "");
    const hit = hits.find((h) => h.toLowerCase() === q) ?? hits.find((h) => h.toLowerCase().includes(q) || (q.includes(h.toLowerCase()) && h.length > 3)) ?? (strict ? undefined : hits[0]);
    if (!hit) continue;
    const text = await pageText(wiki, hit, max);
    if (text.length > 120) return { title: `${hit} (${wiki.name})`, url: pageUrl(wiki, hit), kind: wiki.kind, text };
  }
  return null;
}

/** Where the co-writer can look things up: what research found, else the work's wiki and Wikipedia. */
export async function wikisFor(research: Research | null | undefined, basedOn: string): Promise<Wiki[]> {
  if (research?.wikis.length) return research.wikis;
  const fandom = basedOn.trim() ? await findFandom(basedOn).catch(() => null) : null;
  return fandom ? [fandom, WIKIPEDIA] : [WIKIPEDIA];
}

export const researchBlock =(r: Research | null | undefined) => (r?.brief.trim() ? `CANON RESEARCH (from ${r.sources.map((s) => s.title).slice(0, 6).join("; ")}; trust it over memory, the author's changes over it):\n${r.brief.trim()}` : "");

export const BRIEF_RULE = (basedOn: string, focus?: string) =>
  [
    `Distil this research about ${basedOn} into a canon brief a writer can rely on${focus ? `, centred on ${focus}` : ""}. Use only what the sources say, plus well-known canon you're sure of; mark anything uncertain with "(?)".`,
    "Sections, in plain text with ## headings: Premise and timeline; Cast (EVERY named character, one line each: full name — who they are, key relationships, what happens to them; group the minor ones but never drop them); Places; Groups and families; Objects and motifs; Key events; Fanon (popular ships, fan interpretations, recurring fic tropes and fan nicknames you know of, marked as fanon).",
    "Dense and factual; up to 2,500 words. No commentary.",
  ].join(" ");

export const emptyResearch = (basedOn: string): Research => ({ basedOn, at: now(), wikis: [], sources: [], names: [], brief: "" });
