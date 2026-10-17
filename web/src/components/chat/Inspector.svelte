<script lang="ts">
  import Modal from "../Modal.svelte";
  import { get, patch, post } from "../../lib/api";
  import { compact } from "../../lib/format";
  import { Copy } from "../../lib/icons";
  import { toast } from "../../lib/state.svelte";
  import type { PromptTrace } from "../../lib/types";

  let { open = $bindable(false), chatId, generationId = null, onregenerate }: { open?: boolean; chatId: string; generationId?: string | null; onregenerate?: () => void } = $props();

  interface Data {
    model?: string;
    profile?: string;
    messages: { role: string; content: string }[];
    trace: PromptTrace | null;
    estPromptTokens?: number;
    promptTokens?: number | null;
    cachedTokens?: number | null;
    /** PERF-10 */
    ttftMs?: number | null;
    tokensPerSec?: number | null;
    error?: string;
  }

  let data = $state<Data | null>(null);
  let showLore = $state<"active" | "all">("active");
  let expanded = $state<Record<number, boolean>>({});
  let laneOpen = $state<Record<string, boolean>>({});
  // H1: "Keep this next time" pins a block for this chat: it's never cut to fit the ceiling.
  let kept = $state<string[]>([]);
  // H3: the plan this reply was written from; edit it and regenerate.
  const planBlock = $derived(data?.trace?.blocks.find((b) => b.id === "extra:advisor" && b.included) ?? null);
  let editingPlan = $state(false);
  let planDraft = $state("");
  const planOf = (t: string) => (t.match(/<director-plan>\n?([\s\S]*?)\n?<\/director-plan>/)?.[1] ?? t.replace(/^\[Private plan[^\]]*\]\n?/, "")).trim();
  async function savePlan() {
    if (!generationId) return;
    try {
      await post(`/api/chats/${chatId}/plan`, { generationId, text: planDraft });
      editingPlan = false;
      open = false;
      onregenerate?.();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't save the plan");
    }
  }
  // H2: cost per reply (writer + planner + background).
  let cost = $state<{ writer: { tokens: number }; planner: { tokens: number } | null; background: { tokens: number } | null; total: { tokens: number; cost: number } } | null>(null);
  $effect(() => {
    cost = null;
    if (!open || !generationId) return;
    void get<{ cost: typeof cost }>(`/api/generations/${generationId}/cost`)
      .then((r) => (cost = r.cost))
      .catch(() => {});
  });
  $effect(() => {
    if (!open) return;
    void get<{ chat: { settings: { promptKeep?: string[] } } }>(`/api/chats/${chatId}`)
      .then((d) => (kept = d.chat.settings.promptKeep ?? []))
      .catch(() => {});
  });
  async function keepNext(key: string) {
    try {
      const d = await get<{ chat: { settings: { promptKeep?: string[] } } }>(`/api/chats/${chatId}`);
      const next = [...new Set([...(d.chat.settings.promptKeep ?? []), key])];
      await patch(`/api/chats/${chatId}`, { settings: { promptKeep: next } });
      kept = next;
      toast("Kept: it won't be cut in this chat", { kind: "ok" });
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't keep it");
    }
  }

  $effect(() => {
    if (!open) return;
    data = null;
    expanded = {};
    const load = generationId
      ? get<any>(`/api/generations/${generationId}`).then((g) => ({
          model: g.model_id,
          messages: g.request?.messages ?? [],
          trace: g.trace,
          estPromptTokens: g.est_prompt_tokens,
          promptTokens: g.prompt_tokens,
          cachedTokens: g.cached_tokens,
          ttftMs: g.first_token_at ? g.first_token_at - g.started_at : null,
          tokensPerSec: g.completion_tokens && g.first_token_at && g.finished_at > g.first_token_at ? Math.round((g.completion_tokens / ((g.finished_at - g.first_token_at) / 1000)) * 10) / 10 : null,
        }))
      : get<any>(`/api/chats/${chatId}/prompt-preview`).then((p) => ({ model: p.model, profile: p.profile, messages: p.messages, trace: p.trace, estPromptTokens: p.estPromptTokens }));
    load.then((d) => (data = d)).catch((e) => (data = { messages: [], trace: null, error: (e as Error).message }));
  });

  const b = $derived(data?.trace?.budget);
  const pct = (n: number) => (b ? `${Math.max(0, Math.min(100, (n / b.contextTarget) * 100))}%` : "0%");
  const mem = $derived(data?.trace?.memory);
  const windowNote = { kept: "window unchanged", advanced: "older messages moved into memory", restored: "window widened again" } as const;
  const levelChip: Record<string, string> = { scene: "", chapter: "lavender", arc: "peach", story: "butter" };
  const slotChip: Record<string, string> = { pinned: "butter", recent: "mint", relevant: "lavender", serendipity: "sky", entity: "mint", deep: "butter" };
  const slotName: Record<string, string> = { pinned: "pinned", recent: "recent", relevant: "relevant", serendipity: "callback", entity: "in play", deep: "quoted" };
  // docs/15, 6.3: what fired, by tier (the focus, around it, the rest), then what the budget cut.
  const TIER_ORDER = { focus: 0, around: 1 } as Record<string, number>;
  const lore = $derived(
    (data?.trace?.lore ?? [])
      .filter((l) => showLore === "all" || l.status === "active")
      .slice()
      .sort((a, b) => Number(a.status !== "active") - Number(b.status !== "active") || (TIER_ORDER[a.tier ?? ""] ?? 2) - (TIER_ORDER[b.tier ?? ""] ?? 2)),
  );
  const cut = $derived((data?.trace?.lore ?? []).filter((l) => l.status !== "active" && l.reason.startsWith("over token budget")));
  const TIER_LABEL: Record<string, string> = { focus: "Focus", around: "Around" };

  function copyJson() {
    navigator.clipboard?.writeText(JSON.stringify(data?.messages ?? [], null, 2));
    toast("Prompt copied as JSON", { kind: "ok" });
  }
