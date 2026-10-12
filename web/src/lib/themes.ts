/**
 * Mea's themes. Lantern and the rooms (Wildflower, Overprint, Citadel, Marquee) share the Lantern
 * shell: a slim rail, a living backdrop, glass panels. Each room lives in its own folder under
 * src/rooms and has a day and a night; Cozy is the older, plainer look with its own light and dark.
 */
import { ROOMS, type RoomId } from "../rooms";

export type { RoomId };
export type ThemeId = "lantern" | RoomId;

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
  ...ROOMS.map(({ id, name, motto, day, night, bar, swatch }) => ({ id, name, motto, day, night, bar, swatch })),
];

export const isShellTheme = (t: string): t is ThemeId => THEMES.some((x) => x.id === t);
export const isRoom = (t: string): t is RoomId => ROOMS.some((r) => r.id === t);
export const themeInfo = (t: string) => THEMES.find((x) => x.id === t);

const loaded = new Set<RoomId>();
/** Each room's typefaces arrive the first time the room is shown. */
export function loadThemeFonts(t: RoomId) {
  if (loaded.has(t)) return;
  loaded.add(t);
  void ROOMS.find((r) => r.id === t)?.fonts();
}
