import { defineRoom } from "../types";

export default defineRoom({
  id: "disco",
  name: "Disco Inferno",
  motto: "Under the mirror ball, everyone's a star",
  day: "Roller Rink",
  night: "Studio Floor",
  bar: { day: "#ffefe0", night: "#160822" },
  swatch: { day: ["#fff2e2", "#ff7a1f", "#d92e7f", "#13a39e", "#f5b417"], night: ["#220c36", "#ff4fa8", "#ff8a3d", "#2fe0d6", "#ffd24a"] },
  fonts: () => import("./fonts"),
  grain: null,
  loadAmbience: () => import("./Ambience.svelte"),
  styles: () => Promise.all([import("./palette.css"), import("./room.css")]),
});
