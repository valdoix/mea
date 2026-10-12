<script lang="ts">
  import "../../styles/studio.css";
  import Module from "../desk/Module.svelte";
  import SceneWindow from "./SceneWindow.svelte";
  import TrackerSettings from "./TrackerSettings.svelte";
  import LessonsPanel from "./LessonsPanel.svelte";
  import OffpagePanel from "./OffpagePanel.svelte";
  import PromisesPanel from "./PromisesPanel.svelte";
  import { editOffpage, offpageFor } from "../../lib/offpage.svelte";
  import { living } from "../../lib/living";
  import { readClock } from "../../lib/storytime";
  import { app } from "../../lib/state.svelte";
  import { post } from "../../lib/api";
  import { Bandage, Calendar, Check, Eye, ExternalLink, Heart, Landmark, Lock, LockOpen, RefreshCw, Repeat, Settings, ShieldAlert, Sprout, Star, Trash } from "../../lib/icons";
  import { errorToast, toast } from "../../lib/state.svelte";
  import { lockLine, removeLadder, trackerEdit, trk } from "../../lib/trackers.svelte";
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
  const obligations = $derived(st ? Object.values(st.obligations).filter((o) => o.kind !== "promise" && (o.status === "open" || o.status === "due")) : []);
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

  // The desk: body meters are five-light LED ladders, gauges and clocks light up cell by cell.
  const tone = (v: number, good: boolean) => (good ? (v <= 2 ? "bad" : v <= 3 ? "mid" : "") : v >= 4 ? "bad" : v >= 3 ? "mid" : "");
  const initials = (name: string) =>
    name
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0] ?? "")
      .join("")
      .toUpperCase();
  /** A faction clock as a pie of `max` slices, `cur` of them filled. */
  function pie(cur: number, max: number) {
    const n = Math.max(1, max);
    return Array.from({ length: n }, (_, i) => {
      const a0 = (i / n) * 2 * Math.PI - Math.PI / 2;
      const a1 = ((i + 1) / n) * 2 * Math.PI - Math.PI / 2;
      const p = (a: number) => `${(17 + 15 * Math.cos(a)).toFixed(2)} ${(17 + 15 * Math.sin(a)).toFixed(2)}`;
      return { on: i < cur, d: n === 1 ? "M17 2 A15 15 0 1 1 16.99 2 Z" : `M17 17 L${p(a0)} A15 15 0 0 1 ${p(a1)} Z` };
    });
  }
  const herePeek = $derived(`${here.length} here${away.length ? ` · ${away.length} away` : ""}`);
  // G1: Add a day (a birthday, a feast, an anniversary) to the story's calendar.
  let addingDay = $state(false);
  let dayForm = $state({ title: "", when: "", kind: "birthday" });
  async function addDay() {
    const t = dayForm.title.replace(/[|:]/g, " ").trim();
    const w = dayForm.when.replace(/\|/g, " ").trim();
    if (!t || !w) return;
    if (await trackerEdit(chatId, [`event ${t}: ${w} | ${dayForm.kind}`])) {
      toast(`${t} is on the calendar`, { kind: "ok" });
      dayForm = { title: "", when: "", kind: "birthday" };
      addingDay = false;
    }
  }
</script>

