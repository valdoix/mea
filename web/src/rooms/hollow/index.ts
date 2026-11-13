import { defineRoom } from "../types";

export default defineRoom({
  id: "hollow",
  name: "Hollow",
  motto: "Mind the roots",
  day: "Mossbed",
  night: "Glowcap",
  bar: { day: "#e6ecd2", night: "#0b1a16" },
  swatch: {
    day: ["#e6ecd2", "#c2412d", "#55732f", "#6b4a2f", "#2b2a1d"],
    night: ["#0b1a16", "#4ff0cf", "#c9f56c", "#ffe680", "#e3eedb"],
  },
  fonts: () => import("./fonts"),
  grain: { day: 0.12, night: 0.06 },
  loadAmbience: () => import("./Ambience.svelte"),
  styles: () => Promise.all([import("./palette.css"), import("./room.css")]),
});
