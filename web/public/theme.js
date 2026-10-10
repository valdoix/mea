// Applies the theme before first paint to avoid a flash. It's a file of its own, not inline in
// index.html, so the Content-Security-Policy can forbid inline script (M4).
(function () {
  try {
    var t = localStorage.getItem("mea.theme") || "lantern";
    var m = localStorage.getItem("mea.themeMode") || "system";
    var d = document.documentElement;
    var sysDark = matchMedia("(prefers-color-scheme: dark)").matches;
    var rooms = ["wildflower", "overprint", "citadel", "marquee"];
    var shell = t === "lantern" || rooms.indexOf(t) >= 0;
    d.dataset.theme = shell ? t : t === "dark" || (t === "system" && sysDark) ? "dark" : "light";
    d.dataset.shell = shell ? "lantern" : "cozy";
    if (rooms.indexOf(t) >= 0) d.dataset.mode = m === "night" || (m !== "day" && sysDark) ? "night" : "day";
  } catch (e) {
    document.documentElement.dataset.theme = "lantern";
    document.documentElement.dataset.shell = "lantern";
  }
})();
