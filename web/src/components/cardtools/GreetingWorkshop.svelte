<script lang="ts">
  import Segmented from "../Segmented.svelte";
  import DiffModal from "./DiffModal.svelte";
  import { post } from "../../lib/api";
  import { Loader, Sparkles } from "../../lib/icons";
  import { errorToast } from "../../lib/state.svelte";

  /**
   * Greeting workshop (CHAR-15): a new alternate greeting from a situation, in the point of view
   * and tense you pick, never acting for {{user}}. Shown before it's added.
   */
  let {
    card,
    pov = $bindable("third"),
    tense = $bindable("present"),
    onadd,
  }: { card: () => Record<string, unknown>; pov?: "first" | "second" | "third"; tense?: "present" | "past"; onadd: (text: string) => void } = $props();

  let situation = $state("");
  let working = $state(false);
  let text = $state("");
  let open = $state(false);

  const IDEAS = ["The morning after", "A chance meeting in the rain", "They need your help", "Years later", "Something went wrong", "A quiet evening"];

  async function write() {
    working = true;
    try {
      text = (await post<{ text: string }>("/api/card-tools/greeting", { card: card(), situation, pov, tense })).text;
      open = true;
    } catch (e) {
      errorToast(e);
    } finally {
      working = false;
    }
  }
</script>

<section class="panel stack tight">
  <span class="label"><Sparkles size={14} /> Greeting workshop</span>
  <div class="row wrap">
    <input class="input grow" bind:value={situation} placeholder="Where and when it opens (empty: something different from the ones it has)" aria-label="Situation" onkeydown={(e) => e.key === "Enter" && write()} />
    <button class="btn primary" onclick={write} disabled={working}>{#if working}<span class="spin"><Loader size={14} /></span> Writing…{:else}Write a greeting{/if}</button>
  </div>
  <div class="row wrap">
    {#each IDEAS as idea (idea)}<button class="chip tiny idea" onclick={() => (situation = idea)}>{idea}</button>{/each}
  </div>
  <div class="row wrap">
    <Segmented bind:value={pov} options={[{ value: "first", label: "I" }, { value: "second", label: "You" }, { value: "third", label: "She / he / they" }]} small />
    <Segmented bind:value={tense} options={[{ value: "present", label: "Present" }, { value: "past", label: "Past" }]} small />
  </div>
  <span class="tiny muted">Point of view and tense also guide the wand's “Fix point of view” on every greeting.</span>
</section>

<DiffModal bind:open title="A new alternate greeting" before="" after={text} note="It's added as an alternate greeting; save the card to keep it." onaccept={(t) => onadd(t)} />

<style>
  .grow {
    flex: 1 1 14rem;
    min-width: 0;
  }
  .idea {
    cursor: pointer;
    border: 1px solid var(--border);
    font: inherit;
    font-size: var(--fs-xs);
  }
  .spin {
    display: inline-grid;
    animation: spin 1s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
