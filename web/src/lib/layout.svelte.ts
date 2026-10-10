/**
 * Lantern: what's on screen around the story. The navigation rail and the chat's side panel can be
 * tucked away, and focus mode hides everything but the story and the message box. Remembered per
 * device, with the rail kept separately for chats (where it starts hidden) and everywhere else.
 */

const KEY = "mea.layout";

interface Layout {
  /** Rail shown while reading a chat. */
  railChat: boolean;
  /** Rail shown on every other screen. */
  railOther: boolean;
  /** The chat's side panel (Memory, Story, World…), on wide screens. */
  dock: boolean;
  /** The side panel's width in pixels, when you've dragged it; null is the default. */
  dockW: number | null;
}

function read(): Layout {
  const d: Layout = { railChat: false, railOther: true, dock: true, dockW: null };
  try {
    return { ...d, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return d;
  }
}

export const layout = $state({ ...read(), focus: false });

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ railChat: layout.railChat, railOther: layout.railOther, dock: layout.dock, dockW: layout.dockW }));
  } catch {
    // private mode: the choice lasts until the tab closes
  }
}

export function railShown(inChat: boolean) {
  return !layout.focus && (inChat ? layout.railChat : layout.railOther);
}

export function toggleRail(inChat: boolean) {
  if (inChat) layout.railChat = !layout.railChat;
  else layout.railOther = !layout.railOther;
  save();
}

export function toggleDock() {
  layout.dock = !layout.dock;
  save();
}

/** The side panel's width: kept between a usable minimum and half the window. null goes back to the default. */
export const DOCK_MIN = 320;
export function dockMax() {
  return Math.max(DOCK_MIN, Math.min(760, Math.round(window.innerWidth * 0.5)));
}
export function setDockWidth(w: number | null, persist = true) {
  layout.dockW = w == null ? null : Math.round(Math.max(DOCK_MIN, Math.min(dockMax(), w)));
  if (persist) save();
}

export function setFocus(on: boolean) {
  layout.focus = on;
}