</script>

<Modal bind:open title={generationId ? "What the model received" : "Next prompt (preview)"} size="xl">
  {#snippet actions()}
    <button class="btn small" onclick={copyJson} disabled={!data?.messages.length}><Copy size={14} /> JSON</button>
  {/snippet}
  {#if !data}
    <p class="muted">Loading…</p>
  {:else if data.error}
    <div class="notice error">{data.error}</div>
  {:else}
    <div class="stack">
      <div class="row wrap summary">
        {#if data.model}<span class="chip lavender">{data.model}</span>{/if}
        {#if data.profile}<span class="chip">{data.profile}</span>{/if}
        <span class="chip mint">≈ {compact(data.estPromptTokens)} tokens estimated</span>
        {#if data.promptTokens}<span class="chip butter">{compact(data.promptTokens)} reported by provider</span>{/if}
        {#if data.cachedTokens}<span class="chip sky">{compact(data.cachedTokens)} cached</span>{/if}
        {#if data.trace}<span class="chip">{data.trace.history.included}/{data.trace.history.total} messages in context</span>{/if}
        {#if cost}<span class="chip" title="The writer, the planner and the background work this reply set off">cost: writer {compact(cost.writer.tokens)}{cost.planner?.tokens ? ` + planner ${compact(cost.planner.tokens)}` : ""}{cost.background?.tokens ? ` + background ${compact(cost.background.tokens)}` : ""} = {compact(cost.total.tokens)} tokens{cost.total.cost ? ` · $${cost.total.cost.toFixed(4)}` : ""}</span>{/if}
      </div>

      {#if data.trace?.timing || data.ttftMs != null}
        {@const t = data.trace?.timing}
        <div class="row wrap tiny timing" aria-label="Timing">
          <b>Timing</b>
          {#if t}<span title="Building the prompt: trackers {t.trackersMs} ms, memory recall {t.retrievalMs} ms, lore {t.loreMs} ms, advisor {t.advisorMs} ms, assembly {t.assemblyMs} ms">prompt {Math.round(t.totalMs)} ms <span class="faint">(recall {Math.round(t.retrievalMs)} · lore {Math.round(t.loreMs)} · trackers {Math.round(t.trackersMs)} · assembly {Math.round(t.assemblyMs)})</span></span>{/if}
          {#if data.ttftMs != null}<span>first token {(data.ttftMs / 1000).toFixed(2)} s</span>{/if}
          {#if data.tokensPerSec}<span>{data.tokensPerSec} tokens/s</span>{/if}
          {#if data.promptTokens}<span>cache hit {Math.round(((data.cachedTokens ?? 0) / data.promptTokens) * 100)}%</span>{/if}
        </div>
      {/if}

      {#if b}
        <div class="budget" title="Prompt budget">
          <span class="seg fixed" style:width={pct(b.fixed)} title="Instructions, card, lore: {b.fixed}"></span>
          {#if b.memory}<span class="seg mem" style:width={pct(b.memory)} title="Story So Far: {b.memory}"></span>{/if}
          {#if b.recall}<span class="seg recall" style:width={pct(b.recall)} title="Recalled memories: {b.recall}"></span>{/if}
          <span class="seg hist" style:width={pct(b.history)} title="History: {b.history}"></span>
          <span class="seg reserve" style:width={pct(b.reserve)} title="Reserved for the reply: {b.reserve}"></span>
        </div>
        <div class="row wrap tiny muted legend">
          <span><i class="dot fixed"></i>Setup {compact(b.fixed)}</span>
          {#if b.memory}<span><i class="dot mem"></i>Story So Far {compact(b.memory)}</span>{/if}
          {#if b.recall}<span><i class="dot recall"></i>Recall {compact(b.recall)}</span>{/if}
          <span><i class="dot hist"></i>History {compact(b.history)}</span>
          <span><i class="dot reserve"></i>Reply {compact(b.reserve)}</span>
          <span>Target {compact(b.effectiveTarget ?? b.contextTarget)}{b.ratio && b.ratio !== 1 ? ` (calibrated ×${b.ratio.toFixed(2)})` : ""}</span>
        </div>
      {/if}

      {#if data.trace}
        <details open>
          <summary><b>Blocks</b></summary>
          <table>
            <tbody>
              {#each data.trace.blocks as blk (blk.id)}
                <tr class:off={!blk.included}>
                  <td>{blk.name}</td>
                  <td class="muted">{blk.role}{blk.depth != null ? ` · depth ${blk.depth}` : ""}</td>
                  <td class="num">{blk.included && blk.kind !== "history" ? blk.tokens : ""}</td>
                  <td class="muted">{blk.note ?? (blk.kind === "history" ? `${data.trace.history.included} messages${data.trace.history.dropped ? `, ${data.trace.history.dropped} older ones left out` : ""}` : "")}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </details>

        {@const lanes = data.trace.blocks.filter((x) => x.lane && x.included)}
        {#if lanes.length}
          <details open>
            <summary><b>Lanes</b> <span class="tiny muted">what Mea's story features added this turn · {compact(lanes.reduce((n, x) => n + x.tokens, 0))} tokens</span></summary>
            {#each lanes as l (l.id)}
              <div class="lane">
                <button type="button" class="lane-h" onclick={() => (laneOpen = { ...laneOpen, [l.id]: !laneOpen[l.id] })} aria-expanded={Boolean(laneOpen[l.id])}>
                  <span>{l.name}</span><span class="tiny muted">{l.tokens} tokens{l.depth != null ? ` · depth ${l.depth}` : ""}</span>
                </button>
                {#if laneOpen[l.id] && l.text}<pre class="lane-t">{l.text}</pre>{/if}
              </div>
            {/each}
          </details>
        {/if}

        {#if data.trace.craft && data.trace.craft.replies >= 2}
          {@const c = data.trace.craft}
          <div class="row wrap tiny craft" aria-label="Craft meter">
            <b>Craft</b>
            <span title="Filter words (felt, noticed…) per 100 words, last {c.replies} replies">filter {c.filter}</span>
            <span title="Em-dashes per 100 words">dashes {c.emdash}</span>
            <span title="Ellipses per 100 words">ellipses {c.ellipsis}</span>
            <span title="Lists of three per reply">threes {c.triads}</span>
            <span title="Share of the text in dialogue{c.baselineDialogue != null ? `; usually ${Math.round(c.baselineDialogue * 100)}%` : ''}">dialogue {Math.round(c.dialogue * 100)}%{c.baselineDialogue != null ? ` (usually ${Math.round(c.baselineDialogue * 100)}%)` : ""}</span>
            {#if c.topOpening}<span title="The most common first word of a sentence">“{c.topOpening.word}” opens {Math.round(c.topOpening.share * 100)}%</span>{/if}
          </div>
        {/if}

        {#if planBlock?.text}
          <details open>
            <summary><b>{planBlock.name}</b> <span class="tiny muted">{compact(planBlock.tokens)} tokens</span></summary>
            {#if editingPlan}
              <textarea class="textarea" rows="10" bind:value={planDraft} aria-label="The plan"></textarea>
              <div class="row">
                <button type="button" class="btn small primary" disabled={!planDraft.trim() || !generationId} onclick={savePlan}>Regenerate with this plan</button>
                <button type="button" class="btn ghost small" onclick={() => (editingPlan = false)}>Cancel</button>
              </div>
            {:else}
              <pre class="lane-t">{planBlock.text}</pre>
              {#if generationId && onregenerate}<button type="button" class="btn ghost small" onclick={() => ((planDraft = planOf(planBlock.text ?? "")), (editingPlan = true))}>Edit the plan and regenerate</button>{/if}
            {/if}
          </details>
        {/if}

        {#if data.trace.ceiling}
          {@const cl = data.trace.ceiling}
          <details open={cl.cuts.length > 0}>
            <summary><b>Ceiling</b> <span class="tiny muted">what Mea adds: {compact(cl.after)} of {compact(cl.tokens)} tokens{cl.auto ? " (automatic)" : ""}{cl.cuts.length ? ` · ${cl.cuts.length} cut to fit (${compact(cl.before - cl.after)} tokens)` : " · nothing cut"}</span></summary>
            {#each cl.cuts as c (c.key)}
              <div class="row between cut">
                <span class="small">{c.name} <span class="tiny faint">{compact(c.tokens)} tokens</span></span>
                {#if kept.includes(c.key)}<span class="tiny muted">kept from next time</span>{:else}<button type="button" class="btn ghost small" onclick={() => keepNext(c.key)}>Keep this next time</button>{/if}
              </div>
            {/each}
            <p class="tiny faint">The order is in Settings › Memory › What goes first when space is short.</p>
          </details>
        {/if}

        {#if data.trace.reworded?.length}
          <details>
            <summary><b>Reworded for the secret</b> <span class="tiny muted">{data.trace.reworded.length} block{data.trace.reworded.length === 1 ? "" : "s"} kept off the page</span></summary>
            {#each data.trace.reworded as r, i (i)}
              <div class="lane">
                <p class="tiny muted">{r.where} · {r.by === "model" ? "reworded by the helper" : "sentences left out by the rules (the helper's rewording comes next time)"}</p>
                <pre class="lane-t">{r.after || "(nothing left)"}</pre>
              </div>
            {/each}
          </details>
        {/if}

        {#if mem}
          <details open>
            <summary>
              <b>Memory</b>
              <span class="tiny muted">{mem.enabled ? `${mem.telescope.length} summaries · ${mem.recall.length} recalled` : "off"}</span>
            </summary>
            {#if !mem.enabled}
              <p class="tiny muted">Memory is off for this reply. Turn it on in Settings → Memory.</p>
            {:else}
              <div class="stack tight memsec">
                <p class="tiny muted">
                  Verbatim window: {mem.window.messages} {mem.window.messages === 1 ? "message" : "messages"} ({compact(mem.window.tokens)}{mem.window.budget ? ` of ${compact(mem.window.budget)}` : ""} tokens) · {windowNote[mem.window.moved]}{mem.evictedThrough ? ` · messages up to #${mem.evictedThrough} are covered by summaries` : ""}
                </p>
                {#if mem.window.unsafe}<div class="notice warn tiny">Some messages left the window before memory had summarized them; the reply may miss details from them.</div>{/if}
                {#each mem.gaps as g (g.startSeq)}<div class="notice warn tiny">Not summarized yet: #{g.startSeq}–#{g.endSeq} ({g.reason})</div>{/each}

                <h4>Story So Far <span class="tiny muted">{compact(mem.telescopeTokens)} / {compact(mem.telescopeBudget)} tokens{mem.dropped ? ` · ${mem.dropped} oldest folded away` : ""}</span></h4>
                {#if mem.telescope.length}
                  <table>
                    <tbody>
                      {#each mem.telescope as t (t.id)}
                        <tr>
                          <td><span class="chip {levelChip[t.level]}">{t.level}</span> {t.title || "Untitled"}</td>
                          <td class="muted">#{t.startSeq}–#{t.endSeq}</td>
                          <td class="num">{t.tokens}</td>
                          <td class="muted">{t.state === "ready" ? "" : t.state}</td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                {:else}
                  <p class="tiny muted">Nothing has left the verbatim window yet, so no summaries were needed.</p>
                {/if}

                <h4>Recalled <span class="tiny muted">{compact(mem.recallTokens)} / {compact(mem.recallBudget)} tokens{mem.vector ? " · keywords + meaning" : " · keywords only"}</span></h4>
                {#if mem.queries?.length}
                  <div class="tiny muted how">
                    Searched with {mem.queries.map((q) => `${q.label}${q.vector ? "" : " (keywords)"}`).join(" · ")}.
                    {#if mem.pov}Remembered as {mem.pov}{#if mem.stats?.filteredPov} ({mem.stats.filteredPov} memories they couldn't know were left out){/if}.{:else}Narrator's view: everything.{/if}
                    {#if mem.stats?.librarian === "used"}The librarian picked from the candidates.{/if}
                    {#if mem.stats?.deep}{mem.stats.deep} quote{mem.stats.deep === 1 ? "" : "s"} found by deep search.{/if}
                    {#if mem.index && mem.index.coverage < 0.95}Meaning search index {Math.round(mem.index.coverage * 100)}% ready.{/if}
                    {#if mem.journalTokens}The character's journal rode along ({compact(mem.journalTokens)} tokens).{/if}
                    Written as “{mem.format ?? "prose"}”.
                  </div>
                {/if}
                {#if mem.recall.length}
                  <table>
                    <tbody>
                      {#each mem.recall as r (r.ownerType + r.id)}
                        <tr>
                          <td><span class="chip {slotChip[r.slot]}">{slotName[r.slot] ?? r.slot}</span></td>
                          <td>{r.content}<div class="tiny muted">{r.type}{r.seq != null ? ` · #${r.seq}` : ""}{r.when ? ` · ${r.when}` : ""}{r.where ? `, at ${r.where}` : ""}{r.confirmed ? " · confirmed by you" : ""}{r.disputed ? " · disputed" : ""}{r.reasons.length ? ` · ${r.reasons.join(", ")}` : ""}</div></td>
                          <td class="num">{r.tokens}</td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                {:else}
                  <p class="tiny muted">Nothing recalled for this reply.</p>
                {/if}
                {#if mem.query}<p class="tiny faint">Searched for: “{mem.query.slice(0, 200)}”</p>{/if}
              </div>
            {/if}
          </details>
        {/if}

        <details open>
          <summary>
            <b>Lorebook entries</b>
            <span class="tiny muted">({data.trace.lore.filter((l) => l.status === "active").length} active of {data.trace.lore.length})</span>
            <button class="btn ghost small" onclick={(e) => { e.preventDefault(); showLore = showLore === "all" ? "active" : "all"; }}>{showLore === "all" ? "Active only" : "Show all"}</button>
          </summary>
          {#if lore.length}
            <table>
              <tbody>
                {#each lore as l, i (l.id)}
                  {#if l.status === "active" && (i === 0 || lore[i - 1]!.tier !== l.tier) && (l.tier || lore.some((x) => x.tier))}
                    <tr class="tierrow"><td colspan="4" class="tiny muted">{l.tier ? TIER_LABEL[l.tier] : "Other"}{l.tier === "around" ? " · essentials and what's true now" : l.tier === "focus" ? " · the full entry" : ""}</td></tr>
                  {/if}
                  <tr class:off={l.status !== "active"}>
                    <td>{l.comment}{#if l.why}<span class="chip tiny why">{l.why}</span>{/if}</td>
                    <td class="muted">{l.bookName}</td>
                    <td class="num">{l.tokens ?? ""}</td>
                    <td class={l.status === "active" ? "ok" : "muted"}>{l.reason}{#if l.facts?.length}<div class="tiny muted" title="The facts it sent">Now: {l.facts.join(" · ")}</div>{/if}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {:else}
            <p class="tiny muted">No entries {showLore === "active" ? "fired" : "in scope"}.</p>
          {/if}
          {#if cut.length && showLore === "active"}
            <p class="tiny muted cut">Cut for the budget: {cut.map((l) => `${l.comment}${l.why ? ` (${l.why})` : ""}`).join(" · ")}</p>
          {/if}
        </details>
      {/if}

      <details>
        <summary><b>Messages</b> <span class="tiny muted">({data.messages.length})</span></summary>
        <div class="msgs">
          {#each data.messages as m, i (i)}
            <div class="m">
              <button class="mhead" onclick={() => (expanded[i] = !expanded[i])}>
                <span class="chip {m.role === 'system' ? 'butter' : m.role === 'user' ? 'lavender' : 'rose'}">{m.role}</span>
                <span class="wraps grow muted small">{m.content.slice(0, 140)}</span>
              </button>
              {#if expanded[i]}<pre>{m.content}</pre>{/if}
            </div>
          {/each}
        </div>
      </details>
    </div>
  {/if}
</Modal>

<style>
  .timing {
    gap: 0.9rem;
    color: var(--text-muted);
  }
  .summary {
    gap: 0.4rem;
  }
  .craft {
    gap: 0.4rem 0.9rem;
    color: var(--text-muted);
  }
  .lane {
    border-top: 1px solid var(--border);
  }
  .lane-h {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    width: 100%;
    padding: 0.35rem 0;
    border: 0;
    background: none;
    color: var(--text);
    font: inherit;
    font-size: 0.85rem;
    text-align: start;
    cursor: pointer;
  }
  .lane-t {
    margin: 0 0 0.5rem;
    padding: 0.5rem 0.65rem;
    border-radius: var(--r-sm);
    background: var(--surface-2);
    font-size: 0.78rem;
    white-space: pre-wrap;
  }
  .budget {
    display: flex;
    height: 0.7rem;
    border-radius: var(--r-pill);
    background: var(--surface-2);
    overflow: hidden;
  }
  .seg.fixed,
  .dot.fixed {
    background: var(--lavender);
  }
  .seg.mem,
  .dot.mem {
    background: var(--butter);
  }
  .how {
    margin: 0.2rem 0 0.4rem;
    line-height: 1.5;
  }
  .seg.recall,
  .dot.recall {
    background: var(--sky);
  }
  .memsec h4 {
    margin: 0.4rem 0 0;
    font-size: var(--fs-sm);
  }
  .seg.hist,
  .dot.hist {
    background: var(--accent);
  }
  .seg.reserve,
  .dot.reserve {
    background: var(--mint);
  }
  .legend {
    gap: 0.9rem;
  }
  .dot {
    display: inline-block;
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 50%;
    margin-right: 0.3rem;
    vertical-align: -0.05rem;
  }
  details {
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    padding: 0.5rem 0.8rem;
  }
  summary {
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--fs-sm);
    margin-top: 0.5rem;
  }
  td {
    padding: 0.3rem 0.4rem;
    border-top: 1px solid var(--border);
    vertical-align: top;
  }
  td.num {
    text-align: right;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  td.ok {
    color: var(--ok);
  }
  tr.off td {
    opacity: 0.6;
  }
  .tierrow td {
    padding-top: 0.5rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .why {
    margin-left: 0.35rem;
  }
  .cut {
    margin: 0.4rem 0 0;
  }
  .msgs {
    display: grid;
    gap: 0.3rem;
    margin-top: 0.5rem;
  }
  .mhead {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    border: 0;
    background: none;
    cursor: pointer;
    text-align: left;
    padding: 0.25rem 0;
    color: inherit;
  }
  pre {
    white-space: pre-wrap;
    font-family: var(--font-mono);
    font-size: 0.78rem;
    background: var(--surface-2);
    padding: 0.7rem;
    border-radius: var(--r-sm);
    margin: 0.2rem 0 0.6rem;
    max-height: 22rem;
    overflow: auto;
  }
</style>
