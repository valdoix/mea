/**
 * Every selectable font (Settings → Appearance). All self-hosted, so they work offline. The first-load
 * fonts ship with the app (main.ts); the rest load the first time they're chosen or scroll into
 * view in the picker, so a font nobody picks costs nothing. This list is its own chunk: fonts.ts
 * fetches it once at startup, before the first paint of anything that reads a font.
 */

export type FontGroup = "serif" | "slab" | "sans" | "mono" | "hand" | "display";

export interface FontChoice<Id extends string = string> {
  id: Id;
  label: string;
  /** The CSS font stack. */
  family: string;
  note: string;
  group?: FontGroup;
  load?: () => Promise<unknown>;
}

const serif = (name: string) => `"${name}", Georgia, serif`;
const sans = (name: string) => `"${name}", system-ui, -apple-system, "Segoe UI", sans-serif`;
const mono = (name: string) => `"${name}", ui-monospace, Consolas, monospace`;
const hand = (name: string) => `"${name}", "Segoe Print", cursive`;

type Entry = Omit<FontChoice, "id">;
const s = (label: string, name: string, note: string, load?: Entry["load"]): Entry => ({ label, family: serif(name), note, group: "serif", load });
const b = (label: string, name: string, note: string, load: Entry["load"]): Entry => ({ label, family: serif(name), note, group: "slab", load });
const n = (label: string, name: string, note: string, load?: Entry["load"]): Entry => ({ label, family: sans(name), note, group: "sans", load });
const m = (label: string, name: string, note: string, load: Entry["load"]): Entry => ({ label, family: mono(name), note, group: "mono", load });
const h = (label: string, name: string, note: string, load?: Entry["load"]): Entry => ({ label, family: hand(name), note, group: "hand", load });
const d = (label: string, family: string, note: string, load?: Entry["load"]): Entry => ({ label, family, note, group: "display", load });

