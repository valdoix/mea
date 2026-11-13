import { defineRoom } from "../types";

export default defineRoom({
  id: "hoarfrost",
  name: "Hoarfrost",
  motto: "Speak low, the snow is listening",
  day: "First Light",
  night: "Deep Winter",
  bar: { day: "#f4f8fb", night: "#0b1424" },
  swatch: {
    day: ["#f4f8fb", "#b23a48", "#2f4f45", "#7fa9c8", "#1d2a38"],
    night: ["#0b1424", "#ff7d8a", "#9cc7b5", "#f3c06b", "#e7eef6"],
  },
  fonts: () => import("./fonts"),
  grain: null,
  loadAmbience: () => import("./Ambience.svelte"),
  styles: () => Promise.all([import("./palette.css"), import("./room.css")]),
});
