<script lang="ts">
  import { get, put } from "../../lib/api";
  import { Compass, Plus, X } from "../../lib/icons";
  import { errorToast, toast } from "../../lib/state.svelte";
  import type { WorldAgency } from "../../lib/types";

  /**
   * World agency for a narrator card: cozy (it follows your lead), or an agenda it quietly pursues and
   * holds it never breaks. Saved into the card's rules book at once, so it holds in every chat.
   */
  let { characterId }: { characterId: string } = $props();
  let a = $state<WorldAgency | null>(null);
  let saving = $state(false);

  $effect(() => {
    get<{ agency: WorldAgency }>(`/api/characters/${characterId}/agency`)
      .then((r) => (a = { ...r.agency, holds: r.agency.holds.length ? r.agency.holds : [""] }))
      .catch(() => {});
  });

  async function save(enabled = a!.enabled) {
    saving = true;
    try {
      const r = await put<{ agency: WorldAgency }>(`/api/characters/${characterId}/agency`, { enabled, agenda: a!.agenda, holds: a!.holds.filter((h) => h.trim()) });
      a = { ...r.agency, holds: r.agency.holds.length ? r.agency.holds : [""] };
      toast(enabled ? "World agency saved to the rules book" : "This world follows your lead now", { kind: "ok" });
    } catch (e) {
      errorToast(e);
    } finally {
      saving = false;
    }
  }
</script>

{#if a}
  <section class="panel stack tight">
    <div class="row between wrap">
      <h3><Compass size={16} /> World agency</h3>
      <label class="switch"><input type="checkbox" checked={a.enabled} onchange={(e) => { a!.enabled = e.currentTarget.checked; if (!a!.enabled || a!.agenda.trim()) void save(a!.enabled); }} /> {a.enabled ? "On" : "Off"}</label>
    </div>
    {#if !a.enabled}
      <p class="tiny muted">This world is cozy: it hosts your scenes and follows your lead. Turn it on to give it an agenda of its own and lines it won't bend. It's not a difficulty setting: it doesn't fight you for the story, it has its own weather.</p>
    {:else}
      <label class="field"><span class="label">Agenda <span class="faint">what the world quietly works toward, whatever you do</span></span><textarea class="textarea" rows="2" bind:value={a.agenda} placeholder="The tithe will be paid in full before the spring tide, one way or another."></textarea></label>
      <span class="label">Holds <span class="faint">lines that never break; scenes can strain them</span></span>
      {#each a.holds as _, i (i)}
        <div class="row"><input class="input grow" bind:value={a.holds[i]} placeholder="No one who has read the full ledger leaves Saltmere." /><button class="btn ghost icon small" onclick={() => (a!.holds = a!.holds.filter((__, k) => k !== i))} aria-label="Remove"><X size={13} /></button></div>
      {/each}
      <div class="row between wrap">
        <button class="btn ghost small" onclick={() => (a!.holds = [...a!.holds, ""])} disabled={a.holds.length >= 8}><Plus size={13} /> Add a hold</button>
        <button class="btn small primary" onclick={() => save(true)} disabled={saving || !a.agenda.trim()}>{saving ? "Saving…" : "Save"}</button>
      </div>
    {/if}
  </section>
{/if}

<style>
  h3 {
    margin: 0;
    display: flex;
    gap: 0.4rem;
    align-items: center;
  }
  .grow {
    flex: 1;
    min-width: 0;
  }
</style>
