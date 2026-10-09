<script lang="ts">
  import SceneWindow from "./SceneWindow.svelte";
  import TrackerSettings from "./TrackerSettings.svelte";
  import { living } from "../../lib/living";
  import { readClock } from "../../lib/storytime";
  import { app } from "../../lib/state.svelte";
  import { post } from "../../lib/api";
  import { Lock, LockOpen, RefreshCw, Settings, ExternalLink, Eye } from "../../lib/icons";
  import { errorToast, toast } from "../../lib/state.svelte";
  import { lockLine, trackerEdit, trk } from "../../lib/trackers.svelte";
  import type { TemplateField, TrackerCharacter, TrackerTemplate } from "../../lib/types";

  let { chatId }: { chatId: string } = $props();

  let editing = $state<string | null>(null);
  let draft = $state("");
  let revealed = $state<Record<string, boolean>>({});
  let settingsOpen = $state(false);

  const d = $derived(trk.data);
  const st = $derived(d?.state);
  const sec = $derived(d?.config.sections);
  const chars = $derived(st ? Object.values(st.chars) : []);
  const here = $derived(chars.filter((c) => (c.tier === "spot" || c.tier === "peri") && !c.dead).sort((a, b) => Number(a.isUser) - Number(b.isUser)));
  const away = $derived(chars.filter((c) => !here.includes(c) && !c.isUser));
  const nm = (id: string | undefined) => (!id ? "—" : id.startsWith("place:") ? id.slice(6) : st?.chars[id]?.isUser ? (d?.userName ?? "You") : (st?.chars[id]?.name ?? id));
  const locked = (path: string) => Boolean(st?.locks.includes(path.toLowerCase()));
  const lastSeq = $derived(st?.lastSeq ?? 0);

  function start(path: string, value: unknown) {
    editing = path;
    draft = value == null ? "" : Array.isArray(value) ? value.join(", ") : String(value);
  }
  async function save(line: string | null) {
    const path = editing;
    editing = null;
    if (!line || !path) return;
    await trackerEdit(chatId, [line]);
  }
  async function toggleLock(path: string) {
    await trackerEdit(chatId, [lockLine(path, !locked(path))]);
  }
  async function readAgain() {
    try {
      await post(`/api/chats/${chatId}/trackers/run`);
      trk.running = true;
      toast("Reading the latest reply…");
    } catch (e) {
      errorToast(e);
    }
  }
  async function setup() {
    try {
      await post(`/api/chats/${chatId}/trackers/init`, { fresh: false });
      trk.running = true;
      toast("Setting up the story state from the card…");
    } catch (e) {
      errorToast(e);
    }
  }

  const METERS: [keyof TrackerCharacter["meters"], string, boolean][] = [
    ["health", "Health", true],
    ["fatigue", "Fatigue", false],
    ["hunger", "Hunger", false],
    ["thirst", "Thirst", false],
    ["pain", "Pain", false],
    ["intox", "Drink", false],
    ["composure", "Composure", true],
    ["stress", "Stress", false],
    ["arousal", "Arousal", false],
  ];
  const SEV = ["", "scratch", "wound", "serious", "critical"];
  const AX_BI = new Set(["trust", "affection", "respect", "comfort"]);
  const LADDER = ["Strangers", "Aware", "Interested", "Charged", "Tested", "Spoken", "Together", "Established"];

  const bonds = $derived(
    st
      ? Object.values(st.bonds)
          .filter((b) => here.some((c) => c.id === b.from || c.id === b.to) || st.chars[b.from]?.isUser || st.chars[b.to]?.isUser)
          .sort((a, b) => Number(st.chars[b.to]?.isUser) - Number(st.chars[a.to]?.isUser))
      : [],
  );
  const threads = $derived(st ? Object.values(st.threads).filter((t) => t.status !== "resolved").sort((a, b) => b.lastSeq - a.lastSeq) : []);
  const resolved = $derived(st ? Object.values(st.threads).filter((t) => t.status === "resolved") : []);
  const obligations = $derived(st ? Object.values(st.obligations).filter((o) => o.status === "open" || o.status === "due") : []);
  const deadlines = $derived(st ? Object.values(st.deadlines).filter((x) => !x.done) : []);
  const plants = $derived(st ? Object.values(st.plants).filter((p) => p.paidSeq == null) : []);
  const facts = $derived(st ? Object.values(st.facts).sort((a, b) => Number(Boolean(b.secret)) - Number(Boolean(a.secret)) || b.lastSeq - a.lastSeq) : []);
  const items = $derived(st ? Object.values(st.items).filter((i) => !i.gone) : []);

  function fmt(f: TemplateField, v: unknown): string {
    if (v == null || v === "" || (Array.isArray(v) && !v.length)) return "—";
    if (Array.isArray(v)) return f.type === "table" ? `${v.length} rows` : v.join(", ");
    if (typeof v === "boolean") return v ? "yes" : "no";
    return String(v);
  }
  function rows(v: unknown) {
    return Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
  }
  const keyOf = (f: TemplateField) => f.keyField ?? f.fields?.[0]?.key ?? "name";
