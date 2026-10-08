<script lang="ts">
  import StyleEditor from "./StyleEditor.svelte";
  import { get, post } from "../../lib/api";
  import { onEvent } from "../../lib/events";
  import { Compass } from "../../lib/icons";
  import { app, errorToast } from "../../lib/state.svelte";
  import type { AdvisorPlan, ChatSettings, StyleProfile } from "../../lib/types";

  /** Steering for one chat: the advisor (STEER-01/02), the editor (STEER-03), the style profile (STEER-04). */
  let { chatId, characterStyle = null, settings, onupdate }: { chatId: string; characterStyle?: StyleProfile | null; settings: ChatSettings; onupdate: (patch: { settings: Partial<ChatSettings> }) => Promise<void> | void } = $props();

  let plans = $state<{ id: string; plan: AdvisorPlan; used: boolean; createdAt: number }[]>([]);
  let next = $state<AdvisorPlan | null>(null);
  let on = $state(false);
  let planning = $state(false);
  const steer = $derived(app.settings?.["steer.config"]);

  async function load() {
    try {
      const r = await get<{ on: boolean; next: AdvisorPlan | null; plans: typeof plans }>(`/api/chats/${chatId}/advisor`);
      on = r.on;
      next = r.next;
      plans = r.plans;
    } catch {
      // optional
    }
  }
  $effect(() => {
    void chatId;
    void settings.advisor;
    void load();
  });
  $effect(() =>
    onEvent((e) => {
      if ((e.type === "gen.end" || e.type === "chat.changed") && "chatId" in e && e.chatId === chatId) void load();
    }),
  );

  async function planNow() {
    planning = true;
    try {
      await post(`/api/chats/${chatId}/advisor/plan`, {});
      await load();
    } catch (e) {
      errorToast(e);
    } finally {
      planning = false;
    }
  }
  const fmt = (p: AdvisorPlan) => [p.direction, p.beats.length ? `Beats: ${p.beats.join("; ")}` : ""].filter(Boolean).join(" ");
</script>

<details class="steer" open={Boolean(settings.advisor || settings.editor || settings.style)}>
  <summary class="label"><Compass size={13} /> Steering</summary>
  <div class="stack tight">
    <div class="field">
      <span class="tiny muted">Advisor: a private plan before each reply</span>
      <select class="select mini" value={settings.advisor == null ? "" : settings.advisor ? "on" : "off"} onchange={(e) => onupdate({ settings: { advisor: e.currentTarget.value === "" ? null : e.currentTarget.value === "on" } })}>
        <option value="">Default ({steer?.advisor ? "on" : "off"})</option>
        <option value="on">On</option>
        <option value="off">Off</option>
      </select>
      {#if on}
        {#if next}
          <div class="plan small"><b>Ready for the next reply:</b> {fmt(next)}</div>
        {:else}
          <div class="row"><span class="hint grow">The plan for the next reply is written while you type.</span><button class="btn ghost small" onclick={planNow} disabled={planning}>{planning ? "Planning…" : "Plan now"}</button></div>
        {/if}
        {#if plans.filter((p) => p.used).length}
          <details class="earlier">
            <summary class="tiny muted">Earlier plans ({plans.filter((p) => p.used).length})</summary>
            {#each plans.filter((p) => p.used) as p (p.id)}<p class="tiny">{fmt(p.plan)}</p>{/each}
          </details>
        {/if}
      {/if}
    </div>
    <label class="field">
      <span class="tiny muted">Editor: small fixes after each reply</span>
      <select class="select mini" value={settings.editor ?? ""} onchange={(e) => onupdate({ settings: { editor: (e.currentTarget.value || null) as ChatSettings["editor"] } })}>
        <option value="">Default ({steer?.editor === "off" ? "off" : steer?.editor === "flagged" ? "when the guards find something" : "every reply"})</option>
        <option value="off">Off</option>
        <option value="flagged">When the guards find something</option>
        <option value="every">Every reply</option>
      </select>
    </label>
    <div class="field">
      <span class="tiny muted">Style profile</span>
      <StyleEditor value={settings.style ?? {}} inherited={characterStyle} onchange={(style) => onupdate({ settings: { style } })} />
    </div>
  </div>
</details>

<style>
  .steer summary {
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }
  .plan {
    background: var(--surface-2);
    border-radius: var(--r-sm);
    padding: 0.45rem 0.6rem;
  }
  .earlier p {
    margin: 0.3rem 0;
    padding-left: 0.5rem;
    border-left: 2px solid var(--border);
  }
</style>
