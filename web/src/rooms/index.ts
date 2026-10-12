import citadel from "./citadel";
import marquee from "./marquee";
import overprint from "./overprint";
import wildflower from "./wildflower";

/** Every room, in picker order. Their stylesheets are listed in palettes.css and rooms.css. */
export const ROOMS = [wildflower, overprint, citadel, marquee] as const;

export type RoomId = (typeof ROOMS)[number]["id"];

export const room = (id: string) => ROOMS.find((r) => r.id === id);