/** Every face Mea can show. The three lists below say which picker offers which. */
const FACES = {
  newsreader: s("Newsreader", "Newsreader Variable", "Modern book serif"),
  lora: s("Lora", "Lora Variable", "Warm and brushed"),
  literata: s("Literata", "Literata Variable", "Made for e-books"),
  ebgaramond: s("EB Garamond", "EB Garamond Variable", "The classic novel", () => Promise.all([import("@fontsource-variable/eb-garamond"), import("@fontsource-variable/eb-garamond/wght-italic.css")])),
  cormorant: s("Cormorant", "Cormorant Garamond Variable", "Elegant, high contrast", () => Promise.all([import("@fontsource-variable/cormorant-garamond"), import("@fontsource-variable/cormorant-garamond/wght-italic.css")])),
  crimson: s("Crimson Pro", "Crimson Pro Variable", "Old-style, quiet", () => Promise.all([import("@fontsource-variable/crimson-pro"), import("@fontsource-variable/crimson-pro/wght-italic.css")])),
  sourceserif: s("Source Serif", "Source Serif 4 Variable", "Crisp and even", () => Promise.all([import("@fontsource-variable/source-serif-4"), import("@fontsource-variable/source-serif-4/wght-italic.css")])),
  merriweather: s("Merriweather", "Merriweather Variable", "Sturdy on small screens", () => Promise.all([import("@fontsource-variable/merriweather"), import("@fontsource-variable/merriweather/wght-italic.css")])),
  alegreya: s("Alegreya", "Alegreya Variable", "Calligraphic, literary", () => Promise.all([import("@fontsource-variable/alegreya"), import("@fontsource-variable/alegreya/wght-italic.css")])),
  spectral: s("Spectral", "Spectral", "Refined, screen-first", () => Promise.all([import("@fontsource/spectral/400.css"), import("@fontsource/spectral/400-italic.css"), import("@fontsource/spectral/700.css")])),
  vollkorn: s("Vollkorn", "Vollkorn Variable", "Dark, hearty old-style", () => Promise.all([import("@fontsource-variable/vollkorn"), import("@fontsource-variable/vollkorn/wght-italic.css")])),
  gelasio: s("Gelasio", "Gelasio Variable", "Georgia's close cousin", () => Promise.all([import("@fontsource-variable/gelasio"), import("@fontsource-variable/gelasio/wght-italic.css")])),
  notoserif: s("Noto Serif", "Noto Serif Variable", "Plain, covers every script", () => Promise.all([import("@fontsource-variable/noto-serif"), import("@fontsource-variable/noto-serif/wght-italic.css")])),
  baskerville: s("Libre Baskerville", "Libre Baskerville", "Stately and wide", () => Promise.all([import("@fontsource/libre-baskerville/400.css"), import("@fontsource/libre-baskerville/400-italic.css"), import("@fontsource/libre-baskerville/700.css")])),
  cardo: s("Cardo", "Cardo", "A scholar's Bembo", () => Promise.all([import("@fontsource/cardo/400.css"), import("@fontsource/cardo/400-italic.css"), import("@fontsource/cardo/700.css")])),
  ptserif: s("PT Serif", "PT Serif", "Sturdy Russian transitional", () => Promise.all([import("@fontsource/pt-serif/400.css"), import("@fontsource/pt-serif/400-italic.css"), import("@fontsource/pt-serif/700.css")])),
  gentium: s("Gentium Book", "Gentium Book Plus", "Calm, built for long reads", () => Promise.all([import("@fontsource/gentium-book-plus/400.css"), import("@fontsource/gentium-book-plus/400-italic.css"), import("@fontsource/gentium-book-plus/700.css")])),
  goudy: s("Sorts Mill Goudy", "Sorts Mill Goudy", "Old American letterpress", () => Promise.all([import("@fontsource/sorts-mill-goudy/400.css"), import("@fontsource/sorts-mill-goudy/400-italic.css")])),
  domine: s("Domine", "Domine", "Sturdy newspaper serif", () => Promise.all([import("@fontsource/domine/400.css"), import("@fontsource/domine/700.css")])),
  caslon: s("Libre Caslon", "Libre Caslon Text", "A Georgian broadsheet", () => Promise.all([import("@fontsource/libre-caslon-text/400.css"), import("@fontsource/libre-caslon-text/400-italic.css"), import("@fontsource/libre-caslon-text/700.css")])),
  playfair: s("Playfair", "Playfair Display Variable", "Dramatic, for short scenes", () => Promise.all([import("@fontsource-variable/playfair-display"), import("@fontsource-variable/playfair-display/wght-italic.css")])),
  fraunces: s("Fraunces", "Fraunces Variable", "Soft, old-style wonk", () => import("@fontsource-variable/fraunces/soft.css")),
  instrument: s("Instrument Serif", "Instrument Serif", "Slim and condensed"),
  youngserif: s("Young Serif", "Young Serif", "Heavy and friendly", () => import("@fontsource/young-serif/400.css")),
  fell: s("IM Fell English", "IM Fell English", "Inked, 17th-century", () => Promise.all([import("@fontsource/im-fell-english/400.css"), import("@fontsource/im-fell-english/400-italic.css")])),
  almendra: s("Almendra", "Almendra", "A storybook hand", () => Promise.all([import("@fontsource/almendra/400.css"), import("@fontsource/almendra/400-italic.css"), import("@fontsource/almendra/700.css")])),

  bitter: b("Bitter", "Bitter Variable", "A slab made for screens", () => Promise.all([import("@fontsource-variable/bitter"), import("@fontsource-variable/bitter/wght-italic.css")])),
  robotoslab: b("Roboto Slab", "Roboto Slab Variable", "Modern and even", () => import("@fontsource-variable/roboto-slab")),
  zilla: b("Zilla Slab", "Zilla Slab", "Friendly and a little techy", () => Promise.all([import("@fontsource/zilla-slab/400.css"), import("@fontsource/zilla-slab/400-italic.css"), import("@fontsource/zilla-slab/700.css")])),
  arvo: b("Arvo", "Arvo", "Geometric, poster-sturdy", () => Promise.all([import("@fontsource/arvo/400.css"), import("@fontsource/arvo/400-italic.css"), import("@fontsource/arvo/700.css")])),

  nunitoface: n("Nunito", "Nunito Variable", "Round and soft"),
  inter: n("Inter", "Inter Variable", "Clean and neutral", () => Promise.all([import("@fontsource-variable/inter"), import("@fontsource-variable/inter/wght-italic.css")])),
  atkinson: n("Atkinson Hyperlegible", "Atkinson Hyperlegible", "Every letter distinct", () => Promise.all([import("@fontsource/atkinson-hyperlegible/400.css"), import("@fontsource/atkinson-hyperlegible/400-italic.css"), import("@fontsource/atkinson-hyperlegible/700.css")])),
  lexend: n("Lexend", "Lexend Variable", "Wide, for easier reading", () => import("@fontsource-variable/lexend")),
  manrope: n("Manrope", "Manrope Variable", "Modern, slightly geometric"),
  sourcesans: n("Source Sans", "Source Sans 3 Variable", "Quiet and practical", () => Promise.all([import("@fontsource-variable/source-sans-3"), import("@fontsource-variable/source-sans-3/wght-italic.css")])),
  opensans: n("Open Sans", "Open Sans Variable", "Open, friendly, everywhere", () => Promise.all([import("@fontsource-variable/open-sans"), import("@fontsource-variable/open-sans/wght-italic.css")])),
  worksans: n("Work Sans", "Work Sans Variable", "Sturdy grotesque", () => Promise.all([import("@fontsource-variable/work-sans"), import("@fontsource-variable/work-sans/wght-italic.css")])),
  dmsans: n("DM Sans", "DM Sans Variable", "Low contrast and tidy", () => Promise.all([import("@fontsource-variable/dm-sans"), import("@fontsource-variable/dm-sans/wght-italic.css")])),
  figtree: n("Figtree", "Figtree Variable", "Light on its feet", () => Promise.all([import("@fontsource-variable/figtree"), import("@fontsource-variable/figtree/wght-italic.css")])),
  outfit: n("Outfit", "Outfit Variable", "Pure geometry", () => import("@fontsource-variable/outfit")),
  rubik: n("Rubik", "Rubik Variable", "Softly squared corners", () => Promise.all([import("@fontsource-variable/rubik"), import("@fontsource-variable/rubik/wght-italic.css")])),
  karla: n("Karla", "Karla Variable", "Quirky, narrow grotesque", () => Promise.all([import("@fontsource-variable/karla"), import("@fontsource-variable/karla/wght-italic.css")])),
  mulish: n("Mulish", "Mulish Variable", "Minimal and round", () => Promise.all([import("@fontsource-variable/mulish"), import("@fontsource-variable/mulish/wght-italic.css")])),
  jakarta: n("Plus Jakarta", "Plus Jakarta Sans Variable", "Crisp, a little playful", () => Promise.all([import("@fontsource-variable/plus-jakarta-sans"), import("@fontsource-variable/plus-jakarta-sans/wght-italic.css")])),
  notosans: n("Noto Sans", "Noto Sans Variable", "Plain, covers every script", () => Promise.all([import("@fontsource-variable/noto-sans"), import("@fontsource-variable/noto-sans/wght-italic.css")])),
  roboto: n("Roboto", "Roboto Variable", "Android's own", () => Promise.all([import("@fontsource-variable/roboto"), import("@fontsource-variable/roboto/wght-italic.css")])),
  lato: n("Lato", "Lato", "Warm humanist", () => Promise.all([import("@fontsource/lato/400.css"), import("@fontsource/lato/400-italic.css"), import("@fontsource/lato/700.css")])),
  poppins: n("Poppins", "Poppins", "Bold, circular geometry", () => Promise.all([import("@fontsource/poppins/400.css"), import("@fontsource/poppins/400-italic.css"), import("@fontsource/poppins/700.css")])),
  quicksand: n("Quicksand", "Quicksand Variable", "Rounded and light", () => import("@fontsource-variable/quicksand")),
  jost: n("Jost", "Jost Variable", "Futura's descendant", () => import("@fontsource-variable/jost")),
  alegreyasans: n("Alegreya Sans", "Alegreya Sans", "Calligraphic sans", () => Promise.all([import("@fontsource/alegreya-sans/400.css"), import("@fontsource/alegreya-sans/400-italic.css"), import("@fontsource/alegreya-sans/700.css")])),
  fredoka: n("Fredoka", "Fredoka Variable", "Bubbly and big", () => import("@fontsource-variable/fredoka")),
  sora: n("Sora", "Sora Variable", "Wide, futuristic", () => import("@fontsource-variable/sora")),
  spacegrotesk: n("Space Grotesk", "Space Grotesk Variable", "Technical, with character", () => import("@fontsource-variable/space-grotesk")),
  bricolage: n("Bricolage", "Bricolage Grotesque Variable", "Inky, opinionated", () => import("@fontsource-variable/bricolage-grotesque")),
  josefin: n("Josefin Sans", "Josefin Sans Variable", "Elegant, vintage geometry", () => import("@fontsource-variable/josefin-sans")),

  courierprime: m("Courier Prime", "Courier Prime", "A screenplay's typewriter", () => Promise.all([import("@fontsource/courier-prime/400.css"), import("@fontsource/courier-prime/400-italic.css"), import("@fontsource/courier-prime/700.css")])),
  specialelite: m("Special Elite", "Special Elite", "Worn typewriter ribbon", () => import("@fontsource/special-elite/400.css")),
  plexmono: m("IBM Plex Mono", "IBM Plex Mono", "An engineer's notebook", () => Promise.all([import("@fontsource/ibm-plex-mono/400.css"), import("@fontsource/ibm-plex-mono/400-italic.css"), import("@fontsource/ibm-plex-mono/700.css")])),
  spacemono: m("Space Mono", "Space Mono", "Retro, a little odd", () => Promise.all([import("@fontsource/space-mono/400.css"), import("@fontsource/space-mono/400-italic.css"), import("@fontsource/space-mono/700.css")])),
  jetbrains: m("JetBrains Mono", "JetBrains Mono Variable", "Tall and code-clean", () => Promise.all([import("@fontsource-variable/jetbrains-mono"), import("@fontsource-variable/jetbrains-mono/wght-italic.css")])),

  caveat: h("Caveat", "Caveat", "Quick handwriting"),
  kalam: h("Kalam", "Kalam", "A felt-tip diary", () => Promise.all([import("@fontsource/kalam/400.css"), import("@fontsource/kalam/700.css")])),
  patrickhand: h("Patrick Hand", "Patrick Hand", "Neat, comic-book print", () => import("@fontsource/patrick-hand/400.css")),
  shantell: h("Shantell Sans", "Shantell Sans Variable", "A marker, bouncing a little", () => Promise.all([import("@fontsource-variable/shantell-sans"), import("@fontsource-variable/shantell-sans/wght-italic.css")])),
  comicneue: h("Comic Neue", "Comic Neue", "Comic Sans, grown up", () => Promise.all([import("@fontsource/comic-neue/400.css"), import("@fontsource/comic-neue/400-italic.css"), import("@fontsource/comic-neue/700.css")])),
  dancing: h("Dancing Script", "Dancing Script Variable", "A looping script", () => import("@fontsource-variable/dancing-script")),

  cinzel: d("Cinzel", serif("Cinzel Variable"), "Roman inscriptions", () => import("@fontsource-variable/cinzel")),
  cinzeldeco: d("Cinzel Decorative", serif("Cinzel Decorative"), "Inscriptions with flourishes", () => import("@fontsource/cinzel-decorative/400.css")),
  abril: d("Abril Fatface", serif("Abril Fatface"), "Fat Didone headlines", () => import("@fontsource/abril-fatface/400.css")),
  dmserif: d("DM Serif Display", serif("DM Serif Display"), "Glossy magazine", () => Promise.all([import("@fontsource/dm-serif-display/400.css"), import("@fontsource/dm-serif-display/400-italic.css")])),
  cormorantd: d("Cormorant Display", serif("Cormorant Variable"), "Hairline elegance", () => Promise.all([import("@fontsource-variable/cormorant"), import("@fontsource-variable/cormorant/wght-italic.css")])),
  limelight: d("Limelight", serif("Limelight"), "Art Deco cinema", () => import("@fontsource/limelight/400.css")),
  poiret: d("Poiret One", sans("Poiret One"), "Thin 1920s line", () => import("@fontsource/poiret-one/400.css")),
  bebas: d("Bebas Neue", sans("Bebas Neue"), "Tall poster capitals", () => import("@fontsource/bebas-neue/400.css")),
  uncial: d("Uncial Antiqua", serif("Uncial Antiqua"), "A monk's manuscript", () => import("@fontsource/uncial-antiqua/400.css")),
  grenze: d("Grenze Gotisch", serif("Grenze Gotisch Variable"), "A readable blackletter", () => import("@fontsource-variable/grenze-gotisch")),
  fraktur: d("UnifrakturMaguntia", serif("UnifrakturMaguntia"), "Full Gothic blackletter"),
  pinyon: d("Pinyon Script", hand("Pinyon Script"), "Copperplate invitation"),
  monoton: d("Monoton", sans("Monoton"), "Neon tubing", () => import("@fontsource/monoton/400.css")),
  neon: d("Neonderthaw", hand("Neonderthaw"), "A neon signature", () => import("@fontsource/neonderthaw/400.css")),
  chewy: d("Chewy", hand("Chewy"), "Saturday cartoons", () => import("@fontsource/chewy/400.css")),
  pressstart: d("Press Start 2P", mono("Press Start 2P"), "8-bit arcade", () => import("@fontsource/press-start-2p/400.css")),
  silkscreen: d("Silkscreen", mono("Silkscreen"), "A pixel label", () => import("@fontsource/silkscreen/400.css")),
} satisfies Record<string, Entry>;

