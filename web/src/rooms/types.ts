import type { Component } from "svelte";

/**
 * One room: everything that makes it itself, in its own folder (after VENUS's one-module-per-theme).
 * A room is `index.ts` (this), `palette.css` (its day and night tokens), `room.css` (its cards,
 * names, rail and motion) and `Ambience.svelte` (its living backdrop). To add one, make the folder,
 * list it in `rooms/index.ts`, and add its two stylesheets to `palettes.css` and `rooms.css`.
 */
export interface Room<Id extends string = string> {
  id: Id;
  name: string;
  motto: string;
  /** What day and night are called in this room. */
  day: string;
  night: string;
  /** The browser bar colour, by day and by night. */
  bar: { day: string; night: string };
  /** A few colours for the picker card, by day and by night. */
  swatch: { day: string[]; night: string[] };
  /** Loads the room's typefaces; called the first time the room is shown. */
  fonts: () => unknown;
  /** How strongly the paper grain shows over the room, by day and by night; null for none. */
  grain: { day: number; night: number } | null;
  /** The living backdrop behind the room. */
  Ambience: Component;
}

export const defineRoom = <const Id extends string>(room: Room<Id>) => room;
