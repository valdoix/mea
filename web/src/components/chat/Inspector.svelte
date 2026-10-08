<script lang="ts">
  import Modal from "../Modal.svelte";
  import { get } from "../../lib/api";
  import { compact } from "../../lib/format";
  import { Copy } from "../../lib/icons";
  import { toast } from "../../lib/state.svelte";
  import type { PromptTrace } from "../../lib/types";

  let { open = $bindable(false), chatId, generationId = null }: { open?: boolean; chatId: string; generationId?: string | null } = $props();

  interface Data {
    model?: string;
    profile?: string;
    messages: { role: string; content: string }[];
    trace: PromptTrace | null;
    estPromptTokens?: number;
    promptTokens?: number | null;
    cachedTokens?: number | null;
    error?: string;
  }

  let data = $state<Data | null>(null);
  let showLore = $state<"active" | "all">("active");
  let expanded = $state<Record<number, boolean>>({});

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
        }))
      : get<any>(`/api/chats/${chatId}/prompt-preview`).then((p) => ({ model: p.model, profile: p.profile, messages: p.messages, trace: p.trace, estPromptTokens: p.estPromptTokens }));
    load.then((d) => (data = d)).catch((e) => (data = { messages: [], trace: null, error: (e as Error).message }));
  });

  const b = $derived(data?.trace?.budget);
  const pct = (n: number) => (b ? `${Math.max(0, Math.min(100, (n / b.contextTarget) * 100))}%` : "0%");
  const lore = $derived((data?.trace?.lore ?? []).filter((l) => showLore === "all" || l.status === "active"));

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
      </div>

      {#if b}
        <div class="budget" title="Prompt budget">
          <span class="seg fixed" style:width={pct(b.fixed)} title="Instructions, card, lore: {b.fixed}"></span>
          <span class="seg hist" style:width={pct(b.history)} title="History: {b.history}"></span>
          <span class="seg reserve" style:width={pct(b.reserve)} title="Reserved for the reply: {b.reserve}"></span>
        </div>
        <div class="row wrap tiny muted legend">
          <span><i class="dot fixed"></i>Setup {compact(b.fixed)}</span>
          <span><i class="dot hist"></i>History {compact(b.history)}</span>
          <span><i class="dot reserve"></i>Reply {compact(b.reserve)}</span>
          <span>Target {compact(b.contextTarget)}</span>
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

        <details open>
          <summary>
            <b>Lorebook entries</b>
            <span class="tiny muted">({data.trace.lore.filter((l) => l.status === "active").length} active of {data.trace.lore.length})</span>
            <button class="btn ghost small" onclick={(e) => { e.preventDefault(); showLore = showLore === "all" ? "active" : "all"; }}>{showLore === "all" ? "Active only" : "Show all"}</button>
          </summary>
          {#if lore.length}
            <table>
              <tbody>
                {#each lore as l (l.id)}
                  <tr class:off={l.status !== "active"}>
                    <td>{l.comment}</td>
                    <td class="muted">{l.bookName}</td>
                    <td class="num">{l.tokens ?? ""}</td>
                    <td class={l.status === "active" ? "ok" : "muted"}>{l.reason}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {:else}
            <p class="tiny muted">No entries {showLore === "active" ? "fired" : "in scope"}.</p>
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
                <span class="truncate grow muted small">{m.content.slice(0, 140)}</span>
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
  .summary {
    gap: 0.4rem;
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
