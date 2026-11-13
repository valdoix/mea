import { defineRoom } from "../types";

export default defineRoom({
  id: "orchard",
  name: "Orchard",
  motto: "Something's always ripening",
  day: "Harvest",
  night: "Cider Night",
  bar: { day: "#f6ecd6", night: "#1f1410" },
  swatch: {
    day: ["#f6ecd6", "#a4462a", "#6b7f2e", "#d39a2b", "#3a2418"],
    night: ["#1f1410", "#e8805a", "#a9ba60", "#f3aa45", "#f3e4cc"],
  },
  fonts: () => import("./fonts"),
  grain: { day: 0.14, night: 0.08 },
  loadAmbience: () => import("./Ambience.svelte"),
  styles: () => Promise.all([import("./palette.css"), import("./room.css")]),
});
