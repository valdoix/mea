import { defineRoom } from "../types";
import Ambience from "./Ambience.svelte";

export default defineRoom({
  id: "noir",
  name: "Noir Salon",
  motto: "Speak softly; everyone's listening",
  day: "Vernissage",
  night: "Après Minuit",
  bar: { day: "#f2ede2", night: "#0b0a09" },
  swatch: { day: ["#f2ede2", "#12100e", "#c9a45a", "#7a1f2b", "#2c4a52"], night: ["#0b0a09", "#f2d896", "#c9a45a", "#a3343f", "#a9c4c9"] },
  fonts: () => [
    import("@fontsource/limelight/400.css"),
    import("@fontsource/poiret-one/400.css"),
    import("@fontsource-variable/josefin-sans"),
    import("@fontsource-variable/cormorant-garamond"),
    import("@fontsource-variable/cormorant-garamond/wght-italic.css"),
  ],
  grain: { day: 0.18, night: 0.12 },
  Ambience,
  styles: () => Promise.all([import("./palette.css"), import("./room.css")]),
});