{#snippet lock(path: string, what: string)}
  <button class="lk" class:on={locked(path)} type="button" onclick={() => toggleLock(path)} aria-label="{locked(path) ? 'Unlock' : 'Lock'} {what}" title={locked(path) ? "Locked: the trackers won't change it" : "Lock it"}>{#if locked(path)}<Lock size={12} />{:else}<LockOpen size={12} />{/if}</button>
{/snippet}

{#if !d}
  <p class="st-loading">LOADING THE STORY STATE…</p>
{:else if d.config.mode === "off"}
  <div class="studio st-stack">
    <Module title="Story">
      <p class="st-hint first">Trackers are off for this chat.</p>
      <div class="st-keys"><button class="st-key" type="button" onclick={() => (settingsOpen = true)}><Settings size={14} /> Tracker settings</button></div>
    </Module>
    <LessonsPanel {chatId} />
    <OffpagePanel />
  </div>
{:else if st}
  <div class="studio st-stack">
    <div class="st-lcdbar">
      <span class="st-read">
        <span class="st-lcd clock">{trk.running ? "READING THE LATEST REPLY…" : (d.when?.label ?? d.time ?? "NO STORY TIME YET").toUpperCase()}</span>
        <small>{d.when || d.time ? "Story time · read from the latest reply" : "Set it under Scene, or let the story say"}</small>
      </span>
      <span class="st-iconkeys">
        <button class="st-key sq" type="button" onclick={readAgain} title="Read the latest reply again" aria-label="Read again"><RefreshCw size={15} class={trk.running ? "spin" : ""} /></button>
        <a class="st-key sq" href="/chat/{chatId}/story" title="Timeline, relationship web and cast" aria-label="Open the story view"><ExternalLink size={15} /></a>
        <button class="st-key sq" type="button" onclick={() => (settingsOpen = true)} title="Tracker settings" aria-label="Tracker settings"><Settings size={15} /></button>
      </span>
    </div>
    {#if !d.hasBase}
      <div class="st-well basenote"><span class="st-led warm"></span><span>The starting state is set from the card after the first reply. <button class="st-link" type="button" onclick={setup}>Set it up now</button></span></div>
    {/if}

    {#if sec?.scene}
      <Module title="Scene" fold led={st.sceneNo ? "on" : null} peek={st.sceneNo ? `scene ${st.sceneNo}` : ""}>
        {#if living(app.settings).window}<div class="window"><SceneWindow when={d.when} weather={st.weather?.now ?? null} place={st.place} /></div>{/if}
        <div class="kvs">
          <div class="kv">
            <span>Time</span>
            {#if editing === "clock"}
              <!-- svelte-ignore a11y_autofocus -->
              <input class="val" autofocus bind:value={draft} placeholder={d.config.calendar === "westeros" ? "the 14th day of the 10th moon of 299 AC 21:40" : "Day 3 21:40 or 2026-03-14 21:40"} onkeydown={(e) => e.key === "Enter" && save(`clock: ${draft}`)} onblur={() => save(draft ? `clock: ${draft}` : null)} />
            {:else}
              <button class="val" type="button" onclick={() => start("clock", d.time)} title={d.time ?? undefined}>{d.when?.label ?? d.time ?? "—"}</button>
            {/if}
            {@render lock("clock", "the clock")}
          </div>
          <div class="kv">
            <span>Place</span>
            {#if editing === "place"}
              <!-- svelte-ignore a11y_autofocus -->
              <input class="val" autofocus bind:value={draft} placeholder="Town › Building › Room" onkeydown={(e) => e.key === "Enter" && save(`at: ${draft}`)} onblur={() => save(draft ? `at: ${draft}` : null)} />
            {:else}
              <button class="val" type="button" onclick={() => start("place", st.place.join(" › "))} title={st.place.join(" › ")}>{st.place.join(" › ") || "—"}</button>
            {/if}
            {@render lock("place", "the place")}
          </div>
          <div class="kv">
            <span>Weather</span>
            {#if editing === "wx"}
              <!-- svelte-ignore a11y_autofocus -->
              <input class="val" autofocus bind:value={draft} onkeydown={(e) => e.key === "Enter" && save(`wx: ${draft}`)} onblur={() => save(draft ? `wx: ${draft}` : null)} />
            {:else}
              <button class="val" type="button" onclick={() => start("wx", st.weather?.now)} title={st.weather?.now ?? undefined}>{st.weather?.now ?? "—"}</button>
            {/if}
            <span></span>
          </div>
        </div>
        {#if st.sceneTitle || st.mode}<p class="scene-meta">{st.sceneTitle ? `“${st.sceneTitle}”` : ""}{st.mode ? ` · ${st.mode}` : ""} · scene {st.sceneNo}</p>{/if}
      </Module>
    {/if}

    {#if sec?.cast}
      <Module title="People here" fold peek={herePeek}>
        {#each here as c (c.id)}
          {@const base = `chars.${c.id}`}
          {@const name = c.isUser ? (d.userName ?? "You") : c.name}
          <div class="strip">
            <div class="strip-h">
              <span class="ava" class:you={c.isUser} aria-hidden="true">{initials(name)}</span>
              <span class="who"><b>{name}</b>{#if c.activity || c.isUser}<small>{c.isUser ? "you" : ""}{c.isUser && c.activity ? " · " : ""}{c.activity ?? ""}</small>{/if}</span>
            </div>
            {#if !c.isUser || !d.config.sealed}
              <div class="kvs">
                <div class="kv">
                  <span>Mood</span>
                  {#if editing === `${base}.mood`}
                    <!-- svelte-ignore a11y_autofocus -->
                    <input class="val" autofocus bind:value={draft} onkeydown={(e) => e.key === "Enter" && save(`mood ${c.name}: ${draft}`)} onblur={() => save(draft ? `mood ${c.name}: ${draft}` : null)} />
                  {:else}
                    <button class="val" type="button" onclick={() => start(`${base}.mood`, c.mood?.name)}>{c.mood?.name ?? "—"}{c.mood?.prev ? ` (was ${c.mood.prev})` : ""}</button>
                  {/if}
                  {@render lock(`${base}.mood`, "mood")}
                </div>
              </div>
            {/if}
            {#if sec?.body}
              {@const ms = METERS.filter(([k]) => c.meters[k] != null)}
              {#if ms.length}
                <div class="meters">
                  {#each ms as [k, label, good] (k)}
                    {@const v = c.meters[k] ?? 0}
                    <div class="lm {tone(v, good)}" title="{label} {v}/5">
                      <span class="lm-n">{label}</span>
                      <span class="cells" aria-hidden="true">{#each [0, 1, 2, 3, 4] as n (n)}<i class:on={n < Math.round(v)}></i>{/each}</span>
                      <span class="pm">
                        <button type="button" onclick={() => trackerEdit(chatId, [`body ${c.name}: ${k} ${Math.max(0, Math.round(v) - 1)}`])} aria-label="Lower {label}">−</button>
                        <button type="button" onclick={() => trackerEdit(chatId, [`body ${c.name}: ${k} ${Math.min(5, Math.round(v) + 1)}`])} aria-label="Raise {label}">+</button>
                      </span>
                    </div>
                  {/each}
                </div>
              {/if}
              {#if c.injuries.length || c.conditions.length || c.flags.length}
                <div class="st-tags tags">
                  {#each c.injuries as i (i.where)}<span class="st-chip rose" title={i.treated ? "treated" : "untreated"}><Bandage size={12} /> {i.where} · {SEV[i.severity]}</span>{/each}
                  {#each c.conditions as k (k.kind)}<span class="st-chip butter">{k.text}</span>{/each}
                  {#each c.flags.slice(-4) as f (f)}<span class="st-chip">{f}</span>{/each}
                </div>
              {/if}
            {/if}
            <div class="kvs">
              <div class="kv">
                <span>Look</span>
                {#if editing === `${base}.look`}
                  <!-- svelte-ignore a11y_autofocus -->
                  <input class="val" autofocus bind:value={draft} onkeydown={(e) => e.key === "Enter" && save(`look ${c.name}: ${draft}`)} onblur={() => save(draft ? `look ${c.name}: ${draft}` : null)} />
                {:else}
                  <button class="val" type="button" onclick={() => start(`${base}.look`, c.look)} title={c.look ?? undefined}>{c.look ?? "—"}</button>
                {/if}
                {@render lock(`${base}.look`, "look")}
              </div>
            </div>
            {#if c.traits.length || (!c.isUser && (c.drives.want || c.drives.fear)) || c.mask?.felt || (sec?.items && items.some((i) => i.holder === c.id))}
              {@const held = sec?.items ? items.filter((i) => i.holder === c.id) : []}
              <div class="lines">
                {#if c.traits.length}<div><span class="k">Always</span> {c.traits.map((t) => t.text).join(" · ")}</div>{/if}
                {#if !c.isUser && (c.drives.want || c.drives.fear)}<div><span class="k">Wants</span> {c.drives.want ?? "—"}{c.drives.fear ? ` · fears ${c.drives.fear}` : ""}</div>{/if}
                {#if c.mask?.felt}<div><span class="k">Shows</span> {c.mask.shown ?? "—"} <span class="k">· feels</span> {c.mask.felt}{c.mask.tell ? ` · tell: ${c.mask.tell}` : ""}</div>{/if}
                {#if held.length}<div><span class="k">Has</span> {held.map((i) => `${i.name}${i.where ? ` (${i.where})` : ""}`).join(", ")}</div>{/if}
              </div>
            {/if}
            {#if c.thoughts}
              <button class="thought" class:blur={!revealed[c.id]} type="button" onclick={() => (revealed[c.id] = !revealed[c.id])} title={revealed[c.id] ? "Hide" : "Tap to reveal their private thought"}>
                <Eye size={13} /><span>{c.thoughts.text}</span>
              </button>
            {/if}
          </div>
        {:else}
          <p class="st-hint first">Nobody is in the scene yet.</p>
        {/each}
        {#if away.length}
          <p class="away">Not here: {away.map((c) => `${c.name}${c.dead ? " †" : c.place ? ` (${c.place.split(" › ").at(-1)})` : ""}`).join(" · ")}</p>
        {/if}
      </Module>
    {/if}

    {#if sec?.bonds && bonds.length}
      {@const top = sec?.romance ? Math.max(-1, ...bonds.map((b) => st.ladders[`${b.from}>${b.to}`]?.tier ?? -1)) : -1}
      <Module title="Bonds" fold led={top >= 0 ? "on" : null} peek={top >= 0 ? LADDER[top] : `${bonds.length}`}>
        {#each bonds as b (`${b.from}>${b.to}`)}
          {@const l = sec?.romance ? st.ladders[`${b.from}>${b.to}`] : undefined}
          <div class="bond">
            <div class="bond-h"><span><b>{nm(b.from)}</b> → {nm(b.to)}</span>{#if b.label}<em>“{b.label}”</em>{/if}</div>
            <div class="axes">
              {#each Object.entries(b.axes).filter(([, v]) => v) as [axis, v] (axis)}
                {@const bi = AX_BI.has(axis)}
                {@const x = v ?? 0}
                <div class="axis" title="{axis} {x}">
                  <span>{axis}</span>
                  <span class="abar" class:bi>
                    <span class="afill" class:neg={x < 0} style:left={bi ? (x < 0 ? `${50 + (x / 5) * 50}%` : "50%") : "0"} style:width={bi ? `${(Math.abs(x) / 5) * 50}%` : `${(x / 5) * 100}%`}></span>
                  </span>
                  <output class="st-lcd">{x > 0 && bi ? "+" : ""}{x}</output>
                </div>
              {/each}
            </div>
            {#if l}
              <div class="ladder">
                <div class="rungs" aria-hidden="true">{#each LADDER as r, i (r)}<i class:on={i <= l.tier} class:now={i === l.tier} title={r}></i>{/each}</div>
                <p><Heart size={12} /> <b>{LADDER[l.tier]}</b> ({l.tier}/7){l.evidence ? ` · ${l.evidence}` : ""}<button class="btn ghost icon small rm" title="Remove this romance" aria-label="Remove {nm(b.from)} → {nm(b.to)} romance" onclick={() => removeLadder(chatId, `${b.from}>${b.to}`, `${nm(b.from)} → ${nm(b.to)}`)}><Trash size={12} /></button></p>
              </div>
            {/if}
          </div>
        {/each}
      </Module>
    {/if}

    {#if (sec?.threads && (threads.length || plants.length)) || (sec?.stakes && (obligations.length || deadlines.length || Object.keys(st.gauges).length || Object.keys(st.clocks).length))}
      <Module title="Threads & stakes" fold peek={threads.length ? `${threads.length} open` : ""}>
        {#if sec?.threads}
          {#each threads as t (t.id)}
            <div class="thread">
              <span class="st-chip {t.status === 'stalled' ? 'butter' : 'mint'}">{t.status}</span>
              <span class="ttl"><b>{t.title}</b>{#if t.latest}<span>&nbsp;— {t.latest}</span>{/if}</span>
              <span class="age st-lcd" title="Opened at message #{t.openedSeq}">{Math.max(0, lastSeq - t.openedSeq)} MSGS</span>
              <button class="done" type="button" onclick={() => trackerEdit(chatId, [`thread ${t.title}: resolve — closed by you`])} title="Mark resolved" aria-label="Resolve {t.title}"><Check size={13} /></button>
            </div>
          {/each}
          {#each plants as p (p.id)}<div class="plant"><Sprout size={13} /><span>{p.text}{p.payoff ? ` → ${p.payoff}` : ""}</span></div>{/each}
          {#if resolved.length}<p class="st-hint">{resolved.length} resolved</p>{/if}
        {/if}
        {#if sec?.stakes}
          {#each obligations as o (o.id)}
            <div class="thread two"><span class="st-chip {o.status === 'due' ? 'rose' : ''}">{o.kind === "promise" ? "promise" : "debt"}</span><span class="ttl">{nm(o.who)} → {nm(o.whom)}: {o.what}{o.due ? ` (due ${o.due.text})` : ""}</span></div>
          {/each}
          {#each deadlines as x (x.id)}<div class="thread two"><span class="st-chip butter">deadline</span><span class="ttl">{x.title}{x.text ? ` · ${x.text}` : ""}</span></div>{/each}
          {#each Object.values(st.gauges) as g (g.name)}
            {@const hot = g.cur >= g.max - 1}
            <div class="gauge">
              <span>{g.name}</span>
              {#if g.max <= 12}
                <span class="gcells" aria-hidden="true">{#each Array(g.max) as _, i (i)}<i class:on={i < g.cur} class:hot={hot && i < g.cur}></i>{/each}</span>
              {:else}
                <span class="gbar" aria-hidden="true"><i class:hot style:width="{(g.cur / g.max) * 100}%"></i></span>
              {/if}
              <output class="st-lcd">{g.cur}/{g.max}</output>
            </div>
          {/each}
          {#each Object.values(st.clocks) as k (`${k.faction}:${k.name}`)}
            <div class="fclock">
              <svg viewBox="0 0 34 34" role="img" aria-label="{k.cur} of {k.max}">{#each pie(k.cur, k.max) as s, i (i)}<path class:on={s.on} d={s.d} />{/each}</svg>
              <span><Landmark size={12} /> <b>{k.faction}</b> · {k.name}</span>
            </div>
          {/each}
        {/if}
      </Module>
    {/if}

    {#if sec?.knowledge && facts.length}
      <Module title="Knowledge" fold open={false} peek="{facts.length} fact{facts.length === 1 ? '' : 's'}">
        {#each facts.slice(0, 20) as f (f.key)}
          {@const op = offpageFor(`tracker:${f.key}`)}
          <div class="fact">
            <div>
              {#if f.secret}<ShieldAlert size={12} class="secret" />{/if}
              {#if op}<span class="lock" title="Kept off the page">🔒</span>{/if}
              {f.statement}{f.truth !== "true" ? ` (${f.truth})` : ""}
              {#if f.secret}<button class="st-link" type="button" onclick={() => (op ? editOffpage(op) : editOffpage(null, { label: f.statement, ref: `tracker:${f.key}` }))}>{op ? "Edit · reveal" : "Keep off the page"}</button>{/if}
            </div>
            <small>{Object.entries(f.stances).map(([id, s]) => `${nm(id)} ${s.status}`).join(" · ")}</small>
          </div>
        {/each}
      </Module>
    {/if}

    {#if sec?.items && items.length}
      <Module title="Things" fold open={false} peek={String(items.length)}>
        {#each items as i (i.id)}<div class="listrow"><span>{i.name}{i.condition ? ` (${i.condition})` : ""}</span><small>{nm(i.holder)}{i.owner && i.owner !== i.holder ? ` · ${nm(i.owner)}'s` : ""}{i.gift ? ` · gift from ${i.gift}` : ""}</small></div>{/each}
      </Module>
    {/if}

    {#if sec?.calendar || (sec?.motifs && (Object.keys(st.motifs).length || st.milestones.length))}
      <Module title="Calendar & moments" fold open={false} peek={String(Object.keys(st.calendar).length + Math.min(6, st.milestones.length) + Object.keys(st.motifs).length)}>
        {#each Object.values(st.calendar) as e (e.id)}<div class="listrow ic"><Calendar size={13} /><span>{e.title}</span><small>{e.when}</small></div>{/each}
        {#if sec?.calendar}
          {#if addingDay}
            <form class="addday" onsubmit={(e) => (e.preventDefault(), void addDay())}>
              <input class="input" bind:value={dayForm.title} placeholder="Mira's birthday" maxlength="80" aria-label="What" />
              <input class="input" bind:value={dayForm.when} placeholder="19 January" maxlength="60" aria-label="Day" />
              <select class="select" bind:value={dayForm.kind} aria-label="Kind"><option value="birthday">Birthday</option><option value="holiday">Feast or holiday</option><option value="anniversary">Anniversary</option><option value="appointment">Appointment</option></select>
              <button class="st-key" type="submit" disabled={!dayForm.title.trim() || !dayForm.when.trim()}>Add</button>
            </form>
          {:else}
            <div class="st-keys"><button class="st-key" type="button" onclick={() => (addingDay = true)}><Calendar size={14} /> Add a day</button></div>
          {/if}
        {/if}
        {#each st.milestones.slice(-6) as m, i (i)}<div class="listrow ic"><Star size={13} /><span>{m.text}</span><small>{m.at ? readClock(m.at, d.config.calendar) : ""}</small></div>{/each}
        {#each Object.values(st.motifs) as m (m.id)}<div class="listrow ic"><Repeat size={13} /><span>{m.text}</span><small>×{m.uses}</small></div>{/each}
      </Module>
    {/if}

    <PromisesPanel {chatId} />
    <LessonsPanel {chatId} />
    <OffpagePanel />

    {#if sec?.custom}
      {#each d.templates as t (t.id)}
        {@const vals = st.custom[t.key] ?? {}}
        <Module title={t.name} fold peek="custom tracker">
          {#each t.schema.fields as f (f.key)}
            {@const path = `${t.key}.${f.key}`}
            {#if f.visibility !== "hidden"}
              {#if f.type === "table"}
                <p class="st-k sub">{f.label}</p>
                {#each rows(vals[f.key]) as r (String(r[keyOf(f)]))}
                  <div class="listrow"><b>{String(r[keyOf(f)])}</b><small>{(f.fields ?? []).filter((s) => s.key !== keyOf(f) && r[s.key] != null && r[s.key] !== "").map((s) => `${s.label.toLowerCase()} ${fmt(s, r[s.key])}`).join(" · ")}</small></div>
                {:else}<p class="st-hint first">none yet</p>{/each}
              {:else if f.type === "meter" || f.type === "number"}
                {@const v = Number(vals[f.key] ?? 0)}
                <div class="kv num">
                  <span>{f.label}</span>
                  <span class="numrow">
                    {#if f.type === "meter"}<span class="gbar" aria-hidden="true"><i style:width="{Math.max(0, Math.min(100, v))}%"></i></span>{/if}
                    {#if editing === path}
                      <!-- svelte-ignore a11y_autofocus -->
                      <input class="val n" type="number" autofocus bind:value={draft} onkeydown={(e) => e.key === "Enter" && save(`set ${path}: ${draft}`)} onblur={() => save(draft !== "" ? `set ${path}: ${draft}` : null)} />
                    {:else}
                      <button class="val n" type="button" onclick={() => start(path, vals[f.key])}>{vals[f.key] ?? "—"}</button>
                    {/if}
                  </span>
                  {@render lock(path, f.label)}
                </div>
              {:else}
                <div class="kv">
                  <span>{f.label}</span>
                  {#if editing === path}
                    {#if f.type === "enum"}
                      <select class="val" bind:value={draft} onchange={() => save(`set ${path}: ${draft}`)} onblur={() => (editing = null)}>
                        {#each f.options ?? [] as o (o)}<option value={o}>{o}</option>{/each}
                      </select>
                    {:else}
                      <!-- svelte-ignore a11y_autofocus -->
                      <input class="val" autofocus bind:value={draft} onkeydown={(e) => e.key === "Enter" && save(`set ${path}: ${draft}`)} onblur={() => save(`set ${path}: ${draft}`)} />
                    {/if}
                  {:else}
                    <button class="val" class:spoiler={f.spoiler && !revealed[path]} type="button" onclick={() => (f.spoiler && !revealed[path] ? (revealed[path] = true) : start(path, vals[f.key]))}>{fmt(f, vals[f.key])}</button>
                  {/if}
                  {@render lock(path, f.label)}
                </div>
              {/if}
            {/if}
          {/each}
        </Module>
      {/each}
    {/if}
  </div>
{/if}

<TrackerSettings bind:open={settingsOpen} {chatId} />

<style>
  .addday {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    margin-top: 6px;
  }
  .first {
    margin-top: 0;
  }
  .clock {
    font-size: calc(12px * var(--st-lcd-k));
  }
  .basenote {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
  }

  /* the scene monitor */
  .window {
    overflow: hidden;
    margin-bottom: 10px;
    padding: 4px;
    border-radius: var(--r-sm);
    background: var(--surface);
    box-shadow: inset 0 0 0 var(--st-bw) var(--st-edge), var(--st-inset-sm);
  }
  .kvs {
    display: grid;
    gap: 6px;
  }
  .strip .kvs {
    margin-top: 10px;
  }
  .kv {
    display: grid;
    grid-template-columns: 62px minmax(0, 1fr) 26px;
    align-items: center;
    gap: 8px;
  }
  .kv > span:first-child {
    font: 700 9.5px/1.2 var(--st-meta);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-faint);
    overflow-wrap: anywhere;
  }
  .val {
    min-width: 0;
    width: 100%;
    padding: 6px 9px;
    border: 0;
    border-radius: var(--r-sm);
    background: var(--st-well);
    box-shadow: var(--st-inset-sm);
    color: var(--text);
    text-align: left;
    font: 600 12.5px/1.3 var(--font-ui);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: text;
  }
  .val:hover {
    box-shadow: inset 0 1px 3px rgb(0 0 0 / 12%), inset 0 0 0 1px var(--accent);
  }
  input.val,
  select.val {
    outline: none;
    box-shadow: inset 0 0 0 1.5px var(--accent);
    cursor: auto;
  }
  .val.spoiler {
    filter: blur(5px);
    user-select: none;
    cursor: pointer;
  }
  .val.n {
    width: auto;
    min-width: 3.4rem;
    text-align: center;
  }
  .num .numrow {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .lk {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border: var(--st-bw) solid var(--st-edge);
    border-radius: 6px;
    background: var(--surface);
    color: var(--text-faint);
    box-shadow: 0 1.5px 0 var(--border-strong);
    cursor: pointer;
  }
  .lk.on {
    color: var(--accent-ink);
    background: color-mix(in srgb, var(--accent) 16%, var(--surface));
    border-color: var(--accent);
  }
  .scene-meta {
    margin: 8px 2px 0;
    font: italic 12.5px/1.3 var(--st-story);
    color: var(--text-muted);
  }

  /* people as channel strips */
  .strip {
    padding: 12px;
    border-radius: var(--r-sm);
    background: var(--st-well);
    box-shadow: inset 0 0 0 var(--st-bw) var(--st-edge);
  }
  .strip + .strip {
    margin-top: 8px;
  }
  .strip-h {
    display: grid;
    grid-template-columns: 34px minmax(0, 1fr);
    align-items: center;
    gap: 10px;
  }
  .ava {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border-radius: 50%;
    background: var(--st-grad);
    color: var(--on-accent);
    font: 800 12px/1 var(--font-ui);
    box-shadow:
      0 0 0 2px var(--surface),
      0 0 0 3px var(--st-edge);
  }
  .ava.you {
    background: var(--st-cool);
    color: var(--surface);
  }
  .who {
    min-width: 0;
  }
  .who b {
    display: block;
    font: 600 calc(16px * var(--st-hs)) / 1.1 var(--st-head);
  }
  .who small {
    display: block;
    margin-top: 2px;
    font-size: 11.5px;
    color: var(--text-faint);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meters {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
    gap: 6px 14px;
    margin-top: 10px;
  }
  .lm {
    display: grid;
    grid-template-columns: 62px minmax(0, 1fr) auto;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--text-muted);
  }
  .lm-n {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cells {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 2px;
  }
  .cells i {
    height: 8px;
    border-radius: 1.5px;
    background: color-mix(in srgb, var(--text) 10%, transparent);
  }
  .cells i.on {
    background: var(--ok);
    box-shadow: 0 0 6px -1px var(--ok);
  }
  .lm.mid .cells i.on {
    background: var(--st-warm);
    box-shadow: 0 0 6px -1px var(--st-warm);
  }
  .lm.bad .cells i.on {
    background: var(--danger);
    box-shadow: 0 0 6px -1px var(--danger);
  }
  .pm {
    display: flex;
    gap: 1px;
    opacity: 0.2;
    transition: opacity 0.15s;
  }
  .lm:hover .pm,
  .lm:focus-within .pm {
    opacity: 1;
  }
  .pm button {
    width: 16px;
    height: 16px;
    padding: 0;
    border: 0;
    border-radius: 3px;
    background: var(--st-fill-2);
    color: var(--text-muted);
    font-size: 11px;
    line-height: 1;
    cursor: pointer;
  }
  .pm button:hover {
    color: var(--text);
    background: color-mix(in srgb, var(--accent) 25%, transparent);
  }
  .tags {
    margin-top: 10px;
  }
  .lines {
    display: grid;
    gap: 4px;
    margin-top: 10px;
    font-size: 12px;
    line-height: 1.4;
  }
  .lines .k {
    font-weight: 700;
    color: var(--text-muted);
  }
  .thought {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    width: 100%;
    margin-top: 10px;
    padding: 8px 10px;
    border: 1px dashed var(--border-strong);
    border-radius: var(--r-sm);
    background: none;
    color: var(--text);
    text-align: left;
    font: italic 12.5px/1.4 var(--st-story);
    cursor: pointer;
  }
  .thought :global(svg) {
    flex: 0 0 auto;
    margin-top: 2px;
    color: var(--accent-ink);
  }
  .thought.blur span {
    filter: blur(5px);
    user-select: none;
  }
  .away {
    margin: 8px 2px 0;
    font-size: 11.5px;
    color: var(--text-faint);
  }

  /* bonds */
  .bond {
    padding: 10px 12px;
    border-radius: var(--r-sm);
    background: var(--st-well);
    box-shadow: inset 0 0 0 var(--st-bw) var(--st-edge);
  }
  .bond + .bond {
    margin-top: 8px;
  }
  .bond-h {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    font-size: 12.5px;
  }
  .bond-h > span {
    flex: 0 0 auto;
  }
  .bond-h em {
    min-width: 0;
    font: italic 12px/1.3 var(--st-story);
    color: var(--text-faint);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .axes {
    display: grid;
    gap: 5px;
    margin-top: 8px;
  }
  .axis {
    display: grid;
    grid-template-columns: 64px minmax(0, 1fr) 26px;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    color: var(--text-muted);
  }
  .abar {
    position: relative;
    height: 8px;
    border-radius: 4px;
    background: color-mix(in srgb, var(--text) 9%, transparent);
  }
  .abar.bi::before {
    content: "";
    position: absolute;
    left: 50%;
    top: -3px;
    bottom: -3px;
    width: 1.5px;
    margin-left: -0.75px;
    background: var(--border-strong);
  }
  .afill {
    position: absolute;
    top: 0;
    bottom: 0;
    border-radius: 4px;
    background: var(--ok);
  }
  .afill.neg {
    background: var(--danger);
  }
  .axis output {
    text-align: right;
    font-size: calc(9.5px * var(--st-lcd-k));
    color: var(--text);
    text-shadow: none;
  }
  .ladder {
    margin-top: 10px;
  }
  .rungs {
    display: grid;
    grid-template-columns: repeat(8, 1fr);
    gap: 3px;
  }
  .rungs i {
    height: 14px;
    border-radius: 3px;
    background: color-mix(in srgb, var(--text) 9%, transparent);
  }
  .rungs i.on {
    background: var(--st-rose);
    box-shadow: 0 0 8px -2px var(--st-rose);
  }
  .rungs i.now {
    outline: 2px solid var(--st-rose);
    outline-offset: 1px;
  }
  .ladder p {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px;
    margin: 6px 0 0;
    font-size: 11.5px;
    color: var(--text-muted);
  }
  .ladder p b {
    color: var(--text);
  }
  .ladder p :global(svg) {
    color: var(--st-rose);
  }
  .ladder .rm {
    margin-left: auto;
  }
  .ladder .rm :global(svg) {
    color: var(--text-muted);
  }

  /* threads and stakes */
  .thread {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 8px;
    padding: 7px 0;
    border-bottom: 1px dashed var(--st-edge);
    font-size: 12.5px;
  }
  .thread.two {
    grid-template-columns: auto minmax(0, 1fr);
  }
  .ttl {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .ttl span {
    color: var(--text-muted);
  }
  .age {
    font-size: calc(9px * var(--st-lcd-k));
    color: var(--text-faint);
    white-space: nowrap;
    text-shadow: none;
  }
  .done {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: var(--st-bw) solid var(--st-edge);
    border-radius: 6px;
    background: var(--surface);
    color: var(--ok);
    box-shadow: 0 1.5px 0 var(--border-strong);
    cursor: pointer;
  }
  .plant {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 0;
    border-bottom: 1px dashed var(--st-edge);
    font-size: 12px;
    color: var(--text-muted);
  }
  .plant :global(svg) {
    flex: 0 0 auto;
    color: var(--ok);
  }
  .gauge {
    display: grid;
    grid-template-columns: minmax(0, 90px) minmax(0, 1fr) 40px;
    align-items: center;
    gap: 8px;
    margin-top: 9px;
    font-size: 11.5px;
    color: var(--text-muted);
  }
  .gcells {
    display: grid;
    grid-auto-columns: 1fr;
    grid-auto-flow: column;
    gap: 2px;
  }
  .gcells i {
    height: 10px;
    border-radius: 2px;
    background: color-mix(in srgb, var(--text) 10%, transparent);
  }
  .gcells i.on {
    background: var(--st-warm);
  }
  .gcells i.hot,
  .gbar i.hot {
    background: var(--danger);
    box-shadow: 0 0 6px -1px var(--danger);
  }
  .gbar {
    display: block;
    flex: 1;
    min-width: 0;
    height: 8px;
    overflow: hidden;
    border-radius: 4px;
    background: color-mix(in srgb, var(--text) 10%, transparent);
  }
  .gbar i {
    display: block;
    height: 100%;
    border-radius: 4px;
    background: var(--st-warm);
  }
  .gauge output {
    text-align: right;
    font-size: calc(9.5px * var(--st-lcd-k));
    color: var(--text);
    text-shadow: none;
  }
  .fclock {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 10px;
    font-size: 12px;
  }
  .fclock svg {
    flex: 0 0 auto;
    width: 34px;
    height: 34px;
  }
  .fclock path {
    fill: color-mix(in srgb, var(--text) 10%, transparent);
    stroke: var(--surface);
    stroke-width: 1.5;
  }
  .fclock path.on {
    fill: var(--st-cool);
  }

  /* knowledge, things, calendar */
  .fact {
    padding: 7px 0;
    border-bottom: 1px dashed var(--st-edge);
    font-size: 12.5px;
    line-height: 1.4;
  }
  .fact:last-child,
  .listrow:last-child,
  .thread:last-child {
    border-bottom: 0;
  }
  .fact :global(.secret) {
    color: var(--accent-ink);
    vertical-align: -1px;
  }
  .fact small {
    display: block;
    margin-top: 3px;
    font-size: 11px;
    color: var(--text-faint);
  }
  .listrow {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    padding: 6px 0;
    border-bottom: 1px dashed var(--st-edge);
    font-size: 12.5px;
  }
  .listrow.ic {
    grid-template-columns: auto minmax(0, 1fr) auto;
  }
  .listrow.ic :global(svg) {
    color: var(--text-faint);
  }
  .listrow small {
    max-width: 12rem;
    font-size: 11px;
    color: var(--text-faint);
    text-align: right;
  }
  .sub {
    margin: 10px 0 2px;
  }
</style>