type Face = keyof typeof FACES;
const pick = <Id extends Face>(ids: readonly Id[]) => ids.map((id) => ({ id, ...FACES[id] })) as FontChoice<Id>[];

/** Story fonts, heading fonts and interface fonts. server/src/lib/settings.ts lists the same ids. */
const STORY_FACES = ["newsreader", "lora", "literata", "ebgaramond", "cormorant", "crimson", "sourceserif", "merriweather", "alegreya", "spectral", "vollkorn", "gelasio", "notoserif", "baskerville", "cardo", "ptserif", "gentium", "goudy", "domine", "caslon", "playfair", "fraunces", "instrument", "youngserif", "fell", "almendra", "bitter", "robotoslab", "zilla", "arvo", "inter", "atkinson", "lexend", "manrope", "sourcesans", "opensans", "worksans", "dmsans", "figtree", "outfit", "rubik", "karla", "mulish", "jakarta", "notosans", "roboto", "lato", "poppins", "quicksand", "jost", "alegreyasans", "courierprime", "specialelite", "plexmono", "spacemono", "jetbrains", "caveat", "kalam", "patrickhand", "shantell", "comicneue", "dancing"] as const;
const UI_FACES = ["nunitoface", "inter", "atkinson", "lexend", "manrope", "sourcesans", "opensans", "worksans", "dmsans", "figtree", "outfit", "rubik", "karla", "mulish", "jakarta", "notosans", "roboto", "lato", "poppins", "quicksand", "jost", "alegreyasans", "fredoka", "sora", "spacegrotesk", "bricolage", "josefin", "plexmono", "spacemono", "jetbrains", "patrickhand", "shantell", "comicneue"] as const;
const DISPLAY_FACES = ["fraunces", "instrument", "playfair", "youngserif", "fell", "almendra", "cinzel", "cinzeldeco", "abril", "dmserif", "cormorantd", "limelight", "poiret", "bebas", "uncial", "grenze", "fraktur", "pinyon", "monoton", "neon", "chewy", "pressstart", "silkscreen", "bricolage", "spacegrotesk", "josefin", "caveat", "dancing"] as const;

