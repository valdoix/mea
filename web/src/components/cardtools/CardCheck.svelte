<script lang="ts">
  import DiffModal from "./DiffModal.svelte";
  import { post } from "../../lib/api";
  import { CircleAlert, ClipboardCheck, Loader, TriangleAlert } from "../../lib/icons";
  import { errorToast } from "../../lib/state.svelte";
  import type { StudioIssue } from "../../lib/types";

  /**
   * Quality checks (CHAR-13, PER-04): instant checks per field, and an editor's review (a model
   * pass) whose fixes open as a diff for that field.
   */
  let {
    kind,
    card,
    labels,
    pov = "third",
    onapply,
  }: {
    kind: "character" | "persona";
    card: () => Record<string, unknown>;
    labels: Record<string, string>;
    pov?: "first" | "second" | "third";
    onapply: (field: string, text: string) => void;
  } = $props();

  let issues = $state<Record<string, StudioIssue[]> | null>(null);
  let review = $state<{ field: string; problem: string; fix: string }[] | null>(null);
  let busy = $state("");
  let proposal = $state<{ field: string; before: string; after: string; note: string } | null>(null);
  let diffOpen = $state(false);

  async function check(deep: boolean) {
    busy = deep ? "deep" : "quick";
    try {
      const r = await post<{ issues: Record<string, StudioIssue[]>; review: typeof review }>("/api/card-tools/check", { kind, card: card(), pov, deep });
      issues = r.issues;
      if (deep) review = r.review;
    } catch (e) {
      errorToast(e);
    } finally {
      busy = "";
    }
  }

  const fieldText = (f: string) => {
    const m = f.match(/^alt_(\d+)$/);
    const c = card();
    return m ? String((c.alternate_greetings as string[] | undefined)?.[Number(m[1]) - 1] ?? "") : String(c[f] ?? "");
  };

  async function fix(field: string, instruction: string, note: string) {
    busy = `fix:${field}`;
    try {
      const r = await post<{ text: string }>("/api/card-tools/assist", { kind, field: field.startsWith("alt_") ? "alternate_greetings" : field, action: "edit", text: fieldText(field), card: card(), instruction, pov });
      proposal = { field, before: fieldText(field), after: r.text, note };
      diffOpen = true;
    } catch (e) {
      errorToast(e);
    } finally {
      busy = "";
    }
  }

  const label = (f: string) => labels[f] ?? (f.startsWith("alt_") ? `Alternate greeting ${f.slice(4)}` : f);
  const count = $derived(issues ? Object.values(issues).flat().length : 0);
  const warns = $derived(issues ? Object.values(issues).flat().filter((i) => i.severity === "warn").length : 0);
</script>

<section class="panel stack tight">
  <div class="row between wrap">
    <span class="small"><ClipboardCheck size={15} /> <b>Check this {kind === "persona" ? "persona" : "card"}</b>{#if issues}{" "}<span class="muted">· {count ? `${count} note${count === 1 ? "" : "s"}${warns ? `, ${warns} to fix` : ""}` : "nothing flagged"}</span>{/if}</span>
    <div class="row">
      <button class="btn small" onclick={() => check(false)} disabled={Boolean(busy)}>{busy === "quick" ? "Checking…" : "Quick check"}</button>
      <button class="btn small" onclick={() => check(true)} disabled={Boolean(busy)} title="A model reads it like an editor: generic, contradictory, missing, flat">{#if busy === "deep"}<span class="spin"><Loader size={13} /></span> Reading…{:else}Ask an editor{/if}</button>
    </div>
  </div>
  {#if issues}
    {#each Object.entries(issues) as [f, list] (f)}
      {#each list as iss, k (k)}
        <div class="issue tiny" class:warn={iss.severity === "warn"}>
          {#if iss.severity === "warn"}<TriangleAlert size={12} />{:else}<CircleAlert size={12} />{/if}
          <span><b>{label(f)}:</b> {iss.message}</span>
          {#if iss.kind === "puppets-user"}<button class="btn ghost small" onclick={() => fix(f, "Remove every place where it writes {{user}}'s actions, words, thoughts or feelings; leave every choice to {{user}}.", iss.message)} disabled={Boolean(busy)}>Fix</button>{/if}
        </div>
      {/each}
    {/each}
  {/if}
  {#if review}
    <div class="stack tight review">
      {#each review as r, k (k)}
        <div class="rev small">
          <div class="grow"><b>{label(r.field)}:</b> {r.problem}{#if r.fix}{" "}<span class="muted">{r.fix}</span>{/if}</div>
          {#if r.fix}<button class="btn small" onclick={() => fix(r.field, r.fix, r.problem)} disabled={Boolean(busy)}>{busy === `fix:${r.field}` ? "Writing…" : "Apply fix"}</button>{/if}
        </div>
      {:else}
        <span class="tiny ok">The editor found nothing generic, contradictory or missing.</span>
      {/each}
    </div>
  {/if}
</section>

{#if proposal}
  <DiffModal bind:open={diffOpen} title="{label(proposal.field)}: suggested fix" note={proposal.note} before={proposal.before} after={proposal.after} onaccept={(t) => onapply(proposal!.field, t)} />
{/if}

<style>
  .issue {
    display: flex;
    gap: 0.4rem;
    align-items: center;
    color: var(--text-muted);
    flex-wrap: wrap;
  }
  .issue.warn {
    color: var(--danger);
  }
  .review {
    border-top: 1px solid var(--border);
    padding-top: 0.5rem;
  }
  .rev {
    display: flex;
    gap: 0.5rem;
    align-items: flex-start;
    flex-wrap: wrap;
    padding: 0.45rem 0.6rem;
    border-radius: var(--r-sm, 8px);
    background: var(--warn-bg);
  }
  .grow {
    flex: 1 1 14rem;
    min-width: 0;
  }
  .ok {
    color: var(--ok);
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
