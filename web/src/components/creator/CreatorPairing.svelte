<script lang="ts">
  import Segmented from "../Segmented.svelte";
  import type { CreatorSession } from "../../lib/creator.svelte";
  import { autosize } from "../../lib/gestures";
  import { MessageHeart, Plus } from "../../lib/icons";

  /** A persona made to play opposite a character: an opening on that character's card, written opposite this persona. */
  let { session }: { session: CreatorSession } = $props();
  const draft = $derived(session.draft!);
  // svelte-ignore state_referenced_locally
  let register = $state(session.draft?.pairing?.register ?? "neutral");
  let text = $state("");
  $effect(() => {
    text = draft.pairing?.text ?? "";
  });
  const REGISTERS = [
    { value: "neutral", label: "Neutral" },
    { value: "canon", label: "Canon" },
    { value: "au", label: "AU" },
    { value: "romantic", label: "Romantic" },
    { value: "adversarial", label: "Adversarial" },
  ];
</script>

{#if draft.counterpart}
  <div class="panel stack tight">
    <span class="small"><MessageHeart size={14} /> <b>Paired opening</b> <span class="muted">· an alternate greeting on {draft.counterpart.name}'s card that opens with this persona in play</span></span>
    <div class="row wrap">
      <span class="tiny muted">Relationship:</span>
      <Segmented value={register} options={REGISTERS} onchange={(v) => (register = v)} small />
      <button class="btn small" onclick={() => session.act("pairing", "/pairing", { register })} disabled={Boolean(session.busy) || !draft.fields.some((f) => f.value.trim())}>{session.busy === "pairing" ? "Writing…" : draft.pairing ? "Write it again" : "Write the opening"}</button>
    </div>
    {#if draft.pairing}
      <textarea class="textarea story" use:autosize={{ max: 360, value: text }} bind:value={text}></textarea>
      <div class="row between wrap">
        <span class="tiny muted">{draft.pairing.appliedTo ? `Added to ${draft.counterpart.name}.` : `Not on ${draft.counterpart.name}'s card yet.`}</span>
        <button class="btn small primary" onclick={() => session.act("pairing", "/pairing/apply", { text })} disabled={Boolean(session.busy) || !text.trim()}><Plus size={13} /> Add to {draft.counterpart.name}</button>
      </div>
    {/if}
  </div>
{/if}
