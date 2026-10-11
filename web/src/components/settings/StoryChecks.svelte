<script lang="ts">
  import { post } from "../../lib/api";
  import { errorToast } from "../../lib/state.svelte";

  /**
   * K1: Run story checks: the golden scenarios as a pass/fail board. "Run" grades each scenario's
   * own replies (free); "With my story model" has your story model write each reply (it costs a
   * reply per scenario). The checks use throwaway chats that go straight to the trash.
   */
  interface Result {
    name: string;
    about: string;
    pass: boolean;
    checks: { name: string; pass: boolean; detail: string }[];
  }
  let board = $state<{ at: number; model: boolean; pass: boolean; results: Result[] } | null>(null);
  let busy = $state<"" | "rules" | "model">("");
  let open = $state<Record<string, boolean>>({});

  async function runChecks(model: boolean) {
    busy = model ? "model" : "rules";
    try {
      board = await post("/api/golden/run", { model });
    } catch (e) {
      errorToast(e);
    } finally {
      busy = "";
    }
  }
</script>

<section class="panel stack tight">
  <div class="row between wrap">
    <h2>Story checks</h2>
    <div class="row">
      <button class="btn small" onclick={() => runChecks(false)} disabled={Boolean(busy)}>{busy === "rules" ? "Checking…" : "Run story checks"}</button>
      <button class="btn ghost small" onclick={() => runChecks(true)} disabled={Boolean(busy)} title="Your story model writes a reply for each scene (it costs a reply each)">{busy === "model" ? "Writing and checking…" : "With my story model"}</button>
    </div>
  </div>
  <p class="tiny muted">A fixed set of scenes that grade Mea's prompt and checks: agency, knowledge leaks, the clock, weather, who's present, promises, secrets kept off the page, the canon cutoff, the safety floor, ledger shape and planning.</p>
  {#if board}
    <p class="small"><b>{board.results.filter((r) => r.pass).length} of {board.results.length}</b> pass{board.model ? " with your story model" : ""}.</p>
    <div class="board">
      {#each board.results as r (r.name)}
        <button type="button" class="cell" class:fail={!r.pass} onclick={() => (open[r.name] = !open[r.name])} aria-expanded={Boolean(open[r.name])} title={r.about}>
          <span>{r.pass ? "✓" : "✗"}</span> {r.name}
        </button>
        {#if open[r.name]}
          <div class="detail tiny">
            <p class="muted">{r.about}</p>
            {#each r.checks as c, i (i)}<div class:bad={!c.pass}>{c.pass ? "✓" : "✗"} {c.name}{c.detail ? ` — ${c.detail}` : ""}</div>{/each}
          </div>
        {/if}
      {/each}
    </div>
  {/if}
</section>

<style>
  .board {
    display: grid;
    gap: 0.3rem;
  }
  .cell {
    text-align: left;
    border: 1px solid color-mix(in srgb, var(--ok, #82e3d3) 50%, var(--border));
    background: color-mix(in srgb, var(--ok, #82e3d3) 10%, transparent);
    color: inherit;
    border-radius: 8px;
    padding: 0.3rem 0.55rem;
    cursor: pointer;
    font-size: 0.85rem;
  }
  .cell.fail {
    border-color: color-mix(in srgb, var(--danger) 60%, var(--border));
    background: color-mix(in srgb, var(--danger) 12%, transparent);
  }
  .detail {
    padding: 0.2rem 0.6rem 0.5rem;
    display: grid;
    gap: 0.15rem;
  }
  .bad {
    color: var(--danger);
  }
</style>
