import "@fontsource-variable/nunito";
import "@fontsource-variable/nunito/wght-italic.css";
import "@fontsource-variable/lora";
import "@fontsource-variable/lora/wght-italic.css";
import "@fontsource-variable/literata";
import "@fontsource-variable/literata/wght-italic.css";
import "@fontsource-variable/fraunces/soft.css";
import "@fontsource-variable/manrope";
import "@fontsource-variable/newsreader";
import "@fontsource-variable/newsreader/wght-italic.css";
import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
import "./styles/tokens.css";
import "./rooms/palettes.css";
import "./styles/picks.css";
import "./styles/base.css";
import "./styles/lantern.css";
import "@fontsource/caveat/500.css";
import "@fontsource/caveat/600.css";
import "@fontsource/im-fell-english/400.css";
import "@fontsource/im-fell-english/400-italic.css";
import "@fontsource/unifrakturmaguntia/400.css";
import "@fontsource/vt323/400.css";
import "./styles/artifacts.css";
import "./styles/vtk.css";
import "./styles/voices.css";
import "./rooms/rooms.css";
import "./styles/frames.css";
import "@fontsource/pinyon-script/400.css";
import { mount } from "svelte";
import App from "./App.svelte";
import { registerServiceWorker } from "./lib/push";
import { navigate } from "./lib/router.svelte";
import { ApiError } from "./lib/api";
import { errorToast } from "./lib/state.svelte";
import { loadThemeStyles } from "./lib/themes";

registerServiceWorker();

// A tab opened before a rebuild still asks for the old build's chunks, which are gone:
// load the new build instead, at most once a minute so a down server doesn't loop.
const STALE_CHUNK = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i;
function reloadForNewBuild(): boolean {
  try {
    const last = Number(sessionStorage.getItem("mea:chunk-reload") ?? 0);
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem("mea:chunk-reload", String(Date.now()));
  } catch {
    // No session storage: reload anyway, the next build will match.
  }
  location.reload();
  return true;
}
window.addEventListener("vite:preloadError", (e) => {
  if (reloadForNewBuild()) e.preventDefault();
});

// L1: an action that failed with nobody to catch it still says so, once.
let lastRejection = { message: "", at: 0 };
window.addEventListener("unhandledrejection", (e) => {
  const r = e.reason;
  if (r instanceof DOMException && r.name === "AbortError") return;
  if (r instanceof Error && STALE_CHUNK.test(r.message) && reloadForNewBuild()) return;
  // Unpaired and locked answers have their own screens.
  if (r instanceof ApiError && (r.code === "unpaired" || r.status === 423)) return;
  const message = r instanceof Error ? r.message : String(r);
  if (message === lastRejection.message && Date.now() - lastRejection.at < 4000) return;
  lastRejection = { message, at: Date.now() };
  errorToast(r);
});

// Notification clicks ask an open window to navigate (sw.js).
navigator.serviceWorker?.addEventListener("message", (e) => {
  if (e.data?.type === "navigate" && typeof e.data.url === "string") navigate(e.data.url);
});

// A room that loads its stylesheets on demand gets them before the first paint of the app.
void loadThemeStyles(document.documentElement.dataset.theme ?? "")
  .catch(() => {})
  .then(() => mount(App, { target: document.getElementById("app")! }));
