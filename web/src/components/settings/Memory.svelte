<script lang="ts">
  import Segmented from "../Segmented.svelte";
  import { get, post } from "../../lib/api";
  import { compact } from "../../lib/format";
  import { app, errorToast, saveSetting } from "../../lib/state.svelte";
  import type { Compression, MemoryConfig, Planner } from "../../lib/types";

  const cfg = $derived(app.settings?.["memory.config"]);
  let planner = $state<Planner | null>(null);

  async function loadPlanner() {
    try {
      planner = await get<Planner>("/api/quota/planner");
    } catch (e) {
      errorToast(e);
    }
  }
  $effect(() => {
    void loadPlanner();
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  // H1: the cut order, top goes first.
  const CUT_LABEL: Record<string, string> = { craft: "Craft coach notes", slips: "Last slips", "swipe-digest": "Earlier takes (on a swipe)", pressures: "Hidden pressures", promises: "Promises", style: "Style profile", recall: "Recalled memories", lessons: "Lessons", advisor: "Advisor's plan", anchor: "Who the character is (re-anchor)", trackers: "Story-state note", memory: "The Story So Far" };
  function moveCut(from: number, to: number) {
    if (!cfg || to < 0 || to >= cfg.cutOrder.length || from === to) return;
    const order = [...cfg.cutOrder];
    const [k] = order.splice(from, 1);
    order.splice(to, 0, k!);
    set({ cutOrder: order });
  }
  function set(patch: Partial<MemoryConfig>) {
    if (!cfg) return;
    const next = { ...$state.snapshot(cfg), ...patch } as MemoryConfig;
    if (app.settings) app.settings["memory.config"] = next;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        await saveSetting("memory.config", next);
        void loadPlanner();
      } catch (e) {
        errorToast(e);
      }
    }, 400);
  }
  const LEVELS: { k: keyof MemoryConfig["compression"]; label: string }[] = [
    { k: "scene", label: "Scenes" },
    { k: "chapter", label: "Chapters" },
    { k: "arc", label: "Arcs" },
    { k: "story", label: "The Story So Far" },
  ];
  const num = (v: string, min: number, max: number) => Math.max(min, Math.min(max, Number(v) || min));
  const pct = (n: number) => `${Math.round(n * 100)}%`;

  /** Recall slots must add up to 1; moving one rebalances the other two proportionally. */
  function setSlot(k: keyof MemoryConfig["slots"], v: number) {
    if (!cfg) return;
    const others = (["recent", "relevant", "serendipity"] as const).filter((x) => x !== k);
    const rest = others.reduce((n, x) => n + cfg.slots[x], 0) || 1;
    const left = Math.max(0, 1 - v);
    const slots = { ...cfg.slots, [k]: v };
    for (const x of others) slots[x] = Math.round((cfg.slots[x] / rest) * left * 100) / 100;
    set({ slots });
  }

  // MEM-44: Light / Balanced / Deep; any change you make yourself turns the profile into "custom".
  const PROFILES = [
    { id: "light" as const, label: "Light", about: "Cheapest: records without checks, smaller budgets, no journals, librarian or deep search." },
    { id: "balanced" as const, label: "Balanced", about: "Checked records, journals and deep search; no librarian or checker model pass." },
    { id: "deep" as const, label: "Deep", about: "Everything on, for the best continuity. The default." },
  ];
  async function applyProfile(name: "light" | "balanced" | "deep") {
    try {
      const r = await post<{ config: MemoryConfig }>(`/api/memory/profiles/${name}`);
      if (app.settings) app.settings["memory.config"] = r.config;
      void loadPlanner();
    } catch (e) {
      errorToast(e);
    }
  }

  const degradeAt = $derived(app.settings?.["quota.degradeAt"] ?? 0.9);
  const shedLabel: Record<string, string> = { advisor: "advisor", librarian: "librarian", gates: "scene-break checks", drift: "drift checks", continuity: "continuity checks", verification: "summary verification" };
