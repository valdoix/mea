import { defineRoom } from "../types";
import Ambience from "./Ambience.svelte";

export default defineRoom({
  id: "meringue",
  name: "Meringue",
  motto: "A cup of something warm",
  day: "Buttercream",
  night: "Moonmilk",
  bar: { day: "#fdeee8", night: "#2a2644" },
  swatch: { day: ["#fdf0e6", "#b8507a", "#3a8a6b", "#f3d27a", "#dcd5f2"], night: ["#2a2644", "#f5a8c5", "#a6e0c6", "#f4da92", "#c4b9f4"] },
  fonts: () => [import("@fontsource/young-serif/400.css"), import("@fontsource-variable/nunito"), import("@fontsource-variable/nunito/wght-italic.css")],
  // The quilt and the clouds are its texture.
  grain: null,
  Ambience,
  styles: () => Promise.all([import("./palette.css"), import("./room.css")]),
});
