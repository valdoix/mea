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
  const clean = DOMPurify.sanitize(raw, { FORBID_TAGS: ["style", "script", "iframe", "form", "input", "button"] });
  const tpl = document.createElement("template");
  tpl.innerHTML = clean;
  const container = document.createElement("div");
  container.appendChild(tpl.content);
  highlightDialogue(container);
  return found.length ? placeArtifacts(container.innerHTML, found, opts.artifacts !== false) : container.innerHTML;
}
