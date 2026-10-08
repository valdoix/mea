<script lang="ts">
  import { post } from "../../lib/api";
  import type { CreatorSession } from "../../lib/creator.svelte";
  import { promptText } from "../../lib/dialogs.svelte";
  import { autosize } from "../../lib/gestures";
  import { ClipboardCheck, Loader, PenLine, RefreshCw, Sparkle, TriangleAlert, UserPen, Users, X } from "../../lib/icons";
  import { navigate } from "../../lib/router.svelte";
  import { errorToast } from "../../lib/state.svelte";
  import type { CreatorDraft } from "../../lib/types";

  let { session }: { session: CreatorSession } = $props();
  const draft = $derived(session.draft!);
  const isChar = $derived(draft.kind === "character");
  let steer = $state("");
  let hidden = $state<Record<string, boolean>>({});
  const issuesOf = (key: string) => (draft.bibleCheck ?? []).filter((i, k) => i.section === key && !hidden[`${key}:${k}`]).map((i) => ({ ...i, k: draft.bibleCheck!.indexOf(i) }));
  const words = $derived(draft.bible.reduce((n, b) => n + b.text.split(/\s+/).filter(Boolean).length, 0));
  const filled = $derived(draft.bible.filter((b) => b.text.trim()).length);

  async function rewrite(key: string, label: string) {
    const v = await promptText({ title: `Rewrite “${label}”`, label: "What should change?", placeholder: "She's older; the debt is to her brother, not the guild", confirmLabel: "Rewrite" });
    if (v?.trim()) await session.act(`section:${key}`, `/bible/${key}`, { steer: v.trim() });
  }

  async function twin() {
    try {
      await session.flush();
      const r = await post<{ draft: CreatorDraft }>("/api/creator", { kind: isChar ? "persona" : "character", fromDraftId: draft.id });
      navigate(`/creator/${r.draft.id}`);
    } catch (e) {
      errorToast(e);
    }
  }
</script>

<section class="stack">
  {#if !draft.bible.length}
    <p class="muted small">No bible yet. {session.busy === "bible" ? "Writing it…" : ""}</p>
    <div class="row"><button class="btn primary" onclick={() => session.act("bible", "/bible")} disabled={Boolean(session.busy)}>{session.busy === "bible" ? "Writing…" : "Write the bible"}</button></div>
  {:else}
    <div class="panel stack tight">
      <div class="row between wrap">
        <span class="small"><b>The bible</b> <span class="muted">· {filled} sections · {words} words · the source of truth for every field</span></span>
        <button class="btn small" onclick={() => session.act("check", "/bible/check")} disabled={Boolean(session.busy)}>
          {#if session.busy === "check"}<span class="spin"><Loader size={14} /></span> Reading…{:else}<ClipboardCheck size={14} /> Check it like an editor{/if}
        </button>
      </div>
      {#if draft.bibleCheck}
        <span class="tiny" class:ok={!draft.bibleCheck.length}>{draft.bibleCheck.length ? `${draft.bibleCheck.length} thing${draft.bibleCheck.length === 1 ? "" : "s"} to look at: generic choices, contradictions, missing essentials. Each has a fix you can apply.` : "The editor found nothing generic, contradictory or missing."}</span>
      {/if}
    </div>

    {#each draft.bible as b (b.key)}
      <div class="card stack tight section" class:working={session.busy === `section:${b.key}`}>
        <div class="row between">
          <b>{b.label}</b>
          <div class="row">
            {#if session.busy === `section:${b.key}`}<span class="spin"><Loader size={14} /></span>{/if}
            <button class="btn ghost small" onclick={() => session.act(`section:${b.key}`, `/bible/${b.key}`, {})} disabled={Boolean(session.busy)} title="Sharper and more specific, same facts"><Sparkle size={13} /> Sharpen</button>
            <button class="btn ghost small" onclick={() => rewrite(b.key, b.label)} disabled={Boolean(session.busy)}><PenLine size={13} /> Rewrite</button>
          </div>
        </div>
        <textarea class="textarea story" use:autosize={{ max: 500, value: b.text }} value={b.text} oninput={(e) => { b.text = e.currentTarget.value; session.save({ bible: { [b.key]: b.text } }, `bible:${b.key}`); }}></textarea>
        {#each issuesOf(b.key) as iss (iss.k)}
          <div class="issue small">
            <TriangleAlert size={14} />
            <div class="grow"><b>{iss.problem}</b>{#if iss.fix}{" "}<span class="muted">{iss.fix}</span>{/if}</div>
            {#if iss.fix}<button class="btn small" onclick={() => session.act(`section:${b.key}`, `/bible/${b.key}`, { steer: iss.fix })} disabled={Boolean(session.busy)}>Apply fix</button>{/if}
            <button class="btn ghost icon small" onclick={() => (hidden[`${b.key}:${iss.k}`] = true)} aria-label="Dismiss"><X size={13} /></button>
          </div>
        {/each}
      </div>
    {/each}

    <div class="panel stack tight">
      <div class="row wrap">
        <input class="input grow" bind:value={steer} placeholder="Rework the whole bible: older, darker, more humour, a different secret…" aria-label="How to rework the bible" />
        <button class="btn" onclick={() => session.act("bible", "/bible", { steer })} disabled={Boolean(session.busy)}><RefreshCw size={14} /> {session.busy === "bible" ? "Reworking…" : "Rework"}</button>
      </div>
      <span class="tiny muted">A rework keeps your edits and the facts you gave, and changes what you ask.</span>
    </div>

    <div class="row wrap actions">
      <button class="btn ghost" onclick={twin} disabled={Boolean(session.busy)} title={isChar ? "A persona built from this bible, to play them yourself" : "A character card built from this bible"}>
        {#if isChar}<UserPen size={15} /> Make a persona from this{:else}<Users size={15} /> Make a character from this{/if}
      </button>
      <span class="grow"></span>
      <button class="btn primary" onclick={() => session.act("write", "/write")} disabled={Boolean(session.busy)}><PenLine size={16} /> {session.busy === "write" ? "Starting…" : isChar ? "Write the card" : "Write the persona"}</button>
    </div>
  {/if}
</section>

<style>
  .section {
    padding: 0.8rem 1rem;
  }
  .section.working textarea {
    opacity: 0.6;
  }
  .issue {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    padding: 0.5rem 0.6rem;
    border-radius: var(--r-sm, 8px);
    background: var(--warn-bg);
    color: var(--text);
    flex-wrap: wrap;
  }
  .issue .grow {
    flex: 1 1 12rem;
    min-width: 0;
  }
  .ok {
    color: var(--ok);
  }
  .grow {
    flex: 1 1 12rem;
    min-width: 0;
  }
  .actions {
    align-items: center;
  }
  .spin {
    display: inline-grid;
    animation: spin 1s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
