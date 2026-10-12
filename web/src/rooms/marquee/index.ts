import { defineRoom } from "../types";
import Ambience from "./Ambience.svelte";

export default defineRoom({
  id: "marquee",
  name: "Marquee",
  motto: "Every name in lights",
  day: "Matinee",
  night: "Late Show",
  bar: { day: "#f3f0fa", night: "#07060d" },
  swatch: { day: ["#f3f0fa", "#19d3f0", "#ff3fa4", "#8b5cff", "#f2a900"], night: ["#07060d", "#3ee8ff", "#ff4fb0", "#b77bff", "#ffc94a"] },
  fonts: () => [import("@fontsource/monoton/400.css"), import("@fontsource/neonderthaw/400.css"), import("@fontsource-variable/sora")],
  // Marquee paints its own brick wall instead.
  grain: null,
  Ambience,
});
