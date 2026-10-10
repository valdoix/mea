import DOMPurify from "dompurify";
import { marked } from "marked";
import { extractArtifacts, placeArtifacts } from "./artifacts";
import { quoteIds } from "./quotes";

/**
 * Message rendering (CHAT-07): Markdown → sanitized HTML (SEC-03), dialogue
 * highlighting, and card CSS scoped to its own message so it can't restyle the app.
 */
marked.setOptions({ gfm: true, breaks: true });

const cache = new Map<string, string>();
const MAX_CACHE = 600;

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

/** A value that would load something from outside the message: a remote image, or a request to Mea's API. */
const REMOTE_REF = /(?:image-set|\bsrc)\s*\(|url\(\s*["']?(?!data:)/i;

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

/** Scopes card-provided CSS to one message using the browser's own CSS parser. */
function scopeCss(css: string, scope: string): string {
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
    const scoped = out.join("\n").replace(/url\(\s*["']?(?!data:)[^)]*\)/gi, "none");
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

export function renderMessage(input: string, scopeClass: string, opts: { artifacts?: boolean } = {}): string {
  const dressed = opts.artifacts !== false;
  const key = `${scopeClass}\u0000${dressed ? 1 : 0}\u0000${input}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  // Artifacts (<letter>, <texts>…) are cut out before Markdown and drawn from escaped text.
  const { text, found } = extractArtifacts(input.replace(/<ledger\b[\s\S]*?(?:<\/ledger\s*>|$)/gi, ""));

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
  });
  const tpl = document.createElement("template");
  tpl.innerHTML = clean;
  const container = document.createElement("div");
  container.appendChild(tpl.content);
  highlightDialogue(container);
  let html = found.length ? placeArtifacts(container.innerHTML, found, dressed) : container.innerHTML;
  if (styles.length) {
    const scoped = scopeCss(styles.join("\n"), `.${scopeClass}`);
    if (scoped) html = `<style>${scoped}</style>${html}`;
  }
  cache.set(key, html);
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!);
  return html;
}

/** Cheap render for streaming text: re-rendered at most once per animation frame. */
export function renderStreaming(input: string, opts: { artifacts?: boolean } = {}): string {
  // Inline trackers: the hidden <ledger> the story model writes never shows while it streams.
  const { text, found } = extractArtifacts(input.replace(/<ledger\b[\s\S]*$/i, ""));
  const raw = marked.parse(text, { async: false }) as string;
  const clean = purify.sanitize(raw, { FORBID_TAGS: ["style", "script", "iframe", "object", "embed", "form", "input", "button", "link", "meta", "base"], FORBID_ATTR: ["srcset"] });
  const tpl = document.createElement("template");
  tpl.innerHTML = clean;
  const container = document.createElement("div");
  container.appendChild(tpl.content);
  highlightDialogue(container);
  return found.length ? placeArtifacts(container.innerHTML, found, opts.artifacts !== false) : container.innerHTML;
}
