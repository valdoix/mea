import arcade from "./arcade";
import citadel from "./citadel";
import marquee from "./marquee";
import menagerie from "./menagerie";
import meringue from "./meringue";
import noir from "./noir";
import overprint from "./overprint";
import rosewater from "./rosewater";
import sugarrush from "./sugarrush";
import wildflower from "./wildflower";

/**
 * Every room, in picker order. The first four's stylesheets are listed in palettes.css and
 * rooms.css; the rest load theirs the first time they're shown (Room.styles).
 */
export const ROOMS = [wildflower, overprint, citadel, marquee, sugarrush, arcade, noir, rosewater, meringue, menagerie] as const;

export type RoomId = (typeof ROOMS)[number]["id"];

export const room = (id: string) => ROOMS.find((r) => r.id === id);
