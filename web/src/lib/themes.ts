/**
 * Mea's themes. Lantern and the four "rooms" (Wildflower, Overprint, Citadel, Marquee) share the
 * Lantern shell: a slim rail, a living backdrop, glass panels. The rooms each have a day and a
 * night; Cozy is the older, plainer look with its own light and dark.
 */

export type ThemeId = "lantern" | "wildflower" | "overprint" | "citadel" | "marquee";
export type RoomId = Exclude<ThemeId, "lantern">;

export interface ThemeInfo {
  id: ThemeId;
  name: string;
  motto: string;
  /** What day and night are called in this room. */
  day?: string;
  night?: string;
  /** The browser bar colour, by day and by night. */
  bar: { day: string; night: string };
  /** A few colours for the picker card, by day and by night. */
  swatch: { day: string[]; night: string[] };
}

export const THEMES: ThemeInfo[] = [
  {
    id: "lantern",
    name: "Lantern",
    motto: "A night garden of lamplight and sea glass",
    bar: { day: "#0E0A18", night: "#0E0A18" },
    swatch: { day: ["#0e0a18", "#ff9ec0", "#c7b4ff", "#82e3d3", "#ffd08f"], night: ["#0e0a18", "#ff9ec0", "#c7b4ff", "#82e3d3", "#ffd08f"] },
  },
  {
    id: "wildflower",
    name: "Wildflower",
    motto: "A meadow in pastel",
    day: "Meadow",
    night: "Moon Garden",
    bar: { day: "#fbf3f3", night: "#111916" },
    swatch: { day: ["#fbf3f3", "#f4a9c4", "#a9dcbf", "#ddd0f2", "#fbe4a0"], night: ["#111916", "#f5aac6", "#8fd1b0", "#a99cc8", "#e8d08a"] },
  },
  {
    id: "overprint",
    name: "Overprint",
    motto: "Two inks, slightly off",
    day: "Newsprint",
    night: "Blacklight",
    bar: { day: "#f2eee2", night: "#12101b" },
    swatch: { day: ["#f2eee2", "#ff4fb3", "#3a5bd9", "#ffe14a", "#1d2763"], night: ["#12101b", "#ff4fb3", "#5b78ff", "#ffe14a", "#f6f1e5"] },
  },
  {
    id: "citadel",
    name: "Citadel",
    motto: "Chronicled by candlelight",
    day: "Parchment",
    night: "Long Night",
    bar: { day: "#2e2b29", night: "#0b0e12" },
    swatch: { day: ["#e6d7b8", "#8a1c1c", "#27466b", "#b08a3a", "#2e2b29"], night: ["#0b0e12", "#b84d28", "#a9cdee", "#d4b065", "#8a96a3"] },
  },
  {
    id: "marquee",
    name: "Marquee",
    motto: "Every name in lights",
    day: "Matinee",
    night: "Late Show",
    bar: { day: "#f3f0fa", night: "#07060d" },
    swatch: { day: ["#f3f0fa", "#19d3f0", "#ff3fa4", "#8b5cff", "#f2a900"], night: ["#07060d", "#3ee8ff", "#ff4fb0", "#b77bff", "#ffc94a"] },
  },
];

export const isShellTheme = (t: string): t is ThemeId => THEMES.some((x) => x.id === t);
export const isRoom = (t: string): t is RoomId => t !== "lantern" && isShellTheme(t);
export const themeInfo = (t: string) => THEMES.find((x) => x.id === t);

const loaded = new Set<RoomId>();
/** Each room's typefaces arrive the first time the room is shown. */
export function loadThemeFonts(t: RoomId) {
  if (loaded.has(t)) return;
  loaded.add(t);
  if (t === "wildflower") {
    void import("@fontsource-variable/cormorant-garamond");
    void import("@fontsource-variable/cormorant-garamond/wght-italic.css");
    void import("@fontsource/pinyon-script/400.css");
    void import("@fontsource-variable/quicksand");
  } else if (t === "overprint") {
    void import("@fontsource-variable/bricolage-grotesque");
    void import("@fontsource-variable/space-grotesk");
    void import("@fontsource/space-mono/400.css");
    void import("@fontsource/space-mono/700.css");
  } else if (t === "citadel") {
    void import("@fontsource/cinzel-decorative/400.css");
    void import("@fontsource/cinzel-decorative/700.css");
    void import("@fontsource/alegreya-sans/400.css");
    void import("@fontsource/alegreya-sans/500.css");
    void import("@fontsource/alegreya-sans/700.css");
  } else if (t === "marquee") {
    void import("@fontsource/monoton/400.css");
    void import("@fontsource/neonderthaw/400.css");
    void import("@fontsource-variable/sora");
  }
}
