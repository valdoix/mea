<script lang="ts">
  import { get, post } from "../../lib/api";
  import { onEvent } from "../../lib/events";
  import { RefreshCw, ShieldCheck } from "../../lib/icons";
  import { errorToast, toast } from "../../lib/state.svelte";
  import type { ChatSettings, GuardsConfig, GuardsView } from "../../lib/types";

  /** Phase 5 guards for one chat: the re-anchor (CON-03), voice drift (CON-10), and this chat's own switches. */
  let { chatId, settings, onupdate }: { chatId: string; settings: ChatSettings; onupdate: (patch: { settings: Partial<ChatSettings> }) => Promise<void> | void } = $props();

  let view = $state<GuardsView | null>(null);
  let showAnchor = $state(false);
  let checking = $state(false);

  async function load() {
    try {
      view = await get<GuardsView>(`/api/chats/${chatId}/guards`);
    } catch {
      view = null;
    }
  }
  $effect(() => {
    void chatId;
    void load();
  });
  $effect(() =>
    onEvent((e) => {
      if (e.type === "chat.changed" && e.chatId === chatId) void load();
    }),
  );

  const own = $derived(settings.guards ?? {});
  async function setOwn<K extends keyof GuardsConfig>(k: K, v: GuardsConfig[K] | "") {
    const next: Partial<GuardsConfig> = { ...own };
    if (v === "") delete next[k];
    else next[k] = v as GuardsConfig[K];
    await onupdate({ settings: { guards: next } });
    void load();
  }

  async function check() {
    checking = true;
    try {
      const r = await post<{ status: string; reason?: string; reading?: { drifting: boolean } }>(`/api/chats/${chatId}/drift/check`);
      if (r.status !== "ok") toast(r.reason ?? "Not enough to compare yet");
      else toast(r.reading?.drifting ? "The voice is drifting; the re-anchor is stronger now" : "The voice matches the samples ✿", { kind: "ok" });
      await load();
    } catch (e) {
      errorToast(e);
    } finally {
      checking = false;
    }
  }

  const latest = $derived(view?.drift.history.at(-1) ?? null);
  const spark = $derived.by(() => {
    const h = view?.drift.history ?? [];
    if (h.length < 2) return "";
    const w = 120;
    const step = w / (h.length - 1);
    return h.map((r, i) => `${(i * step).toFixed(1)},${(22 - Math.min(1, r.score) * 20).toFixed(1)}`).join(" ");
  });
  const threshold = $derived(view?.config.driftThreshold ?? 0.45);
</script>

<details class="guards">
  <summary class="label"><ShieldCheck size={13} /> Guards and voice{#if latest?.drifting}<span class="chip tiny warn">drifting</span>{/if}</summary>
  {#if view}
    <div class="stack tight">
      <div class="field">
        <span class="tiny muted">Re-anchor</span>
        <div class="row wrap">
          <select class="select mini" value={own.anchor ?? ""} onchange={(e) => setOwn("anchor", e.currentTarget.value as GuardsConfig["anchor"] | "")}>
            <option value="">Default ({view.config.anchor === "auto" ? "long chats and drift" : view.config.anchor})</option>
            <option value="auto">Long chats and drift</option>
            <option value="always">Always</option>
            <option value="off">Off</option>
          </select>
          <span class="tiny" class:muted={!view.anchor.active}>{view.anchor.active ? (view.anchor.strong ? "On, stronger: the voice drifted" : "On") : "Not in the prompt yet"}</span>
          <button class="btn ghost small" onclick={() => (showAnchor = !showAnchor)}>{showAnchor ? "Hide" : "Show"} text</button>
        </div>
        {#if showAnchor}<pre class="anchor tiny">{view.anchor.text}</pre>{/if}
      </div>

      <div class="field">
        <span class="tiny muted">Voice</span>
        {#if view.drift.samples === 0}
          <span class="hint">No voice samples yet. Keep a few lines in the character's voice lab, or add example dialogue to the card, and Mea can tell when the voice drifts.</span>
        {:else}
          <div class="row wrap drift">
            {#if spark}
              <svg viewBox="0 0 120 24" class="spark" role="img" aria-label="Drift over time">
                <line x1="0" x2="120" y1={22 - threshold * 20} y2={22 - threshold * 20} class="th" />
                <polyline points={spark} />
              </svg>
            {/if}
            {#if latest}
              <span class="small" class:warn-text={latest.drifting}>{latest.drifting ? "Drifting" : "On voice"} · {Math.round(latest.score * 100)}%</span>
            {:else}
              <span class="tiny muted">Not measured yet</span>
            {/if}
            <button class="btn ghost small" onclick={check} disabled={checking}><RefreshCw size={13} /> {checking ? "Checking…" : "Check now"}</button>
          </div>
          {#if latest?.reasons.length}<span class="hint">{latest.reasons.join(" · ")}</span>{/if}
          <span class="hint">Compared with {view.drift.samples} sample line{view.drift.samples === 1 ? "" : "s"} from {view.drift.source === "both" ? "the voice lab and the card" : view.drift.source === "voice lab" ? "the voice lab" : "the card's examples"}.</span>
        {/if}
      </div>

      <div class="sgrid">
        <label class="field">
          <span class="tiny muted">Writing for you</span>
          <select class="select mini" value={own.puppetAction ?? ""} onchange={(e) => setOwn("puppetAction", e.currentTarget.value as GuardsConfig["puppetAction"] | "")}>
            <option value="">Default ({view.config.puppetAction === "flag" ? "note" : view.config.puppetAction === "trim" ? "cut" : "retry"})</option>
            <option value="flag">Note it</option>
            <option value="trim">Cut the end</option>
            <option value="regenerate">Write it again</option>
          </select>
        </label>
        <label class="field">
          <span class="tiny muted">Misspelled names</span>
          <select class="select mini" value={own.names ?? ""} onchange={(e) => setOwn("names", e.currentTarget.value as GuardsConfig["names"] | "")}>
            <option value="">Default ({view.config.names === "fix" ? "correct" : view.config.names === "flag" ? "note" : "off"})</option>
            <option value="flag">Note them</option>
            <option value="fix">Correct them</option>
            <option value="off">Off</option>
          </select>
        </label>
      </div>
      <a class="tiny" href="/settings/guards">All guard settings</a>
    </div>
  {/if}
</details>

<style>
  .guards summary {
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }
  .anchor {
    white-space: pre-wrap;
    background: var(--surface-2);
    border-radius: var(--r-sm);
    padding: 0.5rem 0.6rem;
    margin: 0.3rem 0 0;
    font-family: var(--font-ui);
  }
  .drift {
    align-items: center;
    gap: 0.5rem;
  }
  .spark {
    width: 7.5rem;
    height: 1.5rem;
  }
  .spark polyline {
    fill: none;
    stroke: var(--accent-strong);
    stroke-width: 1.6;
    stroke-linejoin: round;
  }
  .spark .th {
    stroke: var(--warn);
    stroke-dasharray: 3 3;
    stroke-width: 1;
  }
  .warn-text {
    color: var(--warn);
    font-weight: 700;
  }
  .chip.warn {
    background: var(--warn-bg);
    color: var(--warn);
  }
  .sgrid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
    gap: 0.5rem;
  }
</style>
