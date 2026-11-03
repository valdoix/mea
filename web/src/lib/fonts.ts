/**
 * Applies the chosen fonts. The catalog of faces (fontcatalog.ts) is a chunk of its own, so the long
 * list isn't in the first load; loadSettings waits for it, so nothing paints in the wrong font.
 */
export type { DisplayFontId, StoryFontId, UiFontId } from "./fontcatalog";

type Catalog = typeof import("./fontcatalog");
let catalog: Catalog | null = null;
let loading: Promise<Catalog | null> | null = null;

export function loadFontCatalog() {
  loading ??= import("./fontcatalog").then(
    (m) => (catalog = m),
    () => ((loading = null), null),
  );
  return loading;
}

let want: [HTMLElement, string | undefined, string | undefined, string | undefined] | null = null;
function apply() {
  if (!catalog || !want) return;
  const { STORY_FONTS, UI_FONTS, DISPLAY_FONTS, ensureFont } = catalog;
  const [root, story, ui, display] = want;
  const st = STORY_FONTS.find((f) => f.id === story) ?? STORY_FONTS[0]!;
  ensureFont(st);
  root.dataset.storyFont = st.id;
  root.style.setProperty("--font-story-pick", st.family);
  const u = UI_FONTS.find((f) => f.id === ui) ?? UI_FONTS[0]!;
  ensureFont(u);
  root.dataset.uiFont = u.id;
  if (u.family) root.style.setProperty("--font-ui-pick", u.family);
  else root.style.removeProperty("--font-ui-pick");
  const dp = DISPLAY_FONTS.find((f) => f.id === display) ?? DISPLAY_FONTS[0]!;
  ensureFont(dp);
  root.dataset.displayFont = dp.id;
  if (dp.family) root.style.setProperty("--font-display-pick", dp.family);
  else root.style.removeProperty("--font-display-pick");
}

/** Sets the chosen fonts on the page (picks.css reads the -pick variables). */
export function applyFonts(root: HTMLElement, story: string | undefined, ui: string | undefined, display?: string) {
  want = [root, story, ui, display];
  if (catalog) apply();
  else void loadFontCatalog().then(apply);
}
