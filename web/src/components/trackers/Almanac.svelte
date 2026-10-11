<script lang="ts">
  import { calendarDef, customDay, loadCalendars, monthLength } from "../../lib/customcal.svelte";
  import SceneWindow from "./SceneWindow.svelte";
  import VeilCard from "./VeilCard.svelte";
  import { get } from "../../lib/api";
  import { living } from "../../lib/living";
  import { app, errorToast } from "../../lib/state.svelte";
  import { MONTH_NAMES, daysIn, ordinal, readClock, weekdayOf, ymdOf } from "../../lib/storytime";
  import { openTrackers, trk } from "../../lib/trackers.svelte";
  import { USER_COLOR, storyColors, voiceColor } from "../../lib/voices";
  import type { TrackerCharacter, TrackersResponse } from "../../lib/types";

  /**
   * The Almanac: everything the trackers remember, laid out as one cabinet, with a rewind that
   * shows the world as it stood at any earlier message.
   */
  let { chatId }: { chatId: string } = $props();

  $effect(() => {
    if (trk.chatId !== chatId) openTrackers(chatId);
  });

  let scrub = $state<number | null>(null);
  let snap = $state<TrackersResponse | null>(null);
  let timer: ReturnType<typeof setTimeout>;
  const max = $derived(trk.data?.maxSeq ?? 0);
  const live = $derived(scrub == null || scrub >= max);
  const d = $derived(live ? trk.data : (snap ?? trk.data));
  const st = $derived(d?.state);
  function onScrub() {
    clearTimeout(timer);
    if (live) return;
    timer = setTimeout(async () => {
      try {
        snap = await get<TrackersResponse>(`/api/chats/${chatId}/trackers?seq=${scrub}`);
      } catch (e) {
        errorToast(e);
      }
    }, 160);
  }

  const chars = $derived(st ? Object.values(st.chars) : []);
  const here = $derived(chars.filter((c) => (c.tier === "spot" || c.tier === "peri") && !c.dead).sort((a, b) => Number(a.isUser) - Number(b.isUser)));
  const away = $derived(chars.filter((c) => !here.includes(c) && !c.isUser));
  const user = $derived(chars.find((c) => c.isUser));
  const nameOf = (c: TrackerCharacter | undefined) => (!c ? "—" : c.isUser ? (d?.userName ?? "You") : c.name);
  const nm = (id: string | undefined) => (!id ? "—" : id.startsWith("place:") ? id.slice(6) : nameOf(st?.chars[id]) === "—" ? id : nameOf(st?.chars[id]));
  const colors = $derived(storyColors(d ?? null));
  const colorOf = (c: TrackerCharacter | undefined) => (!c ? "#8a7d9e" : (colors.get(nameOf(c).toLowerCase()) ?? voiceColor(nameOf(c), d?.profiles[c.name.toLowerCase()]?.color ?? (c.isUser ? USER_COLOR : null))));

  // ---------- people ----------
  const METERS: [keyof TrackerCharacter["meters"], string, string][] = [
    ["health", "health", "var(--mint, #82e3d3)"],
    ["fatigue", "fatigue", "var(--lavender, #c7b4ff)"],
    ["hunger", "hunger", "#ffd08f"],
    ["thirst", "thirst", "#9cc4ff"],
    ["pain", "pain", "#ff8a9a"],
    ["intox", "drink", "#ffb86b"],
    ["composure", "composure", "var(--mint, #82e3d3)"],
    ["stress", "stress", "#ff8a9a"],
    ["arousal", "arousal", "#ff9ec0"],
  ];
  const moodColor = (c: TrackerCharacter) => (c.mood?.v == null ? "#ffd08f" : c.mood.v > 0.2 ? "#82e3d3" : c.mood.v < -0.2 ? "#ff8a9a" : "#ffd08f");
  const breath = (c: TrackerCharacter) => `${Math.max(1.4, 4 - (c.mood?.a ?? 0.3) * 2.4)}s`;

  // ---------- bodies ----------
  let bodyOf = $state<string | null>(null);
  const hurt = $derived(chars.filter((c) => !c.dead && (c.injuries.length || c.conditions.length)));
  const body = $derived(hurt.find((c) => c.id === bodyOf) ?? hurt[0]);
  const SEV = ["", "#ffd08f", "#ffb86b", "#ff8a9a", "#ff4d6d"];
  const SEV_WORD = ["", "scratch", "wound", "serious", "critical"];
  function spot(where: string): [number, number] {
    const w = where.toLowerCase();
    const side = /\bleft\b/.test(w) ? -1 : /\bright\b/.test(w) ? 1 : 0;
    const x = (l: number, r: number) => (side < 0 ? l : side > 0 ? r : (l + r) / 2);
    if (/head|face|eye|cheek|jaw|brow|forehead|skull|temple|lip|mouth|nose|ear/.test(w)) return [60, 26];
    if (/neck|throat/.test(w)) return [60, 44];
    if (/shoulder/.test(w)) return [x(44, 76), 52];
    if (/hand|palm|wrist|finger|knuckle/.test(w)) return [x(28, 92), 122];
    if (/arm|elbow|bicep/.test(w)) return [x(33, 87), 88];
    if (/chest|rib|breast|heart|collar/.test(w)) return [60, 68];
    if (/stomach|belly|abdomen|gut|side|waist/.test(w)) return [x(54, 66), 92];
    if (/hip|groin/.test(w)) return [x(50, 70), 108];
    if (/knee/.test(w)) return [x(51, 69), 170];
    if (/foot|ankle|toe|heel/.test(w)) return [x(46, 74), 214];
    if (/thigh/.test(w)) return [x(52, 68), 138];
    if (/leg|shin|calf/.test(w)) return [x(50, 70), 190];
    if (/back|spine/.test(w)) return [60, 76];
    return [60, 84];
  }

  // ---------- bonds ----------
  const bonds = $derived(st ? Object.values(st.bonds) : []);
  const bondNodes = $derived.by(() => {
    const ids = [...new Set(bonds.flatMap((b) => [b.from, b.to]))].filter((id) => st?.chars[id]);
    const center = ids.find((id) => st!.chars[id]!.isMain && !st!.chars[id]!.isUser) ?? ids[0];
    const ring = ids.filter((id) => id !== center);
    const pos = new Map<string, [number, number]>();
    if (center) pos.set(center, [200, 125]);
    ring.forEach((id, i) => {
      // Offset by half a step so two or three people sit side by side, not stacked in a column.
      const a = (i / Math.max(1, ring.length)) * Math.PI * 2 - Math.PI / 2 + Math.PI / Math.max(1, ring.length);
      pos.set(id, [200 + Math.cos(a) * 150, 125 + Math.sin(a) * 92]);
    });
    return pos;
  });
  let bondSel = $state<string | null>(null);
  const selBond = $derived(bonds.find((b) => `${b.from}>${b.to}` === bondSel) ?? bonds.find((b) => st?.chars[b.to]?.isUser || st?.chars[b.from]?.isUser) ?? bonds[0]);
  const BI = new Set(["trust", "affection", "respect", "comfort"]);
  const edgeColor = (aff: number) => (aff >= 3 ? "#ff9ec0" : aff >= 1 ? "#c7b4ff" : aff <= -1 ? "#ff8a9a" : "#9cc4ff");

  // ---------- romance ----------
  const LADDER = ["Strangers", "Aware", "Interested", "Charged", "Tested", "Spoken", "Together", "Established"];
  const ladders = $derived(st ? Object.values(st.ladders) : []);
  let ladderSel = $state<string | null>(null);
  const ladder = $derived(ladders.find((l) => `${l.from}>${l.to}` === ladderSel) ?? [...ladders].sort((a, b) => b.tier - a.tier)[0]);

  // ---------- knowledge ----------
  const facts = $derived(st ? Object.values(st.facts).sort((a, b) => Number(Boolean(b.secret)) - Number(Boolean(a.secret)) || b.lastSeq - a.lastSeq).slice(0, 12) : []);
  const knowers = $derived(here.length ? here.slice(0, 5) : chars.slice(0, 5));

  // ---------- things, threads, stakes ----------
  const items = $derived(st ? Object.values(st.items).filter((i) => !i.gone) : []);
  const threads = $derived(st ? Object.values(st.threads).sort((a, b) => Number(a.status === "resolved") - Number(b.status === "resolved") || b.lastSeq - a.lastSeq).slice(0, 8) : []);
  const plants = $derived(st ? Object.values(st.plants).filter((p) => p.paidSeq == null) : []);
  const obligations = $derived(st ? Object.values(st.obligations).filter((o) => o.status === "open" || o.status === "due") : []);
  const deadlines = $derived(st ? Object.values(st.deadlines).filter((x) => !x.done) : []);
  function threadPath(i: number, tension: number) {
    let p = "M0 17";
    for (let x = 0; x <= 100; x += 4) p += ` L${x} ${17 + Math.sin(x / 7 + i) * tension * 9}`;
    return p;
  }
  function wedge(i: number, n: number) {
    const r = 26;
    const a0 = (i / n) * 6.283 - 1.571 + 0.05;
    const a1 = ((i + 1) / n) * 6.283 - 1.571 - 0.05;
    return `M33 33 L${33 + r * Math.cos(a0)} ${33 + r * Math.sin(a0)} A${r} ${r} 0 0 1 ${33 + r * Math.cos(a1)} ${33 + r * Math.sin(a1)}Z`;
  }

  // ---------- calendar ----------
  const when = $derived(d?.when ?? null);
  const westeros = $derived(when?.calendar === "westeros");
  // G1: a calendar you built draws its own month.
  $effect(() => {
    void loadCalendars();
  });
  const custom = $derived(calendarDef(when?.calendar));
  const month = $derived(when?.form === "date" && when.year != null && when.month != null ? { year: when.year, month: when.month, day: when.day ?? 1 } : null);
  const events = $derived(st ? Object.values(st.calendar).filter((e) => !e.done) : []);
  function eventDay(e: (typeof events)[number]): number | null {
    if (!month) return null;
    if (e.at != null) {
      const y = ymdOf(e.at);
      return y.year === month.year && y.month === month.month ? y.day : null;
    }
    const w = e.when.toLowerCase();
    if (custom) {
      const mi = custom.months.findIndex((x) => w.includes(x.name.toLowerCase()));
      const dd = w.match(/\b(\d{1,3})(?:st|nd|rd|th)?\b/);
      return mi + 1 === month.month && dd ? Number(dd[1]) : null;
    }
    let m = w.match(/(\d{1,2})(?:st|nd|rd|th)?\s+(?:day\s+)?of\s+the\s+(\d{1,2})(?:st|nd|rd|th)?\s+moon/);
    if (m) return Number(m[2]) === month.month ? Number(m[1]) : null;
    m = w.match(/^(?:\d{1,4}-)?(\d{2})-(\d{2})/);
    if (m) return Number(m[1]) === month.month ? Number(m[2]) : null;
    const idx = MONTH_NAMES.findIndex((n) => w.includes(n.toLowerCase().slice(0, 3)));
    const day = w.match(/\b(\d{1,2})(?:st|nd|rd|th)?\b/);
    return idx + 1 === month.month && day ? Number(day[1]) : null;
  }
  const grid = $derived.by(() => {
    if (!month) return [];
    const n = custom ? monthLength(custom, month.year, month.month) : daysIn(month.year, month.month);
    const lead = custom ? (custom.weekdays.length ? ((customDay(custom, month.year, month.month, 1) % custom.weekdays.length) + custom.weekdays.length) % custom.weekdays.length : 0) : westeros ? 0 : weekdayOf(month.year, month.month, 1);
    const cells: ({ day: number; evs: typeof events } | null)[] = Array.from({ length: lead }, () => null);
    for (let day = 1; day <= n; day++) cells.push({ day, evs: events.filter((e) => eventDay(e) === day) });
    return cells;
  });
  const EVC: Record<string, string> = { birthday: "#ff9ec0", anniversary: "#c7b4ff", holiday: "#82e3d3", appointment: "#ffd08f", plan: "#9cc4ff", recurring: "#ffb86b" };

  // ---------- motifs, you, custom, minds ----------
  const motifs = $derived(st ? Object.values(st.motifs).sort((a, b) => b.uses - a.uses).slice(0, 10) : []);
  const STICK = ["#ffd08f", "#82e3d3", "#c7b4ff", "#ff9ec0", "#9cc4ff", "#b6f08a"];
  const minds = $derived(here.filter((c) => !c.isUser && (c.mask?.felt || c.mask?.shown || c.thoughts || c.drives?.want || c.drives?.fear || c.journal?.length)));
  const sec = $derived(d?.config.sections);
