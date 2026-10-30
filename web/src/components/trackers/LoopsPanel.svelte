<script lang="ts">
  import Module from "../desk/Module.svelte";
  import { get, post } from "../../lib/api";
  import { dockRequest } from "../../lib/dock.svelte";
  import { errorToast, toast } from "../../lib/state.svelte";
  import { trk } from "../../lib/trackers.svelte";

  /**
   * docs/22 5.1: what the story is waiting for, then what closed it, one tap from either. What you
   * say here holds: a model can't undo it. It should be needed rarely, and Story health counts it.
   */
  type Action = "done" | "dropped" | "open";
  interface LoopView {
    id: string;
    what: string;
    kind: string;
    status: "open" | "done" | "dropped" | "lapsed";
    who: string | null;
    opened: number;
    closed: number | null;
    how: string | null;
    byHand: boolean;
    repeats: boolean;
    last: number | null;
    late: boolean;
    due: string | null;
  }
  let { chatId }: { chatId: string } = $props();
  let list = $state<LoopView[]>([]);
  let open = $state(false);
  let all = $state(false);
  let el = $state<HTMLElement | null>(null);
  let busy = $state<string | null>(null);
  const SHOWN = 8;

  async function load() {
    try {
      list = (await get<{ loops: LoopView[] }>(`/api/chats/${chatId}/loops`)).loops;
    } catch {
      list = [];
    }
  }
  $effect(() => {
    void trk.data;
    void load();
  });
  $effect(() => {
    if (dockRequest.seq && dockRequest.section === "loops") {
      open = true;
      requestAnimationFrame(() => el?.scrollIntoView({ block: "start", behavior: "smooth" }));
    }
  });

  const live = $derived(list.filter((l) => l.status === "open"));
  const late = $derived(live.filter((l) => l.late).length);
  const over = $derived(list.filter((l) => l.status !== "open"));
  const said = $derived(all ? over : over.slice(0, SHOWN));
  const SAID: Record<LoopView["status"], string> = { open: "open", done: "done", dropped: "off", lapsed: "lapsed" };
  const WORD: Record<Action, string> = { done: "Done", dropped: "Off", open: "Open again" };
  const closing = (l: LoopView) => `${SAID[l.status]}${l.closed != null ? ` at #${l.closed}` : ""}${l.how ? ` · ${l.how}` : l.byHand ? ` · ${l.status === "done" ? "you closed it" : "you called it off"}` : ""}`;

  async function act(l: LoopView, action: Action) {
    busy = l.id;
    try {
      await post(`/api/chats/${chatId}/loops/${encodeURIComponent(l.id)}`, { action });
      toast(l.repeats && action === "done" ? "Noted for this time" : WORD[action], { kind: "ok" });
      await load();
    } catch (e) {
      errorToast(e);
    } finally {
      busy = null;
    }
  }
</script>

{#if list.length}
  <div bind:this={el} data-section="loops">
    <Module title="Open loops" fold bind:open led={late ? "warm" : live.length ? "on" : null} peek={late ? `${late} past due` : live.length ? `${live.length} open` : "None"}>
      {#each live as l (l.id)}
        <div class="sec" class:due={l.late}>
          <div class="txt">
            <span>{l.who ? `${l.who}: ` : ""}{l.what}</span>
            <small>{l.kind} · from #{l.opened}{l.due ? ` · ${l.late ? "was due" : "due"} ${l.due}` : ""}{l.repeats ? ` · repeats${l.last != null ? `, last at #${l.last}` : ""}` : ""}</small>
          </div>
          <div class="st-keys">
            <button class="st-key" type="button" disabled={busy === l.id} onclick={() => act(l, "done")}>{l.repeats ? "Done this time" : "Done"}</button>
            <button class="st-key" type="button" disabled={busy === l.id} onclick={() => act(l, "dropped")} title="It's not happening: nobody's waiting for it now">It's off</button>
          </div>
        </div>
      {:else}
        <p class="st-hint first">Nothing's open.</p>
      {/each}
      {#each said as l (l.id)}
        <div class="sec settled">
          <div class="txt">
            <span>{l.who ? `${l.who}: ` : ""}{l.what}</span>
            <small>{closing(l)}</small>
          </div>
          <div class="st-keys"><button class="st-key" type="button" disabled={busy === l.id} onclick={() => act(l, "open")}>Open again</button></div>
        </div>
      {/each}
      {#if over.length > SHOWN}<div class="st-keys"><button class="st-key" type="button" onclick={() => (all = !all)}>{all ? "Fewer" : `All ${over.length}`}</button></div>{/if}
    </Module>
  </div>
{/if}

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
  .sec.settled {
    opacity: 0.8;
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
</style>
