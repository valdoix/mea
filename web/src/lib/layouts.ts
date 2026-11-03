/**
 * How a chat is laid out, independent of the theme. Classic is the glass stage with a side panel;
 * Folio reads with notes in the margin and works in columns; Stage puts the scene in a band above
 * the story. Layouts only arrange things: colours and type come from the theme's tokens
 * (styles/layouts.css derives the rest), so every theme fits every layout.
 */
export type LayoutId = "classic" | "folio" | "stage";

export const LAYOUTS: { id: LayoutId; name: string; motto: string }[] = [
  { id: "classic", name: "Classic", motto: "The story, with a panel beside it" },
  { id: "folio", name: "Folio", motto: "Read in the margins, work in columns" },
  { id: "stage", name: "Stage", motto: "The scene is the frame" },
];

export const isLayout = (x: unknown): x is LayoutId => x === "classic" || x === "folio" || x === "stage";

let styled: Promise<unknown> | null = null;
/** Folio and Stage bring their own stylesheet; Classic costs nothing extra. */
export function loadLayoutStyles(l: LayoutId): Promise<unknown> {
  if (l === "classic") return Promise.resolve();
  styled ??= import("../styles/layouts.css").catch(() => (styled = null));
  return styled;
}
