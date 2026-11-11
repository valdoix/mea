<script lang="ts">
  import { get, post } from "../../lib/api";
  import { confirm } from "../../lib/dialogs.svelte";
  import { onEvent } from "../../lib/events";
  import { errorToast, toast } from "../../lib/state.svelte";

  /**
   * docs/33 7.6: what this story has waiting on you: continuity notes still open on its replies,
   * and editor suggestions never applied. One button each clears them.
   */
  let { chatId }: { chatId: string } = $props();

  interface Notes {
    replies: number;
    issues: number;
    fixable: number;
    edits: number;
    fixAllMax: number;
  }
  let n = $state<Notes | null>(null);
  let busy = $state(false);

  async function load() {
    try {
      n = await get<Notes>(`/api/chats/${chatId}/open-notes`);
    } catch {
      n = null;
    }
  }
  $effect(() => {
    void chatId;
    void load();
  });
  let timer: ReturnType<typeof setTimeout>;
  $effect(() =>
    onEvent((e) => {
      if ((e.type === "continuity.changed" || e.type === "message.changed" || e.type === "gen.end") && e.chatId === chatId) {
        clearTimeout(timer);
        timer = setTimeout(load, 800);
      }
    }),
  );

  async function fixAll() {
    if (!n?.fixable) return;
    const count = Math.min(n.fixable, n.fixAllMax);
    const ok = await confirm({
      title: `Fix ${count} open note${count === 1 ? "" : "s"}?`,
      message: `Each note's sentence is rewritten in its reply, one helper call a note${n.fixable > count ? ` (${count} at a time; ${n.fixable - count} wait for the next press)` : ""}. Every change can be undone from the reply's own Undo.`,
      confirmLabel: "Fix them",
    });
    if (!ok) return;
    busy = true;
    try {
      const r = await post<{ queued: number }>(`/api/chats/${chatId}/open-notes/fix-all`);
      toast(r.queued ? `Fixing ${r.queued} note${r.queued === 1 ? "" : "s"} in the background` : "Nothing to fix", { kind: "ok" });
    } catch (e) {
      errorToast(e);
    } finally {
      busy = false;
    }
  }
  async function applyEdits() {
    if (!n?.edits) return;
    busy = true;
    try {
      const r = await post<{ applied: number; skipped: number; notes: Notes }>(`/api/chats/${chatId}/open-notes/apply-edits`);
      n = r.notes;
      toast(`Applied ${r.applied} suggestion${r.applied === 1 ? "" : "s"}${r.skipped ? `; ${r.skipped} left (their reply changed since)` : ""}`, { kind: "ok" });
    } catch (e) {
      errorToast(e);
    } finally {
      busy = false;
    }
  }
</script>

{#if n && (n.issues || n.edits)}
  <div class="open">
    {#if n.issues}
      <div class="line">
        <span><b>{n.issues}</b> open note{n.issues === 1 ? "" : "s"} on {n.replies} repl{n.replies === 1 ? "y" : "ies"}</span>
        {#if n.fixable}<button class="btn ghost small" type="button" onclick={fixAll} disabled={busy} title="Rewrite each note's sentence in its reply">Fix all</button>{/if}
      </div>
    {/if}
    {#if n.edits}
      <div class="line">
        <span><b>{n.edits}</b> editor suggestion{n.edits === 1 ? "" : "s"} never applied</span>
        <button class="btn ghost small" type="button" onclick={applyEdits} disabled={busy} title="Apply every suggestion still waiting; each can be undone on its reply">Apply all</button>
      </div>
    {/if}
  </div>
{/if}

<style>
  .open {
    display: grid;
    gap: 4px;
    margin: 6px 0 8px;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: 8px;
    font-size: 0.85rem;
  }
  .line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
</style>
