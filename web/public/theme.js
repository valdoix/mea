// Applies the theme before first paint to avoid a flash. It's a file of its own, not inline in
// index.html, so the Content-Security-Policy can forbid inline script (M4).
(function () {
  var d = document.documentElement;
  d.dataset.shell = "lantern";
  try {
    var t = localStorage.getItem("mea.theme") || "lantern";
    var m = localStorage.getItem("mea.themeMode") || "system";
    var rooms = ["wildflower", "overprint", "citadel", "marquee", "sugarrush", "arcade", "noir", "rosewater", "meringue", "menagerie"];
    var room = rooms.indexOf(t) >= 0;
    d.dataset.theme = room ? t : "lantern";
    if (room) d.dataset.mode = m === "night" || (m !== "day" && matchMedia("(prefers-color-scheme: dark)").matches) ? "night" : "day";
  } catch (e) {
    d.dataset.theme = "lantern";
  }
})();
