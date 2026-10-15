<script lang="ts">
  import ExtendButton from "../studio/ExtendButton.svelte";
  import { del, get, post } from "../../lib/api";
  import { autosize } from "../../lib/gestures";
  import { Check, Compass, ExternalLink, Feather, MessageQuestion, Plus, Sparkles, Trash, UserPen, Users } from "../../lib/icons";
  import { navigate } from "../../lib/router.svelte";
  import { errorToast } from "../../lib/state.svelte";
  import type { FactSource, LorePerson } from "../../lib/types";

  /**
   * A world's people, on a ladder: a name → an extra (a few lines in the book) → named (a short
   * interview woven into a voiced profile) → their own card, carrying this book.
   */
  let { bookId, onchanged, onopen }: { bookId: string; onchanged: () => void; onopen: (entryId: string) => void } = $props();
  let people = $state<LorePerson[]>([]);
  let enough = $state(3);
  let busy = $state("");
  let name = $state("");
  let hook = $state("");
  let weaving = $state<string | null>(null);
  let answer = $state("");
  let source = $state<FactSource>("typed");

  async function load() {
    try {
      const r = await get<{ people: LorePerson[]; enough: number }>(`/api/lorebooks/${bookId}/people`);
      people = r.people;
      enough = r.enough;
    } catch (e) {
      errorToast(e);
    }
  }
  $effect(() => {
    void load();
  });

  async function run<T>(label: string, fn: () => Promise<T>) {
    busy = label;
    try {
      return await fn();
    } catch (e) {
      errorToast(e);
      return undefined;
    } finally {
      busy = "";
    }
  }
  const replace = (p: LorePerson) => (people = people.map((x) => (x.id === p.id ? p : x)));

  async function add() {
    if (!name.trim()) return;
    const r = await run("add", () => post<{ people: LorePerson[] }>(`/api/lorebooks/${bookId}/people`, { name, hook }));
    if (r) {
      people = r.people;
      name = hook = "";
    }
  }
  async function personAct(p: LorePerson, path: string, body?: unknown) {
    const r = await run(`${path}:${p.id}`, () => post<{ person: LorePerson }>(`/api/people/${p.id}/${path}`, body));
    if (r) {
      replace(r.person);
      if (path === "extra" || path === "weave") onchanged();
    }
    return r?.person;
  }
  async function startWeave(p: LorePerson) {
    weaving = p.id;
    answer = "";
    source = "typed";
    if (!p.interview.some((a) => !a.answer.trim())) await personAct(p, "question");
  }
  async function useAnswer(p: LorePerson, qid: string) {
    const got = await personAct(p, "answer", { qid, answer, source });
    if (!got) return;
    answer = "";
    source = "typed";
    await personAct(got, "question");
  }
  async function promote(p: LorePerson) {
    const r = await run(`promote:${p.id}`, () => post<{ draftId: string }>(`/api/people/${p.id}/promote`));
    if (r) navigate(`/creator/${r.draftId}`);
  }
  async function remove(p: LorePerson) {
    if (await run(`rm:${p.id}`, () => del(`/api/people/${p.id}`))) people = people.filter((x) => x.id !== p.id);
  }

  const TIER: Record<LorePerson["tier"], string> = { unfleshed: "a name", extra: "extra", named: "named" };
  const ORIGIN: Record<LorePerson["origin"], string> = { interview: "from your build", proposed: "proposed", manual: "" };
  const inUniverse = $derived(people.filter((p) => p.characterId));
</script>

