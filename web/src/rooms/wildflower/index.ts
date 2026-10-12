import { defineRoom } from "../types";
import Ambience from "./Ambience.svelte";

export default defineRoom({
  id: "wildflower",
  name: "Wildflower",
  motto: "A meadow in pastel",
  day: "Meadow",
  night: "Moon Garden",
  bar: { day: "#fbf3f3", night: "#111916" },
  swatch: { day: ["#fbf3f3", "#f4a9c4", "#a9dcbf", "#ddd0f2", "#fbe4a0"], night: ["#111916", "#f5aac6", "#8fd1b0", "#a99cc8", "#e8d08a"] },
  fonts: () => [
    import("@fontsource-variable/cormorant-garamond"),
    import("@fontsource-variable/cormorant-garamond/wght-italic.css"),
    import("@fontsource/pinyon-script/400.css"),
    import("@fontsource-variable/quicksand"),
  ],
  grain: { day: 0.06, night: 0.035 },
  Ambience,
});
