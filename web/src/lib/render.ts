import DOMPurify from "dompurify";
import { marked } from "marked";
import { applyFx, extractArtifacts, pendingVisual, placeArtifacts } from "./artifacts";
import { quoteIds, smartQuotes, straightQuotes } from "./quotes";

/**
 * Message rendering (CHAT-07): Markdown → sanitized HTML (SEC-03), dialogue
 * highlighting, and card CSS scoped to its own message so it can't restyle the app.
 */
marked.setOptions({ gfm: true, breaks: true });

const cache = new Map<string, string>();
const MAX_CACHE = 600;

export type QuoteStyle = "curly" | "straight" | null;

/**
 * The story's quote style on what's shown (L-quotes): every message, yours and older replies
 * included, reads the same. Works on the text only, so tags, attributes and code keep their marks.
 */
function typeset(root: HTMLElement, quotes: QuoteStyle) {
  if (!quotes) return;
  const blocks = root.querySelectorAll("p, li, blockquote, td, th, h1, h2, h3, h4, div");
  const targets: Element[] = blocks.length ? Array.from(blocks) : [root];
  for (const block of targets) {
    if (block.querySelector("p, li, div")) continue;
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement?.closest("code, pre, style") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    const nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    const joined = nodes.map((n) => n.data).join("");
    if (!/["'\u201c\u201d\u201e]/.test(joined)) continue;
    // Read the whole block at once, so a mark at the edge of an <em> sees the word beside it.
    const done = quotes === "curly" ? smartQuotes(joined) : straightQuotes(joined);
    let at = 0;
    for (const node of nodes) {
      const next = done.slice(at, at + node.data.length);
      at += node.data.length;
      if (next !== node.data) node.data = next;
    }
  }
}

/** Wraps quoted dialogue in <span class="dl">, across inline elements, never inside code. */
function highlightDialogue(root: HTMLElement) {
  const blocks = root.querySelectorAll("p, li, blockquote, td, h1, h2, h3, h4, div");
  const targets: Element[] = blocks.length ? Array.from(blocks) : [root];
  for (const block of targets) {
    if (block.querySelector("p, li, div")) continue; // only leaf blocks
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => ((n.parentElement?.closest("code, pre, style, .dl") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)),
    });
    const nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    // Read the whole block at once, so a mark at the end of one node can look at the start of the next.
    const ids = quoteIds(nodes.map((n) => n.data).join(""));
    let at = 0;
    for (const node of nodes) {
      const text = node.data;
      const parts: { text: string; id: number }[] = [];
      for (let i = 0; i < text.length; i++) {
        const id = ids[at + i]!;
        const last = parts.at(-1);
        if (last && last.id === id) last.text += text[i];
        else parts.push({ text: text[i]!, id });
      }
      at += text.length;
      if (!parts.some((p) => p.id)) continue;
      const frag = document.createDocumentFragment();
      for (const p of parts) {
        if (p.id) {
          const span = document.createElement("span");
          span.className = "dl";
          span.textContent = p.text;
          frag.appendChild(span);
        } else frag.appendChild(document.createTextNode(p.text));
      }
      node.replaceWith(frag);
    }
  }
}

/** One spoken line and who says it, kept in a saved reply's meta (server lib/speakers.ts). */
export interface SpokenLine {
  text: string;
  name: string | null;
  tone?: string;
}

const attr = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function spanFor(who: { name: string | null; tone?: string }) {
  return `<span class="dl" data-spk="${attr(who.name ?? "?")}"${who.tone ? ` data-tone="${attr(who.tone)}"` : ""}>`;
}

