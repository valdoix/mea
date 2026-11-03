import { defineRoom } from "../types";

export default defineRoom({
  id: "nighttrain",
  name: "Night Train",
  motto: "Wake up somewhere else",
  day: "Dining Car",
  night: "Sleeper",
  bar: { day: "#efe4cf", night: "#121729" },
  swatch: { day: ["#efe4cf", "#6b3f26", "#b98a35", "#8a1f28", "#6f9a68"], night: ["#121729", "#26150e", "#dcae55", "#f0a84f", "#242237"] },
  fonts: () => import("./fonts"),
  grain: { day: 0.1, night: 0.08 },
  loadAmbience: () => import("./Ambience.svelte"),
  styles: () => Promise.all([import("./palette.css"), import("./room.css")]),
});
