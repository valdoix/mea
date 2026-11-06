import { defineRoom } from "../types";

export default defineRoom({
  id: "hearthwool",
  name: "Hearthwool",
  motto: "Knit one, purl one, tell one",
  day: "Window Seat",
  night: "Fireside",
  bar: { day: "#fcf0f2", night: "#2a1526" },
  swatch: { day: ["#fcf0f2", "#e27d9f", "#f3c6d6", "#86a983", "#ffd98a"], night: ["#2a1526", "#5d2f52", "#ff9fc4", "#a9c79c", "#ffb36a"] },
  fonts: () => import("./fonts"),
  grain: null,
  loadAmbience: () => import("./Ambience.svelte"),
  styles: () => Promise.all([import("./palette.css"), import("./room.css")]),
});
