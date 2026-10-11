<script lang="ts">
  import Module from "../desk/Module.svelte";
  import { get, post } from "../../lib/api";
  import { dockRequest } from "../../lib/dock.svelte";
  import { Handshake } from "../../lib/icons";
  import { errorToast, toast } from "../../lib/state.svelte";
  import { trk } from "../../lib/trackers.svelte";

  /**
   * E3: the Story tab's promises and meetings, with a countdown in story time, and your word on
   * each: Kept, Broken, They had a reason (the bond doesn't move), Forgive.
   */
  interface PromiseView {
    id: string;
    who: string;
    whom: string | null;
    what: string;
    meet: string | null;
    status: "open" | "due" | "kept" | "broken" | "paid" | "forgiven" | "lapsed" | "excused";
    auto: boolean;
    importance: number;
    due: string | null;
    left: number | null;
    window: number;
    seq: number;
  }
  let { chatId }: { chatId: string } = $props();
  let list = $state<PromiseView[]>([]);
  let open = $state(false);
  let el = $state<HTMLElement | null>(null);
  let busy = $state<string | null>(null);

  async function load() {
    try {
      list = (await get<{ promises: PromiseView[] }>(`/api/chats/${chatId}/promises`)).promises;
    } catch {
      list = [];
    }
  }
  $effect(() => {
    void trk.data;
    void load();
  });
  $effect(() => {
    if (dockRequest.seq && dockRequest.section === "promises") {
      open = true;
      requestAnimationFrame(() => el?.scrollIntoView({ block: "start", behavior: "smooth" }));
    }
  });

  const live = $derived(list.filter((p) => p.status === "open" || p.status === "due"));
  const settled = $derived(list.filter((p) => !(p.status === "open" || p.status === "due")).slice(0, 6));
  const soon = $derived(live.find((p) => p.left != null && p.left <= 120));
  const left = (min: number) => (min <= 0 ? "now" : min < 60 ? `in ${min} min` : min < 1440 ? `in ${Math.floor(min / 60)} h ${min % 60 ? `${min % 60} min` : ""}`.trim() : `in ${Math.round(min / 1440)} d`);
  const SAID: Record<PromiseView["status"], string> = { open: "open", due: "due", kept: "kept", broken: "broken", paid: "paid", forgiven: "forgiven", lapsed: "lapsed", excused: "they had a reason" };

  async function verdict(p: PromiseView, v: "kept" | "broken" | "excused" | "forgiven" | "open") {
    busy = p.id;
    try {
      await post(`/api/chats/${chatId}/promises/${encodeURIComponent(p.id)}`, { verdict: v });
      toast(v === "excused" ? "They had a reason; the bond stays as it was" : v === "forgiven" ? "Forgiven" : `Marked ${v}`, { kind: "ok" });
      await load();
    } catch (e) {
      errorToast(e);
    } finally {
      busy = null;
    }
  }
</script>

<div bind:this={el} data-section="promises">
  <Module title="Promises" fold bind:open led={soon ? "warm" : live.length ? "on" : null} peek={soon ? `${soon.meet ? `at ${soon.meet}` : soon.whom ?? ""} ${left(soon.left!)}` : live.length ? `${live.length} open` : "None"}>
    {#each live as p (p.id)}
      <div class="sec" class:due={p.left != null && p.left <= 120}>
        <div class="txt">
          <span><Handshake size={12} /> {p.who} → {p.whom ?? "someone"}: {p.what}{p.importance >= 3 ? " · vital" : p.importance <= 1 ? " · minor" : ""}</span>
          <small>{p.meet ? `meeting at ${p.meet} · ` : ""}{p.due ? `${p.due}` : "no time set"}{p.left != null ? ` · ${left(p.left)}` : ""}</small>
        </div>
        <div class="st-keys">
          <button class="st-key" type="button" disabled={busy === p.id} onclick={() => verdict(p, "kept")}>Kept</button>
          <button class="st-key" type="button" disabled={busy === p.id} onclick={() => verdict(p, "broken")}>Broken</button>
        </div>
      </div>
    {:else}
      <p class="st-hint first">Promises and meetings appear as they're made, in a reply or in your own message, each with a time. Mea marks a meeting kept when you're both there in time, and broken when someone is stood up.</p>
    {/each}
    {#each settled as p (p.id)}
      <div class="sec settled">
        <div class="txt">
          <span>{p.who} → {p.whom ?? "someone"}: {p.what}</span>
          <small>{SAID[p.status]}{p.auto ? " (Mea's call)" : ""}</small>
        </div>
        <div class="st-keys">
          {#if p.status === "broken"}
            <button class="st-key" type="button" disabled={busy === p.id} onclick={() => verdict(p, "excused")} title="The bond doesn't move">They had a reason</button>
            <button class="st-key" type="button" disabled={busy === p.id} onclick={() => verdict(p, "forgiven")} title="The resentment goes; the trust takes longer">Forgive</button>
            <button class="st-key" type="button" disabled={busy === p.id} onclick={() => verdict(p, "kept")}>It was kept</button>
          {:else if p.status === "kept"}
            <button class="st-key" type="button" disabled={busy === p.id} onclick={() => verdict(p, "broken")}>It was broken</button>
          {/if}
        </div>
      </div>
    {/each}
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
