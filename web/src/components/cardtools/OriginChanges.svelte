<script lang="ts">
  import { get, post, put } from "../../lib/api";
  import { wordDiff } from "../../lib/diff";
  import { onEvent } from "../../lib/events";
  import { ArrowDown, Check, RefreshCw, WandSparkles, X } from "../../lib/icons";
  import { errorToast, toast } from "../../lib/state.svelte";
  import type { OriginChange, OriginSync } from "../../lib/types";

  /**
   * Changes from the original (docs/14, part 5). What the version kept the same is taken straight
   * across; what it changed is translated again through its map, and you see the result first.
   * Anything you edited in the version yourself is its own and never shows here.
   */
  let { kind, id, onchanged }: { kind: "character" | "persona"; id: string; onchanged: () => void } = $props();

  const base = $derived(`/api/${kind === "persona" ? "personas" : "characters"}/${id}/origin-changes`);
  let info = $state<OriginSync | null>(null);
  let busy = $state<string | null>(null);
  /** Translations waiting for your OK, by change key. */
  let drafts = $state<Record<string, { text: string; leaks: string[] }>>({});

  async function load() {
    try {
      info = await get<OriginSync>(base);
    } catch (e) {
      errorToast(e);
    }
  }
  $effect(() => {
    void base;
    drafts = {};
    void load();
  });
  $effect(() => onEvent((e) => e.type === "inbox.changed" && void load()));

  const kept = $derived((info?.changes ?? []).filter((c) => c.state === "kept"));

  function done(r: OriginSync & { undo: string }, message: string) {
    info = r;
    for (const k of Object.keys(drafts)) if (!r.changes.some((c) => c.key === k)) delete drafts[k];
    onchanged();
    toast(message, { kind: "ok", action: { label: "Undo", run: async () => (await post(`/api/undo/${r.undo}`), await load(), onchanged()) } });
  }

  async function take(keys: string[], texts?: Record<string, string>) {
    busy = keys.join(",");
    try {
      done(await post<OriginSync & { undo: string }>(`${base}/take`, { keys, texts }), keys.length === 1 ? "Taken from the original" : `Took ${keys.length} changes`);
    } catch (e) {
      errorToast(e);
    } finally {
      busy = null;
    }
  }

  async function skip(c: OriginChange) {
    busy = c.key;
    try {
      done(await post<OriginSync & { undo: string }>(`${base}/skip`, { keys: [c.key] }), `${c.label} is this version's own now`);
    } catch (e) {
      errorToast(e);
    } finally {
      busy = null;
    }
  }

  async function translate(c: OriginChange) {
    busy = c.key;
    try {
      const r = await post<{ text: string; leaks: string[] }>(`${base}/translate`, { key: c.key });
      drafts[c.key] = r;
    } catch (e) {
      errorToast(e);
    } finally {
      busy = null;
    }
  }

  async function setAuto(auto: boolean) {
    try {
      info = await put<OriginSync>(base, { auto });
      onchanged();
    } catch (e) {
      errorToast(e);
    }
  }
</script>

{#if info?.origin}
  <div class="field stack tight">
    <div class="row between wrap">
      <span class="label"><RefreshCw size={13} /> Changes from {info.origin.name}</span>
      <label class="switch tiny"><input type="checkbox" checked={info.auto} onchange={(e) => setAuto(e.currentTarget.checked)} /> Auto-sync</label>
    </div>
    <span class="tiny faint">{info.auto ? `What this version keeps the same as ${info.origin.name} updates by itself; what it changed still asks.` : `When ${info.origin.name} changes, what this version kept the same can be taken across, and what it changed can be translated again.`} What you edit here yourself is never overwritten.</span>
    {#if !info.changes.length}
      <p class="small muted">Up to date with {info.origin.name}.</p>
    {:else}
      {#if kept.length > 1}<div class="row"><button class="btn small" onclick={() => take(kept.map((c) => c.key))} disabled={busy !== null}><ArrowDown size={13} /> Take all {kept.length} kept changes</button></div>{/if}
      {#each info.changes as c (c.key)}
        <article class="change card">
          <div class="row between wrap">
            <b class="wraps">{c.label}{c.target === "entry" ? " (lore)" : ""}</b>
            <span class="chip tiny {c.state === 'kept' ? 'mint' : 'butter'}">{c.state === "kept" ? "Kept the same" : "Changed for this version"}</span>
          </div>
          <span class="tiny faint">What changed in {info.origin.name}:</span>
          <p class="small diff">{#each wordDiff(c.was, c.now) as part, i (i)}<span class={part.type}>{part.text}</span>{/each}</p>
          {#if drafts[c.key]}
            <span class="tiny faint">This version, with the new part translated:</span>
            <p class="small diff">{#each wordDiff(c.mine, drafts[c.key]!.text) as part, i (i)}<span class={part.type}>{part.text}</span>{/each}</p>
            {#if drafts[c.key]!.leaks.length}<p class="tiny warn">Uses {drafts[c.key]!.leaks.join(", ")}, which this version's map changed or dropped.</p>{/if}
            <div class="row wrap">
              <button class="btn primary small" onclick={() => take([c.key], { [c.key]: drafts[c.key]!.text })} disabled={busy !== null}><Check size={13} /> Take this</button>
              <button class="btn ghost small" onclick={() => translate(c)} disabled={busy !== null}><WandSparkles size={13} /> Again</button>
              <button class="btn ghost small" onclick={() => delete drafts[c.key]}><X size={13} /> Discard</button>
            </div>
          {:else}
            <div class="row wrap">
              {#if c.state === "kept"}
                <button class="btn primary small" onclick={() => take([c.key])} disabled={busy !== null}><ArrowDown size={13} /> Take the change</button>
              {:else}
                <button class="btn primary small" onclick={() => translate(c)} disabled={busy !== null}><WandSparkles size={13} /> {busy === c.key ? "Translating…" : "Translate the new part"}</button>
              {/if}
              <button class="btn ghost small" onclick={() => skip(c)} disabled={busy !== null}>Not for this version</button>
            </div>
          {/if}
        </article>
      {/each}
    {/if}
  </div>
{/if}

<style>
  .change {
    display: grid;
    gap: 0.35rem;
    padding: 0.6rem 0.75rem;
    min-width: 0;
  }
  .diff {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    background: var(--surface-2);
    border-radius: var(--r-sm);
    padding: 0.4rem 0.55rem;
  }
  .diff :global(.del) {
    background: color-mix(in srgb, var(--danger) 14%, transparent);
    text-decoration: line-through;
  }
  .diff :global(.add) {
    background: color-mix(in srgb, var(--mint) 35%, transparent);
  }
  .warn {
    margin: 0;
    color: var(--danger);
  }
</style>
