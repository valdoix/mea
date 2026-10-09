<script lang="ts">
  import Modal from "../Modal.svelte";
  import { del, post } from "../../lib/api";
  import { Bookmark, BookmarkPlus, CircleAlert, Heart } from "../../lib/icons";
  import { errorToast, toast } from "../../lib/state.svelte";
  import { delight } from "../../lib/delight";
  import type { Atom } from "../../lib/types";

  /**
   * "Remember this" / "That's wrong" (MEM-41): select text in any message and turn it into a
   * memory, pin it, or correct what memory got wrong, in two taps.
   */
  let { chatId, root, idForSeq, onhighlight }: { chatId: string; root: HTMLElement | null; idForSeq: (seq: number) => string | null; onhighlight?: () => void } = $props();

  let sel = $state<{ text: string; messageId: string; x: number; y: number } | null>(null);
  let fixOpen = $state(false);
  let wrong = $state("");
  let right = $state("");
  let matches = $state<(Atom & { match: number })[]>([]);
  let picked = $state<Set<string>>(new Set());
  let fixMessage = $state<string | null>(null);
  let timer: ReturnType<typeof setTimeout>;

  function read() {
    const s = window.getSelection();
    if (!s || s.isCollapsed || !root) return (sel = null);
    const text = s.toString().replace(/\s+/g, " ").trim();
    const anchor = s.anchorNode instanceof Element ? s.anchorNode : s.anchorNode?.parentElement;
    const prose = anchor?.closest(".prose");
    const msg = anchor?.closest("article.msg") as HTMLElement | null;
    if (!text || text.length < 3 || text.length > 1500 || !prose || !msg || !root.contains(msg)) return (sel = null);
    const id = idForSeq(Number(msg.dataset.seq));
    if (!id) return (sel = null);
    const rect = s.getRangeAt(0).getBoundingClientRect();
    sel = { text, messageId: id, x: Math.min(window.innerWidth - 180, Math.max(8, rect.left + rect.width / 2 - 90)), y: Math.max(8, rect.top - 46) };
  }
  $effect(() => {
    const onChange = () => {
      clearTimeout(timer);
      timer = setTimeout(read, 220);
    };
    document.addEventListener("selectionchange", onChange);
    return () => {
      document.removeEventListener("selectionchange", onChange);
      clearTimeout(timer);
    };
  });

  async function remember(pin: boolean) {
    if (!sel) return;
    try {
      await post(`/api/chats/${chatId}/remember`, { messageId: sel.messageId, text: sel.text, pin });
      toast(pin ? "Pinned: it's in every prompt from now on" : "Remembered", { kind: "ok" });
      delight("sparkle", { x: sel.x + 90, y: sel.y + 20 });
      window.getSelection()?.removeAllRanges();
      sel = null;
    } catch (e) {
      errorToast(e);
    }
  }
  /** QOL-02: keep the passage as a highlight (a best moment, and a memory signal). */
  async function highlight() {
    if (!sel) return;
    try {
      const h = await post<{ id: string }>(`/api/messages/${sel.messageId}/highlights`, { text: sel.text });
      delight("heart", { x: sel.x + 90, y: sel.y + 20 });
      window.getSelection()?.removeAllRanges();
      sel = null;
      onhighlight?.();
      toast("Highlighted ♡", { kind: "ok", action: { label: "Undo", run: () => void del(`/api/highlights/${h.id}`).then(() => onhighlight?.()) } });
    } catch (e) {
      errorToast(e);
    }
  }
  async function startFix() {
    if (!sel) return;
    wrong = sel.text;
    right = "";
    fixMessage = sel.messageId;
    picked = new Set();
    fixOpen = true;
    try {
      matches = (await post<{ matches: (Atom & { match: number })[] }>(`/api/chats/${chatId}/correct/preview`, { wrong, messageId: fixMessage })).matches;
      picked = new Set(matches.filter((m) => m.match >= 0.35).map((m) => m.id));
    } catch (e) {
      errorToast(e);
    }
  }
  async function submitFix() {
    if (!right.trim()) return;
    try {
      const r = await post<{ superseded: Atom[] }>(`/api/chats/${chatId}/correct`, { wrong, right: right.trim(), messageId: fixMessage ?? undefined, memoryIds: picked.size ? [...picked] : undefined });
      toast(r.superseded.length ? `Corrected: ${r.superseded.length} wrong ${r.superseded.length === 1 ? "memory" : "memories"} replaced` : "Saved as a confirmed memory", { kind: "ok" });
      fixOpen = false;
      sel = null;
    } catch (e) {
      errorToast(e);
    }
  }
  function toggle(id: string) {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    picked = next;
  }
</script>

{#if sel && !fixOpen}
  <div class="selbar card" style:left="{sel.x}px" style:top="{sel.y}px" role="toolbar" aria-label="Selected text">
    <button class="btn ghost small" onmousedown={(e) => e.preventDefault()} onclick={highlight}><Heart size={14} /> Highlight</button>
    <button class="btn ghost small" onmousedown={(e) => e.preventDefault()} onclick={() => remember(false)}><BookmarkPlus size={14} /> Remember</button>
    <button class="btn ghost small" onmousedown={(e) => e.preventDefault()} onclick={() => remember(true)}><Bookmark size={14} /> Pin</button>
    <button class="btn ghost small" onmousedown={(e) => e.preventDefault()} onclick={startFix}><CircleAlert size={14} /> That's wrong</button>
  </div>
{/if}

<Modal bind:open={fixOpen} title="Correct what memory knows" size="md">
  <div class="stack">
    <label class="field"><span class="label">What's wrong</span><textarea class="textarea" rows="2" bind:value={wrong}></textarea></label>
    <label class="field"><span class="label">What's right</span><textarea class="textarea" rows="2" bind:value={right} placeholder="Mira's eyes are green."></textarea><span class="hint">Saved as a confirmed memory. Your corrections win over anything the AI wrote, and never fade.</span></label>
    {#if matches.length}
      <div class="field">
        <span class="label">Memories that say the wrong thing</span>
        {#each matches as m (m.id)}
          <label class="match"><input type="checkbox" checked={picked.has(m.id)} onchange={() => toggle(m.id)} /> <span class="small">{m.content}</span></label>
        {/each}
        <span class="hint">The ones you tick are replaced by your correction (they're kept in history, not deleted).</span>
      </div>
    {:else}
      <p class="tiny muted">No memories repeat this yet; your correction is saved for later.</p>
    {/if}
  </div>
  {#snippet footer()}
    <button class="btn ghost" onclick={() => (fixOpen = false)}>Cancel</button>
    <button class="btn primary" onclick={submitFix} disabled={!right.trim()}>Correct it</button>
  {/snippet}
</Modal>

<style>
  .selbar {
    position: fixed;
    z-index: 60;
    display: flex;
    gap: 0.1rem;
    padding: 0.2rem;
    box-shadow: var(--shadow-2, 0 4px 18px rgb(0 0 0 / 0.15));
  }
  .match {
    display: flex;
    gap: 0.45rem;
    align-items: baseline;
    padding: 0.2rem 0;
  }
</style>
