<script lang="ts">
  import { Clapperboard, Heart, Maximize2 } from "../../../lib/icons";

  /** Stage on a phone: the desk and the river, a tap above the composer. */
  let { ondesk, onriver, onstory }: { ondesk: () => void; onriver: () => void; onstory: () => void } = $props();
</script>

<div class="sp-dir">
  <button onclick={ondesk}><Clapperboard size={13} /> Director</button>
  <button onclick={onriver}><Maximize2 size={13} /> River</button>
  <button onclick={onstory}><Heart size={13} /> Story</button>
</div>
