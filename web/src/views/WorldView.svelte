<script lang="ts">
  import Modal from "../components/Modal.svelte";
  import Segmented from "../components/Segmented.svelte";
  import type { PressurePerson } from "../components/trackers/PressureCard.svelte";
  import RelGraph from "../components/world/RelGraph.svelte";
  import { del, get, patch, post, put } from "../lib/api";
  import { confirm } from "../lib/dialogs.svelte";
  import { onEvent } from "../lib/events";
  import { ArrowLeft, Dices, Merge, Pencil, Plus, Settings, Trash } from "../lib/icons";
  import { errorToast, toast } from "../lib/state.svelte";
  import type { Arc, ArcForce, ArcTies, WorldConfig, WorldPerson, WorldViewData } from "../lib/types";

  let { id }: { id: string } = $props();
  let w = $state<WorldViewData | null>(null);
  let filter = $state<"live" | "ended" | "all">("live");
  let busy = $state(false);
  let settingsOpen = $state(false);
  let authorOpen = $state(false);
  let author = $state({ name: "", premise: "" });
  let editArc = $state<Arc | null>(null);
  let arcForm = $state({ premise: "", want: "", fear: "" });
  let cfg = $state<WorldConfig>({ mode: "living", director: "steady", telling: "model", seeding: "ask", fates: "ask", view: "director", climate: "maritime", latitude: 45, tech: "modern", genres: [], step: 120 });

  // E1: dramatic irony: what each person carries, and what you know that they don't.
  let irony = $state(false);
  // G2: the people as a list, or as the relationship graph.
  let peopleView = $state<"list" | "graph">("list");
  let carried = $state<Record<string, PressurePerson>>({});
  async function loadIrony() {
    try {
      const r = await get<{ people: PressurePerson[] }>(`/api/chats/${id}/pressures`);
      carried = Object.fromEntries(r.people.map((x) => [x.name.toLowerCase(), x]));
    } catch {
      carried = {};
    }
  }
  $effect(() => {
    if (irony) void loadIrony();
  });

  async function load() {
    if (irony) void loadIrony();
    try {
      w = await get<WorldViewData>(`/api/chats/${id}/world`);
    } catch (e) {
      errorToast(e);
    }
  }
  $effect(() => {
    void load();
  });
  $effect(() =>
    onEvent((e) => {
      if (e.type === "trackers.changed" && e.chatId === id && !e.running) void load();
    }),
  );

  async function step() {
    busy = true;
    try {
      const r = await post<{ summary: string[] }>(`/api/chats/${id}/world/tick`);
      toast(r.summary.length ? `${r.summary.length} things moved` : "A quiet stretch: nothing moved", { kind: "ok" });
      await load();
    } catch (e) {
      errorToast(e);
    } finally {
      busy = false;
    }
  }
  async function act(url: string, body: unknown) {
    try {
      w = await post<WorldViewData>(url, body);
    } catch (e) {
      errorToast(e);
    }
  }
  // ---------- G3: next beat previews ----------
  interface BeatPreview {
    landsNow: boolean;
    outcome: ArcForce;
    salt: number;
    result: string | null;
    stage: string | null;
    text: string;
    told: "engine" | "model";
    arrivals: { route: string; text: string; carrier: string | null }[];
    why: string[];
    /** What else this beat would set moving: answers, endings it settles, subplots it starts. */
    ripples: string[];
  }
  let preview = $state<{ arc: Arc; data: BeatPreview; editing: boolean; text: string; busy: boolean } | null>(null);
  /** How the called beat would reach the scene, before anything commits. */
  async function previewBeat(a: Arc, outcome: ArcForce, salt = 0) {
    preview = { arc: a, data: preview?.arc.id === a.id ? preview.data : ({ outcome, salt, text: "", landsNow: true } as BeatPreview), editing: false, text: "", busy: true };
    try {
      const data = await post<BeatPreview>(`/api/chats/${id}/world/arcs/${encodeURIComponent(a.id)}/preview`, { outcome, salt });
      preview = { arc: a, data, editing: false, text: data.text, busy: false };
    } catch (e) {
      preview = null;
      errorToast(e);
    }
  }
  async function acceptBeat() {
    if (!preview) return;
    const { arc, data, text } = preview;
    const edited = text.trim() && (text.trim() !== data.text.trim() || data.told === "model");
    preview = null;
    await callBeat(arc, data.outcome, { salt: data.salt, ...(edited ? { text: text.trim() } : {}) });
  }

  /** Call a subplot's next beat (null clears a waiting call). */
  async function callBeat(a: Arc, outcome: ArcForce | null, extra: { salt?: number; text?: string } = {}) {
    try {
      const r = await post<WorldViewData & { landed: boolean }>(`/api/chats/${id}/world/arcs/${encodeURIComponent(a.id)}/force`, { outcome, ...extra });
      w = r;
      if (outcome === null) toast("Call cleared: the dice decide again", { kind: "ok" });
      else if (r.landed) toast(`Done: ${a.leadName}'s next step ${FORCES.find((f) => f.value === outcome)!.said}`, { kind: "ok" });
      else toast(`Called. It lands at ${a.leadName}'s next step.`, { kind: "ok" });
    } catch (e) {
      errorToast(e);
    }
  }
  async function saveConfig(over?: Partial<WorldConfig>) {
    try {
      await patch(`/api/chats/${id}`, { settings: { world: over ?? $state.snapshot(cfg) } });
      await load();
    } catch (e) {
      errorToast(e);
    }
  }
  function openSettings() {
    if (w) cfg = { ...w.config, climate: w.config.climateAuto ? "" : w.config.climate, genres: [...w.config.genres] };
    settingsOpen = true;
  }
  async function giveStory() {
    try {
      w = await post<WorldViewData>(`/api/chats/${id}/world/arcs`, author);
      authorOpen = false;
      author = { name: "", premise: "" };
      toast("Their story begins", { kind: "ok" });
    } catch (e) {
      errorToast(e);
    }
  }
  async function saveArc() {
    if (!editArc) return;
    await act(`/api/chats/${id}/world/arcs/${encodeURIComponent(editArc.id)}`, { action: "edit", ...arcForm });
    editArc = null;
  }
  // ---------- editing people (the same cast endpoints the Story page's Cast uses) ----------
  let person = $state<WorldPerson | null>(null);
  let personForm = $state({ name: "", role: "", where: "", description: "" });
  let mergeInto = $state("");
  function openPerson(p: WorldPerson) {
    person = p;
    personForm = { name: p.name, role: p.role ?? "", where: p.where ?? "", description: p.description ?? "" };
    mergeInto = "";
  }
  /** Who this person can fold into: someone in the story (a cast-only profile can also join another profile). */
  const mergeTargets = $derived((w?.people ?? []).filter((x) => person && x.id !== person.id && (x.source === "story" || (person.source === "cast" && x.source === "cast"))));
  async function savePerson() {
    const p = person;
    if (!p || !personForm.name.trim()) return;
    const f = $state.snapshot(personForm);
    const name = p.source === "lore" ? p.name : f.name.trim();
    try {
      const changed: Record<string, string> = {};
      if (name !== p.name) changed.name = name;
      if (f.role.trim() !== (p.role ?? "")) changed.role = f.role.trim();
      if (f.description.trim() !== (p.description ?? "")) changed.description = f.description.trim();
      if (Object.keys(changed).length) await put(`/api/chats/${id}/cast/${encodeURIComponent(p.name)}`, changed);
      if (f.where.trim() && f.where.trim() !== (p.where ?? "")) await setPerson(name, { where: f.where.trim() });
      else await load();
      person = null;
      toast("Saved", { kind: "ok" });
    } catch (e) {
      errorToast(e);
    }
  }
  async function mergePerson() {
    const p = person;
    const into = (w?.people ?? []).find((x) => x.id === mergeInto);
    if (!p || !into) return;
    if (!(await confirm({ title: `Merge ${p.name} into ${into.name}?`, message: `Everything the story knows about ${p.name} (bonds, things, secrets, traits) moves to ${into.name}, and "${p.name}" becomes another name for them.`, confirmLabel: "Merge" }))) return;
    try {
      await post(`/api/chats/${id}/cast/merge`, { from: p.source === "story" ? p.id : p.name, into: into.source === "story" ? into.id : into.name });
      person = null;
      toast(`${p.name} is now part of ${into.name}`, { kind: "ok" });
      await load();
    } catch (e) {
      errorToast(e);
    }
  }
  async function deletePerson() {
    const p = person;
    if (!p) return;
    if (!(await confirm({ title: `Delete ${p.name}?`, message: "They leave the cast and the story's records, with their bonds. If the story names them again, they come back fresh.", confirmLabel: "Delete", danger: true }))) return;
    try {
      await del(`/api/chats/${id}/cast/${encodeURIComponent(p.name)}?forget=1`);
      person = null;
      toast(`${p.name} is gone`, { kind: "ok" });
      await load();
    } catch (e) {
      errorToast(e);
    }
  }

  async function setPerson(name: string, body: Record<string, unknown>) {
    try {
      w = await put<WorldViewData>(`/api/chats/${id}/world/people/${encodeURIComponent(name)}`, body);
    } catch (e) {
      errorToast(e);
    }
  }

  const arcs = $derived((w?.arcs ?? []).filter((a) => (filter === "all" ? true : filter === "live" ? ["running", "held", "fate", "crossed"].includes(a.status) : ["resolved", "dropped"].includes(a.status))));
  const director = $derived(w?.config.view !== "surprise");
  const STAGES = ["hook", "rising", "reversal", "crisis", "climax"] as const;
  const FORCES: { value: ArcForce; label: string; title: string; said: string }[] = [
    { value: "win", label: "Win", title: "Their next step goes their way", said: "went their way" },
    { value: "cost", label: "At a cost", title: "It works, but they pay for it", said: "worked, at a price" },
    { value: "loss", label: "Loss", title: "Their next step goes wrong", said: "went wrong" },
    { value: "twist", label: "Twist", title: "Something unplanned gets into it: a tie, the weather, an object, a slip, another subplot", said: "took a twist" },
    { value: "reversal", label: "Reversal", title: "It turns against how it's been going", said: "turned around" },
  ];
  const FORCE_LABEL = Object.fromEntries(FORCES.map((f) => [f.value, f.label])) as Record<ArcForce, string>;
  const resultWord = { win: "went their way", cost: "worked, at a price", loss: "went wrong" } as Record<string, string>;
  /** Which way a tied subplot pulls, in words. */
  function stanceWord(t: ArcTies["ties"][number]): string {
    if (t.dir === "theirs") return t.stance === "for" ? `on ${t.person}'s side` : `against ${t.person}`;
    if (t.dir === "target") return `${t.stance === "for" ? `on ${t.person}'s side` : `against ${t.person}`}; both are about ${t.person}`;
    if (t.dir === "mine") return t.stance === "for" ? `${t.person}'s own story; this one is on their side` : `${t.person}'s own story; this one is against them`;
    return `both involve ${t.person}`;
  }
  function jumpTo(arcId: string) {
    filter = "all";
    requestAnimationFrame(() => document.getElementById(arcId)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }
  const routeIcon: Record<string, string> = { carrier: "🗣", signal: "📨", ambient: "📣", trace: "👣", entrance: "🚪", omen: "🌘" };
  const chart = $derived.by(() => {
    const t = w?.tension ?? [];
    if (t.length < 2) return null;
    const lo = t[0]!.at;
    const hi = Math.max(t.at(-1)!.at, lo + 1);
    const x = (v: number) => ((v - lo) / (hi - lo)) * 100;
    const y = (v: number) => 38 - (v / 10) * 36;
    return { value: t.map((p) => `${x(p.at)},${y(p.value)}`).join(" "), target: t.map((p) => `${x(p.at)},${y(p.target)}`).join(" ") };
  });
  const rings = $derived({
    onstage: (w?.people ?? []).filter((p) => p.ring === "onstage"),
    offstage: (w?.people ?? []).filter((p) => p.ring === "offstage"),
    unmet: (w?.people ?? []).filter((p) => p.ring === "unmet"),
  });
  const fmtMin = (m: number) => `${String(Math.floor((m % 1440) / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
</script>

<div class="page">
  <div class="row head">
    <a class="btn ghost icon" href="/chat/{id}" aria-label="Back to the chat"><ArrowLeft size={18} /></a>
    <h1 class="grow">The world off the page</h1>
    {#if w && w.config.mode !== "off"}<button class="btn small" onclick={step} disabled={busy || !w.time}><Dices size={15} /> Move a step</button>{/if}
    <button class="btn ghost icon" onclick={openSettings} aria-label="World settings"><Settings size={18} /></button>
  </div>

  {#if !w}
    <p class="muted">Loading…</p>
  {:else if w.config.mode === "off"}
    <section class="panel stack">
      <p>While it's off, people only act when they're in a scene. Turned on, everyone the story knows lives their own life between scenes: subplots move with the dice as story time passes, news travels person to person, and some of it reaches your scene.</p>
      <button class="btn primary" onclick={() => saveConfig({ mode: "living" })}>Turn it on (living)</button>
    </section>
  {:else}
    <div class="top-grid">
      <section class="panel stack tight">
        <h2>Now</h2>
        <div class="small">{w.time ?? "No story time yet"} · {w.town}</div>
        {#if w.sky}
          <div class="small">{w.sky.weather.text}, {w.sky.weather.tempC}°C · {w.sky.season}{w.sky.sunrise ? ` · sun ${w.sky.sunrise}–${w.sky.sunset}` : ""} · {w.sky.moon}</div>
          <div class="row wrap fc">{#each w.sky.forecast as f (f.minutes)}<span class="chip tiny">{fmtMin(f.minutes)} {f.text.split(",")[0]} {f.tempC}°</span>{/each}</div>
        {/if}
        <div class="tiny muted">{w.lastTickAt ? `Last moved at ${w.lastTickAt}` : "Hasn't moved yet"} · {w.ticks} steps · {w.config.mode}</div>
      </section>
      <section class="panel stack tight">
        <h2>Tension <span class="tiny muted">{w.personalities[w.config.director]?.label}</span></h2>
        {#if chart}
          <svg class="chart" viewBox="0 0 100 40" preserveAspectRatio="none" aria-label="Story tension over time against the director's target"><polyline points={chart.target} class="target" /><polyline points={chart.value} class="value" /></svg>
          <div class="tiny muted">Line: the story's tension. Dashes: where the director wants it. {w.personalities[w.config.director]?.about}</div>
        {:else}
          <p class="tiny muted">Builds up as the world moves.</p>
        {/if}
      </section>
    </div>

    {#if w.proposals.length}
      <section class="stack tight">
        <h2>Waiting for your word</h2>
        {#each w.proposals as p (p.id)}
          <div class="card item">
            <div class="tiny muted">{w.kinds[p.kind]?.label} · grows out of {p.why}</div>
            <div><b>{p.leadName}</b>: {p.premise}</div>
            <div class="tiny muted">Wants {p.want} · fears {p.fear}</div>
            <div class="row"><button class="btn small primary" onclick={() => act(`/api/chats/${id}/world/proposals/${encodeURIComponent(p.id)}`, { accept: true })}>Let it happen</button><button class="btn small ghost" onclick={() => act(`/api/chats/${id}/world/proposals/${encodeURIComponent(p.id)}`, { accept: false })}>Not this</button></div>
          </div>
        {/each}
      </section>
    {/if}

    <section class="stack tight">
      <div class="row between wrap">
        <h2>Subplots</h2>
        <div class="row">
          <Segmented bind:value={filter} small options={[{ value: "live" as const, label: "Live" }, { value: "ended" as const, label: "Ended" }, { value: "all" as const, label: "All" }]} />
          <button class="btn small" onclick={() => (authorOpen = true)}><Plus size={14} /> Give someone a story</button>
        </div>
      </div>
      {#each arcs as a (a.id)}
        <article class="card arc" id={a.id} class:fate={a.status === "fate"}>
          <div class="row between wrap">
            <div><b>{a.leadName}</b> · {w.kinds[a.kind]?.label} <span class="tiny muted">· {a.secrecy}{a.by === "player" ? " · your story" : ""}{a.status !== "running" ? ` · ${a.status}` : ""}</span></div>
            <div class="stages" aria-label="Where it is in its shape">
              {#each STAGES as s, i (s)}<span class="st" class:on={STAGES.indexOf(a.stage as (typeof STAGES)[number]) >= i || a.stage === "aftermath"} title={s}></span>{/each}
              <span class="tiny muted">{a.clock.cur}/{a.clock.max}</span>
            </div>
          </div>
          <p class="small">{a.premise}</p>
          <div class="tiny muted">Wants {a.want} · fears {a.fear}{director ? ` · heat ${a.heat}` : ""}{director ? ` · ${a.tally.win} won, ${a.tally.cost} at a cost, ${a.tally.loss} lost` : ""}</div>
          {#if director && a.grounds.length}<div class="tiny faint">Rests on: {a.grounds.join(", ")}</div>{/if}
          {#if a.fate}
            <div class="notice warn small">{a.fate.text}</div>
            <div class="row wrap">
              <button class="btn small" onclick={() => act(`/api/chats/${id}/world/fates/${encodeURIComponent(a.id)}`, { choice: "accept" })}>Accept</button>
              <button class="btn small" onclick={() => act(`/api/chats/${id}/world/fates/${encodeURIComponent(a.id)}`, { choice: "soften" })}>Soften it</button>
              <button class="btn small ghost" onclick={() => act(`/api/chats/${id}/world/fates/${encodeURIComponent(a.id)}`, { choice: "page" })}>Keep it for a scene on the page</button>
            </div>
          {/if}
          {#if a.beats.length}
            <ol class="beats">
              {#each a.beats.slice(-6) as b, i (`${b.at}:${i}`)}
                <li>
                  <span class="tiny faint">{b.stage}{b.forced ? ` · your call${director ? ` → ${resultWord[b.result]}` : ""}` : director ? ` · ${b.roll[0]}+${b.roll[1]}${b.mod ? (b.mod > 0 ? `+${b.mod}` : b.mod) : ""} → ${resultWord[b.result]}` : ""}{b.twist ? ` · twist: ${b.twist}` : ""}{director && !b.forced && b.why.length ? ` (${b.why.join(", ")})` : ""}{b.answers && b.twist !== "collide" ? ` · answering ${b.answers}` : ""}</span>
                  <div class="small">{b.text}</div>
                </li>
              {/each}
            </ol>
          {/if}
          {#if a.ending}<div class="small ending">Ending ({a.ending.result}): {a.ending.text}</div>{/if}
          {#if a.ties.length || a.stands.length}
            <div class="ties" aria-label="How other subplots bear on this one">
              <div class="tiny muted">Tied to{#if director && a.pull} <span class="chip tiny" class:up={a.pull.mod > 0} class:down={a.pull.mod < 0}>{a.pull.mod > 0 ? "+1" : "−1"} to its next roll</span>{/if}</div>
              {#each a.stands as c, i (i)}
                <div class="tiny stands">{c.text} <span class="faint">(from {c.leadName}'s {w.kinds[c.kind]?.label.toLowerCase()})</span></div>
              {/each}
              {#each a.ties as t (t.id)}
                <div class="tiny">
                  <button class="linkish" onclick={() => jumpTo(t.id)}>{t.leadName}'s {w.kinds[t.kind]?.label.toLowerCase()}</button>
                  <span class="faint">· {stanceWord(t)}{t.ending ? " · ended" : ""}{t.fresh ? " · since its last step" : ""}</span>: {t.text}
                  {#if director && t.mod}<span class="faint"> ({t.mod > 0 ? "+1" : "−1"}: {t.pull})</span>{/if}
                </div>
              {/each}
            </div>
          {/if}
          {#if ["running", "held"].includes(a.status)}
            <div class="row wrap ctl">
              {#if a.status === "running"}<button class="btn ghost small" onclick={() => act(`/api/chats/${id}/world/arcs/${encodeURIComponent(a.id)}`, { action: "hold" })}>Hold</button>{:else}<button class="btn ghost small" onclick={() => act(`/api/chats/${id}/world/arcs/${encodeURIComponent(a.id)}`, { action: "resume" })}>Resume</button>{/if}
              <button class="btn ghost small" onclick={() => act(`/api/chats/${id}/world/arcs/${encodeURIComponent(a.id)}`, { action: "nudge" })}>Nudge</button>
              <button class="btn ghost small" onclick={() => act(`/api/chats/${id}/world/arcs/${encodeURIComponent(a.id)}`, { action: "bringIn" })} title="Offer a way into your scene next turn">Bring in</button>
              <button class="btn ghost small" onclick={() => ((editArc = a), (arcForm = { premise: a.premise, want: a.want, fear: a.fear }))}>Edit</button>
              <button class="btn ghost small" onclick={() => act(`/api/chats/${id}/world/arcs/${encodeURIComponent(a.id)}`, { action: "drop" })}>Drop</button>
            </div>
            <div class="row wrap ctl call" role="group" aria-label="Call the next beat">
              <span class="tiny muted">Next beat:</span>
              {#each FORCES as f (f.value)}
                <button class="btn ghost small" class:on={a.force === f.value || (preview?.arc.id === a.id && preview.data.outcome === f.value)} title={f.title} aria-pressed={a.force === f.value} onclick={() => previewBeat(a, f.value)}>{f.label}</button>
              {/each}
              {#if a.force}
                <span class="tiny muted">{FORCE_LABEL[a.force]} called; it lands {a.status === "held" ? "once you resume it" : "when they're off the page and free to act"}.</span>
                <button class="btn ghost small" onclick={() => callBeat(a, null)}>Clear</button>
              {/if}
            </div>
            {#if preview?.arc.id === a.id}
              {@const pv = preview}
              <div class="beatpreview card" aria-live="polite">
                {#if pv.busy}
                  <p class="tiny muted">Seeing how it would land…</p>
                {:else if !pv.data.landsNow}
                  <p class="small">{a.leadName} can't move off the page right now, so there's nothing to preview yet: the call would wait for their next step.</p>
                  <div class="row wrap">
                    <button class="btn small" onclick={() => ((preview = null), callBeat(a, pv.data.outcome))}>Call it anyway</button>
                    <button class="btn ghost small" onclick={() => (preview = null)}>Cancel</button>
                  </div>
                {:else}
                  <div class="tiny muted">{FORCE_LABEL[pv.data.outcome]}{pv.data.result && pv.data.result !== pv.data.outcome ? ` · comes out as ${pv.data.result}` : ""}{pv.data.stage ? ` · ${pv.data.stage}` : ""}{pv.data.told === "model" ? " · written by the model" : ""}</div>
                  {#if pv.editing}
                    <textarea class="textarea" rows="3" bind:value={pv.text} maxlength="1200" aria-label="How it reaches the scene"></textarea>
                  {:else}
                    <p class="small">{pv.text}</p>
                  {/if}
                  {#if pv.data.ripples?.length}<div class="tiny faint">It would also set moving: {pv.data.ripples.join(" · ")}</div>{/if}
                  {#if pv.data.arrivals.length}<div class="tiny faint">On its way: {pv.data.arrivals.map((x) => `${routeIcon[x.route] ?? "•"} ${x.text}`).join(" · ")}</div>{/if}
                  <div class="row wrap">
                    <button class="btn small primary" onclick={acceptBeat}>Accept</button>
                    <button class="btn ghost small" onclick={() => previewBeat(a, pv.data.outcome, pv.data.salt + 1)} title="Another roll with the same call">Reroll</button>
                    <button class="btn ghost small" onclick={() => (pv.editing = !pv.editing)}>{pv.editing ? "Done editing" : "Edit"}</button>
                    <button class="btn ghost small" onclick={() => (preview = null)}>Cancel</button>
                  </div>
                {/if}
              </div>
            {/if}
          {/if}
        </article>
      {:else}
        <p class="small muted">{filter === "live" ? "Nothing is moving off the page yet. Subplots grow from the story's loose ends (threads, debts, secrets, strong feelings, people who are away) as story time passes." : "None yet."}</p>
      {/each}
    </section>

    <div class="top-grid">
      <section class="panel stack tight">
        <h2>On its way to the scene</h2>
        {#each w.arrivals.filter((a) => a.status === "pending" || a.status === "offered").slice(0, 10) as a (a.id)}
          <div class="small">{routeIcon[a.route]} {a.text} <span class="tiny faint">{a.route}{a.offers ? ` · offered ${a.offers}/${a.maxOffers}` : ""}</span></div>
        {:else}<p class="tiny muted">Nothing right now.</p>{/each}
        {#if w.arrivals.some((a) => a.status === "used")}
          <details><summary class="tiny">Delivered</summary>{#each w.arrivals.filter((a) => a.status === "used").slice(0, 10) as a (a.id)}<div class="tiny">{routeIcon[a.route]} {a.text}</div>{/each}</details>
        {/if}
      </section>
      <section class="panel stack tight">
        <h2>News and happenings</h2>
        {#if director}{#each w.news.slice(0, 8) as n, i (i)}<div class="tiny">{n.to} heard from {n.from} ({n.medium}){n.distorted ? ", garbled" : ""}: {n.statement}</div>{/each}{/if}
        {#each w.incidents.slice(0, 6) as inc, i (i)}<div class="tiny">📣 {inc.text}</div>{/each}
        {#if !w.news.length && !w.incidents.length}<p class="tiny muted">Quiet so far.</p>{/if}
      </section>
    </div>

    <section class="panel stack tight">
      <div class="row between">
        <h2>People</h2>
        <div class="row">
          <Segmented bind:value={peopleView} small options={[{ value: "list" as const, label: "List" }, { value: "graph" as const, label: "Graph" }]} />
          {#if peopleView === "list"}<label class="switch small" title="What each person carries and hasn't said, and what you know that they don't"><input type="checkbox" bind:checked={irony} /> Dramatic irony</label>{/if}
        </div>
      </div>
      {#if peopleView === "graph"}
        <RelGraph chatId={id} />
      {:else}
      {#each [["Here", rings.onstage], ["Seen before", rings.offstage], ["Not met yet", rings.unmet]] as [label, list] (label)}
        {#if (list as typeof rings.onstage).length}
          <div class="tiny muted">{label}</div>
          <div class="ppl">
            {#each list as typeof rings.onstage as p (p.id)}
              <div class="pp">
                <div class="row between name-row">
                  <div class="small"><b>{p.name}</b> {#if p.standing !== "here"}<span class="chip tiny">{p.standing}</span>{/if}{#if p.flag}<span class="chip tiny">{p.flag}</span>{/if}</div>
                  <button class="btn ghost icon tiny-icon" onclick={() => openPerson(p)} aria-label="Edit, merge or delete {p.name}" title="Edit, merge or delete"><Pencil size={14} /></button>
                </div>
                <div class="tiny muted">{p.where ?? ""}{p.travel != null && p.ring !== "onstage" ? ` · ${p.travel < 60 ? `${p.travel} min` : `${Math.round(p.travel / 60)} h`} away` : ""}{p.arcs.length ? ` · ${p.arcs.length} subplot${p.arcs.length > 1 ? "s" : ""}` : ""}</div>
                {#if irony && carried[p.name.toLowerCase()]}
                  {@const c = carried[p.name.toLowerCase()]!}
                  {#if c.pressure && c.pressure.stage !== "resolved"}<div class="tiny irony">Carries: {c.pressure.text} <span class="faint">({c.pressure.stage})</span></div>{/if}
                  {#if c.youKnow.length}<div class="tiny irony">You know, they don't: {c.youKnow.join(" · ")}</div>{/if}
                {/if}
                {#if director && p.ties.length}<div class="tiny faint">Tied to {p.ties.map((t) => `${t.name} (${["", "slight", "some", "close", "strong", "deep"][Math.min(5, Math.max(0, Math.round(t.strength)))] || "slight"})`).join(", ")}</div>{/if}
                {#if p.ring !== "onstage"}
                  <div class="row wrap picks">
                    <select class="select tiny pick" value={p.standing} onchange={(e) => setPerson(p.name, { standing: e.currentTarget.value })} aria-label="Standing">
                      <option value="here">around</option><option value="away">away</option><option value="captive">captive</option><option value="changed">can't act</option><option value="dead">dead</option><option value="companion">companion</option><option value="construct">construct</option>
                    </select>
                    <select class="select tiny pick" value={p.flag ?? ""} onchange={(e) => setPerson(p.name, { flag: e.currentTarget.value || null })} aria-label="Simulation">
                      <option value="">simulate as usual</option><option value="wake">keep awake</option><option value="hold">no new moves</option><option value="out">leave out</option>
                    </select>
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      {/each}
      {/if}
    </section>
  {/if}
</div>

<Modal bind:open={authorOpen} title="Give someone a story" size="md">
  <div class="stack">
    <label class="field"><span class="label">Who</span>
      <input class="input" list="world-people" bind:value={author.name} />
      <datalist id="world-people">{#each w?.people ?? [] as p (p.id)}<option value={p.name}></option>{/each}</datalist>
    </label>
    <label class="field"><span class="label">Their story</span><textarea class="textarea" rows="3" bind:value={author.premise} placeholder="Joss wants to buy back his father's boat before the Guild sells it."></textarea><span class="hint">In your words. The engine picks the kind, grounds it, and starts it at once; it never rewrites what you wrote.</span></label>
  </div>
  {#snippet footer()}<button class="btn ghost" onclick={() => (authorOpen = false)}>Cancel</button><button class="btn primary" onclick={giveStory} disabled={!author.name.trim() || author.premise.trim().length < 5}>Start it</button>{/snippet}
</Modal>

<Modal open={Boolean(person)} onclose={() => (person = null)} title={person ? `About ${person.name}` : ""} size="md">
  {#if person}
    <div class="stack">
      <label class="field"><span class="label">Name</span><input class="input" bind:value={personForm.name} disabled={person.source === "lore"} />{#if person.source === "story"}<span class="hint">A new name: the story calls them that from now on.</span>{/if}</label>
      <label class="field"><span class="label">Role</span><input class="input" bind:value={personForm.role} placeholder="the harbourmaster, her older brother" /></label>
      <label class="field"><span class="label">Where they are</span><input class="input" bind:value={personForm.where} placeholder="Old Town › Bakery" /></label>
      <label class="field"><span class="label">About them</span><textarea class="textarea" rows="3" bind:value={personForm.description}></textarea></label>
      {#if person.source === "lore"}
        <p class="tiny muted">{person.name} comes from a lorebook entry, so their name, merging and deleting live there. "Leave out" on their card keeps them out of the world.</p>
      {:else}
        <div class="field">
          <span class="label">The same person as</span>
          <div class="row wrap merge">
            <select class="select grow" bind:value={mergeInto} aria-label="The same person as">
              <option value="">Pick someone…</option>
              {#each mergeTargets as x (x.id)}<option value={x.id}>{x.name}</option>{/each}
            </select>
            <button class="btn small" disabled={!mergeInto} onclick={mergePerson}><Merge size={14} /> Merge</button>
          </div>
          <span class="hint">{person.name} folds into who you pick and becomes another name for them.</span>
        </div>
      {/if}
    </div>
  {/if}
  {#snippet footer()}
    {#if person && person.source !== "lore"}<button class="btn ghost danger start" onclick={deletePerson}><Trash size={14} /> Delete</button>{/if}
    <button class="btn ghost" onclick={() => (person = null)}>Cancel</button><button class="btn primary" onclick={savePerson} disabled={!personForm.name.trim()}>Save</button>
  {/snippet}
</Modal>

<Modal open={Boolean(editArc)} onclose={() => (editArc = null)} title="Edit subplot" size="md">
  <div class="stack">
    <label class="field"><span class="label">Premise</span><textarea class="textarea" rows="3" bind:value={arcForm.premise}></textarea></label>
    <label class="field"><span class="label">What they want</span><input class="input" bind:value={arcForm.want} /></label>
    <label class="field"><span class="label">What they fear</span><input class="input" bind:value={arcForm.fear} /></label>
    <p class="tiny muted">Your edit locks it: the engine won't rewrite these words.</p>
  </div>
  {#snippet footer()}<button class="btn ghost" onclick={() => (editArc = null)}>Cancel</button><button class="btn primary" onclick={saveArc}>Save</button>{/snippet}
</Modal>

<Modal bind:open={settingsOpen} title="World settings for this chat" size="md">
  <div class="stack">
    <div class="field">
      <span class="label">How lively</span>
      <Segmented bind:value={cfg.mode} small options={[{ value: "off" as const, label: "Off" }, { value: "quiet" as const, label: "Quiet" }, { value: "living" as const, label: "Living" }, { value: "restless" as const, label: "Restless" }]} />
    </div>
    <div class="field">
      <span class="label">Director</span>
      {#each Object.entries(w?.personalities ?? {}) as [k, p] (k)}
        <label class="switch small"><input type="radio" name="director" value={k} bind:group={cfg.director} /> <b>{p.label}</b> <span class="tiny muted">{p.about}</span></label>
      {/each}
    </div>
    <div class="grid">
      <label class="field"><span class="label">New subplots</span><select class="select" bind:value={cfg.seeding}><option value="ask">Ask me first</option><option value="auto">Let them start</option><option value="off">Only mine</option></select></label>
      <label class="field"><span class="label">Endings that can't be undone</span><select class="select" bind:value={cfg.fates}><option value="ask">Ask me</option><option value="page">Only on the page</option><option value="allow">Let them happen</option></select></label>
      <label class="field"><span class="label">Telling</span><select class="select" bind:value={cfg.telling}><option value="model">A model writes the words</option><option value="engine">The engine's own words (no requests)</option></select></label>
      <label class="field"><span class="label">What you see</span><select class="select" bind:value={cfg.view}><option value="director">Everything (dice, grounds)</option><option value="surprise">Surprise me</option></select></label>
      <label class="field"><span class="label">Setting</span><select class="select" bind:value={cfg.tech}><option value="modern">Modern (calls, texts)</option><option value="historic">Historic (letters, notes)</option><option value="fantasy">Fantasy (letters, messengers)</option><option value="future">Future (messages)</option></select></label>
      <label class="field"><span class="label">Climate</span><select class="select" bind:value={cfg.climate}><option value="">Automatic{w?.config.climateAuto ? ` (${w.config.climate})` : " (from the story)"}</option>{#each ["maritime", "continental", "mediterranean", "desert", "tropical", "subarctic", "alpine"] as c (c)}<option value={c}>{c}</option>{/each}</select></label>
      <label class="field"><span class="label">Step</span><input class="input" type="number" min="30" max="1440" step="30" bind:value={cfg.step} /><span class="hint">story minutes between moves</span></label>
      <label class="field"><span class="label">Genres</span><input class="input" value={(cfg.genres ?? []).join(", ")} onchange={(e) => (cfg.genres = e.currentTarget.value.split(/\s*,\s*/).filter(Boolean))} placeholder="mystery, romance" /></label>
    </div>
  </div>
  {#snippet footer()}<button class="btn ghost" onclick={() => (settingsOpen = false)}>Cancel</button><button class="btn primary" onclick={() => ((settingsOpen = false), saveConfig({ ...$state.snapshot(cfg), latitude: undefined, climateAuto: undefined } as Partial<WorldConfig>))}>Save</button>{/snippet}
</Modal>

<style>
  .beatpreview {
    display: grid;
    gap: 0.4rem;
    padding: 0.6rem 0.7rem;
    margin-top: 0.3rem;
    border: 1px dashed color-mix(in srgb, var(--accent) 50%, var(--border));
  }
  .irony {
    color: var(--lavender, var(--accent));
    font-style: italic;
  }
  .pick {
    width: auto;
    padding: 0.2rem 1.7rem 0.2rem 0.5rem;
    background-position: right 0.4rem center;
  }
  .page {
    max-width: 64rem;
    margin: 0 auto;
    padding: 1.2rem clamp(1rem, 3vw, 2rem) 5rem;
    display: grid;
    gap: 1.1rem;
  }
  .head {
    gap: 0.6rem;
    flex-wrap: wrap;
  }
  .top-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
    gap: 1rem;
  }
  .fc {
    gap: 0.25rem;
  }
  .chart {
    width: 100%;
    height: 5rem;
  }
  .chart .value {
    fill: none;
    stroke: var(--accent);
    stroke-width: 2;
    vector-effect: non-scaling-stroke;
  }
  .chart .target {
    fill: none;
    stroke: var(--lavender);
    stroke-width: 1.2;
    stroke-dasharray: 4 3;
    vector-effect: non-scaling-stroke;
  }
  .item,
  .arc {
    padding: 0.8rem 0.9rem;
    display: grid;
    gap: 0.35rem;
  }
  .arc.fate {
    border-color: color-mix(in srgb, var(--danger) 40%, var(--border));
  }
  .stages {
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }
  .st {
    width: 1.1rem;
    height: 0.35rem;
    border-radius: var(--r-pill);
    background: var(--surface-2);
  }
  .st.on {
    background: var(--accent);
  }
  .beats {
    margin: 0.2rem 0 0;
    padding-left: 1.1rem;
    display: grid;
    gap: 0.3rem;
  }
  .ending {
    font-style: italic;
  }
  .ties {
    display: grid;
    gap: 0.2rem;
    padding: 0.4rem 0.6rem;
    border-left: 2px solid var(--border);
  }
  .ties .stands {
    font-weight: 600;
  }
  .ties .chip.up {
    color: var(--ok);
  }
  .ties .chip.down {
    color: var(--danger);
  }
  .linkish {
    background: none;
    border: 0;
    padding: 0;
    font: inherit;
    color: var(--accent);
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .ctl {
    gap: 0.2rem;
  }
  .call {
    align-items: center;
  }
  .call .btn.on {
    border-color: var(--accent);
    color: var(--accent);
  }
  .ppl {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
    gap: 0.5rem;
  }
  .pp {
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    padding: 0.5rem 0.6rem;
    display: grid;
    gap: 0.2rem;
  }
  .pp .select.pick {
    /* Room on the right for the select's arrow, so "simulate as usual" isn't cut off under it. */
    width: auto;
    max-width: 100%;
    min-width: 0;
    padding: 0.15rem 1.7rem 0.15rem 0.5rem;
    background-position: right 0.4rem center;
    text-overflow: ellipsis;
  }
  .picks {
    gap: 0.3rem;
  }
  .name-row {
    align-items: flex-start;
    gap: 0.3rem;
  }
  .tiny-icon {
    padding: 0.15rem;
    min-height: 0;
    flex: none;
  }
  .merge {
    gap: 0.4rem;
  }
  .start {
    margin-right: auto;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
    gap: 0.7rem;
  }
</style>
