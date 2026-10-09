/**
 * Selectable fonts (Settings → Appearance). All self-hosted, so they work offline. The four
 * original story fonts ship with the app; the rest load the first time they're chosen (or shown
 * in the picker), so a font nobody picks costs nothing.
 */

export interface FontChoice<Id extends string = string> {
  id: Id;
  label: string;
  /** The CSS font stack. */
  family: string;
  note: string;
  load?: () => Promise<unknown>;
}

export type StoryFontId =
  | "newsreader"
  | "lora"
  | "literata"
  | "ebgaramond"
  | "cormorant"
  | "crimson"
  | "sourceserif"
  | "merriweather"
  | "alegreya"
  | "spectral"
  | "nunito"
  | "inter"
  | "atkinson"
  | "lexend";
export type UiFontId = "nunito" | "system" | "inter" | "atkinson" | "lexend";

const serif = (name: string) => `"${name}", Georgia, serif`;
const sans = (name: string) => `"${name}", system-ui, -apple-system, "Segoe UI", sans-serif`;

const loadInter = () => Promise.all([import("@fontsource-variable/inter"), import("@fontsource-variable/inter/wght-italic.css")]);
const loadAtkinson = () => Promise.all([import("@fontsource/atkinson-hyperlegible/400.css"), import("@fontsource/atkinson-hyperlegible/400-italic.css"), import("@fontsource/atkinson-hyperlegible/700.css")]);
const loadLexend = () => import("@fontsource-variable/lexend");

export const STORY_FONTS: FontChoice<StoryFontId>[] = [
  { id: "newsreader", label: "Newsreader", family: serif("Newsreader Variable"), note: "Modern book serif" },
  { id: "lora", label: "Lora", family: serif("Lora Variable"), note: "Warm and brushed" },
  { id: "literata", label: "Literata", family: serif("Literata Variable"), note: "Made for e-books" },
  { id: "ebgaramond", label: "EB Garamond", family: serif("EB Garamond Variable"), note: "The classic novel", load: () => Promise.all([import("@fontsource-variable/eb-garamond"), import("@fontsource-variable/eb-garamond/wght-italic.css")]) },
  { id: "cormorant", label: "Cormorant", family: serif("Cormorant Garamond Variable"), note: "Elegant, high contrast", load: () => Promise.all([import("@fontsource-variable/cormorant-garamond"), import("@fontsource-variable/cormorant-garamond/wght-italic.css")]) },
  { id: "crimson", label: "Crimson Pro", family: serif("Crimson Pro Variable"), note: "Old-style, quiet", load: () => Promise.all([import("@fontsource-variable/crimson-pro"), import("@fontsource-variable/crimson-pro/wght-italic.css")]) },
  { id: "sourceserif", label: "Source Serif", family: serif("Source Serif 4 Variable"), note: "Crisp and even", load: () => Promise.all([import("@fontsource-variable/source-serif-4"), import("@fontsource-variable/source-serif-4/wght-italic.css")]) },
  { id: "merriweather", label: "Merriweather", family: serif("Merriweather Variable"), note: "Sturdy on small screens", load: () => Promise.all([import("@fontsource-variable/merriweather"), import("@fontsource-variable/merriweather/wght-italic.css")]) },
  { id: "alegreya", label: "Alegreya", family: serif("Alegreya Variable"), note: "Calligraphic, literary", load: () => Promise.all([import("@fontsource-variable/alegreya"), import("@fontsource-variable/alegreya/wght-italic.css")]) },
  { id: "spectral", label: "Spectral", family: serif("Spectral"), note: "Refined, screen-first", load: () => Promise.all([import("@fontsource/spectral/400.css"), import("@fontsource/spectral/400-italic.css"), import("@fontsource/spectral/700.css")]) },
  { id: "nunito", label: "Nunito", family: "var(--font-ui)", note: "Rounded sans (the interface font)" },
  { id: "inter", label: "Inter", family: sans("Inter Variable"), note: "Clean sans", load: loadInter },
  { id: "atkinson", label: "Atkinson Hyperlegible", family: sans("Atkinson Hyperlegible"), note: "Every letter distinct", load: loadAtkinson },
  { id: "lexend", label: "Lexend", family: sans("Lexend Variable"), note: "Wide, for easier reading", load: loadLexend },
];

export const UI_FONTS: FontChoice<UiFontId>[] = [
  { id: "nunito", label: "The theme's own", family: "", note: "Manrope in Lantern, Nunito elsewhere" },
  { id: "system", label: "My device's", family: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', note: "Whatever your system uses" },
  { id: "inter", label: "Inter", family: sans("Inter Variable"), note: "Neutral and compact", load: loadInter },
  { id: "atkinson", label: "Atkinson Hyperlegible", family: sans("Atkinson Hyperlegible"), note: "Every letter distinct", load: loadAtkinson },
  { id: "lexend", label: "Lexend", family: sans("Lexend Variable"), note: "Wide, for easier reading", load: loadLexend },
];

const loaded = new Set<string>();
function ensure(f: FontChoice | undefined) {
  if (!f?.load || loaded.has(f.id)) return;
  loaded.add(f.id);
  void f.load().catch(() => loaded.delete(f.id));
}

/** Sets the chosen fonts on the page (tokens.css reads --font-story-pick / --font-ui-pick). */
export function applyFonts(root: HTMLElement, story: string | undefined, ui: string | undefined) {
  const s = STORY_FONTS.find((f) => f.id === story) ?? STORY_FONTS[0]!;
  ensure(s);
  root.dataset.storyFont = s.id;
  root.style.setProperty("--font-story-pick", s.family);
  const u = UI_FONTS.find((f) => f.id === ui) ?? UI_FONTS[0]!;
  ensure(u);
  root.dataset.uiFont = u.id;
  if (u.family) root.style.setProperty("--font-ui-pick", u.family);
  else root.style.removeProperty("--font-ui-pick");
}

/** The picker shows every font in its own face. */
export function loadAllFonts() {
  for (const f of [...STORY_FONTS, ...UI_FONTS]) ensure(f);
}
