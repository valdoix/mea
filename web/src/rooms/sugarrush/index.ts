import { defineRoom } from "../types";
import Ambience from "./Ambience.svelte";

export default defineRoom({
  id: "sugarrush",
  name: "Sugar Rush",
  motto: "Sweet talk only",
  day: "Sprinkles",
  night: "Midnight Snack",
  bar: { day: "#ffe9f1", night: "#1f0820" },
  swatch: { day: ["#ffe9f1", "#ff7aa8", "#8fe6c6", "#ffe066", "#c4a8ff"], night: ["#1f0820", "#ff3d9a", "#5ff5c9", "#ffe066", "#b48cff"] },
  fonts: () => [import("@fontsource-variable/fredoka"), import("@fontsource/chewy/400.css")],
  // The awning and the sugar dust are its texture.
  grain: null,
  Ambience,
  styles: () => Promise.all([import("./palette.css"), import("./room.css")]),
});
