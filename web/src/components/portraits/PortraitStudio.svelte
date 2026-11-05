<script lang="ts">
  import Modal from "../Modal.svelte";
  import ImageCropper from "../ImageCropper.svelte";
  import { ApiError, get, imageUrl, post, put } from "../../lib/api";
  import { onEvent } from "../../lib/events";
  import { timeAgo } from "../../lib/format";
  import { Check, Dices, RefreshCw, Sparkles, WandSparkles } from "../../lib/icons";
  import { backfillThumb, uploadImage } from "../../lib/images";
  import { app, errorToast, toast } from "../../lib/state.svelte";
  import type { CompiledPrompt, ImageBatch, ImageModel, ImagesConfig, Look, LookField, LookSource, PortraitDirection, PortraitQuestion, PortraitReadBack, PortraitStyle } from "../../lib/types";

  /**
   * docs/28 Part 3: the Portrait Studio. Your idea → what Mea understood (the Look, each line with
   * where it came from) → three directions → the prompt, written by code for the model you pick →
   * pictures → keep one as the portrait. Every picture is a tap, its price shown first.
   */
  let {
    open = $bindable(false),
    ownerType,
    ownerId,
    name = "",
    aspect = 2 / 3,
    onkept,
  }: { open?: boolean; ownerType: "character" | "persona"; ownerId: string; name?: string; aspect?: number; onkept?: (avatarId: string) => void } = $props();

  const FIELDS: { id: LookField; label: string; list?: boolean; wide?: boolean }[] = [
    { id: "age", label: "Age" },
    { id: "presentation", label: "Presents as" },
    { id: "build", label: "Build" },
    { id: "height", label: "Height" },
    { id: "hair", label: "Hair", wide: true },
    { id: "eyes", label: "Eyes" },
    { id: "skin", label: "Skin" },
    { id: "face", label: "Face", wide: true },
    { id: "marks", label: "Scars and marks", list: true, wide: true },
    { id: "wears", label: "Usually wears", wide: true },
    { id: "signature", label: "Always has", list: true, wide: true },
    { id: "expression", label: "Usual expression", wide: true },
    { id: "never", label: "Never", list: true, wide: true },
  ];
  const SOURCE_LABEL = $derived<Record<LookSource, string>>({ you: "you", lore: "lore", card: ownerType === "persona" ? "persona" : "card", canon: "canon", guess: "guess" });
  const STYLES: { id: PortraitStyle; label: string }[] = [
    { id: "storybook", label: "Storybook pastel" },
    { id: "painted", label: "Painted realism" },
    { id: "photo", label: "Photographic" },
    { id: "anime", label: "Anime" },
    { id: "oil", label: "Oil portrait" },
    { id: "ink", label: "Ink and wash" },
  ];
  const RATIO = /^(\d+(?:\.\d+)?)[x*:](\d+(?:\.\d+)?)$/;
  const shapeOf = (k: string) => {
    const m = k.match(RATIO);
    return m ? Number(m[1]) / Number(m[2]) : null;
  };

  let idea = $state("");
  let reading = $state(false);
  let rb = $state<PortraitReadBack | null>(null);
  let look = $state<Look | null>(null);
  let dirs = $state<PortraitDirection[]>([]);
  let dirBusy = $state(false);
  let steer = $state("");
  let picked = $state<number | null>(null);
  let direction = $state<PortraitDirection | null>(null);
  let style = $state<PortraitStyle>("storybook");

  let models = $state<ImageModel[]>([]);
  let modelId = $state("");
  let size = $state("");
  let shape = $state("");
  let n = $state(2);
  let compiled = $state<CompiledPrompt | null>(null);
  let promptText = $state("");
  let negativeText = $state("");
  let ruleError = $state("");
  let compiling = $state(false);

  let batch = $state<ImageBatch | null>(null);
  let history = $state<ImageBatch[]>([]);
  let sending = $state(false);
  let cropFile = $state<Blob | null>(null);
  let cropSource = $state<string | null>(null);
  let cropOpen = $state(false);

  const cfg = $derived<ImagesConfig | undefined>(app.settings?.["images.config"]);
  const live = $derived(look?.canon?.medium === "live-action");
  const usable = $derived(models.filter((m) => !(live && m.knowsFaces)));
  const model = $derived(usable.find((m) => m.id === modelId) ?? null);
  const shapes = $derived(model?.aspectRatios ?? []);
  const sizes = $derived(model ? (shapes.length ? (model.sizes.length ? model.sizes : Object.keys(model.prices).filter((k) => !k.includes(":"))) : Object.keys(model.prices).length ? Object.keys(model.prices) : model.sizes) : []);
  const each = $derived(model ? (model.prices[size] ?? model.prices[shape] ?? model.prices.auto ?? (Object.values(model.prices).length ? Math.min(...Object.values(model.prices)) : null)) : null);
  const busy = $derived(batch != null && (batch.status === "queued" || batch.status === "running"));
  const usd = (v: number | null | undefined) => (v == null ? "price unknown" : v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(v < 1 ? 3 : 2)}`);

  $effect(() => {
    if (!open) return;
    void loadModels();
    void loadHistory();
  });
  $effect(() =>
    onEvent((e) => {
      if (e.type !== "images.changed") return;
      if (batch && e.batchId === batch.id) void refreshBatch();
      else if (history.some((b) => b.id === e.batchId)) void loadHistory();
    }),
  );
  // The "done" event can arrive before the request that started it has answered (or while the
  // live stream reconnects): while a picture is drawing, look again every few seconds too.
  $effect(() => {
    if (!busy || !open) return;
    const t = setInterval(async () => {
      await refreshBatch();
      if (batch && batch.status !== "queued" && batch.status !== "running") await loadHistory();
    }, 3000);
    return () => clearInterval(t);
  });

  async function loadModels() {
    if (!cfg?.connectionId) return;
    try {
      models = (await get<{ models: ImageModel[] }>(`/api/imagegen/models?connectionId=${encodeURIComponent(cfg.connectionId)}`)).models;
      if (!modelId) pickModel(cfg.defaults.portrait ?? models[0]?.id ?? "");
    } catch (e) {
      errorToast(e);
    }
  }
  async function loadHistory() {
    try {
      history = (await get<{ batches: ImageBatch[] }>(`/api/imagegen/batches?ownerType=${ownerType}&ownerId=${encodeURIComponent(ownerId)}&limit=8`)).batches;
    } catch {
      history = [];
    }
  }

  // ---------- 1–2. idea and read-back ----------

  async function readIt() {
    reading = true;
    try {
      rb = await post<PortraitReadBack>("/api/portraits/readback", { idea, ownerType, ownerId });
      look = rb.refused ? null : rb.look;
      if (look?.style) style = look.style;
      else if (look?.canon && (look.canon.medium === "animated" || look.canon.medium === "drawn")) style = "anime";
      dirs = [];
      picked = null;
      direction = null;
      compiled = null;
      // A live-action character can't use a model that knows faces: move off one.
      if (look?.canon?.medium === "live-action" && models.find((m) => m.id === modelId)?.knowsFaces) pickModel(usable[0]?.id ?? "");
    } catch (e) {
      errorToast(e);
    } finally {
      reading = false;
    }
  }

  function fieldValue(f: LookField): string {
    if (!look) return "";
    const v = look[f as keyof Look];
    if (f === "age") return look.age == null ? "" : String(look.age);
    return Array.isArray(v) ? v.join("; ") : String(v ?? "");
  }
  function setField(f: LookField, raw: string) {
    if (!look) return;
    const text = raw.trim();
    if (f === "age") {
      const n = Number(text);
      look.age = Number.isFinite(n) && n >= 18 && n <= 120 ? Math.round(n) : null;
    } else if (FIELDS.find((x) => x.id === f)?.list) (look as unknown as Record<string, string[]>)[f] = text ? text.split(/\s*;\s*/).filter(Boolean) : [];
    else (look as unknown as Record<string, string>)[f] = text;
    look.source = { ...look.source, [f]: "you" };
    compiled = null;
  }
  function answer(q: PortraitQuestion, value: string) {
    if (q.id === "age") setField("age", value);
    else idea = `${idea.trim()}${idea.trim() ? ", " : ""}${value}`;
    if (rb) rb.questions = rb.questions.filter((x) => x.id !== q.id);
  }

  // ---------- 3. directions ----------

  async function showDirections() {
    if (!look) return;
    dirBusy = true;
    try {
      dirs = (await post<{ directions: PortraitDirection[] }>("/api/portraits/directions", { look, idea, era: rb?.reading.era || undefined, steer: steer.trim() || undefined })).directions;
      picked = null;
    } catch (e) {
      errorToast(e);
    } finally {
      dirBusy = false;
    }
  }
  function pick(i: number) {
    picked = i;
    direction = { ...dirs[i]! };
    compiled = null;
  }
  function ownDirection() {
    picked = -1;
    direction = { title: "My own", setting: "", light: "", framing: "Waist-up, three-quarter view", mood: "", outfit: "", action: "" };
    compiled = null;
  }

  // ---------- 4. the prompt ----------

  function pickModel(id: string) {
    modelId = id;
    const m = models.find((x) => x.id === id);
    if (!m) return;
    if (m.aspectRatios.length) {
      const res = m.sizes.length ? m.sizes : Object.keys(m.prices).filter((k) => !k.includes(":"));
      size = res.find((k) => /^1k$/i.test(k)) ?? res[0] ?? "";
      shape = closest(m.aspectRatios) ?? "";
    } else {
      const keys = Object.keys(m.prices).length ? Object.keys(m.prices) : m.sizes;
      size = closest(keys) ?? keys.find((k) => k !== "auto") ?? keys[0] ?? "";
      shape = "";
    }
    n = Math.min(Math.max(1, n), m.maxImages);
    compiled = null;
  }
  /** The size or shape nearest the portrait's shape (2:3 for a card, square for a persona). */
  function closest(keys: string[]) {
    let best: string | undefined;
    let gap = Infinity;
    for (const k of keys) {
      const r = shapeOf(k);
      if (r == null) continue;
      const g = Math.abs(Math.log(r / aspect)) + (/^(?:1024|1k|1:)/.test(k) ? 0 : 0.001);
      if (g < gap) {
        gap = g;
        best = k;
      }
    }
    return best;
  }

  async function writePrompt() {
    if (!look || !direction || !model) return;
    compiling = true;
    ruleError = "";
    try {
      compiled = await post<CompiledPrompt>("/api/portraits/compile", { look, direction, model: model.id, style, realPeople: rb?.realPeople ?? [] });
      promptText = compiled.prompt;
      negativeText = compiled.negative ?? "";
    } catch (e) {
      compiled = null;
      if (e instanceof ApiError) ruleError = e.message;
      else errorToast(e);
    } finally {
      compiling = false;
    }
  }

  // ---------- 5. pictures ----------

  async function draw(seed?: number, count = n) {
    if (!model || !promptText.trim()) return;
    sending = true;
    try {
      batch = await post<ImageBatch>("/api/imagegen/generate", {
        model: model.id,
        prompt: promptText.trim(),
        negative: compiled?.family !== "prose" && negativeText.trim() ? negativeText.trim() : null,
        n: Math.min(count, model.maxImages),
        size: size || null,
        aspectRatio: shape || null,
        seed: seed ?? null,
        kind: "portrait",
        ownerType,
        ownerId,
        recipe: { idea, look, direction, style, realPeople: rb?.realPeople ?? [] },
      });
      void loadHistory();
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
      await loadHistory();
    } catch (e) {
      errorToast(e);
    }
  }

  async function startCrop(id: string) {
    try {
      cropFile = await (await fetch(imageUrl(id))).blob();
      cropSource = id;
      cropOpen = true;
    } catch (e) {
      errorToast(e);
    }
  }
  async function onCropped(blob: Blob, img: HTMLImageElement) {
    cropOpen = false;
    const source = cropSource;
    try {
      const avatarId = await uploadImage(blob, img);
      await put(ownerType === "character" ? `/api/characters/${ownerId}` : `/api/personas/${ownerId}`, { avatarId });
      if (source) {
        await post(`/api/imagegen/images/${source}/keep`, { kept: true });
        // The uncropped picture is the key image later pictures of them start from (Part 4).
        if (look) look.keyImage = source;
      }
      await saveLook(true);
      toast("Portrait updated", { kind: "ok" });
      onkept?.(avatarId);
      await refreshBatch();
    } catch (e) {
      errorToast(e);
    }
  }
  async function saveLook(quiet = false) {
    if (!look) return;
    try {
      look = (await put<{ look: Look }>(`/api/portraits/looks/${ownerType}/${encodeURIComponent(ownerId)}`, { look: { ...look, style } })).look;
      if (!quiet) toast("Look saved", { kind: "ok" });
    } catch (e) {
      errorToast(e);
    }
  }
  function reuse(b: ImageBatch) {
    batch = b;
    const r = b.recipe as { idea?: string; look?: Look; direction?: PortraitDirection; style?: PortraitStyle };
    if (r.look) look = r.look;
    if (r.direction) direction = r.direction;
    if (r.style) style = r.style;
    if (typeof r.idea === "string") idea = r.idea;
    if (models.some((m) => m.id === b.model)) pickModel(b.model);
    if (b.params.size) size = b.params.size;
    if (b.params.aspectRatio) shape = b.params.aspectRatio;
    promptText = b.prompt;
    negativeText = b.negative ?? "";
    compiled = { prompt: b.prompt, negative: b.negative, family: models.find((m) => m.id === b.model)?.family ?? "prose", style: r.style ?? "storybook", notes: [], model: b.model };
  }
</script>

<Modal bind:open title={`Draw ${name || "a portrait"}`} size="xl">
  {#if !cfg?.connectionId}
    <div class="notice tiny">Pictures need a pay-as-you-go connection. <a href="/settings/images" onclick={() => (open = false)}>Set one up in Settings → Pictures</a>.</div>
  {:else}
    <div class="studio stack">
      <section class="stack tight">
        <h3>1 · Your idea</h3>
        <textarea class="textarea" rows="2" bind:value={idea} placeholder={ownerType === "persona" ? "Leave empty to draw them as they're described, or add what you want: “in winter, rain on her coat”" : "Who, in your own words: “buffy summers, 20 years old”. Leave empty to draw them from their card."}></textarea>
        <div class="row wrap">
          <button class="btn primary" onclick={readIt} disabled={reading}><WandSparkles size={15} /> {reading ? "Reading…" : look ? "Read it again" : "Read it"}</button>
          <span class="tiny muted">Mea works out how they look from your words, {ownerType === "persona" ? "the persona" : "the card"}, its lore, and canon for a known character.</span>
        </div>
        {#if rb?.refused}<p class="notice warn tiny">{rb.refused}</p>{/if}
      </section>

      {#if look}
        <section class="stack tight">
          <div class="row between wrap">
            <h3>2 · How they look</h3>
            <button class="btn small ghost" onclick={() => saveLook()}>Save this look</button>
          </div>
          <p class="tiny muted">
            {look.name || name}{look.canon ? ` · ${look.canon.work} (${look.canon.medium})` : ""}. Each line says where it came from; anything you change becomes yours. These lines go into every picture word for word.
            {#if rb?.sources.length}Read from {#each rb.sources as s, i (s.url)}{i ? ", " : ""}<a href={s.url} target="_blank" rel="noopener">{s.title}</a>{/each}.{/if}
          </p>
          {#each rb?.questions ?? [] as q (q.id)}
            <div class="question card">
              <b class="small">{q.text}</b> <span class="tiny muted">{q.why}</span>
              {#if q.suggestions.length}<div class="row wrap">{#each q.suggestions as s (s)}<button class="chip" onclick={() => answer(q, s)}>{s}</button>{/each}</div>{/if}
            </div>
          {/each}
          <div class="lookgrid">
            {#each FIELDS as f (f.id)}
              <label class="field" class:wide={f.wide}>
                <span class="label">{f.label} {#if look.source[f.id]}<span class="src src-{look.source[f.id]}">{SOURCE_LABEL[look.source[f.id]!]}</span>{/if}</span>
                <input class="input" value={fieldValue(f.id)} type={f.id === "age" ? "number" : "text"} min={f.id === "age" ? 18 : undefined} placeholder={f.list ? "separate with ;" : ""} onchange={(e) => setField(f.id, e.currentTarget.value)} />
              </label>
            {/each}
          </div>
          {#if live}<p class="tiny muted">A live-action character: Mea keeps the actors' names out, and doesn't offer the models seen drawing actors' faces.</p>{/if}
          {#if look.canon && (look.canon.medium === "animated" || look.canon.medium === "drawn" || look.canon.medium === "game")}
            <label class="switch tiny"><input type="checkbox" bind:checked={look.useName} onchange={() => (compiled = null)} /> Put the name in the prompt (helps the model know a drawn character)</label>
          {/if}
        </section>

        <section class="stack tight">
          <h3>3 · The picture</h3>
          <div class="row wrap">
            <input class="input grow" bind:value={steer} placeholder="A steer for all three (optional): darker, candid, in the rain…" />
            <button class="btn" onclick={showDirections} disabled={dirBusy || look.age == null}><Sparkles size={15} /> {dirBusy ? "Thinking…" : dirs.length ? "Three more" : "Show me three directions"}</button>
            <button class="btn ghost" onclick={ownDirection}>Write my own</button>
          </div>
          {#if look.age == null}<p class="tiny muted">Give an age (18 or more) first.</p>{/if}
          {#if dirs.length}
            <div class="dirs">
              {#each dirs as d, i (i)}
                <button class="dir card" class:on={picked === i} onclick={() => pick(i)}>
                  <b>{d.title}</b>
                  <span class="tiny">{d.setting}</span>
                  <span class="tiny muted">{[d.light, d.framing, d.mood].filter(Boolean).join(" · ")}</span>
                </button>
              {/each}
            </div>
          {/if}
          {#if direction}
            <div class="lookgrid">
              <label class="field wide"><span class="label">Where</span><input class="input" bind:value={direction.setting} oninput={() => (compiled = null)} /></label>
              <label class="field"><span class="label">Light</span><input class="input" bind:value={direction.light} oninput={() => (compiled = null)} /></label>
              <label class="field"><span class="label">Framing</span><input class="input" bind:value={direction.framing} oninput={() => (compiled = null)} /></label>
              <label class="field"><span class="label">Mood</span><input class="input" bind:value={direction.mood} oninput={() => (compiled = null)} /></label>
              <label class="field"><span class="label">Doing</span><input class="input" bind:value={direction.action} oninput={() => (compiled = null)} /></label>
              <label class="field wide"><span class="label">Wearing, this time</span><input class="input" bind:value={direction.outfit} placeholder="Empty: their usual clothes" oninput={() => (compiled = null)} /></label>
            </div>
          {/if}
        </section>
      {/if}

      {#if look && direction}
        <section class="stack tight">
          <h3>4 · The prompt</h3>
          <div class="lookgrid">
            <label class="field wide">
              <span class="label">Model</span>
              <select class="select" value={modelId} onchange={(e) => pickModel(e.currentTarget.value)}>
                {#each usable as m (m.id)}<option value={m.id}>{m.name}{m.id === cfg?.defaults.portrait ? " (default)" : ""}</option>{/each}
              </select>
            </label>
            <label class="field">
              <span class="label">Style</span>
              <select class="select" bind:value={style} onchange={() => (compiled = null)}>{#each STYLES as s (s.id)}<option value={s.id}>{s.label}</option>{/each}</select>
            </label>
            {#if sizes.length}
              <label class="field">
                <span class="label">{shapes.length ? "Resolution" : "Size"}</span>
                <select class="select" bind:value={size}>{#each sizes as s (s)}<option value={s}>{s}{model?.prices[s] != null ? ` · ${usd(model.prices[s])}` : ""}</option>{/each}</select>
              </label>
            {/if}
            {#if shapes.length}
              <label class="field">
                <span class="label">Shape</span>
                <select class="select" bind:value={shape}>{#each shapes as s (s)}<option value={s}>{s}</option>{/each}</select>
              </label>
            {/if}
            <label class="field">
              <span class="label">Pictures</span>
              <select class="select" bind:value={n}>{#each Array.from({ length: Math.min(4, model?.maxImages ?? 1) }, (_, i) => i + 1) as k (k)}<option value={k}>{k}</option>{/each}</select>
            </label>
          </div>
          <div class="row wrap">
            <button class="btn" onclick={writePrompt} disabled={compiling || !model}><RefreshCw size={14} /> {compiled ? "Write it again" : "Write the prompt"}</button>
            {#if ruleError}<span class="tiny notice warn">{ruleError}</span>{/if}
          </div>
          {#if compiled}
            <label class="field"><span class="label">Prompt</span><textarea class="textarea" rows="5" bind:value={promptText}></textarea><span class="tiny muted">Written as {compiled.family === "prose" ? "sentences" : "tags"} for this model. It's yours to edit before you draw.</span></label>
            {#if compiled.family !== "prose"}<label class="field"><span class="label">Leave out</span><textarea class="textarea" rows="2" bind:value={negativeText}></textarea></label>{/if}
            {#each compiled.notes as note (note)}<p class="tiny muted">{note}</p>{/each}
            <div class="row between wrap">
              <span class="tiny muted">{each == null ? "Price unknown" : `About ${usd(each * n)}${n > 1 ? ` for ${n}` : ""}`} · pay-as-you-go</span>
              <button class="btn primary" onclick={() => draw()} disabled={sending || busy || !promptText.trim()}><Sparkles size={15} /> {busy ? "Drawing…" : `Draw · ${usd(each == null ? null : each * n)}`}</button>
            </div>
          {/if}
        </section>
      {/if}

      {#if batch}
        <section class="stack tight" aria-live="polite">
          <h3>5 · Pictures</h3>
          {#if busy}<p class="tiny muted">Drawing. This can take up to a minute; you can close this and come back.</p>
          {:else if batch.status === "error"}<p class="tiny notice warn">{batch.error}</p>
          {:else}<p class="tiny muted">{batch.images.length} {batch.images.length === 1 ? "picture" : "pictures"} · {batch.cost != null ? `charged ${usd(batch.cost)}` : "cost not reported"}. Pictures you don't keep go after 30 days.</p>{/if}
          <div class="sheet">
            {#each batch.images as im (im.id)}
              <figure>
                <a href={imageUrl(im.id)} target="_blank" rel="noopener"><img src={imageUrl(im.id)} alt="A portrait of {name}" onload={(e) => backfillThumb(im.id, e.currentTarget as HTMLImageElement)} /></a>
                <div class="row wrap">
                  <button class="btn small primary" onclick={() => startCrop(im.id)}>Use as portrait</button>
                  <button class="btn small" class:on={im.kept} onclick={() => keep(im.id, !im.kept)}>{#if im.kept}<Check size={13} /> Kept{:else}Keep{/if}</button>
                  <button class="btn small ghost" title="The same prompt, another seed" onclick={() => draw(Math.floor(Math.random() * 2 ** 31), 1)} disabled={sending || busy}><Dices size={13} /> More like this</button>
                </div>
              </figure>
            {/each}
          </div>
        </section>
      {/if}

      {#if history.length}
        <section class="stack tight">
          <h3>Earlier pictures of {name || "them"}</h3>
          <div class="history">
            {#each history as b (b.id)}
              <button class="hist card" class:on={batch?.id === b.id} onclick={() => reuse(b)} title={b.prompt}>
                <span class="thumbs">{#each b.images.slice(0, 4) as im (im.id)}<img src={imageUrl(im.id, "s")} alt="" loading="lazy" />{:else}<span class="tiny muted">{b.status === "error" ? "failed" : "drawing…"}</span>{/each}</span>
                <span class="tiny muted">{models.find((m) => m.id === b.model)?.name ?? b.model} · {timeAgo(b.createdAt)}</span>
              </button>
            {/each}
          </div>
        </section>
      {/if}
    </div>
  {/if}
</Modal>

<Modal bind:open={cropOpen} title="Crop the portrait" size="md">
  {#if cropFile}<ImageCropper file={cropFile} {aspect} outWidth={aspect < 1 ? 768 : 512} onconfirm={onCropped} oncancel={() => (cropOpen = false)} />{/if}
</Modal>

<style>
  .studio h3 {
    margin: 0;
    font-size: 1rem;
  }
  .lookgrid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
    gap: 0.5rem 0.75rem;
  }
  .lookgrid .wide {
    grid-column: span 2;
  }
  @media (max-width: 640px) {
    .lookgrid .wide {
      grid-column: auto;
    }
  }
  .src {
    font-size: 0.68rem;
    text-transform: none;
    letter-spacing: 0;
    padding: 0 0.4rem;
    border-radius: 999px;
    margin-left: 0.3rem;
    background: var(--surface-2, rgba(127, 127, 127, 0.15));
    color: var(--text-2, inherit);
  }
  .src-you {
    background: var(--accent-soft, rgba(200, 120, 200, 0.25));
  }
  .src-guess {
    opacity: 0.7;
    font-style: italic;
  }
  .question {
    padding: 0.6rem 0.8rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .dirs {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
    gap: 0.5rem;
  }
  .dir {
    text-align: left;
    padding: 0.6rem 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    cursor: pointer;
    border: 1px solid transparent;
    color: inherit;
    font: inherit;
  }
  .dir.on,
  .hist.on {
    border-color: var(--accent);
  }
  .sheet {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
    gap: 0.75rem;
  }
  .sheet figure {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .sheet img {
    width: 100%;
    border-radius: var(--radius, 10px);
    display: block;
  }
  .btn.on {
    border-color: var(--accent);
  }
  .history {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .hist {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    padding: 0.45rem;
    border: 1px solid transparent;
    cursor: pointer;
    color: inherit;
    font: inherit;
  }
  .thumbs {
    display: flex;
    gap: 0.2rem;
    min-height: 2.5rem;
    align-items: center;
  }
  .thumbs img {
    width: 2.5rem;
    height: 2.5rem;
    object-fit: cover;
    border-radius: 6px;
  }
</style>
