import { defineRoom } from "../types";
import Ambience from "./Ambience.svelte";

export default defineRoom({
  id: "rosewater",
  name: "Rosewater Vanity",
  motto: "Blush, powder, prose",
  day: "Powder Room",
  night: "Night Out",
  bar: { day: "#fbecee", night: "#2a0b1c" },
  swatch: { day: ["#fbecee", "#d9708f", "#f2a7b5", "#c39557", "#fffaf6"], night: ["#2a0b1c", "#f0cf94", "#e07a9f", "#c2577a", "#fbe9d6"] },
  fonts: () => [import("@fontsource-variable/jost"), import("@fontsource-variable/playfair-display"), import("@fontsource-variable/playfair-display/wght-italic.css")],
  // Powder shimmer and damask are its texture.
  grain: null,
  Ambience,
  styles: () => Promise.all([import("./palette.css"), import("./room.css")]),
});
