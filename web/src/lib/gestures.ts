/** Touch gestures as Svelte actions (MOB-03). */
import { buzz } from "./device.svelte";

/** L15: a touch that starts in something that scrolls sideways (a wide table, code) is scrolling it, not swiping. */
function inSideScroller(target: EventTarget | null, root: HTMLElement) {
  for (let el = target instanceof Element ? target : null; el && el !== root; el = el.parentElement) {
    if (el.scrollWidth > el.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(el).overflowX)) return true;
  }
  return false;
}

export function swipe(node: HTMLElement, params: { onLeft?: () => void; onRight?: () => void; enabled?: boolean }) {
  let p = params;
  let startX = 0,
    startY = 0,
    dx = 0,
    tracking = false,
    locked: "x" | "y" | null = null;

  const start = (e: TouchEvent) => {
    if (p.enabled === false || e.touches.length !== 1 || inSideScroller(e.target, node)) return;
    startX = e.touches[0]!.clientX;
    startY = e.touches[0]!.clientY;
    dx = 0;
    tracking = true;
    locked = null;
  };
  const move = (e: TouchEvent) => {
    if (!tracking) return;
    const x = e.touches[0]!.clientX - startX;
    const y = e.touches[0]!.clientY - startY;
    if (!locked && (Math.abs(x) > 10 || Math.abs(y) > 10)) locked = Math.abs(x) > Math.abs(y) * 1.4 ? "x" : "y";
    if (locked === "x") {
      dx = x;
      node.style.transform = `translateX(${x * 0.35}px)`;
      node.style.transition = "none";
    }
  };
  const end = () => {
    if (!tracking) return;
    tracking = false;
    node.style.transition = "transform 220ms cubic-bezier(.22,1,.36,1)";
    node.style.transform = "";
    if (locked === "x" && Math.abs(dx) > 60) {
      if (dx < 0) p.onLeft?.();
      else p.onRight?.();
      buzz(8);
    }
  };
  node.addEventListener("touchstart", start, { passive: true });
  node.addEventListener("touchmove", move, { passive: true });
  node.addEventListener("touchend", end);
  node.addEventListener("touchcancel", end);
  return {
    update(next: typeof params) {
      p = next;
    },
    destroy() {
      node.removeEventListener("touchstart", start);
      node.removeEventListener("touchmove", move);
      node.removeEventListener("touchend", end);
      node.removeEventListener("touchcancel", end);
    },
  };
}

export function longpress(node: HTMLElement, params: { onLong: (e: { x: number; y: number }) => void; ms?: number }) {
  let p = params;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let sx = 0,
    sy = 0,
    fired = false;
  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const start = (e: TouchEvent) => {
    if (e.touches.length !== 1) return;
    fired = false;
    sx = e.touches[0]!.clientX;
    sy = e.touches[0]!.clientY;
    timer = setTimeout(() => {
      fired = true;
      buzz(12);
      p.onLong({ x: sx, y: sy });
    }, p.ms ?? 480);
  };
  const move = (e: TouchEvent) => {
    if (Math.abs(e.touches[0]!.clientX - sx) > 10 || Math.abs(e.touches[0]!.clientY - sy) > 10) clear();
  };
  const click = (e: Event) => {
    if (fired) {
      e.preventDefault();
      e.stopPropagation();
      fired = false;
    }
  };
  const ctx = (e: Event) => {
    if (fired || timer) e.preventDefault();
  };
  node.addEventListener("touchstart", start, { passive: true });
  node.addEventListener("touchmove", move, { passive: true });
  node.addEventListener("touchend", clear);
  node.addEventListener("touchcancel", clear);
  node.addEventListener("click", click, true);
  node.addEventListener("contextmenu", ctx);
  return {
    update(next: typeof params) {
      p = next;
    },
    destroy() {
      clear();
      node.removeEventListener("touchstart", start);
      node.removeEventListener("touchmove", move);
      node.removeEventListener("touchend", clear);
      node.removeEventListener("touchcancel", clear);
      node.removeEventListener("click", click, true);
      node.removeEventListener("contextmenu", ctx);
    },
  };
}

/** Swipe in from the left screen edge (opens the drawer). */
export function onEdgeSwipe(cb: () => void) {
  let sx = -1,
    sy = 0;
  const start = (e: TouchEvent) => {
    const t = e.touches[0]!;
    sx = t.clientX < 24 ? t.clientX : -1;
    sy = t.clientY;
  };
  const move = (e: TouchEvent) => {
    if (sx < 0) return;
    const t = e.touches[0]!;
    if (t.clientX - sx > 50 && Math.abs(t.clientY - sy) < 40) {
      sx = -1;
      cb();
    }
  };
  window.addEventListener("touchstart", start, { passive: true });
  window.addEventListener("touchmove", move, { passive: true });
  return () => {
    window.removeEventListener("touchstart", start);
    window.removeEventListener("touchmove", move);
  };
}

/** Auto-grows a textarea with its content. */
/**
 * Grows a textarea with its text, up to `max` px. Pass `{ max, value }` when the text can change
 * without typing (a background writer, a server update) so it re-fits then too.
 */
export function autosize(node: HTMLTextAreaElement, opt: number | { max?: number; value?: string } = 320) {
  let max = typeof opt === "number" ? opt : (opt.max ?? 320);
  const fit = () => {
    node.style.height = "auto";
    node.style.height = `${Math.min(max, node.scrollHeight)}px`;
    node.style.overflowY = node.scrollHeight > max ? "auto" : "hidden";
  };
  node.addEventListener("input", fit);
  queueMicrotask(fit);
  return {
    update: (next: number | { max?: number; value?: string }) => {
      max = typeof next === "number" ? next : (next.max ?? 320);
      queueMicrotask(fit);
    },
    destroy: () => node.removeEventListener("input", fit),
  };
}

/**
 * Moves an element to the end of <body>, so a dialog or menu opened from inside a label or a
 * clipped container doesn't inherit its styles, its overflow, or its clicks.
 */
export function portal(node: HTMLElement) {
  document.body.appendChild(node);
  return {
    destroy() {
      node.remove();
    },
  };
}

/**
 * A <details>'s starting state. `<details {open}>` would re-assign `open` every time anything else in
 * the same template re-renders (the summary's text, a count), snapping shut a section you opened.
 * This sets it once, and again only when the value itself changes.
 */
export function opened(node: HTMLDetailsElement, value: boolean) {
  let last = value;
  node.open = value;
  return {
    update(next: boolean) {
      if (next !== last) node.open = next;
      last = next;
    },
  };
}
