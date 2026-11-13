import aphelion from "./aphelion";
import arcade from "./arcade";
import caravanserai from "./caravanserai";
import citadel from "./citadel";
import deepend from "./deepend";
import floatingworld from "./floatingworld";
import hearthwool from "./hearthwool";
import disco from "./disco";
import marquee from "./marquee";
import menagerie from "./menagerie";
import meringue from "./meringue";
import noir from "./noir";
import overprint from "./overprint";
import prismlab from "./prismlab";
import rosewater from "./rosewater";
import sugarrush from "./sugarrush";
import vesper from "./vesper";
import weatherglass from "./weatherglass";
import wildflower from "./wildflower";
import herbarium from "./herbarium";

/**
 * Every room, in picker order. The first four's stylesheets are listed in palettes.css and
 * rooms.css; the rest load theirs the first time they're shown (Room.styles).
 */
export const ROOMS = [wildflower, overprint, citadel, marquee, sugarrush, arcade, noir, rosewater, meringue, menagerie, weatherglass, deepend, floatingworld, vesper, caravanserai, aphelion, hearthwool, prismlab, disco, herbarium] as const;

export type RoomId = (typeof ROOMS)[number]["id"];

export const room = (id: string) => ROOMS.find((r) => r.id === id);
