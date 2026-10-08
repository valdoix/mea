import DOMPurify from "dompurify";
import { marked } from "marked";

/**
 * Message rendering (CHAT-07): Markdown → sanitized HTML (SEC-03), dialogue
 * highlighting, and card CSS scoped to its own message so it can't restyle the app.
 */
marked.setOptions({ gfm: true, breaks: true });

const cache = new Map<string, string>();
const MAX_CACHE = 600;

const OPEN_CLOSE: Record<string, string> = { "“": "”", "«": "»", "„": "“" };

/** Wraps quoted dialogue in <span class="dl">, across inline elements, never inside code. */
function highlightDialogue(root: HTMLElement) {
  const blocks = root.querySelectorAll("p, li, blockquote, td, h1, h2, h3, h4, div");
  const targets: Element[] = blocks.length ? Array.from(blocks) : [root];
  for (const block of targets) {
    if (block.querySelector("p, li, div")) continue; // only leaf blocks
    let inQuote = false;
    let closer = "";
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => ((n.parentElement?.closest("code, pre, style, .dl") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)),
    });
    const nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    for (const node of nodes) {
      const text = node.data;
      const parts: { text: string; quoted: boolean }[] = [];
      let buf = "";
      for (const ch of text) {
        if (!inQuote && (ch === '"' || ch in OPEN_CLOSE)) {
          if (buf) parts.push({ text: buf, quoted: false });
          buf = ch;
          inQuote = true;
          closer = ch === '"' ? '"' : OPEN_CLOSE[ch]!;
        } else if (inQuote && (ch === closer || (closer === '"' && ch === "”"))) {
          buf += ch;
          parts.push({ text: buf, quoted: true });
          buf = "";
          inQuote = false;
        } else buf += ch;
      }
      if (buf) parts.push({ text: buf, quoted: inQuote });
      if (!parts.some((p) => p.quoted)) continue;
      const frag = document.createDocumentFragment();
      for (const p of parts) {
        if (p.quoted) {
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

/** Scopes card-provided CSS to one message using the browser's own CSS parser. */
function scopeCss(css: string, scope: string): string {
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    const out: string[] = [];
    const walk = (rules: CSSRuleList, wrap?: (s: string) => string) => {
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSStyleRule) {
          const sel = rule.selectorText
            .split(",")
            .map((s) => `${scope} ${s.trim().replace(/^(html|body|:root)\b/, "")}`)
            .join(", ");
          const body = rule.style.cssText.replace(/position\s*:\s*fixed/gi, "position: absolute");
          const r = `${sel} { ${body} }`;
          out.push(wrap ? wrap(r) : r);
        } else if (rule instanceof CSSMediaRule) {
          walk(rule.cssRules, (r) => `@media ${rule.conditionText} { ${r} }`);
        } else if (rule instanceof CSSKeyframesRule) {
          out.push(rule.cssText);
        }
      }
    };
    walk(sheet.cssRules);
    return out.join("\n").replace(/url\(\s*["']?(?!data:)[^)]*\)/gi, "none");
  } catch {
    return "";
  }
}

export function renderMessage(input: string, scopeClass: string): string {
  const text = input.replace(/<ledger\b[\s\S]*?(?:<\/ledger\s*>|$)/gi, "");
  const key = `${scopeClass}\u0000${text}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const styles: string[] = [];
  const withoutStyles = text.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (_m, css: string) => {
    styles.push(css);
    return "";
  });
  const raw = marked.parse(withoutStyles, { async: false }) as string;
  const clean = DOMPurify.sanitize(raw, {
    FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "input", "button", "textarea", "select", "link", "meta", "base"],
    FORBID_ATTR: ["srcset", "action", "formaction"],
    ALLOW_DATA_ATTR: false,
  });
  const tpl = document.createElement("template");
  tpl.innerHTML = clean;
  const container = document.createElement("div");
  container.appendChild(tpl.content);
  highlightDialogue(container);
  let html = container.innerHTML;
  if (styles.length) {
    const scoped = scopeCss(styles.join("\n"), `.${scopeClass}`);
    if (scoped) html = `<style>${scoped}</style>${html}`;
  }
  cache.set(key, html);
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!);
  return html;
}

/** Cheap render for streaming text: re-rendered at most once per animation frame. */
export function renderStreaming(text: string): string {
  // Inline trackers: the hidden <ledger> the story model writes never shows while it streams.
  const raw = marked.parse(text.replace(/<ledger\b[\s\S]*$/i, ""), { async: false }) as string;
  const clean = DOMPurify.sanitize(raw, { FORBID_TAGS: ["style", "script", "iframe", "form", "input", "button"] });
  const tpl = document.createElement("template");
  tpl.innerHTML = clean;
  const container = document.createElement("div");
  container.appendChild(tpl.content);
  highlightDialogue(container);
  return container.innerHTML;
}
