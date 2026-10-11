<script lang="ts">
  import Module from "../desk/Module.svelte";
  import { dockRequest } from "../../lib/dock.svelte";
  import { Lock, Plus } from "../../lib/icons";
  import { editOffpage, offpageAction, offpageState, revealText } from "../../lib/offpage.svelte";

  /** B1: the Story tab's secrets kept off the page, with Reveal now (and Hold when one comes due). */
  let open = $state(false);
  let el = $state<HTMLElement | null>(null);
  const list = $derived(offpageState.list.filter((o) => o.status === "kept"));
  const due = $derived(list.filter((o) => o.due).length);

  $effect(() => {
    if (dockRequest.seq && dockRequest.section === "offpage") {
      open = true;
      requestAnimationFrame(() => el?.scrollIntoView({ block: "start", behavior: "smooth" }));
    }
  });
</script>

<div bind:this={el} data-section="offpage">
  <Module title="Kept off the page" fold bind:open led={due ? "warm" : list.length ? "on" : null} peek={due ? `${due} ready to come out` : list.length ? `${list.length} kept` : "None"}>
    {#each list as o (o.id)}
      <div class="sec" class:due={o.due}>
        <div class="txt">
          <span><Lock size={12} /> {o.label}</span>
          <small>{o.neverSay.length ? `never say: ${o.neverSay.join(", ")} · ` : ""}hints {o.hints === "building" ? "slowly building" : o.hints} · reveal {revealText(o.reveal)}</small>
        </div>
        <div class="st-keys">
          {#if o.due}<button class="st-key" type="button" onclick={() => offpageAction(o, "reveal")}>Let it come out</button><button class="st-key" type="button" onclick={() => offpageAction(o, "hold")}>Hold</button>
          {:else}<button class="st-key" type="button" onclick={() => offpageAction(o, "reveal")}>Reveal now</button>{/if}
          <button class="st-key" type="button" onclick={() => editOffpage(o)}>Edit</button>
        </div>
      </div>
    {:else}
      <p class="st-hint first">Keep a secret back from the narration itself: the words it mustn't use yet, how it may hint, and when it may come out. Also from a secret in the Codex, or by selecting text in a reply.</p>
    {/each}
    <div class="st-keys"><button class="st-key" type="button" onclick={() => editOffpage(null)}><Plus size={14} /> Keep a secret off the page</button></div>
  </Module>
</div>

<style>
  .sec {
    display: grid;
    gap: 6px;
    padding: 8px;
    margin-bottom: 6px;
    border-radius: var(--r-sm);
    background: var(--st-well);
    box-shadow: var(--st-inset-sm);
  }
  .sec.due {
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--st-warm) 70%, transparent);
  }
  .txt {
    display: grid;
    gap: 2px;
    font-size: 13px;
  }
  .txt small {
    font-size: 11px;
    color: var(--text-faint);
  }
</style>
