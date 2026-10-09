import { device } from "./device.svelte";

/**
 * UI-24: small delights. A sparkle when a memory is saved, a heart pop on a bookmark. Subtle,
 * optional (Settings → Appearance), and never shown to people who asked for reduced motion.
 */
const reduced = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export function delight(kind: "sparkle" | "heart", at?: { x: number; y: number }) {
  if (!device.delights || reduced()) return;
  const x = at?.x ?? window.innerWidth / 2;
  const y = at?.y ?? window.innerHeight - 120;
  const glyphs = kind === "heart" ? ["♥", "♡", "♥"] : ["✦", "✧", "✿", "✦"];
  glyphs.forEach((g, i) => {
    const el = document.createElement("span");
    el.className = `delight ${kind}`;
    el.textContent = g;
    el.setAttribute("aria-hidden", "true");
    const dx = (i - (glyphs.length - 1) / 2) * 18 + (Math.random() * 10 - 5);
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.setProperty("--dx", `${dx}px`);
    el.style.animationDelay = `${i * 50}ms`;
    document.body.appendChild(el);
    el.addEventListener("animationend", () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 1600);
  });
}
