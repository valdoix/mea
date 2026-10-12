import { defineRoom } from "../types";
import Ambience from "./Ambience.svelte";

export default defineRoom({
  id: "overprint",
  name: "Overprint",
  motto: "Two inks, slightly off",
  day: "Newsprint",
  night: "Blacklight",
  bar: { day: "#f2eee2", night: "#12101b" },
  swatch: { day: ["#f2eee2", "#ff4fb3", "#3a5bd9", "#ffe14a", "#1d2763"], night: ["#12101b", "#ff4fb3", "#5b78ff", "#ffe14a", "#f6f1e5"] },
  fonts: () => [
    import("@fontsource-variable/bricolage-grotesque"),
    import("@fontsource-variable/space-grotesk"),
    import("@fontsource/space-mono/400.css"),
    import("@fontsource/space-mono/700.css"),
  ],
  grain: { day: 0.12, night: 0.06 },
  Ambience,
});
