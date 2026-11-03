<script lang="ts">
  import { get, patch, post } from "../../../lib/api";
  import { openDesk } from "../../../lib/desk.svelte";
  import { openDock } from "../../../lib/dock.svelte";
  import { Clapperboard, Feather, SlidersHorizontal, Sparkles } from "../../../lib/icons";
  import { errorToast, toast } from "../../../lib/state.svelte";
  import type { ChatSettings } from "../../../lib/types";

  /** Stage: the director's desk, open beside the story: pace, length, the next beat and a note for the next reply. */
  let { chatId, settings, memories = 0, questions = 0, onchange, onjump }: { chatId: string; settings: ChatSettings; memories?: number; questions?: number; onchange: () => void; onjump?: () => void } = $props();

  type Suggestion = { id: string; label: string; do: { cue: string } | { report: string } | { dock: "story"; section: string } | { skip: string } };
  let beats = $state<Suggestion[]>([]);
  let cue = $state("");
  let busy = $state(false);

  $effect(() => {
    void chatId;
    get<{ suggestions: Suggestion[] }>(`/api/chats/${chatId}/desk`).then(
      (d) => (beats = d.suggestions),
      () => (beats = []),
    );
  });
  $effect(() => {
    cue = settings.cue ?? "";
  });

  async function set(s: Partial<ChatSettings>, said?: string) {
    busy = true;
    try {
      await patch(`/api/chats/${chatId}`, { settings: s });
      if (said) toast(said, { kind: "ok" });
      onchange();
    } catch (e) {
      errorToast(e);
    } finally {
      busy = false;
    }
  }
  async function beat(s: Suggestion) {
    if ("cue" in s.do) return set({ cue: s.do.cue }, "Cue set for the next reply");
    if ("dock" in s.do) return openDock("story", s.do.section);
    if ("report" in s.do) return openDesk();
    try {
      await post(`/api/chats/${chatId}/timeskip`, { duration: s.do.skip });
      toast("Time skipped", { kind: "ok" });
      onchange();
    } catch (e) {
      errorToast(e);
    }
  }
  const PACE = [{ v: "slow", l: "Slow" }, { v: "normal", l: "Steady" }, { v: "fast", l: "Brisk" }] as const;
  const LENGTH = [{ v: "short", l: "Short" }, { v: "normal", l: "Medium" }, { v: "long", l: "Long" }] as const;
</script>

<div class="s-desk" aria-label="Director">
  <section class="desk-card">
    <h3 class="desk-h"><SlidersHorizontal size={12} /> Pace</h3>
    <div class="seg">
      {#each PACE as o (o.v)}<button class:on={(settings.pacing ?? "normal") === o.v} aria-pressed={(settings.pacing ?? "normal") === o.v} disabled={busy} onclick={() => set({ pacing: o.v })}>{o.l}</button>{/each}
    </div>
    <h3 class="desk-h">Length</h3>
    <div class="seg">
      {#each LENGTH as o (o.v)}<button class:on={(settings.length ?? "normal") === o.v} aria-pressed={(settings.length ?? "normal") === o.v} disabled={busy} onclick={() => set({ length: o.v })}>{o.l}</button>{/each}
    </div>
  </section>
  <section class="desk-card">
    <h3 class="desk-h"><Sparkles size={12} /> Next beat</h3>
    {#if beats.length}
      <div class="beats">
        {#each beats as s (s.id)}<button disabled={busy} onclick={() => void beat(s)}><Sparkles size={14} /><span>{s.label}</span></button>{/each}
      </div>
    {:else}
      <p class="tiny muted">Nothing is pressing. The story's in your hands.</p>
    {/if}
    <form class="steer" onsubmit={(e) => (e.preventDefault(), void set({ cue: cue.trim() || null }, cue.trim() ? "Cue set for the next reply" : "Cue cleared"))}>
      <Feather size={14} />
      <input class="steer-in" bind:value={cue} placeholder="A note for the next reply…" aria-label="A note for the next reply" />
    </form>
    <button class="btn ghost small all" onclick={() => (onjump?.(), openDesk())}><Clapperboard size={14} /> The whole desk</button>
  </section>
  {#if memories || questions}
    <div class="s-note">
      {#if memories}<div><span class="d mem"></span><b>Memory</b> filed {memories} thing{memories === 1 ? "" : "s"} lately</div>{/if}
      {#if questions}<div><span class="d flag"></span><b>Meus</b> has {questions} continuity question{questions === 1 ? "" : "s"}</div>{/if}
    </div>
  {/if}
</div>
