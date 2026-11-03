import { defineRoom } from "../types";

export default defineRoom({
  id: "weatherglass",
  name: "Weatherglass",
  motto: "The room keeps the story's weather",
  day: "Fair",
  night: "Foul",
  bar: { day: "#a9d2ea", night: "#0c1a2e" },
  swatch: { day: ["#a9d2ea", "#f0f2e2", "#2c4150", "#c49a4a", "#1f5e80"], night: ["#0c1a2e", "#22324b", "#10171f", "#d3a753", "#8fcbe8"] },
  fonts: () => import("./fonts"),
  grain: null,
  loadAmbience: () => import("./Ambience.svelte"),
  styles: () => Promise.all([import("./palette.css"), import("./room.css")]),
});
