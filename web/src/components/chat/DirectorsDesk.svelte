<script lang="ts">
  import Modal from "../Modal.svelte";
  import { get, patch, post } from "../../lib/api";
  import { openDock } from "../../lib/dock.svelte";
  import { ArrowDown, ArrowUp, Clapperboard, Hourglass, History, Milestone, ShieldCheck, Sparkles, Users, Wind, Zap, Lock, GitBranch, Stethoscope } from "../../lib/icons";
  import { errorToast, toast } from "../../lib/state.svelte";

  /**
   * F2: the Director's Desk, the Story side of the composer's tray. Big buttons for running the
   * story: skip ahead, recaps, reports over the story's records, a story audit, Cut to, Bring
   * someone in, and the pacing cues. Its top row is what's most useful right now.
   */
  interface Suggestion {
    id: string;
    label: string;
    do: { cue: string } | { report: "bonds" | "threads" | "secrets" } | { dock: "story"; section: string } | { skip: string };
  }
  interface Desk {
    suggestions: Suggestion[];
    here: string[];
    away: { name: string; where: string | null }[];
    places: { name: string; path: string }[];
    since: number;
  }
  type Report =
    | { kind: "bonds"; since: number; bonds: { from: string; to: string; label: string | null; changes: { axis: string; delta: number; now: number }[]; why: string | null }[] }
    | { kind: "threads"; threads: { id: string; title: string; state: "open" | "stalled" | "ripe"; latest: string | null; quiet: number }[] }
    | { kind: "secrets"; clocks: { key: string; statement: string; cur: number; max: number; near: { name: string; why: string | null }[] }[]; offpage: { id: string; label: string; due: boolean }[] };

  let {
    chatId,
    lastMessageId,
    onendscene,
    onrecap,
    onanswer,
    onchange,
    onclose,
  }: {
    chatId: string;
    lastMessageId: string | null;
    onendscene: () => Promise<unknown>;
    onrecap: () => Promise<unknown>;
    onanswer: (title: string, text: string) => void;
    onchange: () => void;
    onclose: () => void;
  } = $props();

  let desk = $state<Desk | null>(null);
  let report = $state<Report | null>(null);
  let reportOpen = $state(false);
  let custom = $state("");
  let meanwhile = $state("");
  let busy = $state(false);

  async function load() {
    try {
      desk = await get<Desk>(`/api/chats/${chatId}/desk`);
    } catch {
      desk = null;
    }
  }
  $effect(() => {
    void chatId;
    void load();
  });

  async function run(fn: () => Promise<unknown>, close = true) {
    busy = true;
    try {
      await fn();
      if (close) onclose();
    } catch (e) {
      errorToast(e);
    } finally {
      busy = false;
    }
  }
  const skip = (duration: string) =>
    run(async () => {
      await post(`/api/chats/${chatId}/timeskip`, { duration, note: meanwhile.trim() || undefined });
      meanwhile = "";
      custom = "";
      toast("Time skipped", { kind: "ok" });
      onchange();
    });
  const cue = (body: Record<string, string>, said: string) =>
    run(async () => {
      await post(`/api/chats/${chatId}/desk/cue`, body);
      toast(said, { kind: "ok" });
      onchange();
    });
  const setCue = (text: string) =>
    run(async () => {
      await patch(`/api/chats/${chatId}`, { settings: { cue: text } });
      toast("Cue set for the next reply", { kind: "ok" });
      onchange();
    });
  async function openReport(kind: "bonds" | "threads" | "secrets") {
    try {
      report = { kind, ...(await get<Omit<Report, "kind">>(`/api/chats/${chatId}/desk/report/${kind}`)) } as Report;
      reportOpen = true;
    } catch (e) {
      errorToast(e);
    }
  }
  function suggestion(s: Suggestion) {
    if ("cue" in s.do) void setCue(s.do.cue);
    else if ("report" in s.do) void openReport(s.do.report);
    else if ("skip" in s.do) void skip(s.do.skip);
    else {
      openDock("story", s.do.section);
      onclose();
    }
  }
  const sinceAway = () =>
    run(async () => {
      let since = 0;
      try {
        since = Number(localStorage.getItem(`mea.seen.${chatId}`)) || 0;
      } catch {
        since = 0;
      }
      toast("Catching you up…");
      const r = await post<{ recap: string; count: number }>(`/api/chats/${chatId}/recap/since`, { since });
      onanswer(r.count ? `Since you were away (${r.count} messages)` : "Since you were away", r.recap);
    });
  const audit = () =>
    run(async () => {
      const r = await post<{ queued: number }>(`/api/chats/${chatId}/desk/audit`, { n: 20 });
      toast(`Checking the last ${r.queued} replies; Story health updates as they finish`, { kind: "ok" });
      openDock("chat", "health");
    });
  const SKIPS: [string, string][] = [
    ["30 minutes", "30 min"],
    ["1 hour", "1 hour"],
    ["until evening", "Until evening"],
    ["until morning", "Until morning"],
    ["next day", "Next day"],
    ["1 week", "A week"],
  ];
  const arrow = (d: number) => (d > 0 ? "↑" : "↓");
