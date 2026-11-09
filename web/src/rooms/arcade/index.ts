import { defineRoom } from "../types";
import Ambience from "./Ambience.svelte";

export default defineRoom({
  id: "arcade",
  name: "Arcade Afterhours",
  motto: "Insert coin to continue",
  day: "Attract Mode",
  night: "High Score",
  bar: { day: "#f6ecd7", night: "#0d0715" },
  swatch: {
    day: ["#f6ecd7", "#d42a40", "#f4bf2f", "#5d2a8a", "#21142e"],
    night: ["#0d0715", "#ff4d63", "#ffd23f", "#b98cff", "#b6ff5c"],
  },
  fonts: () => [
    import("@fontsource/silkscreen/400.css"),
    import("@fontsource/silkscreen/700.css"),
    import("@fontsource/ibm-plex-mono/400.css"),
    import("@fontsource/ibm-plex-mono/400-italic.css"),
    import("@fontsource/ibm-plex-mono/600.css"),
    import("@fontsource/press-start-2p/400.css"),
  ],
  // The walnut by day and the scanlines by night are its texture.
  grain: null,
  Ambience,
  styles: () => Promise.all([import("./palette.css"), import("./room.css")]),
});