</script>

{#if !d || !st}
  <p class="muted small">Loading the story state…</p>
{:else if d.config.mode === "off"}
  <p class="muted small">Trackers are off for this chat, so there's no almanac to show. Turn them on in the chat's story panel.</p>
{:else}
  <div class="almanac">
    {#if max > 1}
      <div class="rewind card">
        <div class="turn"><small>{live ? "Now" : "As it stood at"}</small>{live ? "The present" : `Message #${scrub}`}</div>
        <input type="range" min="1" max={max} value={scrub ?? max} oninput={(e) => ((scrub = Number(e.currentTarget.value)), onScrub())} aria-label="Rewind the almanac to an earlier message" />
        {#if !live}<button class="btn ghost small" onclick={() => (scrub = null)}>Back to now</button>{/if}
      </div>
    {/if}

    <div class="bento">
      {#if sec?.scene}
        <section class="tile card scene">
          <h3><span class="g">☾</span>Scene<span class="k">time · place · weather</span></h3>
          {#if living(app.settings).window}<SceneWindow shape="arch" {when} weather={st.weather?.now ?? null} place={st.place} />{/if}
          <div class="tags">
            {#if when}<span class="tag">{when.label}</span>{/if}
            {#if when?.season}<span class="tag">{when.season}</span>{/if}
            {#if st.mode}<span class="tag hot">mode · {st.mode}</span>{/if}
            <span class="tag">scene {st.sceneNo}{st.sceneTitle ? ` · ${st.sceneTitle}` : ""}</span>
            {#if st.weather?.prev}<span class="tag">was {st.weather.prev}</span>{/if}
          </div>
        </section>
      {/if}

      {#if sec?.cast}
        <section class="tile card people-t">
          <h3><span class="g">❀</span>People<span class="k">who's here and how they are</span></h3>
          <div class="people">
            {#each here as c (c.id)}
              <div class="person" style:--vc={colorOf(c)}>
                <div class="top"><span class="orb">{nameOf(c).slice(0, 1)}</span><div><b>{nameOf(c)}</b><span>{c.isUser ? "you" : (c.place?.split(" › ").at(-1) ?? "here")}</span></div></div>
                {#if c.isUser && d.config.sealed}
                  <div class="mood sealed-m">(your inner life is yours)</div>
                {:else if c.mood}
                  <div class="mood" style:--mc={moodColor(c)} style:--bp={breath(c)}><i></i>{c.mood.name}</div>
                {/if}
                {#if c.activity}<div class="doing">{c.activity}</div>{/if}
                {#if sec.body}
                  <div class="meters">
                    {#each METERS.filter(([k]) => c.meters[k] != null) as [k, label, col] (k)}
                      <div class="meter" style:--c={col}><span>{label}</span><span class="bar"><i style:width="{((c.meters[k] ?? 0) / 5) * 100}%"></i></span><span>{c.meters[k]}</span></div>
                    {/each}
                  </div>
                {/if}
              </div>
            {:else}
              <p class="muted small">Nobody is on the page right now.</p>
            {/each}
          </div>
          {#if away.length}<p class="tiny muted away">Elsewhere: {away.map((c) => `${c.name}${c.dead ? " †" : c.place ? ` (${c.place.split(" › ").at(-1)})` : ""}`).join(" · ")}</p>{/if}
        </section>
      {/if}

      {#if sec?.body && body}
        <section class="tile card bodies">
          <h3><span class="g">✚</span>Bodies<span class="k">wounds · conditions</span></h3>
          {#if hurt.length > 1}
            <div class="seg-row">{#each hurt as c (c.id)}<button class="chip" class:on={c.id === body.id} onclick={() => (bodyOf = c.id)}>{nameOf(c)}</button>{/each}</div>
          {/if}
          <div class="fig">
            <svg viewBox="0 0 120 230" aria-hidden="true">
              <g class="silhouette"><circle cx="60" cy="26" r="15" /><path d="M42 48 q18 -8 36 0 l6 58 q-24 8 -48 0z" /><path d="M42 50 l-12 54 l-4 20 l7 2 l9 -40z" /><path d="M78 50 l12 54 l4 20 l-7 2 l-9 -40z" /><path d="M45 106 l-3 66 l-2 46 h10 l5 -50 l5 -60z" /><path d="M75 106 l3 66 l2 46 h-10 l-5 -50 l-5 -60z" /></g>
              {#each body.injuries as w, i (i)}
                {@const [x, y] = spot(w.where)}
                <circle cx={x} cy={y} r={4 + w.severity * 2} fill={SEV[w.severity]} opacity=".25" class="wound" /><circle cx={x} cy={y} r="3.2" fill={SEV[w.severity]} />
              {/each}
            </svg>
            <div class="wlist">
              {#each body.injuries as w, i (i)}<div style:--wc={SEV[w.severity]}><b>{w.where}</b>{SEV_WORD[w.severity]}{w.treated ? " · treated" : " · untreated"}</div>{/each}
              {#each body.conditions as k (k.kind)}<div style:--wc="#c7b4ff"><b>{k.text}</b>{k.kind}</div>{/each}
            </div>
          </div>
        </section>
      {/if}

      {#if sec?.bonds && bonds.length}
        <section class="tile card bonds">
          <h3><span class="g">✦</span>Bonds<span class="k">tap a line</span></h3>
          <svg viewBox="0 0 400 250" class="web">
            {#each bonds as b (`${b.from}>${b.to}`)}
              {@const a = bondNodes.get(b.from)}
              {@const z = bondNodes.get(b.to)}
              {#if a && z}
                {@const mx = (a[0] + z[0]) / 2 + (z[1] - a[1]) * 0.15}
                {@const my = (a[1] + z[1]) / 2 - (z[0] - a[0]) * 0.15}
                {@const key = `${b.from}>${b.to}`}
                <g class="edge" class:on={selBond === b} role="button" tabindex="0" onclick={() => (bondSel = key)} onkeydown={(e) => e.key === "Enter" && (bondSel = key)} aria-label="{nm(b.from)} toward {nm(b.to)}">
                  <path d="M{a[0]} {a[1]}Q{mx} {my} {z[0]} {z[1]}" class="hit" />
                  <path d="M{a[0]} {a[1]}Q{mx} {my} {z[0]} {z[1]}" stroke={edgeColor(b.axes.affection ?? 0)} stroke-width={1 + Math.max(0, b.axes.trust ?? 0) * 0.9} stroke-dasharray={(b.axes.comfort ?? 0) < 0 ? "8 4" : undefined} />
                </g>
              {/if}
            {/each}
            {#each [...bondNodes] as [id, p] (id)}
              {@const c = st.chars[id]}
              <g class="node" class:gone={c?.dead || !(c?.tier === "spot" || c?.tier === "peri")}>
                <circle cx={p[0]} cy={p[1]} r="17" fill={colorOf(c)} />
                <text x={p[0]} y={p[1] + 6} text-anchor="middle" class="init">{nameOf(c).slice(0, 1)}</text>
                <text x={p[0]} y={p[1] + 33} text-anchor="middle" class="lbl">{nameOf(c).split(" ")[0]}{c?.dead ? " †" : ""}</text>
              </g>
            {/each}
          </svg>
          {#if selBond}
            <div class="bond-d">
              <div class="hd">{nm(selBond.from)} → {nm(selBond.to)}{#if selBond.label} · <i>{selBond.label}</i>{/if}</div>
              {#each Object.entries(selBond.axes).filter(([, v]) => v != null && v !== 0) as [axis, v] (axis)}
                {@const bi = BI.has(axis)}
                {@const val = v ?? 0}
                <div class="axis" style:--c={val < 0 ? "#ff8a9a" : axis === "attraction" ? "#ff9ec0" : axis === "fear" || axis === "resentment" || axis === "rivalry" ? "#ffb86b" : "#82e3d3"}>
                  <span>{axis}</span>
                  <span class="track" class:bi><i style:left={bi ? (val < 0 ? `${50 + val * 10}%` : "50%") : "0"} style:width={bi ? `${Math.abs(val) * 10}%` : `${val * 20}%`}></i></span>
                  <span>{val > 0 && bi ? "+" : ""}{val}</span>
                </div>
              {/each}
              {#if selBond.history.at(-1)}{@const h = selBond.history.at(-1)!}<div class="tiny muted">last: {h.axis} {h.delta > 0 ? "+" : ""}{h.delta}{h.cause ? ` — ${h.cause}` : ""}</div>{/if}
            </div>
          {/if}
        </section>
      {/if}

      {#if sec?.romance && ladder}
        <section class="tile card romance">
          <h3><span class="g">♡</span>Romance<span class="k">{d.config.romance}</span></h3>
          {#if ladders.length > 1}
            <select class="select small" value={`${ladder.from}>${ladder.to}`} onchange={(e) => (ladderSel = e.currentTarget.value)}>
              {#each ladders as l (`${l.from}>${l.to}`)}<option value={`${l.from}>${l.to}`}>{nm(l.from)} → {nm(l.to)}</option>{/each}
            </select>
          {:else}
            <div class="tiny muted">{nm(ladder.from)} → {nm(ladder.to)}</div>
          {/if}
          <div class="ladder">
            {#each [...LADDER.keys()].reverse() as i (i)}<div class="rung" class:past={i < ladder.tier} class:now={i === ladder.tier}>{LADDER[i]}</div>{/each}
          </div>
          {#if ladder.evidence}<p class="ev">{ladder.evidence}</p>{/if}
        </section>
      {/if}

      {#if sec?.knowledge && facts.length}
        <section class="tile card know-t">
          <h3><span class="g">◐</span>Knowledge<span class="k">who knows what</span></h3>
          <div class="scroll-x">
            <table class="know">
              <thead><tr><th>Fact</th>{#each knowers as c (c.id)}<th>{nameOf(c).split(" ")[0]}</th>{/each}</tr></thead>
              <tbody>
                {#each facts as f (f.key)}
                  <tr>
                    <td class="fact"><b>{f.secret ? "🔒 " : ""}{f.statement}</b><small>{f.truth === "true" ? "true" : f.truth === "false" ? "false" : f.truth === "partial" ? "partly true" : "unknown"}{f.secret?.keepers.length ? ` · kept by ${f.secret.keepers.map(nm).join(", ")}` : ""}</small></td>
                    {#each knowers as c (c.id)}{@const s = f.stances[c.id]?.status ?? "unaware"}<td><i class="ks {s}" title={s}></i></td>{/each}
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
          <div class="legend"><span><i class="ks knows"></i>knows</span><span><i class="ks believes"></i>believes</span><span><i class="ks suspects"></i>suspects</span><span><i class="ks doubts"></i>doubts</span><span><i class="ks wrong"></i>believes wrongly</span><span><i class="ks unaware"></i>unaware</span></div>
        </section>
      {/if}

      {#if sec?.items && items.length}
        <section class="tile card things">
          <h3><span class="g">⚿</span>Things<span class="k">who has what</span></h3>
          <div class="items">
            {#each items as i (i.id)}
              {@const planted = plants.some((p) => p.text.toLowerCase().includes(i.name.toLowerCase()))}
              <div class="item" class:gun={planted}><b>{i.name}</b><span>{nm(i.holder)}{i.owner && i.owner !== i.holder ? ` · ${nm(i.owner)}'s` : ""}{i.where ? ` · ${i.where}` : ""}</span>{#if i.condition}<span class="cond">{i.condition}</span>{/if}{#if i.gift}<span class="cond">a gift from {i.gift}</span>{/if}</div>
            {/each}
          </div>
        </section>
      {/if}

      {#if sec?.threads && (threads.length || plants.length)}
        <section class="tile card threads">
          <h3><span class="g">〰</span>Threads<span class="k">plots · planted guns</span></h3>
          <div class="loom">
            {#each threads as t, i (t.id)}
              {@const tension = t.status === "resolved" ? 0.15 : t.status === "stalled" ? 0.35 : Math.min(1, 0.45 + t.history.length * 0.08)}
              {@const c = t.status === "resolved" ? "#8a7d9e" : ["#ff9ec0", "#ffbf6b", "#9cc4ff", "#c7b4ff", "#82e3d3"][i % 5]}
              <div class="thread">
                <div class="nm"><b>{t.title}</b><span style:color={c}>{t.status}{t.latest ? ` · ${t.latest}` : ""}</span></div>
                <svg viewBox="0 0 100 34" preserveAspectRatio="none" aria-hidden="true"><path d={threadPath(i, tension)} stroke={c} stroke-width={1 + tension * 2} fill="none" vector-effect="non-scaling-stroke" />{#each t.history.slice(-6) as h, k (k)}{@const x = ((k + 1) / (Math.min(6, t.history.length) + 1)) * 100}<circle cx={x} cy={17 + Math.sin(x / 7 + i) * tension * 9} r="2.6" fill={c} vector-effect="non-scaling-stroke" />{/each}</svg>
              </div>
            {/each}
          </div>
          {#each plants as p (p.id)}<div class="plant">🌱 {p.text}<em>{st.sceneNo - p.scene <= 0 ? "planted this scene" : `planted ${st.sceneNo - p.scene} scene${st.sceneNo - p.scene === 1 ? "" : "s"} ago`} · not yet paid off</em></div>{/each}
        </section>
      {/if}

      {#if sec?.stakes && (obligations.length || deadlines.length || Object.keys(st.gauges).length || Object.keys(st.clocks).length)}
        <section class="tile card stakes">
          <h3><span class="g">⧗</span>Stakes<span class="k">gauges · clocks · debts</span></h3>
          {#each Object.values(st.gauges) as g (g.name)}
            <div class="gauge"><div class="row-b"><b>{g.name}</b><span class="tiny muted">{g.cur} / {g.max}{g.cause ? ` · ${g.cause}` : ""}</span></div><div class="cells" style:grid-template-columns="repeat({g.max}, 1fr)">{#each Array(g.max) as _, k (k)}<i class:on={k < g.cur}></i>{/each}</div></div>
          {/each}
          {#if Object.keys(st.clocks).length}
            <div class="clocks">
              {#each Object.values(st.clocks) as k (`${k.faction}:${k.name}`)}
                <div class="fclock">
                  <svg viewBox="0 0 66 66" aria-hidden="true">{#each Array(k.max) as _, i (i)}<path d={wedge(i, k.max)} class:on={i < k.cur} />{/each}<circle cx="33" cy="33" r="9" class="hub" /><text x="33" y="37" text-anchor="middle">{k.cur}/{k.max}</text></svg>
                  <div><b>{k.faction}</b><span class="tiny muted">{k.name}</span></div>
                </div>
              {/each}
            </div>
          {/if}
          {#each deadlines as x (x.id)}<div class="dl">⏰ {x.title}<span>{x.text}</span></div>{/each}
          {#each obligations as o (o.id)}<p class="oblig"><b>{o.kind === "promise" ? "Promised" : "Owed"}</b> {nm(o.who)}{o.whom ? ` → ${nm(o.whom)}` : ""}: {o.what}{o.due ? ` (due ${o.due.text})` : ""}</p>{/each}
        </section>
      {/if}

      {#if sec?.calendar && (month || events.length)}
        <section class="tile card cal-t">
          <h3><span class="g">◷</span>Calendar<span class="k">{month ? (custom ? `${custom.months[month.month - 1]?.name ?? ""} ${month.year}${custom.era.name ? ` ${custom.era.name}` : ""}` : westeros ? `${ordinal(month.month)} moon, ${month.year} AC` : `${MONTH_NAMES[month.month - 1]} ${month.year}`) : "dates"}</span></h3>
          {#if month}
            <div class="cal" class:moons={westeros || (custom && !custom.weekdays.length)} style:--cols={custom?.weekdays.length ? Math.min(custom.weekdays.length, 10) : undefined}>
              {#if custom}{#each custom.weekdays.slice(0, 10) as w (w)}<div class="dow">{w.slice(0, 2)}</div>{/each}{:else if !westeros}{#each ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"] as w (w)}<div class="dow">{w}</div>{/each}{/if}
              {#each grid as cell, i (i)}
                {#if cell}
                  <div class="d" class:today={cell.day === month.day} class:past={cell.day < month.day} title={cell.evs.map((e) => e.title).join(", ") || undefined}>
                    {cell.day}{#if cell.evs.length}<span class="ev">{#each cell.evs as e (e.id)}<i style:background={EVC[e.kind] ?? "#ffd08f"}></i>{/each}</span>{/if}
                  </div>
                {:else}<div></div>{/if}
              {/each}
            </div>
          {/if}
          <div class="cal-list">{#each events as e (e.id)}<span><i style:background={EVC[e.kind] ?? "#ffd08f"}></i>{e.when} · {e.title}{e.who.length ? ` (${e.who.map(nm).join(", ")})` : ""}</span>{/each}</div>
        </section>
      {/if}

      {#if sec?.motifs && (motifs.length || st.milestones.length)}
        <section class="tile card motifs">
          <h3><span class="g">✿</span>Running bits<span class="k">jokes · names · firsts</span></h3>
          <div class="stickers">{#each motifs as m, i (m.id)}<span class="sticker" style:--c={STICK[i % STICK.length]} style:--r="{((i * 37) % 7) - 3}deg">{m.text}<sup>×{m.uses}</sup>{#if m.who}<small>{m.who}</small>{/if}</span>{/each}</div>
          {#if st.milestones.length}<div class="miles">{#each st.milestones.slice(-6) as m, i (i)}<div>{m.text}{#if m.at}<span>{readClock(m.at, d.config.calendar)}</span>{/if}</div>{/each}</div>{/if}
        </section>
      {/if}

      {#if sec?.persona && user}
        <section class="tile card you">
          <h3><span class="g">☉</span>{d.userName}<span class="k">your character</span></h3>
          <div class="you-g">
            <div class="box"><h5>Wearing</h5><p>{user.look ?? "—"}</p></div>
            <div class="box"><h5>Carrying</h5><p>{items.filter((i) => i.holder === user.id).map((i) => i.name).join(", ") || "—"}</p></div>
            {#if user.injuries.length}<div class="box"><h5>Hurt</h5><p>{user.injuries.map((w) => `${w.where} (${SEV_WORD[w.severity]})`).join(", ")}</p></div>{/if}
            {#if d.config.sealed}<div class="sealed"><span aria-hidden="true">🔏</span><p><b>Inner life sealed</b>Your mood and thoughts are yours. The trackers keep your clothes, wounds and pockets, never what you feel.</p></div>{/if}
          </div>
        </section>
      {/if}

      {#if sec?.custom}
        {#each d.templates as t (t.id)}
          {@const vals = st.custom[t.key] ?? {}}
          <section class="tile card custom">
            <h3><span class="g">⚙</span>{t.name}<span class="k">your tracker</span></h3>
            <div class="log">{#each t.schema.fields.filter((f) => f.visibility !== "hidden" && f.type !== "table") as f (f.key)}<div><span>{f.label}</span><b>{vals[f.key] == null || vals[f.key] === "" ? "—" : String(vals[f.key])}</b></div>{/each}</div>
          </section>
        {/each}
      {/if}
    </div>

    {#if minds.length && living(app.settings).thoughts !== "never"}
      <h2 class="veil-h">The Veil <span>what they show, what they feel, what they don't say</span></h2>
      <div class="minds">{#each minds as c (c.id)}<VeilCard char={c} color={colorOf(c)} calendar={d.config.calendar} />{/each}</div>
    {/if}
  </div>
{/if}

<style>
  .almanac {
    display: grid;
    gap: 1rem;
  }
  .rewind {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 1rem;
    align-items: center;
    padding: 0.7rem 1rem;
  }
  .turn {
    font: 400 1.4rem/1 "Instrument Serif", Georgia, serif;
    min-width: 8rem;
  }
  .turn small {
    display: block;
    font: 700 0.6rem var(--font-ui);
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .rewind input {
    width: 100%;
    accent-color: var(--accent);
  }
  .bento {
    display: grid;
    grid-template-columns: repeat(12, minmax(0, 1fr));
    gap: 0.9rem;
    grid-auto-flow: dense;
  }
  .tile {
    padding: 1rem;
    min-width: 0;
    grid-column: span 6;
  }
  .scene {
    grid-column: span 7;
  }
  .people-t {
    grid-column: span 5;
  }
  .know-t,
  .threads {
    grid-column: span 7;
  }
  .stakes,
  .things {
    grid-column: span 5;
  }
  .romance,
  .custom {
    grid-column: span 4;
  }
  .bonds {
    grid-column: span 8;
  }
  @media (max-width: 1100px) {
    .bento > .tile {
      grid-column: span 6;
    }
    .bento > .scene,
    .bento > .know-t {
      grid-column: span 12;
    }
  }
  @media (max-width: 720px) {
    .bento > .tile {
      grid-column: span 12;
    }
    .rewind {
      grid-template-columns: 1fr;
    }
  }
  h3 {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    margin: 0 0 0.75rem;
    font: 400 1.35rem/1 "Instrument Serif", Georgia, serif;
  }
  .g {
    width: 1.7rem;
    height: 1.7rem;
    border-radius: 0.55rem;
    display: grid;
    place-items: center;
    font-size: 0.9rem;
    background: var(--surface-2);
  }
  .k {
    margin-left: auto;
    font: 800 0.58rem var(--font-ui);
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin-top: 0.8rem;
  }
  .tag {
    padding: 0.2rem 0.6rem;
    border-radius: 999px;
    font: 700 0.7rem var(--font-ui);
    background: var(--surface-2);
    border: 1px solid var(--border);
    color: var(--text-muted);
  }
  .tag.hot {
    color: var(--accent-ink);
    border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
  }
  .people {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
    gap: 0.6rem;
  }
  .person {
    padding: 0.7rem;
    border-radius: 16px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    display: grid;
    gap: 0.4rem;
    align-content: start;
  }
  .top {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }
  .top b {
    display: block;
    font-size: 0.85rem;
  }
  .top span:not(.orb) {
    font-size: 0.7rem;
    color: var(--text-muted);
  }
  .orb {
    width: 1.8rem;
    height: 1.8rem;
    border-radius: 50%;
    flex: none;
    display: grid;
    place-items: center;
    font: 400 1rem "Instrument Serif", Georgia, serif;
    color: #0e0a18;
    background: radial-gradient(circle at 30% 26%, #fffa, transparent 34%), var(--vc);
  }
  .mood {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font: italic 0.9rem var(--font-story);
  }
  .mood i {
    width: 0.8rem;
    height: 0.8rem;
    border-radius: 50%;
    flex: none;
    background: var(--mc);
    box-shadow: 0 0 0 3px color-mix(in oklab, var(--mc) 25%, transparent), 0 0 14px var(--mc);
    animation: breathe var(--bp) ease-in-out infinite;
  }
  .sealed-m {
    color: var(--text-muted);
    font-size: 0.8rem;
  }
  @keyframes breathe {
    50% {
      transform: scale(1.35);
      opacity: 0.75;
    }
  }
  .doing {
    font-size: 0.75rem;
    color: var(--text-muted);
  }
  .meters {
    display: grid;
    gap: 0.2rem;
  }
  .meter {
    display: grid;
    grid-template-columns: 4.2rem 1fr 1rem;
    gap: 0.4rem;
    align-items: center;
    font-size: 0.65rem;
    color: var(--text-muted);
  }
  .bar {
    height: 5px;
    border-radius: 9px;
    background: var(--border);
    overflow: hidden;
  }
  .bar i {
    display: block;
    height: 100%;
    border-radius: 9px;
    background: var(--c);
    transition: width 0.8s ease;
  }
  .away {
    margin: 0.6rem 0 0;
  }
  .seg-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    margin-bottom: 0.5rem;
  }
  .chip.on {
    background: var(--text);
    color: var(--bg);
  }
  .fig {
    display: grid;
    grid-template-columns: 7.5rem 1fr;
    gap: 0.8rem;
    align-items: center;
  }
  .fig svg {
    width: 100%;
    height: 13rem;
  }
  .silhouette {
    fill: color-mix(in srgb, var(--text) 10%, transparent);
    stroke: color-mix(in srgb, var(--text) 25%, transparent);
    stroke-width: 1.2;
  }
  .wound {
    animation: pulse 2.2s ease-in-out infinite;
    transform-box: fill-box;
    transform-origin: center;
  }
  @keyframes pulse {
    50% {
      opacity: 0.45;
      transform: scale(1.5);
    }
  }
  .wlist {
    display: grid;
    gap: 0.4rem;
    font-size: 0.75rem;
    color: var(--text-muted);
  }
  .wlist div {
    padding: 0.4rem 0.6rem;
    border-radius: 10px;
    background: var(--surface-2);
    border-left: 3px solid var(--wc);
  }
  .wlist b {
    display: block;
    color: var(--text);
    font-size: 0.8rem;
  }
  .web {
    width: 100%;
    height: auto;
    max-height: 16rem;
    overflow: visible;
  }
  .edge {
    cursor: pointer;
    opacity: 0.55;
    outline: none;
  }
  .edge.on,
  .edge:hover,
  .edge:focus-visible {
    opacity: 1;
  }
  .edge path {
    fill: none;
    stroke-linecap: round;
  }
  .edge .hit {
    stroke: transparent;
    stroke-width: 16;
  }
  .node.gone {
    opacity: 0.45;
  }
  .init {
    font: 400 16px "Instrument Serif", Georgia, serif;
    fill: #0e0a18;
  }
  .lbl {
    font: 700 11px var(--font-ui);
    fill: var(--text-muted);
  }
  .bond-d {
    display: grid;
    gap: 0.3rem;
    padding: 0.6rem 0.8rem;
    border-radius: 14px;
    background: var(--surface-2);
    margin-top: 0.5rem;
  }
  .bond-d .hd {
    font: 400 1.05rem "Instrument Serif", Georgia, serif;
  }
  .axis {
    display: grid;
    grid-template-columns: 5rem 1fr 1.6rem;
    gap: 0.5rem;
    align-items: center;
    font-size: 0.7rem;
    color: var(--text-muted);
  }
  .track {
    position: relative;
    height: 6px;
    border-radius: 9px;
    background: var(--border);
  }
  .track.bi::before {
    content: "";
    position: absolute;
    left: 50%;
    top: -3px;
    bottom: -3px;
    width: 1px;
    background: var(--text-muted);
  }
  .track i {
    position: absolute;
    top: 0;
    bottom: 0;
    border-radius: 9px;
    background: var(--c);
  }
  .ladder {
    display: grid;
    gap: 0.2rem;
    margin-top: 0.5rem;
  }
  .rung {
    display: grid;
    grid-template-columns: 1rem 1fr;
    gap: 0.5rem;
    align-items: center;
    padding: 0.3rem 0.6rem;
    border-radius: 10px;
    font-size: 0.8rem;
    color: var(--text-muted);
    opacity: 0.55;
  }
  .rung::before {
    content: "";
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 50%;
    border: 1.5px solid currentColor;
    justify-self: center;
  }
  .rung.past {
    opacity: 1;
  }
  .rung.past::before {
    background: currentColor;
  }
  .rung.now {
    opacity: 1;
    color: #0e0a18;
    font-weight: 800;
    background: linear-gradient(135deg, #ffd08f, #ff9ec0);
    box-shadow: 0 8px 24px -8px #ff9ec0aa;
  }
  .ev {
    margin: 0.6rem 0 0;
    font: italic 0.85rem/1.4 var(--font-story);
    color: var(--text-muted);
    border-left: 2px solid #ff9ec0;
    padding-left: 0.6rem;
  }
  .scroll-x {
    overflow-x: auto;
  }
  .know {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0 4px;
    font-size: 0.8rem;
  }
  .know th {
    font: 800 0.58rem var(--font-ui);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-muted);
    padding: 0 0.3rem 0.2rem;
    text-align: center;
  }
  .know th:first-child,
  .know td:first-child {
    text-align: left;
  }
  .know td {
    padding: 0.45rem 0.35rem;
    background: var(--surface-2);
    text-align: center;
  }
  .know td:first-child {
    border-radius: 10px 0 0 10px;
    padding-left: 0.7rem;
  }
  .know td:last-child {
    border-radius: 0 10px 10px 0;
  }
  .fact b {
    font-weight: 600;
  }
  .fact small {
    display: block;
    color: var(--text-muted);
    font-size: 0.65rem;
  }
  .ks {
    display: inline-block;
    width: 1rem;
    height: 1rem;
    border-radius: 50%;
    position: relative;
    vertical-align: middle;
  }
  .ks.knows {
    background: #82e3d3;
    box-shadow: 0 0 10px #82e3d388;
  }
  .ks.believes {
    background: conic-gradient(#82e3d3 0 75%, transparent 0);
    border: 1.5px solid #82e3d3;
  }
  .ks.suspects {
    background: conic-gradient(#ffd08f 0 50%, transparent 0);
    border: 1.5px solid #ffd08f;
  }
  .ks.doubts {
    background: conic-gradient(#c7b4ff 0 25%, transparent 0);
    border: 1.5px solid #c7b4ff;
  }
  .ks.wrong {
    border: 2px solid #ff8a9a;
  }
  .ks.wrong::after {
    content: "";
    position: absolute;
    inset: 40% -2px;
    background: #ff8a9a;
    rotate: -45deg;
    border-radius: 2px;
  }
  .ks.unaware {
    border: 1.5px dashed var(--text-muted);
    opacity: 0.6;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 0.7rem;
    font-size: 0.68rem;
    color: var(--text-muted);
    margin-top: 0.5rem;
  }
  .legend span {
    display: inline-flex;
    gap: 0.35rem;
    align-items: center;
  }
  .legend .ks {
    width: 0.7rem;
    height: 0.7rem;
  }
  .items {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr));
    gap: 0.5rem;
  }
  .item {
    padding: 0.6rem 0.7rem;
    border-radius: 14px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    display: grid;
    gap: 0.15rem;
    position: relative;
    overflow: hidden;
  }
  .item b {
    font-size: 0.82rem;
  }
  .item span {
    font-size: 0.7rem;
    color: var(--text-muted);
  }
  .item .cond {
    font: italic 0.78rem var(--font-story);
    color: color-mix(in srgb, #ffd08f 70%, var(--text));
  }
  .item.gun::after {
    content: "planted";
    position: absolute;
    top: 0.5rem;
    right: -1.6rem;
    rotate: 35deg;
    padding: 1px 1.6rem;
    font: 800 0.5rem var(--font-ui);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    background: #ff8a9a;
    color: #0e0a18;
  }
  .loom {
    display: grid;
    gap: 0.7rem;
  }
  .thread {
    display: grid;
    grid-template-columns: minmax(7rem, 11rem) 1fr;
    gap: 0.7rem;
    align-items: center;
  }
  .thread .nm b {
    display: block;
    font-size: 0.82rem;
  }
  .thread .nm span {
    font-size: 0.66rem;
    font-weight: 700;
  }
  .thread svg {
    width: 100%;
    height: 2rem;
    overflow: visible;
  }
  .plant {
    display: flex;
    gap: 0.6rem;
    align-items: center;
    flex-wrap: wrap;
    font-size: 0.8rem;
    padding: 0.45rem 0.7rem;
    border-radius: 12px;
    margin-top: 0.4rem;
    background: repeating-linear-gradient(-45deg, #ff8a9a10 0 8px, transparent 8px 16px);
    border: 1px dashed #ff8a9a55;
  }
  .plant em {
    margin-left: auto;
    font-style: normal;
    color: #ff8a9a;
    font-size: 0.68rem;
    font-weight: 700;
  }
  .gauge {
    display: grid;
    gap: 0.25rem;
    margin-bottom: 0.6rem;
  }
  .row-b {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    font-size: 0.8rem;
  }
  .cells {
    display: grid;
    gap: 3px;
  }
  .cells i {
    height: 0.8rem;
    border-radius: 4px;
    background: var(--border);
  }
  .cells i.on {
    background: #ffd08f;
    box-shadow: 0 0 8px #ffd08f66;
  }
  .clocks {
    display: flex;
    flex-wrap: wrap;
    gap: 0.8rem;
    margin: 0.3rem 0 0.6rem;
  }
  .fclock {
    display: grid;
    grid-template-columns: 3.6rem 1fr;
    gap: 0.5rem;
    align-items: center;
    font-size: 0.78rem;
    flex: 1 1 11rem;
  }
  .fclock b {
    display: block;
  }
  .fclock svg {
    width: 3.6rem;
    height: 3.6rem;
  }
  .fclock path {
    fill: var(--border);
  }
  .fclock path.on {
    fill: #ff8a9a;
  }
  .fclock .hub {
    fill: var(--surface);
  }
  .fclock text {
    font: 400 12px "Instrument Serif", Georgia, serif;
    fill: var(--text);
  }
  .dl {
    display: flex;
    gap: 0.5rem;
    padding: 0.45rem 0.7rem;
    border-radius: 12px;
    background: var(--surface-2);
    font-size: 0.8rem;
    margin-bottom: 0.3rem;
  }
  .dl span {
    margin-left: auto;
    color: color-mix(in srgb, #ffd08f 70%, var(--text));
    font-size: 0.75rem;
  }
  .oblig {
    margin: 0.35rem 0 0;
    font: italic 0.88rem/1.4 var(--font-story);
    color: var(--text-muted);
  }
  .oblig b {
    font: 700 0.75rem var(--font-ui);
    font-style: normal;
    color: var(--text);
  }
  .cal {
    display: grid;
    grid-template-columns: repeat(var(--cols, 7), 1fr);
    gap: 0.3rem;
  }
  .dow {
    font: 800 0.55rem var(--font-ui);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-muted);
    text-align: center;
  }
  .d {
    aspect-ratio: 1;
    border-radius: 10px;
    background: var(--surface-2);
    display: grid;
    place-items: center;
    position: relative;
    font: 400 1rem "Instrument Serif", Georgia, serif;
    color: var(--text-muted);
  }
  .d.today {
    background: var(--text);
    color: var(--bg);
  }
  .d.past {
    opacity: 0.45;
  }
  .d .ev {
    position: absolute;
    bottom: 0.2rem;
    display: flex;
    gap: 2px;
  }
  .d .ev i {
    width: 5px;
    height: 5px;
    border-radius: 50%;
  }
  .cal-list {
    display: grid;
    gap: 0.25rem;
    margin-top: 0.6rem;
    font-size: 0.76rem;
    color: var(--text-muted);
  }
  .cal-list i {
    display: inline-block;
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    margin-right: 0.45rem;
  }
  .stickers {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .sticker {
    padding: 0.45rem 0.8rem;
    border-radius: 12px;
    background: var(--c);
    color: #0e0a18;
    font: 600 0.88rem/1.2 var(--font-story);
    rotate: var(--r);
    box-shadow: 0 10px 20px -10px #000, inset 0 -2px 0 #0002;
    transition: rotate 0.4s;
  }
  .sticker:hover {
    rotate: 0deg;
  }
  .sticker sup {
    font: 800 0.6rem var(--font-ui);
    margin-left: 0.25rem;
    opacity: 0.65;
  }
  .sticker small {
    display: block;
    font: 700 0.58rem var(--font-ui);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    opacity: 0.6;
  }
  .miles {
    margin-top: 0.9rem;
    position: relative;
    padding-left: 1.1rem;
    display: grid;
    gap: 0.4rem;
    font-size: 0.8rem;
  }
  .miles::before {
    content: "";
    position: absolute;
    left: 0.3rem;
    top: 0.25rem;
    bottom: 0.25rem;
    width: 2px;
    background: linear-gradient(180deg, #ff9ec0, #c7b4ff, #82e3d3);
  }
  .miles div {
    position: relative;
  }
  .miles div::before {
    content: "";
    position: absolute;
    left: -1.05rem;
    top: 0.25rem;
    width: 0.55rem;
    height: 0.55rem;
    border-radius: 50%;
    background: var(--bg);
    border: 2px solid #ff9ec0;
  }
  .miles span {
    color: var(--text-muted);
    font-size: 0.68rem;
    margin-left: 0.4rem;
  }
  .you-g {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
    gap: 0.6rem;
  }
  .box {
    padding: 0.6rem 0.75rem;
    border-radius: 14px;
    background: var(--surface-2);
    font-size: 0.8rem;
  }
  .box h5 {
    margin: 0 0 0.25rem;
    font: 800 0.58rem var(--font-ui);
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .box p {
    margin: 0;
  }
  .sealed {
    grid-column: 1 / -1;
    display: flex;
    gap: 0.8rem;
    align-items: center;
    padding: 0.7rem 0.9rem;
    border-radius: 14px;
    border: 1px dashed color-mix(in srgb, #ff9ec0 50%, var(--border));
    background: linear-gradient(120deg, #ff9ec014, #c7b4ff14);
  }
  .sealed span {
    font-size: 1.6rem;
  }
  .sealed p {
    margin: 0;
    font: italic 0.85rem/1.4 var(--font-story);
    color: var(--text-muted);
  }
  .sealed b {
    display: block;
    font: 700 0.78rem var(--font-ui);
    font-style: normal;
    color: var(--text);
  }
  .log {
    font: 0.8rem/1.6 var(--font-mono, ui-monospace, monospace);
    padding: 0.7rem 0.8rem;
    border-radius: 12px;
    background: color-mix(in srgb, #000 25%, transparent);
    border: 1px solid var(--border);
  }
  .log div {
    display: flex;
    justify-content: space-between;
    gap: 0.6rem;
    border-bottom: 1px dashed var(--border);
  }
  .log span {
    color: var(--text-muted);
  }
  .log b {
    font-weight: 600;
    color: color-mix(in srgb, #ffd08f 70%, var(--text));
    text-align: right;
  }
  .veil-h {
    margin: 1rem 0 0;
    font: 400 1.9rem/1 "Instrument Serif", Georgia, serif;
  }
  .veil-h span {
    display: block;
    font: italic 0.95rem var(--font-story);
    color: var(--text-muted);
    margin-top: 0.3rem;
  }
  .minds {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 21rem), 1fr));
    gap: 0.9rem;
  }
  @media (prefers-reduced-motion: reduce) {
    .mood i,
    .wound {
      animation: none;
    }
  }
</style>
