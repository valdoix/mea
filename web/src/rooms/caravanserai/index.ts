import { defineRoom } from "../types";

export default defineRoom({
  id: "caravanserai",
  name: "Caravanserai",
  motto: "Tea first, then stories",
  day: "High Sun",
  night: "Star Camp",
  bar: { day: "#fbe9c5", night: "#070d2a" },
  swatch: { day: ["#fbe9c5", "#dd9b58", "#a84720", "#1c2d5c", "#d99a2b"], night: ["#070d2a", "#18204e", "#f1a65d", "#f0c04a", "#0d112c"] },
  fonts: () => import("./fonts"),
  grain: { day: 0.14, night: 0.08 },
  loadAmbience: () => import("./Ambience.svelte"),
  styles: () => Promise.all([import("./palette.css"), import("./room.css")]),
});