</script>

{#if cfg}
  <div class="stack">
    <section class="panel stack">
      <div class="row between wrap">
        <h2>Long-term memory</h2>
        <label class="switch"><input type="checkbox" checked={cfg.enabled} onchange={(e) => set({ enabled: e.currentTarget.checked })} /> On</label>
      </div>
      <p class="tiny muted">
        As a story grows past what fits in the prompt, Mea records each scene, rolls scenes up into chapters and arcs, and keeps a Story So Far. It also pulls back details (facts, promises,
        secrets) when they matter again. You can read and edit all of it in each chat's Memory tab.
      </p>
      <div class="field">
        <span class="label">When you edit or delete old messages</span>
        <Segmented
          value={cfg.onEdit}
          options={[
            { value: "auto", label: "Update memory automatically" },
            { value: "ask", label: "Let me review changes" },
          ]}
          onchange={(v) => set({ onEdit: v })}
          small
        />
        <span class="hint">Summaries you edited yourself are always sent for review, never overwritten.</span>
      </div>
      <label class="switch"><input type="checkbox" checked={cfg.verify} onchange={(e) => set({ verify: e.currentTarget.checked })} /> Double-check each scene summary against the messages</label>
      <label class="switch indent"><input type="checkbox" checked={cfg.autoRepair} disabled={!cfg.verify} onchange={(e) => set({ autoRepair: e.currentTarget.checked })} /> Fix it automatically once when the check finds a real problem</label>
      <label class="switch"><input type="checkbox" checked={cfg.boundaryCheck} onchange={(e) => set({ boundaryCheck: e.currentTarget.checked })} /> Ask the helper model to confirm unclear scene breaks</label>
    </section>

    <section class="panel stack">
      <h2>How much memory work</h2>
      <div class="profiles">
        {#each PROFILES as p (p.id)}
          <button class="prof card" class:on={cfg.profile === p.id} onclick={() => applyProfile(p.id)} aria-pressed={cfg.profile === p.id}>
            <b>{p.label}</b>
            <span class="tiny muted">{p.about}</span>
          </button>
        {/each}
      </div>
      {#if cfg.profile === "custom"}<p class="tiny muted">Custom: you've changed settings below. Pick a profile to reset them.</p>{/if}
    </section>

    <section class="panel stack">
      <h2>Recall & accuracy</h2>
      <div class="grid2">
        <label class="field">
          <span class="label">Whose memory</span>
          <select class="select" value={cfg.pov} onchange={(e) => set({ pov: e.currentTarget.value as MemoryConfig["pov"] })}>
            <option value="auto">Follow the chat mode</option>
            <option value="character">The character's (they only recall what they could know)</option>
            <option value="narrator">The narrator's (everything)</option>
          </select>
        </label>
        <label class="field">
          <span class="label">How memories are written</span>
          <select class="select" value={cfg.format} onchange={(e) => set({ format: e.currentTarget.value as MemoryConfig["format"] })}>
            <option value="prose">Notes with when and where</option>
            <option value="attributed">Who remembers, how long ago</option>
            <option value="clinical">Bullet facts with sources</option>
            <option value="minimal">Minimal</option>
          </select>
          <span class="hint">Some models do better with bullets.</span>
        </label>
      </div>
      <div class="field">
        <span class="label">Variety in what's recalled <span class="faint">{pct(cfg.diversity)}</span></span>
        <input type="range" min="0" max="0.8" step="0.05" value={cfg.diversity} oninput={(e) => set({ diversity: Number(e.currentTarget.value) })} />
        <span class="hint">Higher keeps five near-identical memories from filling the budget.</span>
      </div>
      <label class="switch"><input type="checkbox" checked={cfg.entityRecall} onchange={(e) => set({ entityRecall: e.currentTarget.checked })} /> People and places in the scene bring their card and top facts</label>
      <label class="switch"><input type="checkbox" checked={cfg.reinforcement} onchange={(e) => set({ reinforcement: e.currentTarget.checked })} /> Memories the replies use gain weight; unused trivia fades (never deleted)</label>
      <label class="switch"><input type="checkbox" checked={cfg.rewriteQuery} onchange={(e) => set({ rewriteQuery: e.currentTarget.checked })} /> A helper rewrites the search while you type</label>
      <label class="switch"><input type="checkbox" checked={cfg.librarian} onchange={(e) => set({ librarian: e.currentTarget.checked })} /> The librarian picks what matters for the next reply (while you type)</label>
      <label class="switch"><input type="checkbox" checked={cfg.deepSearch} onchange={(e) => set({ deepSearch: e.currentTarget.checked })} /> Deep search: quote the old messages themselves when the story reaches far back</label>
      <label class="switch"><input type="checkbox" checked={cfg.journals} onchange={(e) => set({ journals: e.currentTarget.checked })} /> First-person journals for the main character and recurring people</label>
      <label class="switch"><input type="checkbox" checked={cfg.consolidate} onchange={(e) => set({ consolidate: e.currentTarget.checked })} /> Tidy memory while the chat is quiet (merge duplicates, fold trivia)</label>
      <label class="switch"><input type="checkbox" checked={cfg.chronicle} onchange={(e) => set({ chronicle: e.currentTarget.checked })} /> Propose lore entries for people and places the story introduces</label>
      <label class="switch"><input type="checkbox" checked={cfg.continuity} onchange={(e) => set({ continuity: e.currentTarget.checked })} /> Check each reply for continuity slips (flags only; nothing is rewritten)</label>
      <label class="switch indent"><input type="checkbox" checked={cfg.checkerModel} disabled={!cfg.continuity} onchange={(e) => set({ checkerModel: e.currentTarget.checked })} /> Also ask the helper model, with sources (the quick rules always run)</label>
      <div class="field indent">
        <span class="label">Knowledge-leak guard</span>
        <Segmented
          value={cfg.leakGuard}
          small
          options={[
            { value: "auto", label: "In Narrator chats" },
            { value: "on", label: "Always" },
            { value: "off", label: "Off" },
          ]}
          onchange={(v) => set({ leakGuard: v })}
        />
        <span class="hint">Flags a character mentioning a secret they don't know.</span>
      </div>
    </section>

    <section class="panel stack">
      <h2>What goes first when space is short</h2>
      <p class="tiny muted">Everything Mea adds to the prompt (the story-state note, lanes, the Story So Far, recalled memories) shares one ceiling. Over it, these go first, top to bottom; anything not listed, and the lanes that keep secrets and later canon off the page, are never cut.</p>
      <label class="field">
        <span class="label">Ceiling <span class="faint">{cfg.ceiling > 0 ? `${cfg.ceiling} tokens` : "automatic"}</span></span>
        <input class="input narrow" type="number" min="0" max="200000" step="100" value={cfg.ceiling} onchange={(e) => set({ ceiling: num(e.currentTarget.value, 0, 200000) })} />
        <span class="hint">0 sets it from the model's room once the reply's is set aside (about a third of it)</span>
      </label>
      <ol class="cutorder">
        {#each cfg.cutOrder as k, i (k)}
          <li draggable="true" ondragstart={(e) => e.dataTransfer?.setData("text/plain", String(i))} ondragover={(e) => e.preventDefault()} ondrop={(e) => (e.preventDefault(), moveCut(Number(e.dataTransfer?.getData("text/plain")), i))}>
            <span class="grow">{CUT_LABEL[k] ?? k}</span>
            <button type="button" class="btn ghost icon small" onclick={() => moveCut(i, i - 1)} disabled={i === 0} aria-label="Earlier">↑</button>
            <button type="button" class="btn ghost icon small" onclick={() => moveCut(i, i + 1)} disabled={i === cfg.cutOrder.length - 1} aria-label="Later">↓</button>
          </li>
        {/each}
      </ol>
    </section>

    <section class="panel stack">
      <h2>Scenes & chapters</h2>
      <div class="grid">
        <label class="field">
          <span class="label">Scene size limit</span>
          <input class="input" type="number" min="1000" max="40000" step="500" value={cfg.sceneTokenCap} onchange={(e) => set({ sceneTokenCap: num(e.currentTarget.value, 1000, 40000) })} />
          <span class="hint">tokens; a scene closes here even without a break</span>
        </label>
        <label class="field">
          <span class="label">Pause that starts a new scene</span>
          <input class="input" type="number" min="0.5" max="168" step="0.5" value={cfg.pauseHours} onchange={(e) => set({ pauseHours: num(e.currentTarget.value, 0.5, 168) })} />
          <span class="hint">hours between messages</span>
        </label>
        <label class="field">
          <span class="label">Scenes per chapter</span>
          <input class="input" type="number" min="2" max="30" value={cfg.scenesPerChapter} onchange={(e) => set({ scenesPerChapter: Math.round(num(e.currentTarget.value, 2, 30)) })} />
        </label>
        <label class="field">
          <span class="label">Chapters per arc</span>
          <input class="input" type="number" min="2" max="20" value={cfg.chaptersPerArc} onchange={(e) => set({ chaptersPerArc: Math.round(num(e.currentTarget.value, 2, 20)) })} />
        </label>
        <label class="field">
          <span class="label">Settle delay</span>
          <input class="input" type="number" min="0" max="20" value={cfg.lag} onchange={(e) => set({ lag: Math.round(num(e.currentTarget.value, 0, 20)) })} />
          <span class="hint">newest messages left alone, since you may still swipe or edit them</span>
        </label>
      </div>
    </section>

    <section class="panel stack">
      <h2>How summaries are written</h2>
      <p class="tiny muted">How much each level keeps (SUM-10), and the voice every summary uses (SUM-17). Changes apply to summaries written from now on; rebuild a level to rewrite older ones.</p>
      <div class="grid">
        {#each LEVELS as l (l.k)}
          <label class="field">
            <span class="label">{l.label}</span>
            <select class="select" value={cfg.compression[l.k]} onchange={(e) => set({ compression: { ...cfg.compression, [l.k]: e.currentTarget.value as Compression } })}>
              <option value="tight">Tight</option>
              <option value="balanced">Balanced</option>
              <option value="detailed">Detailed</option>
            </select>
          </label>
        {/each}
      </div>
      <div class="grid">
        <label class="field">
          <span class="label">Tense</span>
          <select class="select" value={cfg.voice.tense} onchange={(e) => set({ voice: { ...cfg.voice, tense: e.currentTarget.value as MemoryConfig["voice"]["tense"] } })}>
            <option value="past">Past</option><option value="present">Present</option>
          </select>
        </label>
        <label class="field">
          <span class="label">Person</span>
          <select class="select" value={cfg.voice.person} onchange={(e) => set({ voice: { ...cfg.voice, person: e.currentTarget.value as MemoryConfig["voice"]["person"] } })}>
            <option value="third">Third person</option><option value="first">First person (the main character remembering)</option>
          </select>
        </label>
        <label class="field">
          <span class="label">Voice</span>
          <select class="select" value={cfg.voice.register} onchange={(e) => set({ voice: { ...cfg.voice, register: e.currentTarget.value as MemoryConfig["voice"]["register"] } })}>
            <option value="record">A neutral record</option><option value="storybook">A storybook narrator</option>
          </select>
        </label>
      </div>
      <label class="switch"><input type="checkbox" checked={cfg.moments} onchange={(e) => set({ moments: e.currentTarget.checked })} /> Tag dramatic moments (confessions, betrayals, promises, deaths…) and keep them through every level (SUM-11)</label>
    </section>

    <section class="panel stack">
      <h2>Prompt budget</h2>
      <p class="tiny muted">Shares of each profile's prompt size target. What memory doesn't use goes to recent messages.</p>
      <label class="field">
        <span class="label">Story So Far <span class="faint">{pct(cfg.budget.summaries)}</span></span>
        <input type="range" min="0" max="0.4" step="0.01" value={cfg.budget.summaries} oninput={(e) => set({ budget: { ...cfg.budget, summaries: Number(e.currentTarget.value) } })} />
      </label>
      <label class="field">
        <span class="label">Recalled memories <span class="faint">{pct(cfg.budget.recall)}</span></span>
        <input type="range" min="0" max="0.25" step="0.01" value={cfg.budget.recall} oninput={(e) => set({ budget: { ...cfg.budget, recall: Number(e.currentTarget.value) } })} />
      </label>
      <div class="field">
        <span class="label">Recall mix</span>
        <div class="mix" aria-hidden="true">
          <span style:flex={cfg.slots.recent} class="recent"></span><span style:flex={cfg.slots.relevant} class="relevant"></span><span style:flex={cfg.slots.serendipity} class="seren"></span>
        </div>
        <div class="grid">
          <label class="field"><span class="label tiny">Recent <span class="faint">{pct(cfg.slots.recent)}</span></span><input type="range" min="0" max="1" step="0.05" value={cfg.slots.recent} oninput={(e) => setSlot("recent", Number(e.currentTarget.value))} /></label>
          <label class="field"><span class="label tiny">Relevant <span class="faint">{pct(cfg.slots.relevant)}</span></span><input type="range" min="0" max="1" step="0.05" value={cfg.slots.relevant} oninput={(e) => setSlot("relevant", Number(e.currentTarget.value))} /></label>
          <label class="field"><span class="label tiny">Serendipity <span class="faint">{pct(cfg.slots.serendipity)}</span></span><input type="range" min="0" max="1" step="0.05" value={cfg.slots.serendipity} oninput={(e) => setSlot("serendipity", Number(e.currentTarget.value))} /></label>
        </div>
        <span class="hint">Recent: things from the last scenes. Relevant: matches what's happening now. Serendipity: an older detail now and then, so the story remembers its past.</span>
      </div>
      <div class="grid">
        <label class="field">
          <span class="label">Trim history down to</span>
          <input class="input" type="number" min="40" max="95" step="5" value={Math.round(cfg.lowWater * 100)} onchange={(e) => set({ lowWater: num(e.currentTarget.value, 40, 95) / 100 })} />
          <span class="hint">% of its budget when it overflows; trimming in chunks keeps the prompt cache warm</span>
        </label>
        <label class="field">
          <span class="label">Clean up older messages after</span>
          <input class="input" type="number" min="0" max="100" value={cfg.filterDepth} onchange={(e) => set({ filterDepth: Math.round(num(e.currentTarget.value, 0, 100)) })} />
          <span class="hint">messages; strips reasoning and markup from older ones</span>
        </label>
        <label class="field">
          <span class="label">Claude cache lifetime</span>
          <select class="select" value={cfg.cacheTtl} onchange={(e) => set({ cacheTtl: e.currentTarget.value as MemoryConfig["cacheTtl"] })}>
            <option value="5m">5 minutes</option>
            <option value="1h">1 hour (costs more to write)</option>
          </select>
          <span class="hint">pay-as-you-go Claude only</span>
        </label>
      </div>
    </section>

    <section class="panel stack">
      <h2>Quota planner</h2>
      {#if planner}
        {#if planner.turnsPerDay != null}
          <div class="row wrap big">
            <div><b>≈ {planner.turnsPerDay}</b><span class="tiny muted"> replies/day</span></div>
            {#if planner.turnsLeftToday != null}<div><b>{planner.turnsLeftToday}</b><span class="tiny muted"> left today</span></div>{/if}
            {#if planner.turnsLeftThisWeek != null}<div><b>{planner.turnsLeftThisWeek}</b><span class="tiny muted"> left this week</span></div>{/if}
          </div>
        {:else}
          <p class="tiny muted">Add a NanoGPT subscription key to see how many replies your quota allows.</p>
        {/if}
        <p class="tiny muted">
          {planner.measured ? `Measured from your last ${planner.turns} replies` : "Estimated (not enough replies yet to measure)"} · ≈ {compact(planner.perTurn)} quota tokens per reply including helpers{planner.swipeRatio
            ? ` · ${Math.round(planner.swipeRatio * 100)}% swipes`
            : ""}
        </p>
        {#if planner.features.length}
          <table>
            <tbody>
              <tr><td>Story reply</td><td class="num">{compact(planner.avgStoryPrompt)}</td></tr>
              {#each planner.features as f (f.task + f.kind)}<tr><td>{f.kind}</td><td class="num">{compact(f.perTurn)}</td></tr>{/each}
            </tbody>
          </table>
        {/if}
        {#if planner.turnsPerDay != null && planner.scenarios[0]?.turnsPerDay != null}
          <p class="tiny muted">At other prompt sizes: {planner.scenarios.map((s) => `${compact(s.target)} → ≈ ${s.turnsPerDay}/day`).join(" · ")}</p>
        {/if}
        {#if planner.pacing}
          <div class="notice {planner.pacing.ahead ? 'warn' : 'ok'} tiny">
            {Math.round(planner.pacing.usedShare * 100)}% of the quota used with {Math.round(planner.pacing.elapsedShare * 100)}% of the week gone{planner.pacing.ahead ? ": you're ahead of pace" : ": on pace"}.
          </div>
        {/if}
        {#if planner.calibration.cachedWeight != null}<p class="tiny faint">Cached tokens count as {Math.round(planner.calibration.cachedWeight * 100)}% toward the quota (measured from {planner.calibration.samples} samples).</p>{/if}
      {:else}
        <p class="tiny muted">Loading…</p>
      {/if}
      <label class="field">
        <span class="label">Save quota from {pct(degradeAt)} used <span class="faint">turns off optional helpers one by one</span></span>
        <input type="range" min="0.5" max="1" step="0.05" value={degradeAt} onchange={(e) => saveSetting("quota.degradeAt", Number(e.currentTarget.value)).then(loadPlanner, errorToast)} />
      </label>
      {#if planner?.state.shed.length}<div class="notice warn tiny">Paused to save quota: {planner.state.shed.map((s) => shedLabel[s] ?? s).join(", ")}.</div>{/if}
    </section>
  </div>
{/if}

<style>
  .cutorder {
    display: grid;
    gap: 0.25rem;
    margin: 0;
    padding-left: 1.4rem;
  }
  .cutorder li {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.15rem 0.3rem;
    border-radius: 8px;
    background: var(--surface-2);
    cursor: grab;
  }
  .cutorder .grow {
    flex: 1;
  }
  .profiles {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
    gap: 0.5rem;
  }
  .prof {
    text-align: left;
    padding: 0.7rem 0.8rem;
    display: grid;
    gap: 0.25rem;
    cursor: pointer;
    color: inherit;
    font: inherit;
  }
  .prof.on {
    border-color: var(--accent);
    box-shadow: var(--focus);
  }
  .grid2 {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
    gap: 0.7rem;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
    gap: 0.8rem;
  }
  .indent {
    margin-left: 1.6rem;
  }
  .mix {
    display: flex;
    height: 0.6rem;
    border-radius: var(--r-pill);
    overflow: hidden;
    background: var(--surface-2);
  }
  .mix .recent {
    background: var(--mint);
  }
  .mix .relevant {
    background: var(--lavender);
  }
  .mix .seren {
    background: var(--sky);
  }
  .big {
    gap: 1.4rem;
    font-size: var(--fs-lg);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--fs-sm);
  }
  td {
    padding: 0.25rem 0.3rem;
    border-top: 1px solid var(--border);
  }
  td.num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
</style>
