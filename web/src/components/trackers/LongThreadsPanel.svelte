<script lang="ts">
  import Module from "../desk/Module.svelte";
  import { del, get, post } from "../../lib/api";
  import { errorToast, toast } from "../../lib/state.svelte";
  import { trk } from "../../lib/trackers.svelte";

  /**
   * docs/33 Part 9: the few things the story owes beyond this scene: promises and plans with a day,
   * open conflicts, secrets still kept, and what you pin. The planner reads this list every turn, and
   * a thread whose day has come goes into the plan.
   */
  interface LongView {
    id: string;
    kind: "promise" | "plan" | "conflict" | "secret" | "pinned";
    text: string;
    when: "today" | "passed" | "soon" | "later" | "open";
    due: string | null;
    seq: number;
    from: string[];
  }
  let { chatId }: { chatId: string } = $props();
  let list = $state<LongView[]>([]);
  let open = $state(false);
  let adding = $state(false);
  let text = $state("");
  let due = $state("");
  let busy = $state(false);

  async function load() {
    try {
      list = (await get<{ threads: LongView[] }>(`/api/chats/${chatId}/long-threads`)).threads;
    } catch {
      list = [];
    }
  }
  $effect(() => {
    void trk.data;
    void load();
  });

  const today = $derived(list.filter((t) => t.when === "today").length);
  const KIND: Record<LongView["kind"], string> = { promise: "promise", plan: "plan", conflict: "open conflict", secret: "secret", pinned: "pinned" };
  const WHEN: Record<LongView["when"], string> = { today: "due today", passed: "its day passed", soon: "coming up", later: "later", open: "" };
  const sub = (t: LongView) => [KIND[t.kind], t.due ? `${t.due}${WHEN[t.when] ? `, ${WHEN[t.when]}` : ""}` : "", t.from.length ? `kept from ${t.from.slice(0, 5).join(", ")}${t.from.length > 5 ? ` and ${t.from.length - 5} more` : ""}` : "", `from #${t.seq}`].filter(Boolean).join(" · ");

  async function pin() {
    busy = true;
    try {
      list = (await post<{ threads: LongView[] }>(`/api/chats/${chatId}/long-threads/pin`, { text: text.trim(), ...(due.trim() ? { due: due.trim() } : {}) })).threads;
      toast("Pinned", { kind: "ok" });
      text = "";
      due = "";
      adding = false;
    } catch (e) {
      errorToast(e);
    } finally {
      busy = false;
    }
  }
  async function unpin(t: LongView) {
    busy = true;
    try {
      list = (await del<{ threads: LongView[] }>(`/api/chats/${chatId}/long-threads/pin/${encodeURIComponent(t.id)}`)).threads;
    } catch (e) {
      errorToast(e);
    } finally {
      busy = false;
    }
  }
</script>

<div data-section="long-threads">
  <Module title="Long threads" fold bind:open led={today ? "warm" : list.length ? "on" : null} peek={today ? `${today} due today` : list.length ? `${list.length} open` : "None"}>
    {#each list as t (t.id)}
      <div class="sec" class:due={t.when === "today"} class:passed={t.when === "passed"}>
        <div class="txt">
          <span>{t.text}</span>
          <small>{sub(t)}</small>
        </div>
        {#if t.kind === "pinned"}
          <div class="st-keys"><button class="st-key" type="button" disabled={busy} onclick={() => unpin(t)}>Take off</button></div>
        {/if}
      </div>
    {:else}
      <p class="st-hint first">Nothing long is open. Pin one the story should keep in view.</p>
    {/each}
    {#if adding}
      <div class="pinform">
        <input class="input what" bind:value={text} placeholder="the rings" aria-label="What the thread is" />
        <input class="input" bind:value={due} placeholder="when: this week (optional)" aria-label="When it's due" />
        <button class="btn small" disabled={busy || !text.trim()} onclick={pin}>Pin</button>
      </div>
    {:else}
      <div class="st-keys"><button class="st-key" type="button" onclick={() => (adding = true)}>Pin a thread</button></div>
    {/if}
  </Module>
</div>

<style>
  .sec {
    display: grid;
    gap: 6px;
    padding: 8px;
    margin-bottom: 6px;
    border-radius: var(--r-sm);
    background: var(--st-well);
    box-shadow: var(--st-inset-sm);
  }
  .sec.due {
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--st-warm) 70%, transparent);
  }
  .sec.passed {
    opacity: 0.85;
  }
  .txt {
    display: grid;
    gap: 2px;
    font-size: 13px;
  }
  .txt small {
    font-size: 11px;
    color: var(--text-faint);
  }
  .pinform {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.35rem;
    align-items: center;
  }
  .pinform .what {
    grid-column: 1 / -1;
  }
</style>
