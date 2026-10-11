<script lang="ts">
  import Modal from "../Modal.svelte";
  import { download, post } from "../../lib/api";
  import { navigate } from "../../lib/router.svelte";
  import { errorToast } from "../../lib/state.svelte";

  /**
   * I3: save this story as a lorebook: the Codex, truths, timeline, people, places, bonds, secrets
   * and callbacks, categorised. As of a point in the story, optionally spoiler-safe. It opens in the
   * Lore Studio's plan to review and save, or downloads as a SillyTavern World Info book.
   */
  let { open = $bindable(false), chatId, lastSeq }: { open?: boolean; chatId: string; lastSeq: number } = $props();
  let seq = $state(0);
  let safe = $state(false);
  let busy = $state(false);
  $effect(() => {
    if (open) seq = lastSeq;
  });
  const query = () => `?${seq && seq < lastSeq ? `seq=${seq}&` : ""}${safe ? "safe=1" : ""}`;

  async function toStudio() {
    busy = true;
    try {
      const r = await post<{ draftId: string; entries: number }>(`/api/chats/${chatId}/lorebook/draft`, { ...(seq && seq < lastSeq ? { seq } : {}), spoilerSafe: safe });
      open = false;
      navigate(`/lore-studio/${r.draftId}`);
    } catch (e) {
      errorToast(e);
    } finally {
      busy = false;
    }
  }
</script>

<Modal bind:open title="Save this story as a lorebook" size="sm">
  <div class="stack">
    <p class="small muted">The people, places, bonds, truths, timeline, secrets and running bits of this story, as a lorebook sorted into categories: for a sequel, or another app.</p>
    <label class="field">
      <span class="label">As of message <span class="faint">#{seq || lastSeq}{seq && seq < lastSeq ? "" : " (now)"}</span></span>
      <input type="range" min="1" max={Math.max(1, lastSeq)} bind:value={seq} aria-label="As of message" />
    </label>
    <label class="switch"><input type="checkbox" bind:checked={safe} /> Spoiler-safe <span class="tiny muted">secrets, and facts that give them away, stay out</span></label>
  </div>
  {#snippet footer()}
    <button class="btn ghost" onclick={() => download(`/api/chats/${chatId}/lorebook/export${query()}`)}>Download (SillyTavern)</button>
    <button class="btn primary" onclick={toStudio} disabled={busy}>{busy ? "Gathering…" : "Review in the Lore Studio"}</button>
  {/snippet}
</Modal>
