/** J2: the colours of a room you can change (CSS tokens), and a contrast check (WCAG ratio). */
export const COLOR_TOKENS = [
  { id: "bg", label: "Paper" },
  { id: "text", label: "Text" },
  { id: "text-muted", label: "Quiet text" },
  { id: "border", label: "Lines" },
  { id: "accent", label: "Accent" },
  { id: "ok", label: "Good" },
  { id: "warn", label: "Warning" },
  { id: "danger", label: "Danger" },
] as const;

function lum(hex: string) {
  const v = hex.replace("#", "");
  const c = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
export function contrast(a: string, b: string) {
  if (!/^#[0-9a-f]{6}$/i.test(a) || !/^#[0-9a-f]{6}$/i.test(b)) return 21;
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}

/** Puts your colours for the room and its day or night on the page (inline, so they win). */
const applied = new Set<string>();
export function applyRoomColors(root: HTMLElement, colors: Record<string, { day?: Record<string, string>; night?: Record<string, string> }> | undefined, room: string, night: boolean) {
  const mine = colors?.[room]?.[night ? "night" : "day"] ?? {};
  for (const k of applied) if (!(k in mine)) root.style.removeProperty(`--${k}`);
  applied.clear();
  for (const [k, v] of Object.entries(mine)) {
    root.style.setProperty(`--${k}`, v);
    applied.add(k);
  }
}
