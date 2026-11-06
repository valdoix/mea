import { defineRoom } from "../types";

export default defineRoom({
  id: "prismlab",
  name: "Prism Lab",
  motto: "Split the light, see what's inside",
  day: "Clean Room",
  night: "Spectrum",
  bar: { day: "#f8f7fa", night: "#07060c" },
  swatch: { day: ["#f8f7fa", "#ffb4d8", "#8cd2ff", "#ffb400", "#9b30ff"], night: ["#07060c", "#ff2a6d", "#ffb400", "#00d27a", "#1f8bff"] },
  fonts: () => import("./fonts"),
  grain: null,
  loadAmbience: () => import("./Ambience.svelte"),
  styles: () => Promise.all([import("./palette.css"), import("./room.css")]),
});