function readMark(raw: string): { name: string | null; tone?: string } {
  const [who = "", how = ""] = raw.split("|");
  const name = who.replace(/#\d{1,2}\s*$/, "").trim();
  const tone = how.trim().toLowerCase();
  return { name: !name || name === "?" ? null : name, ...(/^[a-z]{2,12}$/.test(tone) ? { tone } : {}) };
}

/**
 * Speaker marks become dialogue spans that already know their speaker (lib/voices.ts reads them).
 * A saved reply keeps its marks in meta (`lines`), found again in order in the text; a reply still
 * streaming (or a save cut short) has them inline. A mark still being written never shows.
 */
function markSpeakers(text: string, lines?: SpokenLine[] | null): string {
  let out = text;
  if (lines?.length) {
    let at = 0;
    let res = "";
    for (const l of lines) {
      if (!l?.text) continue;
      const i = out.indexOf(l.text, at);
      if (i < 0) continue;
      res += out.slice(at, i) + spanFor(l) + l.text + "</span>";
      at = i + l.text.length;
    }
    out = res + out.slice(at);
  }
  if (!/\[\/?s|\[$/i.test(out)) return out;
  return (
    out
      // [spk=Mara|whisper]"…"[/spk]
      .replace(/\[spk=([^\]\n]{0,80})\]((?:(?!\[spk=)[^\n])*?)\[\/spk\]/gi, (_m, raw: string, inner: string) => {
        // A mark that also wraps the narration after its quote colours only the quote.
        const q = /^\s*["“][^"“”\n]*["”]/.exec(inner)?.[0] ?? inner;
        return `${spanFor(readMark(raw))}${q}</span>${inner.slice(q.length)}`;
      })
      // a mark the model left open: up to the end of the quote it opens on
      .replace(/\[spk=([^\]\n]{0,80})\](\s*["“][^"“”\n]*["”])/gi, (_m, raw: string, inner: string) => `${spanFor(readMark(raw))}${inner}</span>`)
      // strays, and a mark still streaming in
      .replace(/\[spk=[^\]\n]{0,80}\]|\[\/spk\]|\[spk=[^\]\n]*$|\[\/?(?:s(?:p(?:k)?)?)?$/gi, "")
  );
}

/** A value that would load something from outside the message: a remote image, or a request to Mea's API. */
const REMOTE_REF = /(?:image-set|\bsrc)\s*\(|url\(\s*["']?(?!data:|#)/i;

/**
 * M5: tames one block of declarations (a card's CSS rule, or an inline style=) in place: nothing
 * pinned over the app, no huge z-index, nothing loaded from elsewhere.
 */
function tameStyle(style: CSSStyleDeclaration, pinnedTo?: string) {
  if (/fixed|sticky/i.test(style.position)) {
    if (pinnedTo) style.position = pinnedTo;
    else style.removeProperty("position");
  }
  if (Math.abs(parseInt(style.zIndex, 10)) > 50) style.removeProperty("z-index");
  for (const prop of Array.from(style)) if (REMOTE_REF.test(style.getPropertyValue(prop))) style.removeProperty(prop);
}

/**
 * Scopes card-provided CSS to one message using the browser's own CSS parser. A visual of the
 * model's own also gets its ids prefixed (`idPrefix`), as its markup's ids are.
 */
function scopeCss(css: string, scope: string, idPrefix?: string): string {
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    // M5: keyframes get the message's own prefix, so a card can't redefine the app's animations.
    const names = new Map<string, string>();
    const collect = (rules: CSSRuleList) => {
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSKeyframesRule) names.set(rule.name, `${scope.slice(1)}-${rule.name.replace(/[^\w-]/g, "_")}`);
        else if (rule instanceof CSSMediaRule) collect(rule.cssRules);
      }
    };
    collect(sheet.cssRules);
    const rename = (list: string) =>
      list
        .split(",")
        .map((n) => names.get(n.trim()) ?? n.trim())
        .join(", ");
    const out: string[] = [];
    const walk = (rules: CSSRuleList, wrap?: (s: string) => string) => {
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSStyleRule) {
          const sel = rule.selectorText
            .split(",")
            .map((s) => `${scope} ${s.trim().replace(/^(html|body|:root)\b/, "")}`)
            .map((s) => (idPrefix ? s.replace(/#(-?[_a-zA-Z][\w-]*)/g, `#${idPrefix}$1`) : s))
            .join(", ");
          tameStyle(rule.style, "absolute");
          if (rule.style.animationName) rule.style.animationName = rename(rule.style.animationName);
          const r = `${sel} { ${rule.style.cssText} }`;
          out.push(wrap ? wrap(r) : r);
        } else if (rule instanceof CSSMediaRule) {
          walk(rule.cssRules, (r) => `@media ${rule.conditionText} { ${r} }`);
        } else if (rule instanceof CSSKeyframesRule) {
          rule.name = names.get(rule.name) ?? `${scope.slice(1)}-kf`;
          for (const k of Array.from(rule.cssRules)) if (k instanceof CSSKeyframeRule) tameStyle(k.style, "absolute");
          const r = rule.cssText;
          out.push(wrap ? wrap(r) : r);
        }
      }
    };
    walk(sheet.cssRules);
    let scoped = out.join("\n").replace(/url\(\s*["']?(?!data:|#)[^)]*\)/gi, "none");
    if (idPrefix) scoped = scoped.replace(/url\(\s*(["']?)#/g, `url($1#${idPrefix}`);
    // C1: this text goes back into HTML inside <style>, where any "<" (the CSS parser turns an escaped
    // "<\/style>" in a string into a real one) could close the element early and inject markup. So no
    // "<" survives: each becomes the CSS escape \3c, which means the same character to CSS.
    return scoped.replace(/</g, "\\3c ");
  } catch {
    return "";
  }
}

/** M5: images and media in a message load only from data: URLs and Mea's own images (or its own files). */
function localSrc(value: string) {
  const v = value.trim();
  if (/^data:/i.test(v)) return true;
  try {
    const u = new URL(v, location.href);
    return u.origin === location.origin && (!u.pathname.startsWith("/api/") || u.pathname.startsWith("/api/images/"));
  } catch {
    return false;
  }
}

/** Its own DOMPurify, so these hooks don't touch other uses in the app. */
const purify = DOMPurify(window);
const scratch = document.createElement("div");
purify.addHook("uponSanitizeAttribute", (_node, data) => {
  if (data.attrName !== "style") return;
  scratch.setAttribute("style", data.attrValue);
  tameStyle(scratch.style);
  data.attrValue = scratch.style.cssText;
});
purify.addHook("afterSanitizeAttributes", (node) => {
  const tag = node.nodeName.toLowerCase();
  for (const attr of ["src", "poster", "background", "href", "xlink:href"]) {
    // Links stay links; everywhere else an href loads something (SVG <image>, <use>, <feImage>).
    if ((attr === "href" || attr === "xlink:href") && (tag === "a" || tag === "area")) continue;
    const v = node.getAttribute(attr);
    if (v !== null && !localSrc(v)) node.removeAttribute(attr);
  }
});

/** A model-made visual's markup past this many characters shows as its words instead. */
const VISUAL_MAX = 30000;

/**
 * Draws a visual the model designed itself (<vtk>): its HTML sanitized like a message's, its CSS
 * scoped to the visual alone, its ids, labels and radio groups prefixed so two visuals never
 * share one, and no inputs but checkboxes and radios (CSS-only state: tabs, reveals, flips).
 */
export function freeformVisual(body: string, scope: string): string | null {
  if (!body.trim() || body.length > VISUAL_MAX) return null;
  const styles: string[] = [];
  const markup = body.replace(/<style[^>]*>([\s\S]*?)<\/style\s*>/gi, (_m, css: string) => {
    styles.push(css);
    return "";
  });
  const clean = purify.sanitize(markup, {
    FORBID_TAGS: ["style", "script", "iframe", "object", "embed", "form", "button", "textarea", "select", "option", "link", "meta", "base", "audio", "video", "source", "track", "dialog", "template"],
    FORBID_ATTR: ["srcset", "action", "formaction", "autofocus"],
    ALLOW_DATA_ATTR: false,
    ADD_ATTR: ["for", "tabindex"],
  });
  const tpl = document.createElement("template");
  tpl.innerHTML = clean;
  const root = tpl.content;
  for (const input of Array.from(root.querySelectorAll("input"))) if (!/^(checkbox|radio)$/i.test(input.getAttribute("type") ?? "")) input.remove();
  // An image whose outside source was stripped would only show as broken.
  for (const img of Array.from(root.querySelectorAll("img"))) if (!img.getAttribute("src")) img.remove();
  const p = `${scope}-`;
  for (const el of Array.from(root.querySelectorAll("*"))) {
    if (el.id) el.id = p + el.id;
    for (const a of Array.from(el.attributes)) {
      if (a.name === "for" || (a.name === "name" && el.tagName === "INPUT")) el.setAttribute(a.name, p + a.value);
      else if ((a.name === "href" || a.name === "xlink:href") && a.value.startsWith("#")) el.setAttribute(a.name, `#${p}${a.value.slice(1)}`);
      else if (/url\(\s*["']?#/.test(a.value)) el.setAttribute(a.name, a.value.replace(/url\(\s*(["']?)#/g, `url($1#${p}`));
    }
  }
  const holder = document.createElement("div");
  holder.appendChild(root);
  if (!holder.textContent?.trim() && !holder.querySelector("svg, img, [style], [class]")) return null;
  const css = styles.length ? scopeCss(styles.join("\n"), `.${scope}`, p) : "";
  return `${css ? `<style>${css}</style>` : ""}${holder.innerHTML}`;
}

export function renderMessage(input: string, scopeClass: string, opts: { artifacts?: boolean; freeform?: boolean; quotes?: QuoteStyle; speakers?: SpokenLine[] | null } = {}): string {
  const dressed = opts.artifacts !== false;
  const freeform = dressed && opts.freeform !== false;
  const key = `${scopeClass}\u0000${dressed ? 1 : 0}${freeform ? 1 : 0}\u0000${opts.quotes ?? ""}\u0000${opts.speakers?.length ? JSON.stringify(opts.speakers) : ""}\u0000${input}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  // The visual toolkit's tags (<letter>, <texts>, <mind>…) are cut out before Markdown and drawn from escaped text.
  const cut = extractArtifacts(markSpeakers(input.replace(/<ledger\b[\s\S]*?(?:<\/ledger\s*>|$)/gi, ""), opts.speakers));
  const found = cut.found;
  const text = applyFx(cut.text, dressed);

  const styles: string[] = [];
  const withoutStyles = text.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (_m, css: string) => {
    styles.push(css);
    return "";
  });
  const raw = marked.parse(withoutStyles, { async: false }) as string;
  const clean = purify.sanitize(raw, {
    FORBID_TAGS: ["style", "script", "iframe", "object", "embed", "form", "input", "button", "textarea", "select", "link", "meta", "base"],
    FORBID_ATTR: ["srcset", "action", "formaction"],
    ALLOW_DATA_ATTR: false,
    ADD_ATTR: ["data-spk", "data-tone", "tabindex"],
  });
  const tpl = document.createElement("template");
  tpl.innerHTML = clean;
  const container = document.createElement("div");
  container.appendChild(tpl.content);
  typeset(container, opts.quotes ?? null);
  highlightDialogue(container);
  let html = found.length ? placeArtifacts(container.innerHTML, found, dressed, freeform ? freeformVisual : null) : container.innerHTML;
  if (styles.length) {
    const scoped = scopeCss(styles.join("\n"), `.${scopeClass}`);
    if (scoped) html = `<style>${scoped}</style>${html}`;
  }
  cache.set(key, html);
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!);
  return html;
}

/** Cheap render for streaming text: re-rendered at most once per animation frame. */
export function renderStreaming(input: string, opts: { artifacts?: boolean; freeform?: boolean; quotes?: QuoteStyle } = {}): string {
  const dressed = opts.artifacts !== false;
  // Inline trackers: the hidden <ledger> the story model writes never shows while it streams,
  // and a visual of the model's own shows as a sketch until it closes.
  const cut = extractArtifacts(pendingVisual(markSpeakers(input.replace(/<ledger\b[\s\S]*$/i, ""))));
  const found = cut.found;
  const text = applyFx(cut.text, dressed);
  const raw = marked.parse(text, { async: false }) as string;
  const clean = purify.sanitize(raw, { FORBID_TAGS: ["style", "script", "iframe", "object", "embed", "form", "input", "button", "link", "meta", "base"], FORBID_ATTR: ["srcset"], ADD_ATTR: ["data-spk", "data-tone", "tabindex"] });
  const tpl = document.createElement("template");
  tpl.innerHTML = clean;
  const container = document.createElement("div");
  container.appendChild(tpl.content);
  typeset(container, opts.quotes ?? null);
  highlightDialogue(container);
  const html = container.innerHTML;
  return found.length || html.includes("MEAVTKPENDING") ? placeArtifacts(html, found, dressed, dressed && opts.freeform !== false ? freeformVisual : null) : html;
}
