import { get, post } from "./api";
import { onEvent } from "./events";
import { errorToast, toast } from "./state.svelte";

/** P1: what Mea filed from the open chat's messages, as chips with Undo under each message. */
export interface Filing {
  id: string;
  chatId: string;
  messageId: string | null;
  kind: string;
  label: string;
  data: Record<string, unknown>;
  status: "filed" | "undone";
  createdAt: number;
}

export const filed = $state<{ chatId: string | null; byMessage: Record<string, Filing[]> }>({ chatId: null, byMessage: {} });

async function load(chatId: string) {
  try {
    const r = await get<{ filings: Filing[] }>(`/api/chats/${chatId}/filings`);
    if (filed.chatId !== chatId) return;
    const by: Record<string, Filing[]> = {};
    for (const f of r.filings) if (f.messageId) (by[f.messageId] ??= []).push(f);
    filed.byMessage = by;
  } catch {
    // chips are optional
  }
}

/** Follows one chat's filings; returns the clean-up for an $effect. */
export function watchFilings(chatId: string) {
  filed.chatId = chatId;
  filed.byMessage = {};
  void load(chatId);
  const off = onEvent((e) => {
    if ((e.type === "filings.changed" && e.chatId === chatId) || e.type === "reconnected") void load(chatId);
  });
  return () => {
    off();
    if (filed.chatId === chatId) filed.chatId = null;
  };
}

export async function undoFiled(f: Filing, notMeant = false) {
  try {
    await post(`/api/filings/${f.id}/undo`, { notMeant });
    toast(notMeant ? "Taken back; Mea won't read it that way again" : `Undone: ${f.label}`);
  } catch (e) {
    errorToast(e);
  }
}

/** A toast for something just filed, with Undo. */
export function filedToast(f: Filing, text?: string) {
  toast(text ?? `Filed: ${f.label}`, { kind: "ok", action: { label: "Undo", run: () => void undoFiled(f) } });
}