export type StoryFontId = "theme" | "nunito" | (typeof STORY_FACES)[number];
export type UiFontId = "nunito" | "system" | (typeof UI_FACES)[number];
export type DisplayFontId = "theme" | (typeof DISPLAY_FACES)[number];

export const STORY_FONTS: FontChoice<StoryFontId>[] = [
  { id: "theme", label: "The theme's own", family: 'var(--font-story-theme, "Newsreader Variable", Georgia, serif)', note: "Changes with the theme" },
  ...pick(STORY_FACES),
  { id: "nunito", label: "The interface font", family: "var(--font-ui)", note: "Whatever the interface uses", group: "sans" },
];

export const UI_FONTS: FontChoice<UiFontId>[] = [
  { id: "nunito", label: "The theme's own", family: "", note: "Each theme brings its own" },
  { id: "system", label: "My device's", family: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', note: "Whatever your system uses" },
  ...pick(UI_FACES),
];

export const DISPLAY_FONTS: FontChoice<DisplayFontId>[] = [
  { id: "theme", label: "The theme's own", family: "", note: "Each theme brings its own" },
  ...pick(DISPLAY_FACES),
];

export const FONT_GROUPS: { id: FontGroup; label: string }[] = [
  { id: "serif", label: "Serif" },
  { id: "slab", label: "Slab" },
  { id: "sans", label: "Sans" },
  { id: "mono", label: "Typewriter" },
  { id: "hand", label: "Handwritten" },
  { id: "display", label: "Display" },
];

const loaded = new Set<string>();
/** Loads one font's files, once. */
export function ensureFont(f: FontChoice | undefined) {
  if (!f?.load || loaded.has(f.label)) return;
  loaded.add(f.label);
  void f.load().catch(() => loaded.delete(f.label));
}
