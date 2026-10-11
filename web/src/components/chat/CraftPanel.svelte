<script lang="ts">
  import Module from "../desk/Module.svelte";
  import { get, post } from "../../lib/api";
  import { dockRequest } from "../../lib/dock.svelte";
  import { onEvent } from "../../lib/events";
  import { errorToast, toast } from "../../lib/state.svelte";

  /**
   * D2: the craft coach in the Chat tab. The habits the last replies lean on (against this story's
   * own baseline), with Ban it for a phrase that keeps coming back, It's fine, and Pause coach.
   */
  interface Habit {
    key: string;
    kind: string;
    avoid: string;
    detail: string;
    phrase?: string;
  }
  interface Report {
    habits: Habit[];
    meter: { replies: number };
    on: boolean;
    paused: boolean;
    ignored: string[];
  }
  let { chatId }: { chatId: string } = $props();
  let r = $state<Report | null>(null);
  let open = $state(false);
  let el = $state<HTMLElement | null>(null);

  async function load() {
    try {
      r = await get<Report>(`/api/chats/${chatId}/craft`);
    } catch {
      r = null;
    }
  }
  $effect(() => {
    void chatId;
    void load();
  });
  let t: ReturnType<typeof setTimeout>;
  $effect(() =>
    onEvent((e) => {
      if ((e.type === "gen.end" || e.type === "message.changed" || e.type === "chat.changed") && e.chatId === chatId) {
        clearTimeout(t);
        t = setTimeout(load, 1500);
      }
    }),
  );
  $effect(() => {
    if (dockRequest.seq && dockRequest.section === "craft") {
      open = true;
      requestAnimationFrame(() => el?.scrollIntoView({ block: "start", behavior: "smooth" }));
    }
  });

  async function act(body: Record<string, unknown>, done?: string) {
    try {
      await post(`/api/chats/${chatId}/craft`, body);
      if (done) toast(done);
      await load();
    } catch (e) {
      errorToast(e);
    }
  }
  async function ban(h: Habit) {
    try {
      await post("/api/craft/ban", { phrase: h.phrase });
      toast(`Banned: "${h.phrase}" (Settings › Writing)`, { kind: "ok" });
      await act({ ignore: h.key });
    } catch (e) {
      errorToast(e);
    }
  }
</script>

{#if r && (r.on || r.paused)}
  <div bind:this={el} data-section="craft">
    <Module title="Craft" fold bind:open led={r.paused ? null : r.habits.length ? "warm" : "ok"} peek={r.paused ? "Paused" : r.meter.replies < 2 ? "After a few replies" : `${r.habits.length} habit${r.habits.length === 1 ? "" : "s"} watched`}>
      {#if r.paused}
        <p class="st-hint first">The coach is paused in this chat.</p>
      {:else if r.meter.replies < 2}
        <p class="st-hint first">After a few replies, the coach measures what they lean on (against this story's own rhythm) and tells the model three things to avoid and one technique to try.</p>
      {:else if !r.habits.length}
        <p class="st-hint first">Nothing the last replies lean on. The model still gets one technique to try each reply.</p>
      {:else}
        <ul class="habits">
          {#each r.habits as h, i (h.key)}
            <li class:sent={i < 3}>
              <span class="txt"><b>{h.avoid}</b><small>{h.detail}{i < 3 ? " · sent to the model" : ""}</small></span>
              <span class="st-keys">
                {#if h.phrase}<button class="st-key" type="button" onclick={() => ban(h)} title="Add to your banned phrases">Ban it</button>{/if}
                <button class="st-key" type="button" onclick={() => act({ ignore: h.key }, "Fine: the coach leaves it alone here")}>It's fine</button>
              </span>
            </li>
          {/each}
        </ul>
      {/if}
      {#if r.ignored.length}<p class="st-hint">You said {r.ignored.length} habit{r.ignored.length === 1 ? " is" : "s are"} fine here. <button class="st-link" type="button" onclick={() => Promise.all(r!.ignored.map((k) => post(`/api/chats/${chatId}/craft`, { unignore: k }))).then(load)}>Watch them again</button></p>{/if}
      <div class="st-keys"><button class="st-key" type="button" aria-pressed={r.paused} onclick={() => act({ paused: !r!.paused })}><span class="st-led" class:on={!r.paused}></span>{r.paused ? "Resume coach" : "Pause coach"}</button></div>
    </Module>
  </div>
{/if}

<style>
  .habits {
    display: grid;
    gap: 6px;
    margin: 0 0 8px;
    padding: 0;
    list-style: none;
  }
  .habits li {
    display: grid;
    gap: 6px;
    padding: 8px;
    border-radius: var(--r-sm);
    background: var(--st-well);
    box-shadow: var(--st-inset-sm);
  }
  .habits li.sent {
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--st-warm) 55%, transparent);
  }
  .txt {
    display: grid;
    gap: 2px;
    font-size: 13px;
  }
  .txt b {
    font-weight: 600;
  }
  .txt small {
    font-size: 11px;
    color: var(--text-faint);
  }
</style>
