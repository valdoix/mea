import { defineRoom } from "../types";

export default defineRoom({
  id: "nighttrain",
  name: "Night Train",
  motto: "Wake up somewhere else",
  day: "Dining Car",
  night: "Sleeper",
  bar: { day: "#f4ecdc", night: "#121a31" },
  swatch: {
    day: ["#f4ecdc", "#7e2030", "#264e3d", "#bf8f45", "#5b2c1c"],
    night: ["#121a31", "#d25a6d", "#183d30", "#d6a856", "#f3e7cf"],
  },
  fonts: () => import("./fonts"),
  grain: { day: 0.1, night: 0.08 },
  loadAmbience: () => import("./Ambience.svelte"),
  styles: () => Promise.all([import("./palette.css"), import("./room.css")]),
});
