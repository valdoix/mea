<script lang="ts">
  import Module from "../desk/Module.svelte";
  import Seg from "../desk/Seg.svelte";
  import { get, post } from "../../lib/api";
  import { onEvent } from "../../lib/events";
  import { RefreshCw } from "../../lib/icons";
  import { errorToast, toast } from "../../lib/state.svelte";
  import type { ChatSettings, GuardsConfig, GuardsView, SlipInfo } from "../../lib/types";

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

  /** P1: a check's switch. Checks with their own guard setting flip it; the rest flip `slips`. */
  async function toggleSlip(sl: SlipInfo) {
    const next: Partial<GuardsConfig> = { ...own };
    const slips = { ...(own.slips ?? {}) };
    if (sl.setting && typeof view?.config[sl.setting] === "boolean") {
      (next as Record<string, unknown>)[sl.setting] = !sl.on;
      delete slips[sl.id];
    } else if (sl.setting === "names" && !sl.on && view?.config.names === "off") {
      next.names = "flag";
      delete slips[sl.id];
    } else if (sl.on) slips[sl.id] = false;
    else delete slips[sl.id];
    next.slips = slips;
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
  const threshold = $derived(view?.config.driftThreshold ?? 0.45);
  /** The meter reads how close the voice is to the samples: 1 − drift. Below 1 − threshold is the red zone. */
  const match = (score: number) => Math.max(0, Math.min(1, 1 - score));
  const history = $derived((view?.drift.history ?? []).slice(-16));

  // The VU face: a 120° arc, the needle swinging from DRIFT (left) to VOICE (right).
  const CX = 140;
  const CY = 102;
  const R = 86;
  const pt = (t: number, r: number) => {
    const a = ((-60 + t * 120 - 90) * Math.PI) / 180;
    return [CX + r * Math.cos(a), CY + r * Math.sin(a)] as const;
  };
  const red = $derived(1 - threshold);
  const ticks = $derived(
    Array.from({ length: 21 }, (_, i) => {
      const t = i / 20;
      const [x1, y1] = pt(t, R);
      const [x2, y2] = pt(t, i % 5 ? R - 7 : R - 12);
      return { x1, y1, x2, y2, red: t < red, major: !(i % 5) };
    }),
  );
  const scale = [0, 0.25, 0.5, 0.75, 1].map((t) => ({ t, at: pt(t, R + 10) }));
  const redArc = $derived.by(() => {
    const [ax, ay] = pt(0, R + 1);
    const [bx, by] = pt(red, R + 1);
    return `M${ax} ${ay} A ${R + 1} ${R + 1} 0 0 1 ${bx} ${by}`;
  });
  // The needle rests at the left until there's a reading, then swings over.
  let settled = $state(false);
  $effect(() => {
    void latest;
    const t = setTimeout(() => (settled = true), 250);
    return () => clearTimeout(t);
  });
  const needle = $derived(-60 + (settled && latest ? match(latest.score) : checking ? 0.3 : 0) * 120);
</script>

<Module
  title="Guards & voice"
  fold
  open={false}
  led={latest ? (latest.drifting ? "warm" : "ok") : null}
  peek={latest ? (latest.drifting ? "Drifting" : "On voice") : view?.drift.samples === 0 ? "No voice samples" : "Not measured yet"}
>
  {#if !view}
    <p class="st-loading">LOADING…</p>
  {:else}
    {#if view.drift.samples === 0}
      <p class="st-hint first">No voice samples yet. Keep a few lines in the character's voice lab, or add example dialogue to the card, and Mea can tell when the voice drifts.</p>
    {:else}
      <div class="vu">
        <svg viewBox="0 0 280 132" role="img" aria-label={latest ? `Voice meter: ${Math.round(match(latest.score) * 100)}% like the samples, ${latest.drifting ? "drifting" : "on voice"}` : "Voice meter: not measured yet"}>
          {#each ticks as k, i (i)}<line class="tk" class:red={k.red} x1={k.x1} y1={k.y1} x2={k.x2} y2={k.y2} stroke-width={k.major ? 1.6 : 1} />{/each}
          {#each scale as s (s.t)}<text class="scale-t" x={s.at[0]} y={s.at[1]} text-anchor="middle">{Math.round(s.t * 100)}</text>{/each}
          <path d={redArc} fill="none" class="red" stroke-width="3" opacity=".7" />
          <text class="vu-label" x={CX} y={CY + 22} text-anchor="middle">{latest ? `${latest.drifting ? "DRIFTING" : "ON VOICE"} · ${Math.round(match(latest.score) * 100)}` : "NOT MEASURED"}</text>
          <text class="vu-sub" x="18" y={CY + 22}>DRIFT</text>
          <text class="vu-sub" x="262" y={CY + 22} text-anchor="end">VOICE</text>
          <line class="needle" x1={CX} y1={CY} x2={CX} y2={CY - R + 4} style:transform="rotate({needle}deg)" />
          <circle class="hub" cx={CX} cy={CY} r="6" />
        </svg>
        {#if history.length > 1}
          <div class="history" aria-hidden="true">
            {#each history as h, i (i)}<span class:low={h.drifting} style:height="{Math.max(8, match(h.score) * 100)}%"></span>{/each}
          </div>
        {/if}
      </div>
      <div class="vu-foot">
        <span>Against {view.drift.samples} sample line{view.drift.samples === 1 ? "" : "s"} from {view.drift.source === "both" ? "the voice lab and the card" : view.drift.source === "voice lab" ? "the voice lab" : "the card's examples"}.</span>
        <button class="st-key small" type="button" onclick={check} disabled={checking}><RefreshCw size={13} class={checking ? "spin" : ""} /> {checking ? "Checking…" : "Check"}</button>
      </div>
      {#if latest?.reasons.length}<p class="st-hint">{latest.reasons.join(" · ")}</p>{/if}
    {/if}

    <hr class="st-divider" />
    <div class="st-seg-row">
      <span class="st-k">Re-anchor</span>
      <Seg
        label="Re-anchor"
        value={own.anchor ?? ""}
        options={[
          { value: "", label: "Default", title: `Default: ${view.config.anchor === "auto" ? "long chats and drift" : view.config.anchor}` },
          { value: "auto", label: "Auto", title: "Long chats and drift" },
          { value: "always", label: "Always" },
          { value: "off", label: "Off" },
        ]}
        onchange={(v) => setOwn("anchor", v as GuardsConfig["anchor"] | "")}
      />
    </div>
    <div class="st-hint status">
      <span><span class="st-led" class:ok={view.anchor.active && !view.anchor.strong} class:warm={view.anchor.strong}></span> {view.anchor.active ? (view.anchor.strong ? "On, stronger: the voice drifted" : "On · in the prompt now") : "Not in the prompt yet"}</span>
      <button class="st-link" type="button" onclick={() => (showAnchor = !showAnchor)}>{showAnchor ? "Hide" : "Show"} text</button>
    </div>
    {#if showAnchor}<pre class="anchor">{view.anchor.text}</pre>{/if}

    <div class="st-seg-row gap">
      <span class="st-k">Writes for you</span>
      <Seg
        label="Writing for you"
        value={own.puppetAction ?? ""}
        options={[
          { value: "", label: "Default", title: `Default: ${view.config.puppetAction === "flag" ? "note it" : view.config.puppetAction === "trim" ? "cut the end" : "write it again"}` },
          { value: "flag", label: "Note", title: "Note it" },
          { value: "trim", label: "Cut", title: "Cut the end" },
          { value: "regenerate", label: "Redo", title: "Write it again" },
        ]}
        onchange={(v) => setOwn("puppetAction", v as GuardsConfig["puppetAction"] | "")}
      />
    </div>
    <div class="st-seg-row">
      <span class="st-k">Names</span>
      <Seg
        label="Misspelled names"
        value={own.names ?? ""}
        options={[
          { value: "", label: "Default", title: `Default: ${view.config.names === "fix" ? "correct them" : view.config.names === "flag" ? "note them" : "off"}` },
          { value: "flag", label: "Note", title: "Note them" },
          { value: "fix", label: "Fix", title: "Correct them" },
          { value: "off", label: "Off" },
        ]}
        onchange={(v) => setOwn("names", v as GuardsConfig["names"] | "")}
      />
    </div>
    <hr class="st-divider" />
    <span class="st-k">Checks · run on every reply</span>
    <div class="st-keys checks" role="group" aria-label="Reply checks">
      {#each view.slips as sl (sl.id)}
        <button class="st-key" type="button" aria-pressed={sl.on} onclick={() => toggleSlip(sl)} title={`${sl.description}${sl.on && !sl.runs ? " Waiting on another setting (the continuity checker or the leak guard)." : ""}`}>
          <span class="st-led" class:on={sl.runs} class:warm={sl.on && !sl.runs}></span>{sl.label}
        </button>
      {/each}
    </div>
    {#if view.slips.some((x) => x.on && !x.runs)}<p class="st-hint">An amber light is switched on but waits on another setting: the continuity checker, or the leak guard (Settings › Memory).</p>{/if}
    <p class="st-hint"><a href="/settings/guards">All guard settings →</a></p>
  {/if}
</Module>

<style>
  .first {
    margin-top: 0;
  }
  .vu {
    padding: 10px 10px 8px;
    border-radius: var(--r-sm);
    background: linear-gradient(color-mix(in srgb, var(--butter) 35%, var(--surface)), var(--surface));
    box-shadow: var(--st-inset);
  }
  :global(:root:is([data-mode="night"], [data-theme="lantern"], [data-theme="dark"])) .vu {
    background: linear-gradient(color-mix(in srgb, var(--lamp, var(--butter)) 14%, var(--st-well)), var(--st-well));
  }
  .vu svg {
    display: block;
    width: 100%;
    height: auto;
  }
  .scale-t {
    font: 600 8px/1 var(--font-ui);
    fill: var(--text-muted);
  }
  .tk {
    stroke: var(--text-muted);
  }
  .red,
  .tk.red {
    stroke: var(--danger);
  }
  .needle {
    stroke: var(--text);
    stroke-width: 1.6;
    stroke-linecap: round;
    transform-origin: 140px 102px;
    transition: transform 0.6s cubic-bezier(0.3, 1.6, 0.5, 1);
  }
  .hub {
    fill: var(--text);
  }
  .vu-label {
    font: 400 calc(11px * var(--st-lcd-k)) / 1 var(--st-lcd);
    fill: var(--text);
    letter-spacing: 0.06em;
  }
  .vu-sub {
    font: 600 9px/1 var(--font-ui);
    fill: var(--text-faint);
  }
  .history {
    display: flex;
    align-items: flex-end;
    gap: 3px;
    height: 26px;
    margin-top: 8px;
  }
  .history span {
    flex: 1;
    border-radius: 2px 2px 0 0;
    background: var(--ok);
    opacity: 0.75;
  }
  .history span.low {
    background: var(--st-warm);
  }
  .vu-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-top: 8px;
    font-size: 11.5px;
    color: var(--text-faint);
  }
  .vu-foot .st-key {
    flex: 0 0 auto;
  }
  .status {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .anchor {
    margin: 8px 0 0;
    padding: 9px 11px;
    border-radius: var(--r-sm);
    background: var(--st-well);
    font: italic 12px/1.5 var(--st-story);
    color: var(--text-muted);
    white-space: pre-wrap;
  }
  .gap {
    margin-top: 12px;
  }
  .checks {
    flex-wrap: wrap;
    margin-top: 6px;
  }
</style>
