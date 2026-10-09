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
import "./styles/base.css";
import "./styles/lantern.css";
import { mount } from "svelte";
import App from "./App.svelte";
import { registerServiceWorker } from "./lib/push";
import { navigate } from "./lib/router.svelte";

registerServiceWorker();

// Notification clicks ask an open window to navigate (sw.js).
navigator.serviceWorker?.addEventListener("message", (e) => {
  if (e.data?.type === "navigate" && typeof e.data.url === "string") navigate(e.data.url);
});

mount(App, { target: document.getElementById("app")! });
