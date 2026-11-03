import { defineRoom } from "../types";

export default defineRoom({
  id: "aphelion",
  name: "Aphelion",
  motto: "Farthest from anything",
  day: "Dockside",
  night: "Deep Run",
  bar: { day: "#e6e9ec", night: "#02050a" },
  swatch: { day: ["#e6e9ec", "#fafbfc", "#b8420b", "#04070d", "#d98a4b"], night: ["#02050a", "#07101a", "#5fe6ff", "#3f9db8", "#dff5fa"] },
  fonts: () => import("./fonts"),
  grain: null,
  loadAmbience: () => import("./Ambience.svelte"),
  styles: () => Promise.all([import("./palette.css"), import("./room.css")]),
});