</script>

{#if !d}
  <p class="tiny muted pad">Loading the story state…</p>
{:else if d.config.mode === "off"}
  <div class="pad stack tight">
    <p class="small muted">Trackers are off for this chat.</p>
    <button class="btn small" onclick={() => (settingsOpen = true)}><Settings size={14} /> Tracker settings</button>
  </div>
{:else if st}
  <div class="tpanel stack tight">
    <div class="row between top">
      <span class="tiny muted">{trk.running ? "Reading the latest reply…" : d.when ? d.when.label : d.time ? `Story time: ${d.time}` : "No story time yet"}</span>
      <span class="row">
        <button class="btn ghost icon small" onclick={readAgain} title="Read the latest reply again" aria-label="Read again"><RefreshCw size={14} class={trk.running ? "spin" : ""} /></button>
        <a class="btn ghost icon small" href="/chat/{chatId}/story" title="Timeline, relationship web and cast" aria-label="Open the story view"><ExternalLink size={14} /></a>
        <button class="btn ghost icon small" onclick={() => (settingsOpen = true)} title="Tracker settings" aria-label="Tracker settings"><Settings size={14} /></button>
      </span>
    </div>
    {#if !d.hasBase}
      <div class="notice tiny">The starting state is set from the card after the first reply. <button class="link" onclick={setup}>Set it up now</button></div>
    {/if}

    {#if sec?.scene}
      <details open>
        <summary>Scene</summary>
        {#if living(app.settings).window}<div class="window"><SceneWindow when={d.when} weather={st.weather?.now ?? null} place={st.place} /></div>{/if}
        <div class="kv">
          <span>Time</span>
          {#if editing === "clock"}
            <input class="input mini" bind:value={draft} placeholder={d.config.calendar === "westeros" ? "the 14th day of the 10th moon of 299 AC 21:40" : "Day 3 21:40 or 2026-03-14 21:40"} onkeydown={(e) => e.key === "Enter" && save(`clock: ${draft}`)} onblur={() => save(draft ? `clock: ${draft}` : null)} />
          {:else}
            <button class="val" onclick={() => start("clock", d.time)} title={d.time ?? undefined}>{d.when?.label ?? d.time ?? "—"}</button>
          {/if}
          <button class="lk" class:on={locked("clock")} onclick={() => toggleLock("clock")} aria-label="Lock the clock">{#if locked("clock")}<Lock size={12} />{:else}<LockOpen size={12} />{/if}</button>
        </div>
        <div class="kv">
          <span>Place</span>
          {#if editing === "place"}
            <input class="input mini" bind:value={draft} placeholder="Town › Building › Room" onkeydown={(e) => e.key === "Enter" && save(`at: ${draft}`)} onblur={() => save(draft ? `at: ${draft}` : null)} />
          {:else}
            <button class="val" onclick={() => start("place", st.place.join(" › "))}>{st.place.join(" › ") || "—"}</button>
          {/if}
          <button class="lk" class:on={locked("place")} onclick={() => toggleLock("place")} aria-label="Lock the place">{#if locked("place")}<Lock size={12} />{:else}<LockOpen size={12} />{/if}</button>
        </div>
        <div class="kv">
          <span>Weather</span>
          {#if editing === "wx"}
            <input class="input mini" bind:value={draft} onkeydown={(e) => e.key === "Enter" && save(`wx: ${draft}`)} onblur={() => save(draft ? `wx: ${draft}` : null)} />
          {:else}
            <button class="val" onclick={() => start("wx", st.weather?.now)}>{st.weather?.now ?? "—"}</button>
          {/if}
        </div>
        {#if st.sceneTitle || st.mode}<div class="tiny muted">{st.sceneTitle ? `“${st.sceneTitle}”` : ""}{st.mode ? ` · ${st.mode}` : ""} · scene {st.sceneNo}</div>{/if}
      </details>
    {/if}

    {#if sec?.cast}
      <details open>
        <summary>People here <span class="tiny muted">({here.length})</span></summary>
        {#each here as c (c.id)}
          {@const base = `chars.${c.id}`}
          <div class="person card">
            <div class="row between">
              <b>{c.isUser ? d.userName : c.name}</b>
              {#if c.activity}<span class="tiny muted truncate">{c.activity}</span>{/if}
            </div>
            {#if !c.isUser || !d.config.sealed}
              <div class="kv">
                <span>Mood</span>
                {#if editing === `${base}.mood`}
                  <input class="input mini" bind:value={draft} onkeydown={(e) => e.key === "Enter" && save(`mood ${c.name}: ${draft}`)} onblur={() => save(draft ? `mood ${c.name}: ${draft}` : null)} />
                {:else}
                  <button class="val" onclick={() => start(`${base}.mood`, c.mood?.name)}>{c.mood?.name ?? "—"}{c.mood?.prev ? ` (was ${c.mood.prev})` : ""}</button>
                {/if}
                <button class="lk" class:on={locked(`${base}.mood`)} onclick={() => toggleLock(`${base}.mood`)} aria-label="Lock mood">{#if locked(`${base}.mood`)}<Lock size={12} />{:else}<LockOpen size={12} />{/if}</button>
              </div>
            {/if}
            {#if sec?.body}
              <div class="meters">
                {#each METERS.filter(([k]) => c.meters[k] != null) as [k, label, good] (k)}
                  {@const v = c.meters[k] ?? 0}
                  <div class="meter-row" title="{label} {v}/5">
                    <span class="tiny">{label}</span>
                    <span class="bar"><span class="fill" class:bad={good ? v <= 2 : v >= 4} style:width="{(v / 5) * 100}%"></span></span>
                    <span class="row steps">
                      <button class="mini-b" onclick={() => trackerEdit(chatId, [`body ${c.name}: ${k} ${Math.max(0, Math.round(v) - 1)}`])} aria-label="Lower {label}">−</button>
                      <button class="mini-b" onclick={() => trackerEdit(chatId, [`body ${c.name}: ${k} ${Math.min(5, Math.round(v) + 1)}`])} aria-label="Raise {label}">+</button>
                    </span>
                  </div>
                {/each}
              </div>
              {#if c.injuries.length || c.conditions.length || c.flags.length}
                <div class="row wrap chipsr">
                  {#each c.injuries as i (i.where)}<span class="chip rose" title={i.treated ? "treated" : "untreated"}>🩹 {i.where} · {SEV[i.severity]}</span>{/each}
                  {#each c.conditions as k (k.kind)}<span class="chip butter">{k.text}</span>{/each}
                  {#each c.flags.slice(-4) as f (f)}<span class="chip">{f}</span>{/each}
                </div>
              {/if}
            {/if}
            <div class="kv">
              <span>Look</span>
              {#if editing === `${base}.look`}
                <input class="input mini" bind:value={draft} onkeydown={(e) => e.key === "Enter" && save(`look ${c.name}: ${draft}`)} onblur={() => save(draft ? `look ${c.name}: ${draft}` : null)} />
              {:else}
                <button class="val" onclick={() => start(`${base}.look`, c.look)}>{c.look ?? "—"}</button>
              {/if}
              <button class="lk" class:on={locked(`${base}.look`)} onclick={() => toggleLock(`${base}.look`)} aria-label="Lock look">{#if locked(`${base}.look`)}<Lock size={12} />{:else}<LockOpen size={12} />{/if}</button>
            </div>
            {#if c.traits.length}<div class="tiny"><span class="muted">Always:</span> {c.traits.map((t) => t.text).join(" · ")}</div>{/if}
            {#if !c.isUser && (c.drives.want || c.drives.fear)}<div class="tiny"><span class="muted">Wants</span> {c.drives.want ?? "—"}{c.drives.fear ? ` · fears ${c.drives.fear}` : ""}</div>{/if}
            {#if c.mask?.felt}<div class="tiny"><span class="muted">Shows</span> {c.mask.shown ?? "—"} <span class="muted">· feels</span> {c.mask.felt}{c.mask.tell ? ` · tell: ${c.mask.tell}` : ""}</div>{/if}
            {#if c.thoughts}
              <button class="thought tiny" class:blur={!revealed[c.id]} onclick={() => (revealed[c.id] = !revealed[c.id])} title={revealed[c.id] ? "Hide" : "Tap to reveal their private thought"}>
                <Eye size={12} /> {c.thoughts.text}
              </button>
            {/if}
            {#if sec?.items}
              {@const held = items.filter((i) => i.holder === c.id)}
              {#if held.length}<div class="tiny"><span class="muted">Has</span> {held.map((i) => `${i.name}${i.where ? ` (${i.where})` : ""}`).join(", ")}</div>{/if}
            {/if}
          </div>
        {/each}
        {#if away.length}
          <div class="tiny muted away">Not here: {away.map((c) => `${c.name}${c.dead ? " †" : c.place ? ` (${c.place.split(" › ").at(-1)})` : ""}`).join(" · ")}</div>
        {/if}
      </details>
    {/if}

    {#if sec?.bonds && bonds.length}
      <details open>
        <summary>Bonds</summary>
        {#each bonds as b (`${b.from}>${b.to}`)}
          {@const l = sec?.romance ? st.ladders[`${b.from}>${b.to}`] : undefined}
          <div class="bond">
            <div class="row between"><span class="small"><b>{nm(b.from)}</b> → {nm(b.to)}</span>{#if b.label}<span class="tiny muted truncate">“{b.label}”</span>{/if}</div>
            <div class="axes">
              {#each Object.entries(b.axes).filter(([, v]) => v) as [axis, v] (axis)}
                {@const bi = AX_BI.has(axis)}
                <div class="axis" title="{axis} {v}">
                  <span class="tiny">{axis}</span>
                  <span class="bar" class:bi>
                    <span class="fill" class:neg={(v ?? 0) < 0} style:left={bi ? ((v ?? 0) < 0 ? `${50 + ((v ?? 0) / 5) * 50}%` : "50%") : "0"} style:width={bi ? `${(Math.abs(v ?? 0) / 5) * 50}%` : `${((v ?? 0) / 5) * 100}%`}></span>
                  </span>
                  <span class="tiny num">{(v ?? 0) > 0 && bi ? "+" : ""}{v}</span>
                </div>
              {/each}
            </div>
            {#if l}<div class="tiny">💗 <b>{LADDER[l.tier]}</b> ({l.tier}/7){l.evidence ? ` · ${l.evidence}` : ""}</div>{/if}
          </div>
        {/each}
      </details>
    {/if}

    {#if (sec?.threads && (threads.length || plants.length)) || (sec?.stakes && (obligations.length || deadlines.length || Object.keys(st.gauges).length || Object.keys(st.clocks).length))}
      <details open>
        <summary>Threads & stakes</summary>
        {#if sec?.threads}
          {#each threads as t (t.id)}
            <div class="line">
              <span class="chip {t.status === 'stalled' ? 'butter' : 'mint'}">{t.status}</span>
              <span class="small grow"><b>{t.title}</b>{t.latest ? ` — ${t.latest}` : ""}</span>
              <span class="tiny faint" title="Opened at message #{t.openedSeq}">{Math.max(0, lastSeq - t.openedSeq)} msgs</span>
              <button class="mini-b" onclick={() => trackerEdit(chatId, [`thread ${t.title}: resolve — closed by you`])} title="Mark resolved" aria-label="Resolve">✓</button>
            </div>
          {/each}
          {#each plants as p (p.id)}<div class="line tiny"><span aria-hidden="true">🌱</span> <span class="grow">{p.text}{p.payoff ? ` → ${p.payoff}` : ""}</span></div>{/each}
          {#if resolved.length}<div class="tiny faint">{resolved.length} resolved</div>{/if}
        {/if}
        {#if sec?.stakes}
          {#each obligations as o (o.id)}
            <div class="line"><span class="chip {o.status === 'due' ? 'rose' : ''}">{o.kind === "promise" ? "promise" : "debt"}</span><span class="small grow">{nm(o.who)} → {nm(o.whom)}: {o.what}{o.due ? ` (due ${o.due.text})` : ""}</span></div>
          {/each}
          {#each deadlines as x (x.id)}<div class="line"><span class="chip butter">deadline</span><span class="small grow">{x.title}{x.text ? ` · ${x.text}` : ""}</span></div>{/each}
          {#each Object.values(st.gauges) as g (g.name)}
            <div class="meter-row"><span class="tiny">{g.name}</span><span class="bar"><span class="fill" class:bad={g.cur >= g.max - 1} style:width="{(g.cur / g.max) * 100}%"></span></span><span class="tiny num">{g.cur}/{g.max}</span></div>
          {/each}
          {#each Object.values(st.clocks) as k (`${k.faction}:${k.name}`)}
            <div class="line"><span class="tiny grow">🏛 {k.faction}: {k.name}</span><span class="clock-dots">{#each Array(k.max) as _, i (i)}<span class:on={i < k.cur}></span>{/each}</span></div>
          {/each}
        {/if}
      </details>
    {/if}

    {#if sec?.knowledge && facts.length}
      <details>
        <summary>Knowledge <span class="tiny muted">({facts.length})</span></summary>
        {#each facts.slice(0, 20) as f (f.key)}
          <div class="fact">
            <div class="small">{f.secret ? "🤫 " : ""}{f.statement}{f.truth !== "true" ? ` (${f.truth})` : ""}</div>
            <div class="tiny muted">
              {Object.entries(f.stances).map(([id, s]) => `${nm(id)} ${s.status}`).join(" · ")}
            </div>
          </div>
        {/each}
      </details>
    {/if}

    {#if sec?.items && items.length}
      <details>
        <summary>Things <span class="tiny muted">({items.length})</span></summary>
        {#each items as i (i.id)}<div class="line small"><span class="grow">{i.name}{i.condition ? ` (${i.condition})` : ""}</span><span class="tiny muted">{nm(i.holder)}{i.owner && i.owner !== i.holder ? ` · ${nm(i.owner)}'s` : ""}{i.gift ? ` · gift from ${i.gift}` : ""}</span></div>{/each}
      </details>
    {/if}

    {#if (sec?.calendar && Object.keys(st.calendar).length) || (sec?.motifs && (Object.keys(st.motifs).length || st.milestones.length))}
      <details>
        <summary>Calendar & moments</summary>
        {#each Object.values(st.calendar) as e (e.id)}<div class="line tiny"><span aria-hidden="true">📅</span><span class="grow">{e.title}</span><span class="muted">{e.when}</span></div>{/each}
        {#each st.milestones.slice(-6) as m, i (i)}<div class="line tiny"><span aria-hidden="true">🌟</span><span class="grow">{m.text}</span>{#if m.at}<span class="muted">{readClock(m.at, d.config.calendar)}</span>{/if}</div>{/each}
        {#each Object.values(st.motifs) as m (m.id)}<div class="line tiny"><span aria-hidden="true">🔁</span><span class="grow">{m.text}</span><span class="muted">×{m.uses}</span></div>{/each}
      </details>
    {/if}

    {#if sec?.custom}
      {#each d.templates as t (t.id)}
        {@const vals = st.custom[t.key] ?? {}}
        <details open>
          <summary>{t.name}</summary>
          {#each t.schema.fields as f (f.key)}
            {@const path = `${t.key}.${f.key}`}
            {#if f.visibility !== "hidden"}
              {#if f.type === "table"}
                <div class="tiny muted">{f.label}</div>
                {#each rows(vals[f.key]) as r (String(r[keyOf(f)]))}
                  <div class="line small"><b>{String(r[keyOf(f)])}</b><span class="tiny muted grow">{(f.fields ?? []).filter((s) => s.key !== keyOf(f) && r[s.key] != null && r[s.key] !== "").map((s) => `${s.label.toLowerCase()} ${fmt(s, r[s.key])}`).join(" · ")}</span></div>
                {:else}<div class="tiny faint">none yet</div>{/each}
              {:else if f.type === "meter" || f.type === "number"}
                {@const v = Number(vals[f.key] ?? 0)}
                <div class="meter-row">
                  <span class="tiny">{f.label}</span>
                  {#if f.type === "meter"}<span class="bar"><span class="fill" style:width="{Math.max(0, Math.min(100, v))}%"></span></span>{/if}
                  {#if editing === path}
                    <input class="input mini num-in" type="number" bind:value={draft} onkeydown={(e) => e.key === "Enter" && save(`set ${path}: ${draft}`)} onblur={() => save(draft !== "" ? `set ${path}: ${draft}` : null)} />
                  {:else}
                    <button class="val num" onclick={() => start(path, vals[f.key])}>{vals[f.key] ?? "—"}</button>
                  {/if}
                  <button class="lk" class:on={locked(path)} onclick={() => toggleLock(path)} aria-label="Lock {f.label}">{#if locked(path)}<Lock size={12} />{:else}<LockOpen size={12} />{/if}</button>
                </div>
              {:else}
                <div class="kv">
                  <span>{f.label}</span>
                  {#if editing === path}
                    {#if f.type === "enum"}
                      <select class="select mini" bind:value={draft} onchange={() => save(`set ${path}: ${draft}`)} onblur={() => (editing = null)}>
                        {#each f.options ?? [] as o (o)}<option value={o}>{o}</option>{/each}
                      </select>
                    {:else}
                      <input class="input mini" bind:value={draft} onkeydown={(e) => e.key === "Enter" && save(`set ${path}: ${draft}`)} onblur={() => save(`set ${path}: ${draft}`)} />
                    {/if}
                  {:else}
                    <button class="val" class:blur={f.spoiler && !revealed[path]} onclick={() => (f.spoiler && !revealed[path] ? (revealed[path] = true) : start(path, vals[f.key]))}>{fmt(f, vals[f.key])}</button>
                  {/if}
                  <button class="lk" class:on={locked(path)} onclick={() => toggleLock(path)} aria-label="Lock {f.label}">{#if locked(path)}<Lock size={12} />{:else}<LockOpen size={12} />{/if}</button>
                </div>
              {/if}
            {/if}
          {/each}
        </details>
      {/each}
    {/if}
  </div>
{/if}

<TrackerSettings bind:open={settingsOpen} {chatId} />

<style>
  .pad {
    padding: 0.8rem;
  }
  .tpanel {
    padding: 0.2rem 0.1rem 2rem;
  }
  .top {
    position: sticky;
    top: 0;
    background: var(--bg);
    z-index: 1;
    padding: 0.2rem 0;
  }
  details {
    border-top: 1px solid var(--border);
    padding: 0.45rem 0.1rem;
  }
  summary {
    cursor: pointer;
    font: 700 var(--fs-sm) var(--font-ui);
    padding: 0.15rem 0;
  }
  .window {
    margin: 0.35rem 0 0.5rem;
  }
  .kv {
    display: grid;
    grid-template-columns: 5.2rem 1fr auto;
    align-items: center;
    gap: 0.4rem;
    font-size: var(--fs-sm);
    padding: 0.12rem 0;
  }
  .kv > span:first-child {
    color: var(--text-muted);
    font-size: var(--fs-xs);
  }
  .val {
    border: 0;
    background: none;
    padding: 0.1rem 0.2rem;
    border-radius: 6px;
    text-align: left;
    color: inherit;
    font: inherit;
    cursor: text;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .val:hover {
    background: var(--surface-2);
  }
  .mini {
    padding: 0.2rem 0.45rem;
    font-size: var(--fs-sm);
  }
  .num-in {
    width: 5rem;
  }
  .lk {
    border: 0;
    background: none;
    color: var(--text-faint, var(--text-muted));
    opacity: 0.45;
    cursor: pointer;
    padding: 0.15rem;
    display: inline-flex;
  }
  .lk.on {
    opacity: 1;
    color: var(--accent);
  }
  .person {
    padding: 0.6rem 0.7rem;
    margin: 0.35rem 0;
    display: grid;
    gap: 0.2rem;
  }
  .meters {
    display: grid;
    gap: 0.15rem;
    margin: 0.15rem 0;
  }
  .meter-row {
    display: grid;
    grid-template-columns: 5.2rem 1fr auto auto;
    align-items: center;
    gap: 0.4rem;
  }
  .bar {
    position: relative;
    height: 0.4rem;
    border-radius: var(--r-pill);
    background: var(--surface-2);
    overflow: hidden;
  }
  .bar .fill {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    border-radius: var(--r-pill);
    background: var(--mint);
  }
  .bar .fill.bad,
  .bar .fill.neg {
    background: var(--rose, var(--danger));
  }
  .bar.bi::after {
    content: "";
    position: absolute;
    left: 50%;
    top: -1px;
    bottom: -1px;
    width: 1px;
    background: var(--border);
  }
  .steps {
    gap: 0.1rem;
  }
  .mini-b {
    border: 1px solid var(--border);
    background: var(--surface);
    border-radius: 6px;
    width: 1.3rem;
    height: 1.3rem;
    line-height: 1;
    cursor: pointer;
    color: var(--text-muted);
    font-size: 0.75rem;
  }
  .chipsr {
    gap: 0.25rem;
  }
  .thought {
    border: 1px dashed var(--border);
    border-radius: var(--r-sm);
    background: none;
    text-align: left;
    padding: 0.3rem 0.45rem;
    color: inherit;
    cursor: pointer;
    font-style: italic;
    display: flex;
    gap: 0.35rem;
    align-items: baseline;
  }
  .blur {
    filter: blur(5px);
    user-select: none;
  }
  .away {
    padding-top: 0.3rem;
  }
  .bond {
    padding: 0.4rem 0;
    border-bottom: 1px dashed var(--border);
  }
  .axes {
    display: grid;
    gap: 0.12rem;
    margin: 0.2rem 0;
  }
  .axis {
    display: grid;
    grid-template-columns: 5.2rem 1fr 1.8rem;
    gap: 0.4rem;
    align-items: center;
  }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .line {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
    padding: 0.2rem 0;
  }
  .clock-dots {
    display: inline-flex;
    gap: 2px;
  }
  .clock-dots span {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    border: 1px solid var(--border);
  }
  .clock-dots span.on {
    background: var(--accent);
    border-color: var(--accent);
  }
  .fact {
    padding: 0.3rem 0;
    border-bottom: 1px dashed var(--border);
  }
  .link {
    border: 0;
    background: none;
    color: var(--accent);
    font: inherit;
    cursor: pointer;
    text-decoration: underline;
    padding: 0;
  }
</style>