<section class="panel stack">
  <div class="row between wrap">
    <h3><Users size={16} /> People</h3>
    <button class="btn small" onclick={() => run("propose", async () => (people = (await post<{ people: LorePerson[] }>(`/api/lorebooks/${bookId}/people/propose`)).people))} disabled={Boolean(busy)}><Sparkles size={13} /> {busy === "propose" ? "Thinking…" : "Propose people"}</button>
  </div>
  <p class="tiny muted">Everyone the narrator can bring into a scene. Each step is one action: a name → an extra (a few lines in this book) → named (a voiced profile, firing by name) → their own card that carries this book.</p>
  {#if inUniverse.length}
    <div class="row wrap"><span class="tiny muted">In universe:</span>{#each inUniverse as p (p.id)}<a class="chip rose" href="/character/{p.characterId}">{p.name}</a>{/each}</div>
  {/if}
  {#each people as p (p.id)}
    {@const open = p.interview.find((a) => !a.answer.trim())}
    {@const answered = p.interview.filter((a) => a.answer.trim()).length}
    <div class="person stack tight">
      <div class="row wrap">
        <b>{p.name}</b>
        <span class="chip tiny">{TIER[p.tier]}</span>
        {#if ORIGIN[p.origin]}<span class="tiny faint">{ORIGIN[p.origin]}</span>{/if}
        {#if p.hook}<span class="tiny muted grow">{p.hook}</span>{:else}<span class="grow"></span>{/if}
        {#if p.entryId}<button class="btn ghost small" onclick={() => onopen(p.entryId!)}><ExternalLink size={12} /> Entry</button>{/if}
        {#if p.tier === "unfleshed"}
          <button class="btn small" onclick={() => personAct(p, "extra")} disabled={Boolean(busy)}><Feather size={12} /> {busy === `extra:${p.id}` ? "Writing…" : "Extra"}</button>
          <button class="btn ghost icon small" onclick={() => remove(p)} aria-label="Remove {p.name}"><Trash size={12} /></button>
        {/if}
        <button class="btn small" onclick={() => startWeave(p)} disabled={Boolean(busy)}><MessageQuestion size={12} /> {p.tier === "named" ? "Reweave" : "Weave named"}</button>
        {#if p.entryId}
          {#if p.creatorDraftId && !p.characterId}<a class="btn small" href="/creator/{p.creatorDraftId}"><UserPen size={12} /> Open in studio</a>
          {:else if !p.characterId}<button class="btn small" onclick={() => promote(p)} disabled={Boolean(busy)}><UserPen size={12} /> Promote</button>{/if}
        {/if}
      </div>
      {#if weaving === p.id}
        <div class="weave stack tight">
          {#if open}
            <b class="small">{open.q}</b>
            {#if open.why}<span class="tiny muted">{open.why}</span>{/if}
            <textarea class="textarea small" use:autosize={{ max: 220, value: answer }} rows="2" bind:value={answer} placeholder="In your own words"></textarea>
            {#if open.directions.length}
              <div class="dirs">{#each open.directions as d (d.text)}<button class="dir" onclick={() => { answer = d.text; source = "picked"; }}><b class="tiny">{d.caption}</b><span class="tiny">{d.text}</span></button>{/each}</div>
            {/if}
            <div class="row wrap">
              <button class="btn ghost small" onclick={() => personAct(p, "directions", { qid: open.id })} disabled={Boolean(busy)}><Compass size={12} /> Directions</button>
              <ExtendButton text={answer} question={open.q} onresult={(t) => { answer = t; source = "extended"; }} />
              <span class="grow"></span>
              <button class="btn small" onclick={() => useAnswer(p, open.id)} disabled={Boolean(busy) || !answer.trim()}><Check size={12} /> Use my answer</button>
            </div>
          {:else if busy === `question:${p.id}`}
            <span class="tiny muted">Thinking of a question…</span>
          {/if}
          <div class="row wrap">
            <span class="tiny muted grow">{answered} answered{answered >= enough ? " · enough for a solid profile" : ""}</span>
            <button class="btn small primary" onclick={async () => { if (await personAct(p, "weave")) weaving = null; }} disabled={Boolean(busy) || !answered}>{busy === `weave:${p.id}` ? "Weaving…" : "Weave now"}</button>
            <button class="btn ghost small" onclick={() => (weaving = null)}>Close</button>
          </div>
          {#if p.gate && !p.gate.passed}<span class="tiny warn">{p.gate.criteria.filter((c) => !c.passed).map((c) => `${c.label}: ${c.note}`).join(" ")}</span>{/if}
        </div>
      {/if}
    </div>
  {:else}
    <span class="tiny muted">Nobody yet. Propose people from the book's lore, or add someone.</span>
  {/each}
  <div class="row wrap">
    <input class="input slim" bind:value={name} placeholder="Name" aria-label="Name" />
    <input class="input slim grow" bind:value={hook} placeholder="One-line hook (optional)" aria-label="Hook" onkeydown={(e) => e.key === "Enter" && add()} />
    <button class="btn small" onclick={add} disabled={!name.trim() || Boolean(busy)}><Plus size={13} /> Add person</button>
  </div>
</section>

<style>
  h3 {
    margin: 0;
    display: flex;
    gap: 0.4rem;
    align-items: center;
  }
  .person {
    border-top: 1px solid var(--border);
    padding-top: 0.5rem;
  }
  .person > .row {
    gap: 0.35rem;
    align-items: center;
  }
  .weave {
    padding-left: 0.8rem;
    border-left: 2px solid var(--accent);
  }
  .dirs {
    display: grid;
    gap: 0.3rem;
  }
  .dir {
    display: grid;
    text-align: left;
    border: 1px dashed var(--border);
    border-radius: 8px;
    background: none;
    color: var(--text);
    padding: 0.35rem 0.5rem;
    cursor: pointer;
    font: inherit;
  }
  .slim {
    padding: 0.3rem 0.5rem;
    font-size: var(--fs-sm);
  }
  .grow {
    flex: 1 1 10rem;
    min-width: 0;
  }
  .warn {
    color: var(--danger);
  }
</style>
