<script lang="ts">
  import { imageUrl, patch } from "../../lib/api";
  import { Palette, X } from "../../lib/icons";
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
</script>

<details class="amb">
  <summary class="label"><Palette size={14} /> Ambience</summary>
  <div class="stack tight">
    <label class="switch">
      <input type="checkbox" checked={a.accent} disabled={!palette.length} onchange={(e) => save({ accent: e.currentTarget.checked })} />
      Accent color from {detail.character?.name ?? "the character"}'s portrait
      {#if palette[0]}<span class="dot" style:background={palette[0]}></span>{/if}
    </label>
    {#if !palette.length}<span class="tiny muted">The character needs a portrait first.</span>{/if}
    <div class="row wrap">
      {#if a.imageId}<span class="thumb" style:background-image="url({imageUrl(a.imageId, 's')})"></span>{/if}
      <button class="btn small" onclick={() => input?.click()}>{a.imageId ? "Change background" : "Background image"}</button>
      {#if a.imageId}<button class="btn ghost small icon" onclick={() => save({ imageId: null })} aria-label="Remove background"><X size={14} /></button>{/if}
      <input type="file" accept="image/*" hidden bind:this={input} onchange={(e) => pick(e.currentTarget.files)} />
    </div>
    {#if a.imageId}
      <label class="field"><span class="label">Blur <span class="faint">{a.blur}px</span></span><input type="range" min="0" max="30" step="1" value={a.blur} oninput={(e) => save({ blur: Number(e.currentTarget.value) }, 400)} /></label>
      <label class="field"><span class="label">Dim <span class="faint">{Math.round((a.dim ?? 0) * 100)}%</span></span><input type="range" min="0" max="0.9" step="0.05" value={a.dim} oninput={(e) => save({ dim: Number(e.currentTarget.value) }, 400)} /></label>
      <label class="field"><span class="label">Text panels <span class="faint">{Math.round((a.panel ?? 1) * 100)}% solid</span></span><input type="range" min="0.4" max="1" step="0.02" value={a.panel} oninput={(e) => save({ panel: Number(e.currentTarget.value) }, 400)} /></label>
      <label class="switch"><input type="checkbox" checked={a.vignette} onchange={(e) => save({ vignette: e.currentTarget.checked })} /> Vignette</label>
    {/if}
  </div>
</details>

<style>
  summary {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    cursor: pointer;
    margin-bottom: 0.5rem;
  }
  .dot {
    display: inline-block;
    width: 0.8rem;
    height: 0.8rem;
    border-radius: 50%;
    border: 1px solid var(--border);
    vertical-align: middle;
  }
  .thumb {
    width: 2.6rem;
    height: 2.6rem;
    border-radius: 8px;
    background-size: cover;
    background-position: center;
    border: 1px solid var(--border);
  }
</style>
