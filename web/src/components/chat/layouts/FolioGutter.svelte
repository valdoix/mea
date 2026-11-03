<script lang="ts">
  import { MapPin } from "../../../lib/icons";
  import type { TrackerChange } from "../../../lib/types";

  /** Folio: a message's number, its story time, and where the story moved to. */
  let { seq, time, chips = [] }: { seq: number; time?: string; chips?: TrackerChange[] } = $props();
  const moved = $derived(chips.find((c) => c.kind === "place"));
</script>

<div class="f-gut"><span class="seq">#{seq}</span>{#if time}<span>{time}</span>{/if}{#if moved}<span class="place"><MapPin size={12} />{moved.text}</span>{/if}</div>
