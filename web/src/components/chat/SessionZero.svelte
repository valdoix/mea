<script lang="ts">
  import Modal from "../Modal.svelte";
  import CalendarBuilder from "../trackers/CalendarBuilder.svelte";
  import { get, post } from "../../lib/api";
  import { ArrowLeft, Sparkles } from "../../lib/icons";
  import { setupState } from "../../lib/setup.svelte";
  import { errorToast, toast } from "../../lib/state.svelte";

  /**
   * F1: Session Zero. One screen per question, each answer a tap, every page skippable. The
   * answers come pre-filled from the card, the persona and the character's defaults: you confirm
   * rather than fill in. Opens by itself when a chat starts; Chat tab › Story setup reopens it.
   */
  interface Answers {
    genres: string[];
    tone: string;
    pace: "slow" | "normal" | "fast";
    persona: string;
    romance: string;
    difficulty: string;
    intimacy: string;
    limits: string[];
    world: { calendar?: string; climate?: string; tech?: "modern" | "historic" | "fantasy" | "future"; start?: string };
    canon: { source?: string; point?: string };
    trackers: { mode?: "helper" | "inline" | "off"; sections?: Record<string, boolean> };
    look: { accent?: boolean; music?: boolean };
  }
  type Opt = { value: string; label: string };
  interface View {
    answers: Answers;
    done: boolean;
    show: boolean;
    usual: boolean;
    options: { genres: Opt[]; tones: string[]; persona: Opt[]; romance: Opt[]; difficulty: Opt[]; intimacy: Opt[]; limits: string[]; sections: string[]; calendars: Opt[] };
  }
  let { chatId, onapplied }: { chatId: string; onapplied?: () => void } = $props();

  let view = $state<View | null>(null);
  let a = $state<Answers | null>(null);
  let page = $state(0);
  let saving = $state(false);
  let preview = $state("");
  let previewing = $state(false);
  let customLimit = $state("");
  // G1: build a calendar right from the World page.
  let building = $state(false);
  let away = false;
  function startBuild() {
    // One sheet at a time: setup steps aside while the builder is open, then comes back.
    away = true;
    setupState.open = false;
    building = true;
  }
  $effect(() => {
    if (!building && away) {
      away = false;
      setupState.chatId = chatId;
      setupState.open = true;
    }
  });
  function built(c: { id: string; name: string }) {
    if (!view || !a) return;
    view.options.calendars = [...view.options.calendars.filter((x) => x.value !== `custom:${c.id}`), { value: `custom:${c.id}`, label: c.name }];
    a.world.calendar = `custom:${c.id}`;
  }

  const PAGES = ["Genres", "Tone and pace", "Who writes your character", "Romance pace", "Difficulty", "Intimacy and hard limits", "World", "Canon", "Trackers to show", "Look"] as const;
  const SECTION_LABEL: Record<string, string> = { scene: "Scene", cast: "People here", body: "Bodies", bonds: "Bonds", romance: "Romance", knowledge: "Who knows what", items: "Things", threads: "Threads", stakes: "Stakes", calendar: "Calendar", motifs: "Motifs" };

  async function load(autoOpen: boolean) {
    try {
      const v = await get<View>(`/api/chats/${chatId}/setup`);
      view = v;
      a = structuredClone(v.answers);
      page = 0;
      preview = "";
      if (autoOpen && view.show) {
        setupState.chatId = chatId;
        setupState.open = true;
      }
    } catch {
      view = null;
    }
  }
  // When the chat opens: show it by itself if the chat is just starting.
  $effect(() => {
    void load(true);
  });
  // Reopened from the Chat tab.
  $effect(() => {
    if (setupState.seq && setupState.chatId === chatId) void load(false);
  });

  const open = {
    get value() {
      return setupState.open && setupState.chatId === chatId;
    },
    set value(v: boolean) {
      setupState.open = v;
    },
  };

  function toggleGenre(g: string) {
    if (!a) return;
    // Full up, a new tap takes the last place: it never goes nowhere.
    a.genres = a.genres.includes(g) ? a.genres.filter((x) => x !== g) : [...a.genres.slice(0, 2), g];
  }
  function toggleLimit(l: string) {
    if (!a) return;
    a.limits = a.limits.includes(l) ? a.limits.filter((x) => x !== l) : [...a.limits, l];
  }
  function addLimit() {
    if (!a || !customLimit.trim()) return;
    a.limits = [...a.limits, customLimit.trim().slice(0, 60)];
    customLimit = "";
  }

  async function finish() {
    if (!a) return;
    saving = true;
    try {
      view = await post<View>(`/api/chats/${chatId}/setup`, $state.snapshot(a));
      setupState.open = false;
      toast(view.done ? "Story set up" : "Saved", { kind: "ok" });
      onapplied?.();
    } catch (e) {
      errorToast(e);
    } finally {
      saving = false;
    }
  }
  async function skipAll() {
    setupState.open = false;
    if (view && !view.done) await post(`/api/chats/${chatId}/setup/skip`, {}).catch(() => {});
  }
  async function saveUsual() {
    if (!a) return;
    try {
      await post("/api/setup/usual", $state.snapshot(a));
      if (view) view.usual = true;
      toast("Saved as your usual", { kind: "ok" });
    } catch (e) {
      errorToast(e);
    }
  }
  async function useUsual() {
    try {
      const r = await get<{ answers: Answers | null }>("/api/setup/usual");
      if (r.answers && a) a = { ...r.answers, world: { ...r.answers.world, start: a.world.start }, canon: a.canon };
      toast("Your usual is filled in; change anything, then Done");
    } catch (e) {
      errorToast(e);
    }
  }
  async function showPreview() {
    if (!a) return;
    previewing = true;
    try {
      preview = (await post<{ text: string }>(`/api/chats/${chatId}/setup/preview`, { tone: a.tone, persona: a.persona, genres: a.genres })).text || "This card has no opening to show.";
    } catch (e) {
      errorToast(e);
    } finally {
      previewing = false;
    }
  }
  const genreLabel = (g: string) => view?.options.genres.find((x) => x.value === g)?.label ?? g;
  const short = (label: string) => label.split(" — ")[0];
  const hint = (label: string) => label.split(" — ")[1] ?? "";
