import { defineRoom } from "../types";

export default defineRoom({
  id: "caravanserai",
  name: "Caravanserai",
  motto: "Tea first, then stories",
  day: "High Sun",
  night: "Star Camp",
  bar: { day: "#f7e8c9", night: "#0b1033" },
  swatch: {
    day: ["#f7e8c9", "#ad4c25", "#20357a", "#e1a43a", "#1f7a74"],
    night: ["#0b1033", "#f39a64", "#97adf3", "#f3c14f", "#ef7a86"],
  },
  fonts: () => import("./fonts"),
  grain: { day: 0.14, night: 0.08 },
  loadAmbience: () => import("./Ambience.svelte"),
  styles: () => Promise.all([import("./palette.css"), import("./room.css")]),
});
