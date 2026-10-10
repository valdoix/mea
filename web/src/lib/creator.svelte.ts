import { api, get, put } from "./api";
import { DraftSaver } from "./drafts.svelte";
import { onEvent } from "./events";
import { errorToast } from "./state.svelte";
import { mergeExpansion } from "./studio.svelte";
import type { CreatorDraft, CreatorOptions, CreatorReview, CreatorStage, ExpansionPatch } from "./types";

type Patch = Partial<{
  name: string;
  stage: CreatorStage;
  idea: string;
  options: Partial<CreatorOptions>;
  answers: Record<string, string>;
  worldBookIds: string[];
  loreDraftId: string | null;
  expansion: ExpansionPatch;
  bible: Record<string, string>;
  fields: Record<string, string>;
  basedOn: string;
}>;

/** One open character or persona draft: same rules as the Lore Studio's (see StudioSession). */
export class CreatorSession {
  draft = $state<CreatorDraft | null>(null);
  review = $state<CreatorReview | null>(null);
  busy = $state("");
  missing = $state(false);
  saver = new DraftSaver(() => this.#queueReview());
  #refreshTimer: ReturnType<typeof setTimeout> | undefined;
  #reviewTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(public id: string) {}

  async load() {
    try {
      this.apply((await get<{ draft: CreatorDraft }>(`/api/creator/${this.id}`)).draft);
    } catch (e) {
      if ((e as { status?: number }).status === 404) this.missing = true;
      else errorToast(e);
    }
  }

  listen() {
    return onEvent((e) => {
      if ((e.type === "creator.changed" && e.draftId === this.id) || e.type === "reconnected") {
        clearTimeout(this.#refreshTimer);
        this.#refreshTimer = setTimeout(() => void this.load(), 150);
      }
    });
  }

  apply(s: CreatorDraft) {
    const cur = this.draft;
    const p = (k: string) => this.saver.pending(k);
    if (!cur) {
      this.draft = s;
      this.#queueReview();
      return;
    }
    this.draft = {
      ...s,
      name: p("name") ? cur.name : s.name,
      idea: p("idea") ? cur.idea : s.idea,
      options: p("options") ? cur.options : s.options,
      basedOn: p("basedOn") ? cur.basedOn : s.basedOn,
      worldBookIds: p("world") ? cur.worldBookIds : s.worldBookIds,
      questions: s.questions.map((q) => (p(`answer:${q.id}`) ? { ...q, answer: cur.questions.find((x) => x.id === q.id)?.answer ?? q.answer } : q)),
      expansion: mergeExpansion(cur.expansion, s.expansion, this.saver),
      bible: s.bible.map((b) => (p(`bible:${b.key}`) ? { ...b, text: cur.bible.find((x) => x.key === b.key)?.text ?? b.text } : b)),
      // While the writer works on a field, its text is the server's; otherwise yours wins while you type.
      fields: s.fields.map((f) => (p(`field:${f.key}`) && f.status !== "writing" && f.status !== "queued" ? { ...f, value: cur.fields.find((x) => x.key === f.key)?.value ?? f.value } : f)),
    };
    this.#queueReview();
  }

  save(patch: Patch, key: string, delay = 500) {
    this.saver.queue(key, delay, () => put(`/api/creator/${this.id}`, patch));
  }

  flush() {
    return this.saver.flush();
  }

  async act(label: string, path: string, body?: unknown, method: "POST" | "DELETE" = "POST"): Promise<boolean> {
    this.busy = label;
    try {
      await this.flush();
      const r = await api<{ draft: CreatorDraft }>(method, `/api/creator/${this.id}${path}`, method === "POST" ? (body ?? {}) : body);
      if (r?.draft) this.apply(r.draft);
      return true;
    } catch (e) {
      errorToast(e);
      return false;
    } finally {
      this.busy = "";
    }
  }

  #queueReview() {
    if (this.draft?.stage !== "write" && this.draft?.stage !== "done") return;
    clearTimeout(this.#reviewTimer);
    this.#reviewTimer = setTimeout(async () => {
      try {
        this.review = await get<CreatorReview>(`/api/creator/${this.id}/review`);
      } catch {
        // the checks are a nicety
      }
    }, 400);
  }

  dispose() {
    clearTimeout(this.#refreshTimer);
    clearTimeout(this.#reviewTimer);
    void this.flush().catch(() => {});
  }
}

/** One-tap steering for a field rewrite. */
export const FIELD_STEERS = ["Shorter", "Longer", "More vivid", "More in their voice", "Darker", "Warmer", "Less purple"];
