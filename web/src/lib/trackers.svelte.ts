import { get, patch, post } from "./api";
import { confirm } from "./dialogs.svelte";
import { editLine } from "./dataedit";
import { OCCASIONS } from "./occasions";
import { errorToast } from "./state.svelte";
import type { KeepStyle, TrackerChange, TrackersResponse } from "./types";

/** Tracker data for the open chat: chips per message, story time per message, and the state. */
export const trk = $state({
  chatId: null as string | null,
  chips: {} as Record<string, TrackerChange[]>,
  times: {} as Record<string, string>,
  data: null as TrackersResponse | null,
  running: false,
});

export async function loadChips(chatId: string) {
  try {
    const r = await get<{ byMessage: Record<string, TrackerChange[]>; times: Record<string, string> }>(`/api/chats/${chatId}/trackers/chips`);
    if (trk.chatId !== chatId) return;
    trk.chips = r.byMessage;
    trk.times = r.times;
  } catch {
    // chips are optional
  }
}

export async function loadTrackers(chatId: string) {
  try {
    const r = await get<TrackersResponse>(`/api/chats/${chatId}/trackers`);
    if (trk.chatId !== chatId) return;
    trk.data = r;
    trk.running = r.running;
  } catch (e) {
    errorToast(e);
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;
/** Refetch after a change event (debounced: a tracker run writes many events at once). */
export function refreshTrackers(chatId: string) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    void loadChips(chatId);
    void loadTrackers(chatId);
  }, 250);
}

export function openTrackers(chatId: string) {
  if (trk.chatId !== chatId) {
    trk.chatId = chatId;
    trk.chips = {};
    trk.times = {};
    trk.data = null;
  }
  void loadChips(chatId);
  void loadTrackers(chatId);
}

/** Your edits, as ledger lines (TRK-05). */
export async function trackerEdit(chatId: string, lines: string[]) {
  try {
    const r = await post<{ ok: boolean; bad: string[] }>(`/api/chats/${chatId}/trackers/edit`, { lines });
    if (r.bad.length) errorToast(new Error(`Couldn't read: ${r.bad.join("; ")}`));
    refreshTrackers(chatId);
    return true;
  } catch (e) {
    errorToast(e);
    return false;
  }
}

/** Takes a romance ladder out of the story's records, after asking. */
export async function removeLadder(chatId: string, key: string, label: string) {
  const ok = await confirm({ title: `Remove the romance ${label}?`, message: "Its rungs and history leave the story's records. If the story moves this romance again, it starts over from the bottom.", confirmLabel: "Remove", danger: true });
  if (!ok) return false;
  return trackerEdit(chatId, [editLine(["ladders", key], null)]);
}

export const lockLine = (path: string, on: boolean) => `lock ${path}: ${on ? "on" : "off"}`;

/** "This house is…": how a home is kept, in every room of it (chat settings `houseStyles`). */
export async function setHouseStyle(chatId: string, house: string, style: string) {
  const styles = { ...(trk.chatId === chatId ? trk.data?.houseStyles : null), [house]: style };
  try {
    await patch(`/api/chats/${chatId}`, { settings: { houseStyles: styles } });
    if (trk.chatId === chatId && trk.data) trk.data.houseStyles = styles;
  } catch (e) {
    errorToast(e);
  }
  return styles;
}

/** "This keep is…": a castle's stone and colours, in every room of it (chat settings `keepStyles`). */
export async function setKeepStyle(chatId: string, house: string, style: KeepStyle) {
  const keeps = { ...(trk.chatId === chatId ? trk.data?.keepStyles : null), [house]: style };
  try {
    await patch(`/api/chats/${chatId}`, { settings: { keepStyles: keeps } });
    if (trk.chatId === chatId && trk.data) trk.data.keepStyles = keeps;
  } catch (e) {
    errorToast(e);
  }
  return keeps;
}

/**
 * "This occasion is…", for the scene starting at `seq` (chat settings `occasionFixes`). In the current
 * scene it also goes on the tracker, so every window of the story follows.
 */
export async function setOccasionFix(chatId: string, seq: number, id: string, fixes: Record<string, string>, current: boolean) {
  const next = { ...fixes, [String(seq)]: id };
  try {
    await patch(`/api/chats/${chatId}`, { settings: { occasionFixes: next } });
    if (current) await trackerEdit(chatId, [`occasion: ${id === "none" ? "off" : (OCCASIONS.find((o) => o.id === id)?.label ?? id)}`]);
  } catch (e) {
    errorToast(e);
  }
  return next;
}

/** "This place is…": paint a place as another kind everywhere it's drawn (chat settings `placeKinds`). */
export async function setPlaceKind(chatId: string, name: string, kind: string) {
  const kinds = { ...(trk.chatId === chatId ? trk.data?.placeKinds : null), [name]: kind };
  try {
    await patch(`/api/chats/${chatId}`, { settings: { placeKinds: kinds } });
    if (trk.chatId === chatId && trk.data) trk.data.placeKinds = kinds;
  } catch (e) {
    errorToast(e);
  }
  return kinds;
}
