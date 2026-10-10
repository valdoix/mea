import type { GlossaryTerm } from "./types";

/**
 * Glossary highlighting (LORE-15): lore terms in a rendered message are subtly underlined;
 * tapping one shows its entry. Works on the rendered DOM, between tags only, so markup and
 * links are never touched.
 */

const SKIP = new Set(["A", "CODE", "PRE", "MARK", "BUTTON", "TEXTAREA", "SCRIPT", "STYLE"]);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export interface GlossParams {
  terms: GlossaryTerm[];
  enabled: boolean;
  /** Re-run when the message changes. */
  html: string;
  onpick: (t: GlossaryTerm, at: DOMRect) => void;
}

function apply(node: HTMLElement, p: GlossParams) {
  // Undo an earlier pass first.
  for (const el of [...node.querySelectorAll("span.gloss")]) el.replaceWith(document.createTextNode(el.textContent ?? ""));
  node.normalize();
  if (!p.enabled || !p.terms.length) return;
  const byTerm = new Map(p.terms.map((t) => [t.term.toLowerCase(), t]));
  const source = `(?<![\\p{L}\\p{N}_])(${p.terms.map((t) => esc(t.term)).join("|")})(?![\\p{L}\\p{N}_])`;
  const re = new RegExp(source, "giu");
  // A non-global copy for testing: .test() on a global regex keeps state between calls.
  const probe = new RegExp(source, "iu");
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      for (let el = n.parentElement; el && el !== node; el = el.parentElement) if (SKIP.has(el.tagName) || el.classList.contains("gloss")) return NodeFilter.FILTER_REJECT;
      return n.nodeValue && probe.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });
  const texts: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n as Text);
  // Each term is underlined once per message: enough to find it, not enough to clutter.
  const seen = new Set<string>();
  for (const t of texts) {
    const value = t.nodeValue ?? "";
    re.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0;
    let changed = false;
    for (const m of value.matchAll(re)) {
      const key = m[1]!.toLowerCase();
      const term = byTerm.get(key);
      if (!term || seen.has(term.entryId)) continue;
      seen.add(term.entryId);
      frag.append(value.slice(last, m.index));
      const span = document.createElement("span");
      span.className = "gloss";
      span.dataset.term = key;
      // M41: a button to assistive tech; only a message's first term is a tab stop (arrows reach the rest).
      span.setAttribute("role", "button");
      span.tabIndex = seen.size === 1 ? 0 : -1;
      span.textContent = m[1]!;
      frag.append(span);
      last = (m.index ?? 0) + m[1]!.length;
      changed = true;
    }
    if (!changed) continue;
    frag.append(value.slice(last));
    t.replaceWith(frag);
  }
}

export function gloss(node: HTMLElement, params: GlossParams) {
  let p = params;
  const pick = (e: Event) => {
    const el = (e.target as HTMLElement).closest?.("span.gloss") as HTMLElement | null;
    if (!el) return;
    if (e instanceof KeyboardEvent && (e.key === "ArrowRight" || e.key === "ArrowLeft") && !e.altKey && !e.ctrlKey && !e.metaKey) {
      const all = [...node.querySelectorAll<HTMLElement>("span.gloss")];
      const next = all[all.indexOf(el) + (e.key === "ArrowRight" ? 1 : -1)];
      e.preventDefault();
      e.stopPropagation();
      next?.focus();
      return;
    }
    if (e instanceof KeyboardEvent && e.key !== "Enter" && e.key !== " ") return;
    if (e instanceof KeyboardEvent) e.preventDefault();
    const t = p.terms.find((x) => x.term.toLowerCase() === el.dataset.term);
    if (t) {
      e.stopPropagation();
      p.onpick(t, el.getBoundingClientRect());
    }
  };
  node.addEventListener("click", pick);
  node.addEventListener("keydown", pick);
  queueMicrotask(() => apply(node, p));
  return {
    update(next: GlossParams) {
      const changed = next.html !== p.html || next.enabled !== p.enabled || next.terms !== p.terms;
      p = next;
      if (changed) queueMicrotask(() => apply(node, p));
    },
    destroy() {
      node.removeEventListener("click", pick);
      node.removeEventListener("keydown", pick);
    },
  };
}
