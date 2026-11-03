import { defineRoom } from "../types";

export default defineRoom({
  id: "form",
  name: "Form",
  motto: "Less ornament, more nerve",
  day: "Workshop",
  night: "Blackout",
  bar: { day: "#f2ecdf", night: "#0c0c0c" },
  swatch: { day: ["#f2ecdf", "#d2271c", "#183fa6", "#f6c409", "#111111"], night: ["#0c0c0c", "#d2271c", "#2d55c8", "#f6c409", "#f5f1e6"] },
  fonts: () => import("./fonts"),
  grain: null,
  loadAmbience: () => import("./Ambience.svelte"),
  styles: () => Promise.all([import("./palette.css"), import("./room.css")]),
});
