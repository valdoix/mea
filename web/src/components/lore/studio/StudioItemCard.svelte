<script lang="ts">
  import TagInput from "../../TagInput.svelte";
  import { post } from "../../../lib/api";
  import { promptText } from "../../../lib/dialogs.svelte";
  import { navigate } from "../../../lib/router.svelte";
  import { errorToast } from "../../../lib/state.svelte";
  import { autosize } from "../../../lib/gestures";
  import { ChevronDown, ChevronRight, CircleAlert, ExternalLink, Loader, PenLine, Plus, RotateCcw, Trash, TriangleAlert, UserPen, Users } from "../../../lib/icons";
  import { STEERS, type StudioSession, typeMeta } from "../../../lib/studio.svelte";
  import type { StudioEntry, StudioIssue, StudioItem } from "../../../lib/types";

  let { session, item, issues = [], stale = [], tokens = 0, open = $bindable(false) }: { session: StudioSession; item: StudioItem; issues?: StudioIssue[]; stale?: string[]; tokens?: number; open?: boolean } = $props();

  const meta = $derived(typeMeta(item.type));
  const busy = $derived(item.status === "queued" || item.status === "writing");
  const warns = $derived(issues.filter((i) => i.severity === "warn").length);

  function saveEntry(p: Partial<StudioEntry>, delay = 500) {
    if (!item.entry) return;
    Object.assign(item.entry, p);
    session.saveItem(item.id, { entry: $state.snapshot(item.entry) }, delay);
  }

  // Links to the creator: a person in the world becomes a character card or your persona.
  let making = $state(false);
  async function makeCard(kind: "character" | "persona") {
    making = true;
    try {
      await session.flush();
      const r = await post<{ draft: { id: string } }>("/api/creator", { kind, fromLore: { draftId: session.id, itemId: item.id } });
      navigate(`/creator/${r.draft.id}`);
    } catch (e) {
      errorToast(e);
    } finally {
      making = false;
    }
  }

  async function rewrite(steer: string) {
    let s = steer;
    if (s === "…") {
      const v = await promptText({ title: `Rewrite “${item.title}”`, label: "What should change?", placeholder: "She's older, and the inn burned down last winter", confirmLabel: "Rewrite" });
      if (!v?.trim()) return;
      s = v.trim();
    }
    await session.act(`write:${item.id}`, "/write", { itemIds: [item.id], steer: s });
  }
</script>