</script>

<Modal bind:open={open.value} title={view?.done ? "Story setup" : "Let's set up the story"} size="md" onclose={() => !away && view && !view.done && void post(`/api/chats/${chatId}/setup/skip`, {}).catch(() => {})}>
  {#if a && view}
    <div class="sz">
      <div class="steps" role="tablist" aria-label="Setup pages">
        {#each PAGES as p, i (p)}<button type="button" role="tab" class="dot" class:on={i === page} class:past={i < page} aria-selected={i === page} aria-label={p} title={p} onclick={() => (page = i)}></button>{/each}
      </div>
      <h3 class="q">{PAGES[page]}</h3>

      {#if page === 0}
        <p class="tiny muted">Tap the genres this story is. The first one you tap leads; a second colours how scenes get there.</p>
        {#if a.genres.length}<p class="small">Leading: <b>{genreLabel(a.genres[0]!)}</b>{#if a.genres[1]}{` · then ${genreLabel(a.genres[1])}`}{/if}</p>{/if}
        <div class="chips">
          {#each view.options.genres as g (g.value)}
            <button type="button" class="chip" class:on={a.genres.includes(g.value)} aria-pressed={a.genres.includes(g.value)} onclick={() => toggleGenre(g.value)}>{#if a.genres[0] === g.value}★ {/if}{g.label}</button>
          {/each}
        </div>
      {:else if page === 1}
        <span class="label">Tone</span>
        <div class="chips">{#each view.options.tones as t (t)}<button type="button" class="chip" class:on={a.tone === t} aria-pressed={a.tone === t} onclick={() => a && (a.tone = t)}>{t}</button>{/each}</div>
        <span class="label">Pace</span>
        <div class="chips">{#each [["slow", "Slow, lingering"], ["normal", "Steady"], ["fast", "Quick, things happen"]] as [v, l] (v)}<button type="button" class="chip" class:on={a.pace === v} aria-pressed={a.pace === v} onclick={() => a && (a.pace = v as Answers["pace"])}>{l}</button>{/each}</div>
        <div class="preview">
          <button type="button" class="btn ghost small" onclick={showPreview} disabled={previewing}><Sparkles size={14} /> {previewing ? "Writing…" : "Show me a sample"}</button>
          {#if preview}<p class="sample small">{preview}</p>{/if}
        </div>
      {:else if page === 2 || page === 3 || page === 4}
        {@const key = page === 2 ? "persona" : page === 3 ? "romance" : "difficulty"}
        <div class="choices">
          {#each view.options[key] as o (o.value)}
            <button type="button" class="choice" class:on={a[key] === o.value} aria-pressed={a[key] === o.value} onclick={() => a && (a[key] = o.value)}><b>{short(o.label)}</b>{#if hint(o.label)}<span class="tiny muted">{hint(o.label)}</span>{/if}</button>
          {/each}
        </div>
      {:else if page === 5}
        <span class="label">Intimacy</span>
        <div class="chips">{#each view.options.intimacy as o (o.value)}<button type="button" class="chip" class:on={a.intimacy === o.value} aria-pressed={a.intimacy === o.value} onclick={() => a && (a.intimacy = o.value)}>{short(o.label)}</button>{/each}</div>
        <span class="label">Hard limits <span class="faint">never depicted, whatever else is set</span></span>
        <div class="chips">
          {#each [...new Set([...view.options.limits, ...a.limits])] as l (l)}<button type="button" class="chip" class:on={a.limits.includes(l)} aria-pressed={a.limits.includes(l)} onclick={() => toggleLimit(l)}>{l}</button>{/each}
        </div>
        <div class="row"><input class="input grow" bind:value={customLimit} placeholder="Another limit" maxlength="60" onkeydown={(e) => e.key === "Enter" && addLimit()} aria-label="Another hard limit" /><button type="button" class="btn small" onclick={addLimit} disabled={!customLimit.trim()}>Add</button></div>
      {:else if page === 6}
        <span class="label">Calendar</span>
        <div class="chips">
          {#each view.options.calendars as cal (cal.value)}<button type="button" class="chip" class:on={a.world.calendar === cal.value} aria-pressed={a.world.calendar === cal.value} onclick={() => a && (a.world.calendar = cal.value)}>{cal.label}</button>{/each}
          <button type="button" class="chip add" onclick={startBuild}>+ Build my own</button>
        </div>
        <span class="label">The world</span>
        <div class="chips">{#each [["modern", "Modern"], ["historic", "Historic"], ["fantasy", "Fantasy"], ["future", "Future"]] as [v, l] (v)}<button type="button" class="chip" class:on={a.world.tech === v} aria-pressed={a.world.tech === v} onclick={() => a && (a.world.tech = v as "modern")}>{l}</button>{/each}</div>
        <label class="field"><span class="label">Climate</span><input class="input" bind:value={a.world.climate} placeholder="maritime, desert, subarctic…" maxlength="80" /></label>
        <label class="field"><span class="label">The story starts</span><input class="input" bind:value={a.world.start} placeholder={a.world.calendar?.startsWith("custom:") ? "14 Thaw 1372 09:00 (in this calendar)" : "Day 1 20:00, or 14 March 1889 09:00"} maxlength="60" /></label>
      {:else if page === 7}
        <p class="tiny muted">For a story set in a book, show or game: where it stands, so later events aren't spoiled.</p>
        <label class="field"><span class="label">Source</span><input class="input" bind:value={a.canon.source} placeholder="Leave empty for an original story" maxlength="120" /></label>
        <label class="field"><span class="label">Where the story stands in it</span><input class="input" bind:value={a.canon.point} placeholder="After season 2, before the wedding" maxlength="200" /></label>
      {:else if page === 8}
        <span class="label">Story trackers</span>
        <div class="chips">{#each [["helper", "On"], ["inline", "In the reply"], ["off", "Off"]] as [v, l] (v)}<button type="button" class="chip" class:on={a.trackers.mode === v} aria-pressed={a.trackers.mode === v} onclick={() => a && (a.trackers.mode = v as "helper")}>{l}</button>{/each}</div>
        {#if a.trackers.mode !== "off"}
          <span class="label">Show</span>
          <div class="chips">
            {#each view.options.sections as k (k)}<button type="button" class="chip" class:on={a.trackers.sections?.[k] !== false} aria-pressed={a.trackers.sections?.[k] !== false} onclick={() => a && (a.trackers.sections = { ...(a.trackers.sections ?? {}), [k]: a.trackers.sections?.[k] === false })}>{SECTION_LABEL[k] ?? k}</button>{/each}
          </div>
        {/if}
      {:else}
        <label class="switch"><input type="checkbox" bind:checked={a.look.accent} /> Colour the room from the portrait</label>
        <label class="switch"><input type="checkbox" bind:checked={a.look.music} /> Music, when it's available</label>
        <p class="tiny muted">Backgrounds and the rest of the look are in Chat › Ambience.</p>
      {/if}
    </div>
  {/if}
  {#snippet footer()}
    {#if page > 0}<button class="btn ghost icon" onclick={() => (page -= 1)} aria-label="Back"><ArrowLeft size={16} /></button>{/if}
    {#if view?.usual}<button class="btn ghost small" onclick={useUsual}>Use my usual</button>{/if}
    <button class="btn ghost small" onclick={saveUsual}>Save as my usual</button>
    <span class="grow"></span>
    {#if !view?.done}<button class="btn ghost" onclick={skipAll}>Skip</button>{/if}
    {#if page < PAGES.length - 1}<button class="btn" onclick={() => (page += 1)}>Next</button>{/if}
    <button class="btn primary" onclick={finish} disabled={saving}>{view?.done ? "Save" : "Done"}</button>
  {/snippet}
</Modal>

<CalendarBuilder bind:open={building} onsaved={built} />

<style>
  .sz {
    display: grid;
    gap: 0.6rem;
    min-height: 18rem;
    align-content: start;
  }
  .steps {
    display: flex;
    gap: 6px;
    justify-content: center;
  }
  .dot {
    width: 8px;
    height: 8px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: var(--border);
    cursor: pointer;
  }
  .dot.past {
    background: color-mix(in srgb, var(--accent) 45%, var(--border));
  }
  .dot.on {
    background: var(--accent);
    transform: scale(1.3);
  }
  .q {
    margin: 0;
    text-align: center;
    font-family: var(--font-display, inherit);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }
  .chip {
    cursor: pointer;
    border: 1px solid var(--border);
    background: var(--surface-2);
    color: inherit;
    padding: 0.3rem 0.65rem;
    border-radius: 999px;
    font-size: 0.85rem;
  }
  .chip.add {
    border-style: dashed;
  }
  /* :root outranks the themes' own chip colours (":root[data-theme=…][data-shell] .chip"), so a pick always shows. */
  :global(:root) .sz .chip.on {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--on-accent, #fff);
  }
  .choices {
    display: grid;
    gap: 0.4rem;
  }
  .choice {
    display: grid;
    gap: 0.15rem;
    text-align: left;
    cursor: pointer;
    padding: 0.55rem 0.75rem;
    border-radius: var(--radius-sm, 10px);
    border: 1px solid var(--border);
    background: var(--surface-2);
    color: inherit;
  }
  .choice.on {
    border-color: var(--accent);
    box-shadow: inset 0 0 0 1px var(--accent);
  }
  .preview {
    display: grid;
    gap: 0.3rem;
  }
  .sample {
    margin: 0;
    padding: 0.6rem 0.75rem;
    border-radius: var(--radius-sm, 10px);
    background: var(--surface-2);
    font-style: italic;
  }
  .row {
    display: flex;
    gap: 0.4rem;
  }
  .grow {
    flex: 1;
  }
</style>
