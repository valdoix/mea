<script lang="ts">
  import { post } from "../../lib/api";
  import { Check, RotateCcw, ShieldAlert, X } from "../../lib/icons";
  import { errorToast, toast } from "../../lib/state.svelte";
  import type { Citation, ContinuityFlag } from "../../lib/types";

  /** CON-02 / CON-06: a reply's continuity notes, with citations. Nothing is rewritten unless you ask. */
  let { flag, canRegenerate, onchange, oncite }: { flag: ContinuityFlag; canRegenerate: boolean; onchange: (f: ContinuityFlag | null) => void; oncite: (c: Citation) => void } = $props();

  let open = $state(false);
  const issues = $derived(flag.issues.filter((i) => !i.dismissed));
  const major = $derived(issues.some((i) => i.severity === "major"));
  const KIND: Record<string, string> = { trait: "appearance", dead: "the dead", name: "a name", time: "time of day", place: "place", fact: "a fact", leak: "who knows what", pov: "point of view", tense: "tense", puppet: "writing for you", timeline: "the timeline", lesson: "a lesson you kept" };
  /** A citation that points somewhere (guard notes cite a rule, not a source). */
  const opens = (c: Citation) => Boolean(c.messageId || c.seq != null || c.id || c.type === "lesson");

  async function act(path: string, body: unknown, done?: string) {
    try {
      const f = await post<ContinuityFlag>(`/api/continuity/${flag.id}/${path}`, body);
      onchange(f);
      if (done) toast(done, { kind: "ok" });
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
      <ShieldAlert size={13} /> {issues.length} continuity {issues.length === 1 ? "note" : "notes"}{#if !open}: {issues.map((i) => KIND[i.kind] ?? i.kind).join(", ")}{/if}
    </button>
    {#if open}
      <div class="list">
        {#each issues as i (i.id)}
          <div class="issue">
            <div class="small"><span class="sev" class:hi={i.severity === "major"}>{i.severity}</span> “{i.claim}”</div>
            <div class="small muted">{i.conflict}</div>
            <div class="row wrap cites">
              {#each i.citations as c, k (k)}{#if opens(c)}<button class="chip tiny cite" onclick={() => oncite(c)} title="Open the source">{c.type} · {c.label.slice(0, 60)}</button>{:else}<span class="chip tiny cite rule">{c.label.slice(0, 60)}</span>{/if}{/each}
              {#if i.by === "model"}<span class="tiny faint">checked by the helper model</span>{/if}
            </div>
            <div class="row wrap">
              {#if i.canon}<button class="btn ghost small" onclick={() => act("accept", { issueId: i.id }, "Canon updated: the reply's version is now confirmed")} title="The reply is right: update memory (and the trackers) to match"><Check size={13} /> Accept & update canon</button>{/if}
              <button class="btn ghost small" onclick={() => act("dismiss", { issueId: i.id })}><X size={13} /> Dismiss</button>
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
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
