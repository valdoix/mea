import { defineRoom } from "../types";
import Ambience from "./Ambience.svelte";

export default defineRoom({
  id: "citadel",
  name: "Citadel",
  motto: "Chronicled by candlelight",
  day: "Parchment",
  night: "Long Night",
  bar: { day: "#2e2b29", night: "#0b0e12" },
  swatch: { day: ["#e6d7b8", "#8a1c1c", "#27466b", "#b08a3a", "#2e2b29"], night: ["#0b0e12", "#b84d28", "#a9cdee", "#d4b065", "#8a96a3"] },
  fonts: () => [
    import("@fontsource/cinzel-decorative/400.css"),
    import("@fontsource/cinzel-decorative/700.css"),
    import("@fontsource/alegreya-sans/400.css"),
    import("@fontsource/alegreya-sans/500.css"),
    import("@fontsource/alegreya-sans/700.css"),
  ],
  grain: { day: 0.1, night: 0.1 },
  Ambience,
});
