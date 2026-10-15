import { del, get, patch, post } from "./api";
import { onEvent } from "./events";
import { errorToast, toast } from "./state.svelte";

/** A1: lessons from swipes, for the open chat. */
export type LessonScope = "story" | "character" | "everywhere";
export interface Lesson {
  id: string;
  chatId: string | null;
  characterId: string | null;
  scope: LessonScope;
  text: string;
  why: string;
  quote: string;
  messageId: string | null;
  status: "suggested" | "kept" | "off" | "rejected";
  strength: number;
  by: "rules" | "model" | "edit" | "user";
  lastBrokenSeq: number | null;
  data: { seq?: number; keptIdx?: number; kept?: string; rejected?: { idx: number; quote: string }[]; from?: string; slip?: { kind: string; subject?: string }; step?: string; rule?: string };
  createdAt: number;
  resting?: boolean;
}

export const lessonsState = $state<{ chatId: string | null; list: Lesson[]; mode: "off" | "rules" | "model" }>({ chatId: null, list: [], mode: "rules" });

export async function loadLessons(chatId: string) {
  try {
    const r = await get<{ lessons: Lesson[]; mode: "off" | "rules" | "model" }>(`/api/chats/${chatId}/lessons`);
    if (lessonsState.chatId !== chatId) return;
    lessonsState.list = r.lessons;
    lessonsState.mode = r.mode;
  } catch {
    // lessons are optional
  }
}

export function watchLessons(chatId: string) {
  lessonsState.chatId = chatId;
  lessonsState.list = [];
  void loadLessons(chatId);
  let t: ReturnType<typeof setTimeout> | undefined;
  const off = onEvent((e) => {
    if ((e.type === "lessons.changed" && e.chatId === chatId) || e.type === "reconnected") {
      clearTimeout(t);
      t = setTimeout(() => void loadLessons(chatId), 200);
    }
  });
  return () => {
    off();
    clearTimeout(t);
    if (lessonsState.chatId === chatId) lessonsState.chatId = null;
  };
}

/** Planner notes (the learning planner) live in the Planner's notebook, not with the story's lessons. */
export const isPlannerNote = (l: Lesson) => l.data.from === "planner";
/** The story's own lessons. */
export const storyLessons = () => lessonsState.list.filter((l) => !isPlannerNote(l));

/** Suggestions learned from one reply's swipes (the chip under it). */
export const suggestedFor = (messageId: string) => storyLessons().filter((l) => l.status === "suggested" && l.messageId === messageId);

export async function setLesson(l: Lesson, p: { text?: string; scope?: LessonScope; status?: "kept" | "off" | "rejected" }) {
  try {
    await patch(`/api/lessons/${l.id}`, { ...p, chatId: lessonsState.chatId ?? undefined });
    if (lessonsState.chatId) await loadLessons(lessonsState.chatId);
  } catch (e) {
    errorToast(e);
  }
}

export async function addLesson(chatId: string, text: string, scope: LessonScope) {
  try {
    await post(`/api/chats/${chatId}/lessons`, { text, scope });
    await loadLessons(chatId);
    toast("Lesson kept: it goes to the model every turn", { kind: "ok" });
  } catch (e) {
    errorToast(e);
  }
}

export async function removeLesson(l: Lesson) {
  try {
    await del(`/api/lessons/${l.id}`);
    if (lessonsState.chatId) await loadLessons(lessonsState.chatId);
  } catch (e) {
    errorToast(e);
  }
}

/** "Learn from this swipe": the comparison on demand. */
export async function learnFrom(messageId: string) {
  toast("Comparing the takes…");
  try {
    const r = await post<{ lessons: Lesson[] }>(`/api/messages/${messageId}/learn`);
    if (lessonsState.chatId) await loadLessons(lessonsState.chatId);
    toast(r.lessons.length ? `${r.lessons.length} lesson${r.lessons.length === 1 ? "" : "s"} to look at, under the reply` : "Nothing new to learn from these takes", { kind: r.lessons.length ? "ok" : "info" });
  } catch (e) {
    errorToast(e);
  }
}

export const SCOPES: { value: LessonScope; label: string; title: string }[] = [
  { value: "story", label: "Story", title: "This story only" },
  { value: "character", label: "Character", title: "This character, in every chat" },
  { value: "everywhere", label: "Everywhere", title: "Every story (a writing habit)" },
];
