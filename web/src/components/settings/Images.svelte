<script lang="ts">
  import { get, imageUrl, post } from "../../lib/api";
  import { onEvent } from "../../lib/events";
  import { timeAgo } from "../../lib/format";
  import { Check, RefreshCw, Sparkles } from "../../lib/icons";
  import ReferencePicker from "../portraits/ReferencePicker.svelte";
  import { backfillThumb } from "../../lib/images";
  import { app, errorToast, saveSetting, toast } from "../../lib/state.svelte";
  import type { Connection, ImageBatch, ImageJob, ImageModel, ImagesConfig } from "../../lib/types";

  /**
   * docs/28 Part 1: where pictures come from. NanoGPT's image models are pay-as-you-go, so pictures
   * use the pay-as-you-go key, and every picture is a tap with its price shown first.
   */
  const DEFAULT: ImagesConfig = { connectionId: null, defaults: { portrait: null, edit: null, anime: null, plate: null }, nsfw: false };
  const JOBS: { id: ImageJob; label: string; hint: string; fits: (m: ImageModel) => boolean }[] = [
    { id: "portrait", label: "Portraits", hint: "A new picture from a prompt.", fits: () => true },
    { id: "edit", label: "Same person, new picture", hint: "Takes reference pictures, so a face stays the same. Only models that take them are listed.", fits: (m) => m.maxInputImages > 0 },
    { id: "anime", label: "Anime and illustrated", hint: "For drawn styles.", fits: () => true },
    { id: "plate", label: "Wide scenes", hint: "For scene plates later. Only models with a wide size are listed.", fits: (m) => wideSizes(m).length > 0 },
  ];

  let connections = $state<Connection[]>([]);
  let models = $state<ImageModel[]>([]);
  let syncedAt = $state<number | null>(null);
  let syncing = $state(false);
  let recent = $state<ImageBatch[]>([]);

  let prompt = $state("");
  let refs = $state<string[]>([]);
  let modelId = $state("");
  let size = $state("");
  let n = $state(1);
  let batch = $state<ImageBatch | null>(null);
  let sending = $state(false);

  const cfg = $derived<ImagesConfig>({ ...DEFAULT, ...(app.settings?.["images.config"] ?? {}), defaults: { ...DEFAULT.defaults, ...(app.settings?.["images.config"]?.defaults ?? {}) } });
  // Pictures are never on the subscription: only pay-as-you-go NanoGPT keys (and the mock in development).
  const usable = $derived(connections.filter((c) => (c.kind === "nanogpt" || c.kind === "mock") && c.billing !== "subscription"));
  const model = $derived(models.find((m) => m.id === modelId) ?? null);
  const sizes = $derived(model ? (Object.keys(model.prices).length ? Object.keys(model.prices) : model.sizes) : []);
  const each = $derived(model ? (model.prices[size] ?? model.prices.auto ?? (Object.values(model.prices).length ? Math.min(...Object.values(model.prices)) : null)) : null);
  const busy = $derived(batch != null && (batch.status === "queued" || batch.status === "running"));

  const usd = (v: number | null | undefined) => (v == null ? "price unknown" : v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(v < 1 ? 3 : 2)}`);
  const cheapest = (m: ImageModel) => {
    const p = Object.values(m.prices);
    return p.length ? Math.min(...p) : null;
  };
  function wideSizes(m: ImageModel) {
    return [...Object.keys(m.prices), ...m.sizes, ...m.aspectRatios].filter((k) => {
      const r = k.match(/^(\d+(?:\.\d+)?)[x*:](\d+(?:\.\d+)?)$/);
      return r ? Number(r[1]) / Number(r[2]) >= 2 : false;
    });
  }
  function firstSize(m: ImageModel | null) {
    if (!m) return "";
    const keys = Object.keys(m.prices).length ? Object.keys(m.prices) : m.sizes;
    return keys.find((k) => /^1024[x*]1024$/.test(k)) ?? keys.find((k) => /^1k$/i.test(k)) ?? keys.find((k) => k === "1:1") ?? keys.find((k) => k !== "auto") ?? keys[0] ?? "";
  }

  async function loadConnections() {
    try {
      connections = (await get<{ connections: Connection[] }>("/api/connections")).connections;
    } catch (e) {
      errorToast(e);
    }
  }
  async function loadModels() {
    if (!cfg.connectionId) {
      models = [];
      syncedAt = null;
      return;
    }
    try {
      const r = await get<{ models: ImageModel[]; syncedAt: number | null }>(`/api/imagegen/models?connectionId=${encodeURIComponent(cfg.connectionId)}`);
      models = r.models;
      syncedAt = r.syncedAt;
      if (!models.some((m) => m.id === modelId)) pickModel(cfg.defaults.portrait ?? models[0]?.id ?? "");
    } catch (e) {
      errorToast(e);
    }
  }
  async function loadRecent() {
    try {
      recent = (await get<{ batches: ImageBatch[] }>("/api/imagegen/batches?limit=6")).batches;
    } catch {
      recent = [];
    }
  }

  $effect(() => {
    void loadConnections();
    void loadRecent();
  });
  // The catalog follows the chosen connection (and the adult-content switch).
  $effect(() => {
    void cfg.connectionId;
    void cfg.nsfw;
    void loadModels();
  });
  $effect(() =>
    onEvent((e) => {
      if (e.type !== "images.changed") return;
      if (batch && e.batchId === batch.id) void refreshBatch();
      void loadRecent();
    }),
  );

  // The "done" event can arrive before the request that started it has answered: look again while drawing.
  $effect(() => {
    if (!busy) return;
    const t = setInterval(() => void refreshBatch(), 3000);
    return () => clearInterval(t);
  });

  async function save(patch: Partial<ImagesConfig>) {
    try {
      await saveSetting("images.config", { ...cfg, ...patch });
    } catch (e) {
      errorToast(e);
    }
  }
  function setDefault(job: ImageJob, id: string) {
    void save({ defaults: { ...cfg.defaults, [job]: id || null } });
  }

  async function sync() {
    syncing = true;
    try {
      await post<{ count: number }>("/api/imagegen/models/sync", { connectionId: cfg.connectionId });
      await loadModels();
      toast(`${models.length} image models ready`);
    } catch (e) {
      errorToast(e);
    } finally {
      syncing = false;
    }
  }

  function pickModel(id: string) {
    modelId = id;
    const m = models.find((x) => x.id === id) ?? null;
    size = firstSize(m);
    n = Math.min(n, m?.maxImages ?? 1);
  }

  async function generate() {
    if (!model || !prompt.trim() || refs.length > model.maxInputImages) return;
    sending = true;
    try {
      batch = await post<ImageBatch>("/api/imagegen/generate", { connectionId: cfg.connectionId, model: model.id, prompt: prompt.trim(), n, size: size || null, references: refs, kind: "try" });
    } catch (e) {
      errorToast(e);
    } finally {
      sending = false;
    }
  }
  async function refreshBatch() {
    if (!batch) return;
    try {
      batch = await get<ImageBatch>(`/api/imagegen/batches/${batch.id}`);
    } catch {
      // the next event tries again
    }
  }
  async function keep(id: string, kept: boolean) {
    try {
      await post(`/api/imagegen/images/${id}/keep`, { kept });
      await refreshBatch();
    } catch (e) {
      errorToast(e);
    }
  }
</script>

{#if app.settings}
  <section class="stack tight">
    <h2>Pictures</h2>
    <p class="tiny muted">
      Portraits and other pictures come from NanoGPT's image models. These are always pay-as-you-go, never part of the subscription, so pictures use your pay-as-you-go key. Each picture is a tap, and its price shows before you tap.
    </p>
    <div class="card pad stack tight">
      <label class="field">
        <span class="label">Connection</span>
        <select class="select" value={cfg.connectionId ?? ""} onchange={(e) => save({ connectionId: e.currentTarget.value || null })}>
          <option value="">Off</option>
          {#each usable as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
        </select>
      </label>
      {#if !usable.length}
        <p class="tiny muted">Add a NanoGPT pay-as-you-go connection under Models first.</p>
      {:else if cfg.connectionId}
        <div class="row between wrap tiny muted">
          <span>{models.length ? `${models.length} image models` : "No image models loaded yet"}{syncedAt ? ` · updated ${timeAgo(syncedAt)}` : ""}</span>
          <button class="btn small" onclick={sync} disabled={syncing}><RefreshCw size={13} /> {syncing ? "Loading…" : models.length ? "Update" : "Load image models"}</button>
        </div>
      {/if}
    </div>
  </section>

  {#if cfg.connectionId && models.length}
    <section class="stack tight">
      <h2>Default models</h2>
      <p class="tiny muted">Which model each kind of picture starts with. You can still pick another each time. The price shown is the cheapest size.</p>
      <div class="card pad stack tight">
        {#each JOBS as j (j.id)}
          <label class="field">
            <span class="label">{j.label}</span>
            <select class="select" value={cfg.defaults[j.id] ?? ""} onchange={(e) => setDefault(j.id, e.currentTarget.value)}>
              <option value="">Not set</option>
              {#each models.filter(j.fits) as m (m.id)}<option value={m.id}>{m.name} · {usd(cheapest(m))}{m.maxInputImages ? ` · ${m.maxInputImages} refs` : ""}</option>{/each}
            </select>
            <span class="tiny muted">{j.hint}</span>
          </label>
        {/each}
        <label class="switch">
          <input type="checkbox" checked={cfg.nsfw} onchange={(e) => save({ nsfw: e.currentTarget.checked })} /> Show models that allow adult content
        </label>
        <p class="tiny muted indent">Whatever the model, Mea only draws adults, and never puts a real person's name in a prompt.</p>
      </div>
    </section>

    <section class="stack tight">
      <h2>Try a picture</h2>
      <p class="tiny muted">Send a prompt as written, to see what a model does. Pictures you don't keep go after 30 days.</p>
      <div class="card pad stack tight">
        <label class="field">
          <span class="label">Prompt</span>
          <textarea class="input" rows="3" bind:value={prompt} maxlength={model?.maxPromptChars ?? 8000} placeholder="Portrait of a woman in her thirties, short dark hair, a lighthouse keeper's coat, warm lamplight, painted"></textarea>
        </label>
        <div class="grid">
          <label class="field">
            <span class="label">Model</span>
            <select class="select" value={modelId} onchange={(e) => pickModel(e.currentTarget.value)}>
              {#each models as m (m.id)}<option value={m.id}>{m.name}{m.maxInputImages ? ` · ${m.maxInputImages} refs` : ""}</option>{/each}
            </select>
          </label>
          <label class="field">
            <span class="label">Size</span>
            <select class="select" bind:value={size} disabled={!sizes.length}>
              {#each sizes as s (s)}<option value={s}>{s}{model?.prices[s] != null ? ` · ${usd(model.prices[s])}` : ""}</option>{/each}
            </select>
          </label>
          <label class="field">
            <span class="label">Pictures</span>
            <select class="select" bind:value={n}>
              {#each Array.from({ length: Math.min(4, model?.maxImages ?? 1) }, (_, i) => i + 1) as k (k)}<option value={k}>{k}</option>{/each}
            </select>
          </label>
        </div>
        {#if model?.description}<p class="tiny muted">{model.description}</p>{/if}
        <ReferencePicker bind:refs {model} {models} suggestId={cfg.defaults.edit} onswitch={pickModel} />
        <div class="row between wrap">
          <span class="tiny muted">{each == null ? "Price unknown" : `About ${usd(each * n)}${n > 1 ? ` for ${n}` : ""}`}{model?.estimated ? " (billed by use)" : ""} · pay-as-you-go</span>
          <button class="btn primary" onclick={generate} disabled={!prompt.trim() || !model || sending || busy || refs.length > model.maxInputImages}><Sparkles size={15} /> {busy ? "Drawing…" : each == null ? "Draw" : `Draw · ${usd(each * n)}`}</button>
        </div>

        {#if batch}
          <div class="stack tight result" aria-live="polite">
            {#if busy}
              <p class="tiny muted">Drawing with {model?.name ?? batch.model}. This can take up to a minute.</p>
            {:else if batch.status === "error"}
              <p class="tiny error">{batch.error}</p>
            {:else}
              <p class="tiny muted">{batch.images.length} {batch.images.length === 1 ? "picture" : "pictures"} · {batch.cost != null ? `charged ${usd(batch.cost)}` : "cost not reported"}</p>
            {/if}
            {#if batch.images.length}
              <div class="sheet">
                {#each batch.images as im (im.id)}
                  <figure>
                    <a href={imageUrl(im.id)} target="_blank" rel="noopener"><img src={imageUrl(im.id)} alt="Picture {im.width ?? ''}×{im.height ?? ''}" onload={(e) => backfillThumb(im.id, e.currentTarget as HTMLImageElement)} /></a>
                    <button class="btn small" class:on={im.kept} onclick={() => keep(im.id, !im.kept)}>{#if im.kept}<Check size={13} /> Kept{:else}Keep{/if}</button>
                  </figure>
                {/each}
              </div>
            {/if}
          </div>
        {/if}
      </div>
    </section>

    {#if recent.length}
      <section class="stack tight">
        <h2>Recent pictures</h2>
        <div class="card pad stack tight">
          {#each recent as b (b.id)}
            <div class="recent row wrap">
              <div class="thumbs">
                {#each b.images.slice(0, 4) as im (im.id)}<a href={imageUrl(im.id)} target="_blank" rel="noopener"><img src={imageUrl(im.id, "s")} alt="" loading="lazy" /></a>{/each}
              </div>
              <div class="tiny stack">
                <span class="clip">{b.prompt}</span>
                <span class="muted">{models.find((m) => m.id === b.model)?.name ?? b.model} · {b.status === "error" ? "failed" : b.status === "done" ? usd(b.cost) : "drawing…"} · {timeAgo(b.createdAt)}</span>
              </div>
            </div>
          {/each}
        </div>
      </section>
    {/if}
  {/if}
{/if}

<style>
  .pad {
    padding: 0.8rem 1rem;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
    gap: 0.6rem;
  }
  .indent {
    margin-left: 1.6rem;
  }
  .error {
    color: var(--danger, #b3261e);
  }
  .sheet {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
    gap: 0.6rem;
  }
  .sheet figure {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    align-items: stretch;
  }
  .sheet img {
    width: 100%;
    border-radius: var(--radius, 10px);
    display: block;
    background: var(--surface-2, rgba(0, 0, 0, 0.05));
  }
  .btn.on {
    border-color: var(--accent);
  }
  .recent {
    gap: 0.75rem;
    align-items: center;
  }
  .thumbs {
    display: flex;
    gap: 0.25rem;
  }
  .thumbs img {
    width: 2.75rem;
    height: 2.75rem;
    object-fit: cover;
    border-radius: 6px;
    display: block;
  }
  .clip {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    max-width: 36rem;
  }
</style>
