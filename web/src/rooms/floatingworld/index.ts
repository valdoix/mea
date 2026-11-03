import { defineRoom } from "../types";

export default defineRoom({
  id: "floatingworld",
  name: "Floating World",
  motto: "Carved once, printed forever",
  day: "Morning Print",
  night: "Moon Print",
  bar: { day: "#efe6d2", night: "#111c36" },
  swatch: { day: ["#efe6d2", "#1e3a68", "#5a7fa8", "#b83227", "#f7f0df"], night: ["#111c36", "#050a18", "#233f6e", "#e0553f", "#efe6cc"] },
  fonts: () => import("./fonts"),
  grain: { day: 0.22, night: 0.14 },
  loadAmbience: () => import("./Ambience.svelte"),
  styles: () => Promise.all([import("./palette.css"), import("./room.css")]),
});
