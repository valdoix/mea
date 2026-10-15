<script lang="ts">
  import type { CreatorSession } from "../../lib/creator.svelte";
  import { post } from "../../lib/api";
  import { confirm } from "../../lib/dialogs.svelte";
  import { BookOpen, ClipboardCheck, ClockAlert, ExternalLink, MessageHeart, PenLine, RefreshCw, Save, Square, TriangleAlert, Users, WandSparkles, X } from "../../lib/icons";
  import { navigate } from "../../lib/router.svelte";
  import { errorToast, toast } from "../../lib/state.svelte";
  import type { CreatorDraft } from "../../lib/types";
  import CreatorDepth from "./CreatorDepth.svelte";
  import CreatorField from "./CreatorField.svelte";
  import CreatorPairing from "./CreatorPairing.svelte";

  let { session }: { session: CreatorSession } = $props();
  const draft = $derived(session.draft!);
  const review = $derived(session.review);
  const isChar = $derived(draft.kind === "character");
  const written = $derived(draft.fields.filter((f) => f.value.trim()));
  const working = $derived(draft.fields.filter((f) => f.status === "queued" || f.status === "writing"));
  const current = $derived(draft.fields.find((f) => f.status === "writing"));
  const unwritten = $derived(draft.fields.filter((f) => !f.value.trim() && f.status !== "queued" && f.status !== "writing"));
  const warns = $derived(Object.values(review?.issues ?? {}).flat().filter((i) => i.severity === "warn").length);
  const stale = $derived(review?.stale ?? {});
  const staleKeys = $derived(draft.fields.filter((f) => stale[f.key]?.length).map((f) => f.key));
  const staleWhy = $derived([...new Set(staleKeys.flatMap((k) => stale[k] ?? []))]);
  let hidden = $state<Record<string, boolean>>({});
  const notes = $derived((draft.fieldCheck ?? []).filter((n) => !hidden[n.id]));
  const labelOf = (key: string) => draft.fields.find((f) => f.key === key)?.label ?? key;
  let makeDefault = $state(false);
  let saving = $state(false);

  async function rewriteAll() {
    if (written.length && !(await confirm({ title: "Rewrite every field from the bible?", message: "Each field keeps its current text as the previous version, so you can restore any of them.", confirmLabel: "Rewrite all" }))) return;
    await session.act("write", "/write", { all: true, force: true });
  }
  const signed = $derived(draft.fields.filter((f) => f.accepted && f.value.trim()).length);
  let peopleBookId = $state<string | null>(null);

  async function save() {
    saving = true;
    try {
      await session.flush();
      const r = await post<{ id: string; draft: CreatorDraft; peopleBookId?: string | null }>(`/api/creator/${session.id}/save`, { makeDefault });
      session.apply(r.draft);
      peopleBookId = r.peopleBookId ?? null;
      toast(isChar ? `Saved ${draft.name}` : `Saved ${draft.name} as a persona`, { kind: "ok", action: { label: "Open", run: () => navigate(isChar ? `/character/${r.id}` : `/personas/${r.id}`) } });
    } catch (e) {
      errorToast(e);
    } finally {
      saving = false;
    }
  }

  async function companion() {
    try {
      const r = await post<{ loreDraftId: string; draft: CreatorDraft }>(`/api/creator/${session.id}/companion`);
      navigate(`/lore-studio/${r.loreDraftId}`);
    } catch (e) {
      errorToast(e);
    }
  }

  async function chat() {
    try {
      const c = await post<{ id: string }>("/api/chats", { characterId: draft.savedId });
      navigate(`/chat/${c.id}`);
    } catch (e) {
      errorToast(e);
    }
  }
</script>

