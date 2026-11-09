import { defineRoom } from "../types";

export default defineRoom({
  id: "weatherglass",
  name: "Weatherglass",
  motto: "The room keeps the story's weather",
  day: "Fair",
  night: "Foul",
  bar: { day: "#9fc6df", night: "#0b131e" },
  swatch: {
    day: ["#9fc6df", "#1c4f74", "#5a4f86", "#b5853a", "#ebe4d4"],
    night: ["#0b131e", "#9fd0ea", "#c5b9ec", "#d9ad5c", "#161c24"],
  },
  fonts: () => import("./fonts"),
  grain: null,
  loadAmbience: () => import("./Ambience.svelte"),
  styles: () => Promise.all([import("./palette.css"), import("./room.css")]),
});
