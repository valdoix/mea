import { defineRoom } from "../types";

export default defineRoom({
  id: "y2k",
  name: "Y2K Dream",
  motto: "Your call is important to us",
  day: "Dial-up",
  night: "Screensaver",
  bar: { day: "#9fd2ef", night: "#03051a" },
  swatch: {
    day: ["#b7e3ff", "#8a5cf6", "#ff8a1f", "#7fd321", "#0d2a3d"],
    night: ["#03051a", "#b48cff", "#ffa24a", "#3fd6ff", "#e3f2ff"],
  },
  fonts: () => import("./fonts"),
  grain: null,
  loadAmbience: () => import("./Ambience.svelte"),
  styles: () => Promise.all([import("./palette.css"), import("./room.css")]),
});