<section class="stack">
  <div class="panel stack tight">
    <div class="row between wrap">
      <b>{written.length} of {draft.fields.length} written{#if signed}<span class="muted"> · {signed} signed off</span>{/if}</b>
      <div class="row wrap">
        {#if working.length}
          <span class="tiny muted">{current ? `Writing the ${current.label.toLowerCase()}…` : "Starting…"} {working.length} to go</span>
          <button class="btn small" onclick={() => session.act("stop", "/stop")}><Square size={13} /> Stop</button>
        {:else}
          {#if unwritten.length}<button class="btn small primary" onclick={() => session.act("write", "/write")} disabled={Boolean(session.busy)}><PenLine size={14} /> Write the other {unwritten.length}</button>{/if}
          <button class="btn small" onclick={rewriteAll} disabled={Boolean(session.busy)}><RefreshCw size={14} /> Rewrite all from the bible</button>
        {/if}
      </div>
    </div>
    <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax={draft.fields.length} aria-valuenow={written.length}><span style:width="{(written.length / Math.max(1, draft.fields.length)) * 100}%"></span></div>
    {#if staleKeys.length && !working.length}
      <div class="row wrap stale">
        <ClockAlert size={14} />
        <span class="small grow">{staleKeys.length} field{staleKeys.length === 1 ? " was" : "s were"} written before you changed {staleWhy.join(", ")}.</span>
        <button class="btn small" onclick={() => session.writeFields({ keys: staleKeys, steer: "" })} disabled={Boolean(session.busy)}><RefreshCw size={13} /> Bring {staleKeys.length === 1 ? "it" : "them"} up to date</button>
      </div>
    {/if}
    <div class="row between wrap">
      <span class="tiny muted">The editor reads the card itself: voice drift, flat greetings, contradictions, {"{{user}}"} being played.</span>
      <button class="btn small" onclick={() => session.act("critique", "/critique")} disabled={Boolean(session.busy) || !written.length}><ClipboardCheck size={14} /> {session.busy === "critique" ? "Reading the card…" : "Editor's pass"}</button>
    </div>
    {#if draft.fieldCheck}
      {#each notes as n (n.id)}
        <div class="issue small">
          <TriangleAlert size={14} />
          <div class="grow"><a href="#field-{n.field}" class="tiny">{labelOf(n.field)}</a> <b>{n.problem}</b>{#if n.fix}{" "}<span class="muted">{n.fix}</span>{/if}</div>
          <button class="btn small" onclick={() => session.act(`critique:${n.id}`, `/critique/${n.id}`)} disabled={Boolean(session.busy)}>Apply the fix</button>
          <button class="btn ghost icon small" onclick={() => (hidden[n.id] = true)} aria-label="Dismiss"><X size={13} /></button>
        </div>
      {:else}
        <span class="tiny muted">The editor has no notes{draft.fieldCheck.length ? " left" : ""}.</span>
      {/each}
    {/if}
    {#if review && isChar}<span class="tiny muted">Always in the prompt: {review.cost.permanent} tokens · greeting {review.cost.greeting} · examples {review.cost.examples}{warns ? ` · ${warns} to look at` : ""}</span>{/if}
  </div>

  {#each draft.fields as f (f.key)}
    <CreatorField {session} field={f} issues={review?.issues[f.key] ?? []} stale={stale[f.key] ?? []} tokens={review?.tokens[f.key] ?? 0} />
  {/each}

  <CreatorDepth {session} />
  <CreatorPairing {session} />

  <div class="panel stack savebox">
    <h3><Save size={16} /> {draft.savedId ? "Saved" : "Save"}</h3>
    {#if !isChar}
      <label class="switch"><input type="checkbox" bind:checked={makeDefault} /> Make it my default persona</label>
    {/if}
    {#if draft.worldBookIds.length || draft.loreDraftId}
      <span class="tiny muted"><BookOpen size={12} /> Its world's lorebooks are linked on save{draft.loreDraftId ? " (the Lore Studio draft once it's saved)" : ""}.</span>
    {/if}
    {#if (draft.options.depthBook && draft.depth.some((e) => e.content.trim())) || (isChar && draft.options.rulesBook) || (draft.options.mode === "narrator" && draft.optional.includes("agency"))}
      <span class="tiny muted"><BookOpen size={12} /> Bound on save:{draft.options.depthBook && draft.depth.some((e) => e.content.trim()) ? " a depth book" : ""}{isChar && draft.options.rulesBook ? " · a rules book" : ""}{isChar && draft.options.mode === "narrator" && draft.optional.includes("agency") ? " · world agency" : ""}. Export carries them in the card.</span>
    {/if}
    {#if draft.origin?.copyOf}<span class="tiny muted">A rebuild: saving makes a new {isChar ? "card" : "persona"} and leaves the original as it is.</span>{/if}
    <div class="row between wrap">
      <span class="tiny muted">{draft.savedId || draft.baseId ? `Saving updates the ${isChar ? "card; the old version stays in its history" : "persona"}.` : `Creates a new ${isChar ? "character card" : "persona"}.`}</span>
      <button class="btn primary" onclick={save} disabled={saving || !written.length}>{saving ? "Saving…" : draft.savedId || draft.baseId ? "Save changes" : isChar ? "Save the card" : "Save the persona"}</button>
    </div>
    {#if draft.savedId}
      <div class="row wrap next">
        <a class="btn small" href={isChar ? `/character/${draft.savedId}` : `/personas/${draft.savedId}`}><ExternalLink size={14} /> Open {isChar ? "the card" : "the persona"}</a>
        {#if isChar}<button class="btn small" onclick={chat}><MessageHeart size={14} /> Start a chat</button>{/if}
        {#if peopleBookId}<a class="btn small" href="/lorebooks/{peopleBookId}"><Users size={14} /> Its people</a>{/if}
        {#if draft.companionLoreDraftId}
          <a class="btn small" href="/lore-studio/{draft.companionLoreDraftId}"><BookOpen size={14} /> Companion lorebook</a>
        {:else}
          <button class="btn small" onclick={companion} title="People, places and events from the bible, drafted in the Lore Studio"><WandSparkles size={14} /> Build a companion lorebook</button>
        {/if}
      </div>
    {/if}
  </div>
</section>

<style>
  .bar {
    height: 0.4rem;
    border-radius: var(--r-pill);
    background: var(--border);
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--accent);
    transition: width 0.4s var(--ease);
  }
  .stale {
    gap: 0.5rem;
    align-items: center;
    padding: 0.45rem 0.6rem;
    border-radius: 8px;
    background: color-mix(in srgb, var(--butter, #f5d77a) 18%, transparent);
  }
  .issue {
    display: flex;
    gap: 0.5rem;
    align-items: flex-start;
    border-top: 1px solid var(--border);
    padding-top: 0.4rem;
  }
  .savebox h3 {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin: 0;
  }
  .next {
    gap: 0.4rem;
    border-top: 1px solid var(--border);
    padding-top: 0.7rem;
  }
</style>
