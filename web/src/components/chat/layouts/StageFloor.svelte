<script lang="ts">
  import type { Boundary, ChatDetail } from "../../../lib/types";

  /** Stage: what takes over the floor: one person up close, or the river opened. */
  let {
    detail,
    closeUp,
    boundaries,
    max,
    current,
    moments,
    continuity,
    onclose,
    onjump,
  }: {
    detail: ChatDetail;
    closeUp: string | null;
    boundaries: Boundary[];
    max: number;
    current: number;
    moments: { seq: number; kind: string; title: string }[];
    continuity: { seq: number; title: string }[];
    onclose: () => void;
    onjump: (seq: number) => void;
  } = $props();
</script>

<div class="floor-over">
  {#if closeUp}
    {#await import("./CloseUp.svelte") then m}<m.default {detail} id={closeUp} {onclose} {onjump} />{/await}
  {:else}
    {#await import("./RiverMap.svelte") then m}<m.default {detail} {boundaries} {max} {current} {moments} {continuity} {onclose} {onjump} />{/await}
  {/if}
</div>
