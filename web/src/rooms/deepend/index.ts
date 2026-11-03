import { defineRoom } from "../types";

export default defineRoom({
  id: "deepend",
  name: "The Deep End",
  motto: "Mind the pressure",
  day: "Shallows",
  night: "The Trench",
  bar: { day: "#8ae6e2", night: "#031327" },
  swatch: { day: ["#8ae6e2", "#27aebf", "#0b7192", "#e7d7a4", "#7ff5e0"], night: ["#031327", "#01060f", "#74f0dc", "#d9f7f3", "#22b9ab"] },
  fonts: () => import("./fonts"),
  grain: null,
  loadAmbience: () => import("./Ambience.svelte"),
  styles: () => Promise.all([import("./palette.css"), import("./room.css")]),
});