<div class="card entry" class:out={!item.keep} id="studio-{item.id}">
  <div class="head">
    <button class="expand" onclick={() => (open = !open)} aria-expanded={open}>
      {#if open}<ChevronDown size={16} />{:else}<ChevronRight size={16} />{/if}
      {#if meta}<span class="chip tiny {meta.chip}"><meta.icon size={11} /> {meta.label}</span>{/if}
      {#if item.versionSource}<span class="chip tiny vsrc {item.versionSource.state}" title={item.versionSource.from ? `From “${item.versionSource.from}” in the original` : "Only in this version"}>{item.versionSource.state === "kept" ? "Kept" : item.versionSource.state === "new" ? "New here" : item.versionSource.from && item.versionSource.from !== item.title ? `From ${item.versionSource.from}` : "Translated"}</span>{/if}
      <span class="grow">
        <b class="wraps">{item.title}</b>
        <span class="tiny muted wraps">
          {#if busy}{item.status === "writing" ? "Writing…" : "Waiting to be written"}{:else if item.status === "error"}Failed: {item.error}{:else if item.entry}{item.entry.keys.join(", ")} · {item.entry.content.slice(0, 120)}{:else}Not written yet{item.pitch ? ` · ${item.pitch}` : ""}{/if}
        </span>
      </span>
    </button>
    {#if busy}<span class="spin"><Loader size={15} /></span>{/if}
    {#if item.savedEntryId}<span class="chip tiny mint">saved</span>{/if}
    {#if stale.length && !busy}<span class="chip tiny butter" title="Written before you changed {stale.join(', ')}">out of date</span>{/if}
    {#if warns}<span class="chip tiny rose" title="Needs a look"><TriangleAlert size={11} /> {warns}</span>{:else if issues.length}<span class="chip tiny" title="Notes"><CircleAlert size={11} /> {issues.length}</span>{/if}
    {#if item.entry}<span class="tiny faint hide-sm">{tokens} tok</span>{/if}
    <label class="switch keep" title="Include in the lorebook"><input type="checkbox" checked={item.keep} onchange={(e) => { item.keep = e.currentTarget.checked; session.saveItem(item.id, { keep: item.keep }, 0); }} /><span class="hide-sm">Keep</span></label>
  </div>

  {#if open}
    <div class="body stack">
      {#if issues.length}
        <ul class="issues">
          {#each issues as iss, k (k)}<li class="tiny" class:warn={iss.severity === "warn"}>{iss.message}</li>{/each}
        </ul>
      {/if}

      {#if item.entry}
        <fieldset class="stack" disabled={busy}>
          <label class="field">
            <span class="label">Content</span>
            <textarea class="textarea story" use:autosize={{ max: 480, value: item.entry.content }} value={item.entry.content} oninput={(e) => saveEntry({ content: e.currentTarget.value })}></textarea>
          </label>
          <div class="grid">
            <label class="field"><span class="label">Keywords</span><TagInput bind:value={() => item.entry?.keys ?? [], (v) => saveEntry({ keys: v }, 0)} placeholder="Add a keyword" /></label>
            <label class="field"><span class="label">Also called</span><TagInput bind:value={() => item.entry?.aliases ?? [], (v) => saveEntry({ aliases: v }, 0)} placeholder="Add an alias" /></label>
          </div>
          <label class="field"><span class="label">Essentials <span class="faint">one sentence</span></span><input class="input" value={item.entry.essentials} oninput={(e) => saveEntry({ essentials: e.currentTarget.value })} /></label>
          <div class="field">
            <span class="label">Secrets <span class="faint">the leak guard keeps them in the right mouths</span></span>
            {#each item.entry.secrets as sec, i (i)}
              <div class="row secret">
                <input class="input grow" value={sec.text} oninput={(e) => saveEntry({ secrets: item.entry!.secrets.map((v, j) => (j === i ? { ...v, text: e.currentTarget.value } : v)) })} />
                <input class="input who" value={sec.knownBy.join(", ")} onchange={(e) => saveEntry({ secrets: item.entry!.secrets.map((v, j) => (j === i ? { ...v, knownBy: e.currentTarget.value.split(/\s*,\s*/).filter(Boolean) } : v)) }, 0)} placeholder="Known by" />
                <button class="btn ghost icon small" onclick={() => saveEntry({ secrets: item.entry!.secrets.filter((_, j) => j !== i) }, 0)} aria-label="Remove secret"><Trash size={13} /></button>
              </div>
            {/each}
            <button class="btn ghost small" onclick={() => saveEntry({ secrets: [...item.entry!.secrets, { text: "", knownBy: [] }] }, 0)}><Plus size={13} /> Secret</button>
          </div>
        </fieldset>
      {:else if item.source}
        <p class="tiny muted pre">{item.source}</p>
      {/if}

      {#if item.type === "character" && item.entry}
        <div class="row wrap links">
          {#if item.links.characterId}<a class="btn ghost small" href="/character/{item.links.characterId}"><ExternalLink size={13} /> Open the character card</a>{/if}
          {#if item.links.personaId}<a class="btn ghost small" href="/personas/{item.links.personaId}"><ExternalLink size={13} /> Open the persona</a>{/if}
          {#if item.links.creatorDraftId && !item.links.characterId && !item.links.personaId}<a class="btn ghost small" href="/creator/{item.links.creatorDraftId}"><ExternalLink size={13} /> Continue in the creator</a>{/if}
          {#if !item.links.creatorDraftId}
            <span class="tiny muted">Bring {item.title} to life:</span>
            <button class="btn small" onclick={() => makeCard("character")} disabled={making || busy}><Users size={14} /> Make a character card</button>
            <button class="btn ghost small" onclick={() => makeCard("persona")} disabled={making || busy}><UserPen size={14} /> Make it my persona</button>
          {/if}
        </div>
      {/if}

      <div class="row wrap rewrite">
        {#if item.entry}
          <span class="tiny muted"><PenLine size={13} /> Rewrite:</span>
          {#each STEERS as s (s)}<button class="chip tiny steer" onclick={() => rewrite(s)} disabled={busy || Boolean(session.busy)}>{s}</button>{/each}
          <button class="chip tiny steer" onclick={() => rewrite("…")} disabled={busy || Boolean(session.busy)}>Something else…</button>
          <button class="chip tiny steer" onclick={() => rewrite("")} disabled={busy || Boolean(session.busy)}>Fresh draft</button>
          {#if item.previous}<button class="btn ghost small" onclick={() => session.act("restore", `/items/${item.id}/restore`)} disabled={busy}><RotateCcw size={13} /> Previous version</button>{/if}
        {:else}
          <button class="btn small" onclick={() => rewrite(item.steer)} disabled={busy || Boolean(session.busy)}><PenLine size={14} /> {item.status === "error" ? "Try again" : "Write it"}</button>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .vsrc.kept {
    background: color-mix(in srgb, var(--sky, #9cc4ee) 28%, transparent);
  }
  .vsrc.changed {
    background: color-mix(in srgb, var(--lavender, #c7b8ec) 34%, transparent);
  }
  .vsrc.new {
    background: color-mix(in srgb, var(--mint, #9fe0c0) 30%, transparent);
  }
  .entry.out {
    opacity: 0.55;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.3rem 0.6rem 0.3rem 0.2rem;
  }
  .expand {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.45rem;
    border: 0;
    background: none;
    color: var(--text);
    cursor: pointer;
    text-align: left;
    padding: 0.4rem;
    font: inherit;
  }
  .expand .grow {
    display: grid;
    min-width: 0;
  }
  .expand .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    flex: none;
  }
  .spin {
    display: grid;
    animation: spin 1s linear infinite;
    color: var(--text-muted);
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .keep {
    gap: 0.3rem;
    font-size: var(--fs-xs);
  }
  .body {
    padding: 0.5rem 1rem 1rem;
    border-top: 1px solid var(--border);
  }
  fieldset {
    border: 0;
    margin: 0;
    padding: 0;
    min-width: 0;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
    gap: 0.8rem;
  }
  .issues {
    margin: 0;
    padding-left: 1.1rem;
    display: grid;
    gap: 0.2rem;
    color: var(--text-muted);
  }
  .issues .warn {
    color: var(--danger);
  }
  .secret {
    gap: 0.4rem;
    margin-bottom: 0.3rem;
    flex-wrap: wrap;
  }
  .secret .grow {
    flex: 1 1 12rem;
    min-width: 0;
  }
  .who {
    width: 10rem;
  }
  .links {
    gap: 0.4rem;
    align-items: center;
    padding: 0.5rem 0.6rem;
    border-radius: var(--r-sm, 8px);
    background: color-mix(in srgb, var(--rose, var(--accent)) 12%, transparent);
  }
  .rewrite {
    gap: 0.3rem;
    align-items: center;
  }
  .steer {
    cursor: pointer;
    border: 1px solid var(--border);
    font: inherit;
    font-size: var(--fs-xs);
  }
  .steer:disabled {
    cursor: default;
    opacity: 0.5;
  }
  .pre {
    white-space: pre-wrap;
    margin: 0;
  }
  @media (max-width: 640px) {
    .who {
      width: 100%;
    }
    .hide-sm {
      display: none;
    }
  }
</style>
