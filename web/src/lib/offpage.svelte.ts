import { del, get, patch, post } from "./api";
import { onEvent } from "./events";
import { filedToast, type Filing } from "./filings.svelte";
import { errorToast, toast } from "./state.svelte";

/** B1: secrets kept off the page, for the open chat. */
export type HintBudget = "never" | "rarely" | "building";
export interface RevealPlan {
  when: "never" | "say" | "after" | "exposure";
  afterSeq?: number;
  atMinutes?: number;
  text?: string;
}
export interface Offpage {
  id: string;
  chatId: string;
  ref: string;
  label: string;
  neverSay: string[];
  hintAs: string;
  hints: HintBudget;
  reveal: RevealPlan;
  status: "kept" | "revealed";
  data: { seq?: number; heldUntil?: number; revealedSeq?: number };
  createdAt: number;
  due?: boolean;
}

/** What the editor sends: "after" as a count of messages from now, or a story time. */
export interface OffpageDraft {
  ref?: string;
  label: string;
  neverSay: string[];
  hintAs: string;
  hints: HintBudget;
  reveal: { when: RevealPlan["when"]; messages?: number; at?: string };
  messageId?: string;
}

export const offpageState = $state<{ chatId: string | null; list: Offpage[] }>({ chatId: null, list: [] });

export async function loadOffpage(chatId: string) {
  try {
    const r = await get<{ secrets: Offpage[] }>(`/api/chats/${chatId}/offpage`);
    if (offpageState.chatId === chatId) offpageState.list = r.secrets;
  } catch {
    // optional
  }
}

export function watchOffpage(chatId: string) {
  offpageState.chatId = chatId;
  offpageState.list = [];
  void loadOffpage(chatId);
  const off = onEvent((e) => {
    if ((e.type === "offpage.changed" && e.chatId === chatId) || e.type === "reconnected") void loadOffpage(chatId);
  });
  return () => {
    off();
    if (offpageState.chatId === chatId) offpageState.chatId = null;
  };
}

export const kept = () => offpageState.list.filter((o) => o.status === "kept");
export const offpageFor = (ref: string) => offpageState.list.find((o) => o.ref === ref && o.status === "kept");

export async function saveOffpage(chatId: string, d: OffpageDraft, id?: string) {
  try {
    if (id) await patch(`/api/offpage/${id}`, d);
    else {
      const r = await post<{ secret: Offpage; filing: Filing | null }>(`/api/chats/${chatId}/offpage`, d);
      if (r.filing) filedToast(r.filing, "Kept off the page");
      else toast("Kept off the page: the narration won't state it", { kind: "ok" });
    }
    await loadOffpage(chatId);
    return true;
  } catch (e) {
    errorToast(e);
    return false;
  }
}

export async function offpageAction(o: Offpage, action: "reveal" | "hold" | "delete") {
  try {
    if (action === "delete") await del(`/api/offpage/${o.id}`);
    else await post(`/api/offpage/${o.id}/${action}`);
    toast(action === "reveal" ? "It may come out on the page now" : action === "hold" ? "Held: Mea asks again in ten messages" : "No longer kept off the page");
    if (offpageState.chatId) await loadOffpage(offpageState.chatId);
  } catch (e) {
    errorToast(e);
  }
}

export async function neverSay(o: Offpage, word: string, messageId?: string) {
  try {
    const r = await post<{ secret: Offpage; filing: Filing | null }>(`/api/offpage/${o.id}/never-say`, { word, messageId });
    if (r.filing) filedToast(r.filing, `Never say “${word}”`);
    if (offpageState.chatId) await loadOffpage(offpageState.chatId);
  } catch (e) {
    errorToast(e);
  }
}

export function revealText(r: RevealPlan) {
  return r.when === "never" ? "never comes out" : r.when === "say" ? "when you say" : r.when === "exposure" ? "when its exposure clock fills" : `after ${r.text ?? "a while"}`;
}

/** The editor, opened from anywhere in the chat (Codex, Story tab, selection menu). */
export const offpageEditor = $state<{ open: boolean; id: string | null; draft: OffpageDraft | null }>({ open: false, id: null, draft: null });

export function editOffpage(o: Offpage | null, init?: Partial<OffpageDraft>) {
  offpageEditor.id = o?.id ?? null;
  offpageEditor.draft = o
    ? { label: o.label, neverSay: [...o.neverSay], hintAs: o.hintAs, hints: o.hints, reveal: { when: o.reveal.when } }
    : { label: "", neverSay: [], hintAs: "", hints: "rarely", reveal: { when: "say" }, ...init };
  offpageEditor.open = true;
}
