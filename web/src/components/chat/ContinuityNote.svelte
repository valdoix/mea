<script lang="ts">
  import { post } from "../../lib/api";
  import { FLAG_KINDS } from "../../lib/flagkinds";
  import { Check, GraduationCap, Pencil, RotateCcw, ShieldAlert, X } from "../../lib/icons";
  import { errorToast, toast } from "../../lib/state.svelte";
  import type { Citation, ContinuityFlag } from "../../lib/types";

  /** CON-02 / CON-06: a reply's continuity notes, with citations. Nothing is rewritten unless you ask. */
  let { flag, canRegenerate, onchange, oncite }: { flag: ContinuityFlag; canRegenerate: boolean; onchange: (f: ContinuityFlag | null) => void; oncite: (c: Citation) => void } = $props();

  let open = $state(false);
  const issues = $derived(flag.issues.filter((i) => !i.dismissed && !i.quiet));
  const major = $derived(issues.some((i) => i.severity === "major"));
  /** D1: findings about the whole reply (its voice, its time, planning in it) aren't one sentence to fix. */
  const WHOLE = new Set(["pov", "tense", "timeline", "planning"]);
  /** A citation that points somewhere (guard notes cite a rule, not a source). */
  const opens = (c: Citation) => Boolean(c.messageId || c.seq != null || c.id || c.type === "lesson" || c.type === "secret");

  async function act(path: string, body: unknown, done?: string) {
    try {
      const f = await post<ContinuityFlag>(`/api/continuity/${flag.id}/${path}`, body);
      onchange(f);
      if (done) toast(done, { kind: "ok" });
    } catch (e) {
      errorToast(e);
    }
  }
  /** B1: only the quoted sentence is rewritten (D1 widens this to every finding). */
  let fixing = $state<string | null>(null);
  async function fixSentence(issueId: string) {
    fixing = issueId;
    try {
      const r = await post<{ flag: ContinuityFlag; before: string; after: string }>(`/api/continuity/${flag.id}/fix`, { issueId });
      onchange(r.flag);
      toast("Reworded that sentence", { kind: "ok" });
    } catch (e) {
      errorToast(e);
    } finally {
      fixing = null;
    }
  }
  /** D1: the finding kept as a lesson (sent every turn, and checked). */
  async function makeLesson(issueId: string) {
    try {
      await post(`/api/continuity/${flag.id}/lesson`, { issueId });
      toast("Kept as a lesson: it goes to the model every turn", { kind: "ok" });
    } catch (e) {
      errorToast(e);
    }
  }
  async function regenerate() {
    try {
      await post(`/api/continuity/${flag.id}/regenerate`);
      toast("Writing a new version with the corrections…");
    } catch (e) {
      errorToast(e);
    }
  }
</script>

{#if issues.length}
  <div class="cn" class:major>
    <button class="toggle tiny" onclick={() => (open = !open)} aria-expanded={open}>
      <ShieldAlert size={13} /> {issues.length} continuity {issues.length === 1 ? "note" : "notes"}{#if !open}: {issues.map((i) => FLAG_KINDS[i.kind] ?? i.kind).join(", ")}{/if}
    </button>
    {#if open}
      <div class="list">
        {#each issues as i (i.id)}
          <div class="issue">
            <div class="small"><span class="sev" class:hi={i.severity === "major"}>{i.severity}</span> “{i.claim}”</div>
            <div class="small muted">{i.conflict}</div>
            <div class="row wrap cites">
              {#each i.citations as c, k (k)}{#if opens(c)}<button class="chip tiny cite" onclick={() => oncite(c)} title="Open the source">{c.type} · {c.label}</button>{:else}<span class="chip tiny cite rule">{c.label}</span>{/if}{/each}
              {#if i.by === "model"}<span class="tiny faint">checked by the helper model</span>{/if}
            </div>
            <div class="row wrap">
              {#if i.replace}<button class="btn small" onclick={() => act("replace", { issueId: i.id }, `Now “${i.replace!.to}”`)} title="Swap the name in this reply; every other word stays"><Check size={13} /> Use “{i.replace.to}”</button>{/if}
              {#if !WHOLE.has(i.kind)}<button class="btn ghost small" onclick={() => fixSentence(i.id)} disabled={fixing === i.id} title="Rewrite only this sentence; every other word stays"><Pencil size={13} /> {fixing === i.id ? "Fixing…" : i.kind === "offpage" || i.kind === "canon" ? "Reword this sentence" : "Fix this sentence"}</button>{/if}
              {#if i.canon}<button class="btn ghost small" onclick={() => act("accept", { issueId: i.id }, "Canon updated: the reply's version is now confirmed")} title="The reply is right: update memory (and the trackers) to match"><Check size={13} /> Accept & update canon</button>{/if}
              <button class="btn ghost small" onclick={() => act("dismiss", { issueId: i.id })}><X size={13} /> Dismiss</button>
              {#if i.kind !== "lesson"}<button class="btn ghost small" onclick={() => makeLesson(i.id)} title="Keep this as a rule for the story; replies are checked against it"><GraduationCap size={13} /> Make it a lesson</button>{/if}
            </div>
          </div>
        {/each}
        <div class="row wrap">
          {#if canRegenerate}<button class="btn small" onclick={regenerate}><RotateCcw size={13} /> Regenerate with fix</button>{/if}
          <button class="btn ghost small" onclick={() => act("dismiss", { issueId: null })}>Dismiss all</button>
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .cn {
    margin-top: 0.5rem;
    border-left: 2px solid var(--butter, #e6c35c);
    padding-left: 0.5rem;
  }
  .cn.major {
    border-left-color: var(--danger);
  }
  .toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    border: 0;
    background: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: 0.1rem 0;
    text-align: left;
  }
  .list {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 0.55rem;
    margin-top: 0.35rem;
    min-width: 0;
  }
  .issue {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 0.2rem;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .sev {
    font-size: 0.7em;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
    margin-right: 0.2rem;
  }
  .sev.hi {
    color: var(--danger);
  }
  .cites {
    gap: 0.3rem;
  }
  .cite.rule {
    cursor: default;
  }
  .cite {
    cursor: pointer;
    border: 1px solid var(--border);
    max-width: 100%;
    overflow-wrap: anywhere;
  }
</style>
