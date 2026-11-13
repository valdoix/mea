import { defineRoom } from "../types";

export default defineRoom({
  id: "herbarium",
  name: "Herbarium",
  motto: "Pressed between the pages",
  day: "Field Notes",
  night: "Lamp Study",
  bar: { day: "#f3ecda", night: "#181b12" },
  swatch: {
    day: ["#f3ecda", "#a8432f", "#6f8a5b", "#e6d19d", "#3a2a1c"],
    night: ["#181b12", "#ea8a6c", "#a5c38b", "#d8b86d", "#efe3c6"],
  },
  fonts: () => import("./fonts"),
  grain: { day: 0.16, night: 0.08 },
  loadAmbience: () => import("./Ambience.svelte"),
  styles: () => Promise.all([import("./palette.css"), import("./room.css")]),
});
