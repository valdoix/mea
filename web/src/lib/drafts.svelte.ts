import { errorToast } from "./state.svelte";

/**
 * Debounced saving for studio drafts. Each key ("title", "answer:…", "item:…") saves after a pause;
 * while a key is waiting or in flight, the server's copy of that field must not overwrite what you're
 * typing; and flush() sends everything at once before an action that reads the draft on the server.
 */
export class DraftSaver {
  #timers = new Map<string, ReturnType<typeof setTimeout>>();
  #runs = new Map<string, () => Promise<unknown>>();
  #inflight = new Set<string>();

  constructor(private after: () => void = () => {}) {}

  pending(key: string) {
    return this.#runs.has(key) || this.#inflight.has(key);
  }

  pendingPrefix(prefix: string) {
    for (const k of [...this.#runs.keys(), ...this.#inflight]) if (k.startsWith(prefix)) return true;
    return false;
  }

  /** The latest call for a key wins; delay 0 saves at once. */
  queue(key: string, delay: number, run: () => Promise<unknown>) {
    clearTimeout(this.#timers.get(key));
    this.#runs.set(key, run);
    this.#timers.set(
      key,
      setTimeout(() => void this.#fire(key), delay),
    );
  }

  async #fire(key: string) {
    const run = this.#runs.get(key);
    this.#timers.delete(key);
    this.#runs.delete(key);
    if (!run) return;
    this.#inflight.add(key);
    try {
      await run();
    } catch (e) {
      errorToast(e);
    } finally {
      this.#inflight.delete(key);
      this.after();
    }
  }

  async flush() {
    const keys = [...this.#runs.keys()];
    for (const k of keys) clearTimeout(this.#timers.get(k));
    await Promise.all(keys.map((k) => this.#fire(k)));
  }
}
