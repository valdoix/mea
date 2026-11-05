<script lang="ts">
  import { imageUrl } from "../../lib/api";
  import { ImageIcon, Upload, X } from "../../lib/icons";
  import { loadImage, uploadImage } from "../../lib/images";
  import { errorToast } from "../../lib/state.svelte";
  import type { ImageModel } from "../../lib/types";

  /**
   * Reference pictures for a request: your own uploads (pick, drop or paste) or pictures Mea drew.
   * They go to the model with the prompt, for the models that take them (Seedream edit, Flux Klein
   * edit, Qwen edit, Nano Banana…). Each is stored once and sent as an image id.
   */
  let {
    refs = $bindable<string[]>([]),
    model,
    models = [],
    suggestId = null,
    onswitch,
  }: { refs?: string[]; model: ImageModel | null; models?: ImageModel[]; suggestId?: string | null; onswitch?: (id: string) => void } = $props();

  /** The server takes 16 at most; no model in the catalog takes more than 14. */
  const MOST = 16;
  /** Longest side sent: bigger pictures add upload size and cost nothing in likeness. */
  const SIDE = 2048;
  const MAX_BYTES = 6 * 1024 * 1024;

  let uploading = $state(0);
  let over = $state(false);
  let input = $state<HTMLInputElement | null>(null);

  const max = $derived(model?.maxInputImages ?? 0);
  const tooMany = $derived(model != null && refs.length > max);
  /** A model that takes this many references: the "same person" default first, then the cheapest. */
  const better = $derived.by(() => {
    if (!tooMany) return null;
    const fits = models.filter((m) => m.maxInputImages >= refs.length && !m.tool);
    return fits.find((m) => m.id === suggestId) ?? fits.sort((a, b) => cheapest(a) - cheapest(b))[0] ?? null;
  });
  const cheapest = (m: ImageModel) => (Object.values(m.prices).length ? Math.min(...Object.values(m.prices)) : Infinity);

  /** Shrinks a big or unusual picture to a JPEG; a small PNG, JPEG or WebP goes as it is. */
  async function prepare(file: Blob): Promise<Blob> {
    const img = await loadImage(file);
    const side = Math.max(img.naturalWidth, img.naturalHeight);
    if (side <= SIDE && file.size <= MAX_BYTES && /^image\/(png|jpeg|webp)$/.test(file.type)) return file;
    const scale = Math.min(1, SIDE / side);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff"; // JPEG has no transparency
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't prepare that picture"))), "image/jpeg", 0.92));
  }

  async function add(files: Iterable<File>) {
    const list = [...files].filter((f) => f.type.startsWith("image/"));
    if (!list.length) return;
    const room = MOST - refs.length;
    if (room <= 0) {
      errorToast(new Error(`${MOST} reference pictures at most`));
      return;
    }
    for (const f of list.slice(0, room)) {
      uploading++;
      try {
        const id = await uploadImage(await prepare(f));
        refs = [...refs, id];
      } catch (e) {
        errorToast(e);
      } finally {
        uploading--;
      }
    }
  }
  function remove(id: string) {
    refs = refs.filter((r) => r !== id);
  }
  function onDrop(e: DragEvent) {
    e.preventDefault();
    over = false;
    if (e.dataTransfer?.files.length) void add(e.dataTransfer.files);
  }
  function onPaste(e: ClipboardEvent) {
    const files = [...(e.clipboardData?.items ?? [])].filter((i) => i.kind === "file").map((i) => i.getAsFile()).filter((f): f is File => f != null);
    if (!files.length) return;
    e.preventDefault();
    void add(files);
  }
</script>

<div class="refs stack tight">
  <span class="label">Reference pictures <span class="tiny muted">{model ? (max ? `· ${model.name} takes up to ${max}` : `· ${model.name} takes none`) : ""}</span></span>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div
    class="zone"
    class:over
    role="group"
    aria-label="Reference pictures: drop or paste pictures here"
    tabindex="0"
    ondragover={(e) => (e.preventDefault(), (over = true))}
    ondragleave={() => (over = false)}
    ondrop={onDrop}
    onpaste={onPaste}
  >
    {#each refs as id (id)}
      <figure class="ref">
        <img src={imageUrl(id, "s")} alt="Reference" />
        <button class="x" title="Remove this reference" aria-label="Remove this reference" onclick={() => remove(id)}><X size={12} /></button>
      </figure>
    {/each}
    {#if uploading}<span class="ref pending tiny muted">Adding…</span>{/if}
    {#if refs.length < MOST}
      <button class="ref add" onclick={() => input?.click()} title="Add pictures from this device"><Upload size={16} /><span class="tiny">Add</span></button>
    {/if}
    {#if !refs.length && !uploading}<span class="tiny muted hint"><ImageIcon size={13} /> Drop, paste or add pictures: a face to keep, an outfit, a style to follow.</span>{/if}
  </div>
  <input bind:this={input} type="file" accept="image/*" multiple hidden onchange={(e) => (void add(e.currentTarget.files ?? []), (e.currentTarget.value = ""))} />
  {#if tooMany}
    <p class="tiny notice warn">
      {max ? `${model?.name} takes at most ${max} reference ${max === 1 ? "picture" : "pictures"}` : `${model?.name} doesn't take reference pictures`}.
      {#if better && onswitch}<button class="btn small" onclick={() => onswitch?.(better.id)}>Use {better.name}</button>{:else if !better}Remove some, or pick a model that takes {refs.length}.{/if}
    </p>
  {:else if refs.length}
    <p class="tiny muted">Say in the prompt what to take from them: “the same woman as in the picture”, “in this outfit”, “in this style”.</p>
  {/if}
</div>

<style>
  .zone {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
    padding: 0.45rem;
    border: 1px dashed var(--border-strong, rgba(127, 127, 127, 0.5));
    border-radius: var(--radius, 10px);
    min-height: 4.5rem;
  }
  .zone.over,
  .zone:focus-visible {
    border-color: var(--accent);
    outline: none;
  }
  .ref {
    position: relative;
    margin: 0;
    width: 3.75rem;
    height: 3.75rem;
    flex: none;
  }
  .ref img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 8px;
    display: block;
  }
  .x {
    position: absolute;
    top: -0.35rem;
    right: -0.35rem;
    width: 1.35rem;
    height: 1.35rem;
    border-radius: 999px;
    display: grid;
    place-items: center;
    padding: 0;
    border: 1px solid var(--border, rgba(127, 127, 127, 0.35));
    background: var(--surface, #fff);
    color: inherit;
    cursor: pointer;
  }
  .add,
  .pending {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.15rem;
    border: 1px solid var(--border, rgba(127, 127, 127, 0.35));
    border-radius: 8px;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .pending {
    cursor: default;
  }
  .hint {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }
</style>
