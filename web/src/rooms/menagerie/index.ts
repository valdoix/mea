import { defineRoom } from "../types";
import Ambience from "./Ambience.svelte";

export default defineRoom({
  id: "menagerie",
  name: "Menagerie",
  motto: "A cabinet of curiosities",
  day: "Palazzo",
  night: "Nocturne",
  bar: { day: "#6a1c22", night: "#231229" },
  swatch: { day: ["#eadcc0", "#6a1c22", "#1f5a45", "#c99a3e", "#8e2a22"], night: ["#231229", "#4a1220", "#1a4a3c", "#d8aa4c", "#eb9a7c"] },
  fonts: () => [
    import("@fontsource-variable/playfair-display"),
    import("@fontsource-variable/playfair-display/wght-italic.css"),
    import("@fontsource/libre-caslon-text/400.css"),
    import("@fontsource/libre-caslon-text/400-italic.css"),
    import("@fontsource/libre-caslon-text/700.css"),
    import("@fontsource-variable/josefin-sans"),
  ],
  // The chintz and the damask are its texture.
  grain: null,
  Ambience,
  styles: () => Promise.all([import("./palette.css"), import("./room.css")]),
});
