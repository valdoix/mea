import { ApiError, get, post } from "./api";
import { app } from "./state.svelte";
import type { MeaEvent } from "./types";

/** Live event stream (ARCH-06) with reconnect, plus presence reporting for push (CHAT-06). */
type Listener = (e: MeaEvent) => void;
const listeners = new Set<Listener>();

export function onEvent(fn: Listener) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function emit(e: MeaEvent) {
  for (const l of listeners) {
    try {
      l(e);
    } catch (err) {
      console.error(err);
    }
  }
}

export const clientId = (() => {
  try {
    let id = sessionStorage.getItem("mea.client");
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem("mea.client", id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
})();

let source: EventSource | null = null;
let everConnected = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
/** L15: set once the app is in (paired, unlocked); before that, the Pair and Unlock screens stay quiet. */
let live = false;

export function connectEvents() {
  live = true;
  if (source && source.readyState !== EventSource.CLOSED) return;
  source = new EventSource(`/api/events?client=${clientId}`);
  source.addEventListener("hello", () => {
    app.connected = true;
    if (everConnected) emit({ type: "reconnected" });
    everConnected = true;
    reportPresence();
    refreshQuota();
  });
  source.onmessage = (m) => {
    let e: MeaEvent;
    try {
      e = JSON.parse(m.data);
    } catch {
      return;
    }
    if (e.type === "jobs.activity") app.activity = { running: e.running, queued: e.queued };
    else if (e.type === "quota.changed") refreshQuota();
    else if (e.type === "library.changed") app.libraryVersion++;
    emit(e);
  };
  source.onerror = () => {
    app.connected = false;
    if (source?.readyState === EventSource.CLOSED) {
      source = null;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(retry, 4000);
    }
  };
}

/** L15: an EventSource can't see why it failed; a plain request tells unpaired (401) or locked (423), which end the retries. */
async function retry() {
  retryTimer = null;
  if (!app.authorized) return;
  try {
    await get("/api/quota");
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 423)) return;
  }
  if (app.authorized) connectEvents();
}

export async function refreshQuota() {
  try {
    app.quota = (await get<{ quota: typeof app.quota }>("/api/quota")).quota;
  } catch {
    // quota is optional
  }
}

export function reportPresence() {
  if (!live || !app.authorized) return;
  post("/api/presence", { clientId, chatId: app.currentChatId, visible: document.visibilityState === "visible" }).catch(() => {});
}

document.addEventListener("visibilitychange", () => {
  reportPresence();
  if (live && app.authorized && document.visibilityState === "visible" && (!source || source.readyState === EventSource.CLOSED)) connectEvents();
});
setInterval(reportPresence, 30_000);
