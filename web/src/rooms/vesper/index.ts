import { defineRoom } from "../types";

export default defineRoom({
  id: "vesper",
  name: "Vesper",
  motto: "Light through coloured glass",
  day: "Matins",
  night: "Compline",
  bar: { day: "#e8e0ce", night: "#0e0c14" },
  swatch: { day: ["#e8e0ce", "#a51c30", "#1c3f94", "#c27f12", "#17120e"], night: ["#0e0c14", "#ee4a60", "#6d95f3", "#f2b23e", "#1b1723"] },
  fonts: () => import("./fonts"),
  grain: { day: 0.12, night: 0.08 },
  loadAmbience: () => import("./Ambience.svelte"),
  styles: () => Promise.all([import("./palette.css"), import("./room.css")]),
});
