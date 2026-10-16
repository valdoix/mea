<script lang="ts">
  import { get } from "../../lib/api";
  import type { CreatorSession } from "../../lib/creator.svelte";
  import { autosize } from "../../lib/gestures";
  import { GitBranch, Globe2, Lightbulb, Loader, StepForward } from "../../lib/icons";
  import { errorToast } from "../../lib/state.svelte";
  import { type UniverseSummary, VERSION_KINDS, type VersionKind } from "../../lib/types";

  /** A version's first step (docs/14): what kind of version, what it's called, and the premise in your words. */
  let { session }: { session: CreatorSession } = $props();
  const draft = $derived(session.draft!);
  const v = $derived(draft.variant!);
  const isChar = $derived(v.originKind === "character");
  let steer = $state("");
  let universes = $state<UniverseSummary[]>([]);
  $effect(() => {
    get<{ universes: UniverseSummary[] }>("/api/universes").then((r) => (universes = r.universes), () => {});
  });

  /** Joining a universe brings its premise (if this has none yet) and its map; the server merges them. */
  async function setUniverse(universeId: string) {
    try {
      session.save({ variant: { universeId: universeId || null } }, "universe", 0);
      await session.flush();
      await session.load();
    } catch (e) {
      errorToast(e);
    }
  }

  function setPremise(text: string) {
    session.draft!.variant!.premise = text;
    session.save({ variant: { premise: text } }, "premise");
  }

  async function next() {
    // The questions come once; going back and forward again keeps them.
    if (draft.questions.length) {
      session.draft!.stage = "questions";
      session.save({ stage: "questions" }, "stage", 0);
    } else await session.act("start", "/variant/start");
  }
</script>

<section class="stack">
  <div class="panel stack tight">
    <span class="label"><GitBranch size={14} /> A version of <a href={isChar ? `/character/${v.originId}` : `/personas/${v.originId}`}>{v.originName}</a></span>
    <span class="tiny muted">The original stays exactly as it is. This draft starts from everything {v.originName} already is{draft.worldBookIds.length ? `, with ${draft.worldBookIds.length === 1 ? "their lorebook" : `their ${draft.worldBookIds.length} lorebooks`}` : ""}, and saves as a new {isChar ? "card" : "persona"} linked back to them.</span>
    <div class="row wrap">
      <label class="field grow"><span class="label">Called</span><input class="input" value={v.label} oninput={(e) => { session.draft!.variant!.label = e.currentTarget.value; session.save({ variant: { label: e.currentTarget.value } }, "label"); }} placeholder="College AU · Ten years later · The war never ended" maxlength="80" /></label>
      <label class="field"><span class="label">Kind</span>
        <select class="select" value={v.kind} onchange={(e) => { const k = e.currentTarget.value as VersionKind; session.draft!.variant!.kind = k; session.save({ variant: { kind: k } }, "kind", 0); }}>
          {#each VERSION_KINDS as k (k.id)}<option value={k.id}>{k.label}</option>{/each}
        </select>
      </label>
    </div>
  </div>

  <div class="panel stack tight">
    <span class="label"><Globe2 size={14} /> Universe</span>
    <select class="select" value={v.universeId ?? ""} onchange={(e) => setUniverse(e.currentTarget.value)} aria-label="Universe">
      <option value="">A new one, just for this version (others can join it later)</option>
      {#each universes as u (u.id)}<option value={u.id}>Join {u.name} ({u.members.length} {u.members.length === 1 ? "member" : "members"})</option>{/each}
    </select>
    <span class="tiny muted">{v.universeId ? "Its premise and shared map come along; this version's own map rows join the shared map when you save." : `Saving makes a universe called “${v.label || "…"}” with this premise and map, so a whole cast can move into it later.`}</span>
  </div>

  <div class="panel stack tight">
    <span class="label">The premise</span>
    <span class="tiny muted">Where and when this version lives, the one change everything else follows from, and what it does to who they are. A line is enough; the questions fill in the rest.</span>
    <textarea class="textarea story" use:autosize={{ max: 360, value: v.premise }} value={v.premise} oninput={(e) => setPremise(e.currentTarget.value)} placeholder="Same Mira, but she grew up in a city and runs the late-night show on the campus radio station. The lighthouse is a song she plays every night."></textarea>
    <div class="row wrap">
      <input class="input grow" bind:value={steer} placeholder="Lean the takes: darker, cosier, sci-fi…" aria-label="How to lean the takes" />
      <button class="btn" onclick={() => session.act("directions", "/variant/directions", { steer })} disabled={Boolean(session.busy)}>
        {#if session.busy === "directions"}<span class="spin"><Loader size={14} /></span> Thinking…{:else}<Lightbulb size={14} /> Show me directions{/if}
      </button>
    </div>
    {#each v.directions.slice(-3) as take, i (i)}
      <div class="take card">
        <p class="small">{take}</p>
        <div class="row">
          <button class="btn small" onclick={() => setPremise(take)}>Use this</button>
          <button class="btn ghost small" onclick={() => setPremise([v.premise.trim(), take].filter(Boolean).join("\n\n"))}>Add to mine</button>
        </div>
      </div>
    {/each}
  </div>

  <div class="row actions">
    <span class="grow"></span>
    <button class="btn primary" onclick={next} disabled={Boolean(session.busy) || !v.premise.trim()}>
      {#if session.busy === "start"}<span class="spin"><Loader size={14} /></span> Reading {v.originName}…{:else}<StepForward size={16} /> Next: what stays true{/if}
    </button>
  </div>
</section>

<style>
  .grow {
    flex: 1 1 12rem;
    min-width: 0;
  }
  .take {
    padding: 0.6rem 0.8rem;
  }
  .take p {
    margin: 0 0 0.4rem;
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
