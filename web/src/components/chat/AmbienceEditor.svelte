<script lang="ts">
  import Module from "../desk/Module.svelte";
  import Flip from "../desk/Flip.svelte";
  import Knob from "../desk/Knob.svelte";
  import { imageUrl, patch } from "../../lib/api";
  import { ImageIcon, X } from "../../lib/icons";
  import { uploadImage } from "../../lib/images";
  import { errorToast } from "../../lib/state.svelte";
  import type { Ambience, ChatDetail } from "../../lib/types";

  /** UI-08: this chat's ambience. Art never hurts readability: text panels keep their own opacity. */
  let { detail, onchange }: { detail: ChatDetail; onchange: () => void } = $props();

  // Your latest changes win over the saved copy until the chat reloads with them.
  let local = $state<Ambience>({});
  const a = $derived<Ambience>({ accent: false, imageId: null, blur: 6, dim: 0.25, vignette: true, panel: 0.86, ...(detail.chat.settings.ambience ?? {}), ...local });
  const palette = $derived(detail.character?.palette ?? []);
  let input = $state<HTMLInputElement | null>(null);
  let timer: ReturnType<typeof setTimeout>;

  function save(p: Partial<Ambience>, wait = 0) {
    const next = { ...a, ...p };
    local = { ...local, ...p };
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        await patch(`/api/chats/${detail.chat.id}`, { settings: { ambience: next } });
        onchange();
      } catch (e) {
        errorToast(e);
      }
    }, wait);
  }
  async function pick(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    try {
      save({ imageId: await uploadImage(f) });
    } catch (e) {
      errorToast(e);
    }
  }
  const peek = $derived([a.accent && palette.length ? "Portrait accent" : "", a.imageId ? "Background" : ""].filter(Boolean).join(" · ") || "Off");
</script>

<Module title="Ambience" fold open={false} led={a.accent || a.imageId ? "on" : null} {peek}>
  <div class="flips">
    <Flip checked={Boolean(a.accent)} disabled={!palette.length} onchange={(on) => save({ accent: on })}>
      Accent from {detail.character?.name ?? "the character"}'s portrait
      {#if palette[0]}<span class="sw" style:--sw={palette[0]}></span>{/if}
    </Flip>
    {#if !palette.length}<p class="st-hint first">The character needs a portrait first.</p>{/if}
  </div>
  <div class="bgrow">
    <span class="thumb" class:empty={!a.imageId} style:background-image={a.imageId ? `url(${imageUrl(a.imageId, "s")})` : undefined} style:--b="{Math.min(4, (a.blur ?? 0) / 4)}px" aria-hidden="true"></span>
    <span class="st-keys keys">
      <button class="st-key" type="button" onclick={() => input?.click()}><ImageIcon size={14} /> {a.imageId ? "Change background" : "Background image"}</button>
      {#if a.imageId}<button class="st-key sq" type="button" onclick={() => save({ imageId: null })} aria-label="Remove background" title="Remove background"><X size={14} /></button>{/if}
    </span>
    <input type="file" accept="image/*" hidden bind:this={input} onchange={(e) => pick(e.currentTarget.files)} />
  </div>
  {#if a.imageId}
    <div class="knobs">
      <Knob label="Blur" value={a.blur ?? 6} min={0} max={30} format={(v) => `${v}px`} onchange={(v) => save({ blur: v }, 400)} />
      <Knob label="Dim" value={a.dim ?? 0.25} min={0} max={0.9} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onchange={(v) => save({ dim: v }, 400)} />
      <Knob label="Text panels" value={a.panel ?? 0.86} min={0.4} max={1} step={0.02} format={(v) => `${Math.round(v * 100)}%`} onchange={(v) => save({ panel: v }, 400)} />
    </div>
    <div class="flips vig">
      <Flip checked={Boolean(a.vignette)} onchange={(on) => save({ vignette: on })}>Vignette</Flip>
    </div>
  {/if}
</Module>

<style>
  .flips {
    display: grid;
    gap: 10px;
  }
  .first {
    margin-top: -4px;
  }
  .sw {
    flex: 0 0 auto;
    width: 13px;
    height: 13px;
    border-radius: 50%;
    background: var(--sw);
    box-shadow:
      0 0 0 2px var(--surface),
      0 0 0 3px var(--st-edge),
      0 0 10px var(--sw);
  }
  .bgrow {
    display: grid;
    grid-template-columns: 70px minmax(0, 1fr);
    gap: 10px;
    align-items: center;
    margin: 12px 0 4px;
  }
  .thumb {
    aspect-ratio: 1;
    border-radius: 6px;
    background: center / cover no-repeat;
    box-shadow:
      0 0 0 2px var(--surface),
      0 0 0 3px var(--st-edge);
    filter: blur(var(--b, 0));
  }
  .thumb.empty {
    filter: none;
    background: repeating-linear-gradient(135deg, var(--st-fill) 0 6px, transparent 6px 12px), var(--st-well);
  }
  .keys {
    margin: 0;
  }
  .knobs {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 6px;
    margin-top: 12px;
  }
  .vig {
    margin-top: 12px;
  }
</style>
