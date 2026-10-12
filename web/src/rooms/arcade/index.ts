import { defineRoom } from "../types";
import Ambience from "./Ambience.svelte";

export default defineRoom({
  id: "arcade",
  name: "Arcade Afterhours",
  motto: "Insert coin to continue",
  day: "Attract Mode",
  night: "High Score",
  bar: { day: "#f1e2bf", night: "#0b0704" },
  swatch: { day: ["#f1e2bf", "#d9531e", "#e8a317", "#5f8a1f", "#3b2314"], night: ["#0b0704", "#ff6a2b", "#ffb000", "#7dff5a", "#ffd38a"] },
  fonts: () => [
    import("@fontsource/silkscreen/400.css"),
    import("@fontsource/silkscreen/700.css"),
    import("@fontsource/ibm-plex-mono/400.css"),
    import("@fontsource/ibm-plex-mono/400-italic.css"),
    import("@fontsource/ibm-plex-mono/600.css"),
    import("@fontsource/press-start-2p/400.css"),
  ],
  // The woodgrain by day and the scanlines by night are its texture.
  grain: null,
  Ambience,
  styles: () => Promise.all([import("./palette.css"), import("./room.css")]),
});
