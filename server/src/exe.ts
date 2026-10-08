// Entry point of the single-file build (ARCH-14): registers the embedded web app, then starts the server.
import { assets } from "./embedded-assets";
import { setEmbeddedAssets } from "./lib/embedded";

setEmbeddedAssets(assets);
await import("./index");