</script>

<div class="desk">
  {#if desk?.suggestions.length}
    <div class="now" aria-label="Right now">
      {#each desk.suggestions as s (s.id)}<button class="nowbtn" disabled={busy} onclick={() => suggestion(s)}><Sparkles size={14} /> {s.label}</button>{/each}
    </div>
  {/if}

  <div class="grid">
    <button class="big" onclick={() => run(onendscene)} disabled={busy || !lastMessageId}><Milestone size={18} /><b>End scene</b></button>
    <button class="big" onclick={() => run(onrecap)} disabled={busy}><History size={18} /><b>Previously on…</b></button>
    <button class="big" onclick={sinceAway} disabled={busy}><History size={18} /><b>Since I was away</b></button>
    <button class="big" onclick={() => openReport("bonds")}><Users size={18} /><b>Report: Bonds</b></button>
    <button class="big" onclick={() => openReport("threads")}><GitBranch size={18} /><b>Report: Threads</b></button>
    <button class="big" onclick={() => openReport("secrets")}><Lock size={18} /><b>Report: Secrets</b></button>
    <button class="big" onclick={audit} disabled={busy}><Stethoscope size={18} /><b>Story audit</b></button>
    <button class="big" onclick={() => cue({ kind: "raise" }, "The next reply raises the stakes")} disabled={busy}><Zap size={18} /><b>Raise the stakes</b></button>
    <button class="big" onclick={() => cue({ kind: "breathe" }, "The next reply lets it breathe")} disabled={busy}><Wind size={18} /><b>Breathe</b></button>
  </div>

  <div class="tsec">
    <span class="tlabel"><Hourglass size={12} /> Skip ahead</span>
    <div class="chips">
      {#each SKIPS as [v, l] (v)}<button class="schip" disabled={busy} onclick={() => skip(v)}>{l}</button>{/each}
    </div>
    <div class="inline">
      <input class="input short" bind:value={custom} placeholder="3 days" aria-label="Custom length" />
      <input class="input" bind:value={meanwhile} placeholder="What happened meanwhile (optional)" aria-label="What happened meanwhile" />
      <button class="btn small" disabled={busy || !custom.trim()} onclick={() => skip(custom.trim())}>Skip</button>
    </div>
  </div>

  {#if desk}
    <div class="two">
      <label class="tsec">
        <span class="tlabel"><Clapperboard size={12} /> Cut to…</span>
        <select class="select" value="" disabled={busy} onchange={(e) => e.currentTarget.value && cue({ kind: "cut", to: e.currentTarget.value }, `The next reply cuts to ${e.currentTarget.value.split(" › ").at(-1)}`)}>
          <option value="">Someone or somewhere</option>
          {#if desk.away.length}<optgroup label="People">{#each desk.away as p (p.name)}<option value={p.name}>{p.name}{p.where ? ` (${p.where.split(" › ").at(-1)})` : ""}</option>{/each}</optgroup>{/if}
          {#if desk.places.length}<optgroup label="Places">{#each desk.places as p (p.path)}<option value={p.path}>{p.name}</option>{/each}</optgroup>{/if}
        </select>
      </label>
      <label class="tsec">
        <span class="tlabel"><Users size={12} /> Bring someone in</span>
        <select class="select" value="" disabled={busy || !desk.away.length} onchange={(e) => e.currentTarget.value && cue({ kind: "bring", who: e.currentTarget.value }, `${e.currentTarget.value} comes into the scene next`)}>
          <option value="">{desk.away.length ? "Who" : "Everyone's here"}</option>
          {#each desk.away as p (p.name)}<option value={p.name}>{p.name}</option>{/each}
        </select>
      </label>
    </div>
  {/if}
</div>

<Modal bind:open={reportOpen} title={report ? { bonds: "Bonds this chapter", threads: "Threads", secrets: "Secrets" }[report.kind] : ""} size="md">
  {#if report?.kind === "bonds"}
    {#each report.bonds as b, i (i)}
      <div class="rrow">
        <b>{b.from} → {b.to}</b>{#if b.label}<span class="tiny muted"> “{b.label}”</span>{/if}
        <div class="small">
          {#each b.changes as c (c.axis)}<span class="mv" class:up={c.delta > 0 === (c.axis !== "resentment")}>{c.axis} {arrow(c.delta)}{Math.abs(c.delta)} <span class="faint">(now {c.now})</span></span>{:else}<span class="faint">no change this chapter</span>{/each}
        </div>
        {#if b.why}<div class="tiny muted">Last: {b.why}</div>{/if}
      </div>
    {:else}
      <p class="muted small">No bonds recorded yet.</p>
    {/each}
  {:else if report?.kind === "threads"}
    {#each report.threads as t (t.id)}
      <div class="rrow">
        <div class="row"><span class="chip tiny" class:warm={t.state === "ripe"} class:cold={t.state === "stalled"}>{t.state}</span> <b>{t.title}</b></div>
        {#if t.latest}<div class="tiny muted">{t.latest}{t.quiet ? ` · quiet ${t.quiet} msgs` : ""}</div>{/if}
        <button class="btn ghost small" onclick={() => ((reportOpen = false), cue({ kind: "push", thread: t.id }, `The next reply pushes “${t.title}”`))}><ArrowUp size={13} /> Push this one</button>
      </div>
    {:else}
      <p class="muted small">No open threads.</p>
    {/each}
  {:else if report?.kind === "secrets"}
    {#each report.clocks as x (x.key)}
      <div class="rrow">
        <b class="small">{x.statement}</b>
        <div class="tiny">Exposure {x.cur}/{x.max}{#if x.near.length} · closest: {x.near.map((n) => `${n.name}${n.why ? ` (${n.why})` : ""}`).join(", ")}{/if}</div>
      </div>
    {/each}
    {#each report.offpage as o (o.id)}
      <div class="rrow"><span class="small"><Lock size={12} /> {o.label}</span>{#if o.due}<span class="chip tiny warm">ready to come out</span>{/if}</div>
    {/each}
    {#if !report.clocks.length && !report.offpage.length}<p class="muted small">No secrets in play.</p>{/if}
  {/if}
  {#snippet footer()}
    {#if report?.kind === "secrets"}<button class="btn ghost" onclick={() => ((reportOpen = false), openDock("story", "offpage"), onclose())}><ShieldCheck size={14} /> Open in Story</button>{/if}
    <button class="btn" onclick={() => (reportOpen = false)}><ArrowDown size={14} /> Close</button>
  {/snippet}
</Modal>

<style>
  .schip {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    border: 1px solid var(--border);
    background: var(--surface);
    border-radius: var(--r-pill);
    padding: 0.2rem 0.6rem;
    font: 600 var(--fs-xs) var(--font-ui);
    color: var(--text-muted);
    cursor: pointer;
  }
  .tsec {
    display: grid;
    gap: 0.45rem;
    justify-items: start;
  }
  label.tsec .select {
    width: 100%;
  }
  .tlabel {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font: 700 0.68rem var(--font-ui);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-faint);
  }
  .inline {
    display: flex;
    gap: 0.4rem;
    width: 100%;
  }
  .inline .input {
    flex: 1;
    min-width: 0;
    padding: 0.45rem 0.75rem;
  }
  .inline .input.short {
    flex: 0 0 7rem;
  }
  .desk {
    display: grid;
    gap: 0.6rem;
  }
  .now {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  .nowbtn {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.4rem 0.75rem;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--accent) 60%, transparent);
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    color: inherit;
    cursor: pointer;
    font-size: 0.85rem;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.4rem;
  }
  .big {
    display: grid;
    justify-items: center;
    gap: 0.25rem;
    padding: 0.6rem 0.4rem;
    border-radius: var(--radius-sm, 10px);
    border: 1px solid var(--border);
    background: var(--surface-2);
    color: inherit;
    cursor: pointer;
    font-size: 0.8rem;
    text-align: center;
  }
  .big:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }
  .two {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
  }
  .rrow {
    display: grid;
    gap: 0.2rem;
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--border);
  }
  .mv {
    margin-right: 0.6rem;
    color: var(--danger);
  }
  .mv.up {
    color: var(--mint, var(--accent));
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }
  @media (max-width: 520px) {
    .grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .two {
      grid-template-columns: 1fr;
    }
  }
</style>
