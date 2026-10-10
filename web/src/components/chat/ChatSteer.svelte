<script lang="ts">
  import Module from "../desk/Module.svelte";
  import Seg from "../desk/Seg.svelte";
  import { get, post } from "../../lib/api";
  import { onEvent } from "../../lib/events";
  import { autosize } from "../../lib/gestures";
  import { Plus, X } from "../../lib/icons";
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
  const used = $derived(plans.filter((p) => p.used));

  // The style profile (what StyleEditor does elsewhere), laid out for the desk.
  const style = $derived(settings.style ?? {});
  // A local copy so typing isn't interrupted by refreshes.
  // svelte-ignore state_referenced_locally
  let guide = $state(settings.style?.guide ?? "");
  // svelte-ignore state_referenced_locally
  let dialogue = $state(settings.style?.dialogue ?? "");
  let word = $state("");
  let timer: ReturnType<typeof setTimeout>;
  function emit(patch: Partial<StyleProfile>, delay = 0) {
    clearTimeout(timer);
    timer = setTimeout(() => onupdate({ settings: { style: { ...style, guide: guide.trim() || undefined, dialogue: dialogue.trim() || undefined, ...patch } } }), delay);
  }
  function addWord() {
    const w = word.trim();
    if (!w) return;
    emit({ banned: [...new Set([...(style.banned ?? []), w])] });
    word = "";
  }

  const advisorDefault = $derived(steer?.advisor ? "on" : "off");
  const advisorOn = $derived(settings.advisor ?? Boolean(steer?.advisor));
  const editorDefault = $derived(steer?.editor === "off" ? "off" : steer?.editor === "flagged" ? "when the guards find something" : "after every reply");
</script>

<Module title="Steering" fold open={Boolean(settings.advisor || settings.editor || settings.style)} led={advisorOn ? "ok" : null} peek={advisorOn ? "Advisor on" : "Advisor off"}>
  <div class="st-seg-row">
    <span class="st-k">Advisor</span>
    <Seg
      label="Advisor: a private plan before each reply"
      value={settings.advisor == null ? "" : settings.advisor ? "on" : "off"}
      options={[
        { value: "", label: `Default (${advisorDefault})` },
        { value: "on", label: "On" },
        { value: "off", label: "Off" },
      ]}
      onchange={(v) => onupdate({ settings: { advisor: v === "" ? null : v === "on" } })}
    />
  </div>
  <p class="st-hint">A private plan for each reply, written before it.</p>
  {#if on}
    <div class="screen">
      <div class="st-lcd top">
        <span>{next ? "● NEXT PLAN READY" : planning ? "PLANNING…" : "○ NO PLAN YET"}</span>
        {#if used.length}<span>{used.length} EARLIER</span>{/if}
      </div>
      {#if next}
        <p>{fmt(next)}</p>
      {:else}
        <div class="st-row wait"><span class="st-grow">The plan for the next reply is written while you type.</span><button class="st-key small" type="button" onclick={planNow} disabled={planning}>{planning ? "Planning…" : "Plan now"}</button></div>
      {/if}
      {#if used.length}
        <details class="earlier">
          <summary class="st-link">Earlier plans ({used.length})</summary>
          {#each used as p (p.id)}<p>{fmt(p.plan)}</p>{/each}
        </details>
      {/if}
    </div>
  {/if}

  <div class="st-seg-row editor">
    <span class="st-k">Editor</span>
    <Seg
      label="Editor: small fixes after each reply"
      value={settings.editor ?? ""}
      options={[
        { value: "", label: "Default", title: `Default: ${editorDefault}` },
        { value: "off", label: "Off" },
        { value: "flagged", label: "Flagged", title: "When the guards find something" },
        { value: "every", label: "Every", title: "Every reply" },
      ]}
      onchange={(v) => onupdate({ settings: { editor: (v || null) as ChatSettings["editor"] } })}
    />
  </div>
  <p class="st-hint">Small fixes after each reply. Default: {editorDefault}. “Flagged” runs only when the guards find something.</p>

  <hr class="st-divider" />
  <span class="st-k">Style profile</span>
  <textarea
    class="st-plain guide"
    use:autosize={200}
    bind:value={guide}
    oninput={() => emit({}, 600)}
    aria-label="Prose style guide"
    placeholder={characterStyle?.guide ? `From the character: ${characterStyle.guide}` : "Short paragraphs. Concrete sensory detail. Let silences sit."}
    maxlength="1500"
  ></textarea>
  <div class="st-seg-row gap">
    <span class="st-k">Actions</span>
    <Seg
      label="Actions"
      value={style.actions ?? ""}
      options={[
        { value: "", label: characterStyle?.actions ? "Char's" : "Default", title: characterStyle?.actions ? `The character's (${characterStyle.actions})` : "Any" },
        { value: "asterisks", label: "*Stars*", title: "In *asterisks*" },
        { value: "plain", label: "Plain", title: "Plain prose" },
        { value: "any", label: "Any" },
      ]}
      onchange={(v) => emit({ actions: (v || undefined) as StyleProfile["actions"] })}
    />
  </div>
  <div class="st-seg-row">
    <span class="st-k">Quotes</span>
    <Seg
      label="Dialogue quotes"
      value={style.quotes ?? ""}
      options={[
        { value: "", label: characterStyle?.quotes ? "Char's" : "Default", title: characterStyle?.quotes ? `The character's (${characterStyle.quotes})` : "Any" },
        { value: "straight", label: '"Straight"' },
        { value: "curly", label: "“Curly”", title: "“Curly” (every message)" },
        { value: "any", label: "Any" },
      ]}
      onchange={(v) => emit({ quotes: (v || undefined) as StyleProfile["quotes"] })}
    />
  </div>
  <input class="st-plain dlg" bind:value={dialogue} oninput={() => emit({}, 600)} placeholder="Em dashes for interruptions; no ellipses" maxlength="200" aria-label="Dialogue punctuation, other notes" />
  <span class="st-k never">Never says <span class="lc">· flagged like your banned phrases</span></span>
  {#if characterStyle?.banned?.length || style.banned?.length}
    <div class="bleeps">
      {#each characterStyle?.banned ?? [] as w (w)}<span class="bleep inh" title="From the character">{w}</span>{/each}
      {#each style.banned ?? [] as w (w)}<span class="bleep">{w}<button type="button" onclick={() => emit({ banned: (style.banned ?? []).filter((x) => x !== w) })} aria-label="Remove {w}"><X size={10} /></button></span>{/each}
    </div>
  {/if}
  <label class="st-addline"><Plus size={14} /><input bind:value={word} placeholder="Add a word, Enter" maxlength="80" onkeydown={(e) => e.key === "Enter" && (e.preventDefault(), addWord())} aria-label="Add a word this story never uses" /></label>
</Module>

<style>
  .screen {
    margin-top: 10px;
    padding: 10px 12px;
    border-radius: var(--r-sm);
    background: var(--st-well);
    box-shadow: var(--st-inset);
  }
  .top {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    font-size: calc(9.5px * var(--st-lcd-k));
    color: var(--ok);
  }
  .screen p {
    margin: 6px 0 0;
    font: italic 13.5px/1.45 var(--st-story);
    overflow-wrap: anywhere;
  }
  .wait {
    margin-top: 6px;
    font-size: 12px;
    color: var(--text-muted);
  }
  .earlier {
    margin-top: 8px;
  }
  .earlier summary {
    list-style: none;
  }
  .earlier summary::-webkit-details-marker {
    display: none;
  }
  .earlier p {
    padding-left: 8px;
    border-left: 2px solid var(--st-edge);
    font-size: 12.5px;
    color: var(--text-muted);
  }
  .editor {
    margin-top: 14px;
  }
  .guide {
    margin-top: 6px;
  }
  .gap {
    margin-top: 10px;
  }
  .dlg {
    margin-top: 10px;
    font-size: 13px;
  }
  .never {
    display: block;
    margin-top: 14px;
  }
  .lc {
    text-transform: none;
    letter-spacing: 0;
    font-weight: 600;
  }
  .bleeps {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 7px;
  }
  .bleep {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 4px 4px 9px;
    border-radius: 4px;
    background: var(--danger);
    color: var(--surface);
    font: 400 calc(10.5px * var(--st-lcd-k)) / 1 var(--st-lcd);
    letter-spacing: 0.02em;
  }
  .bleep.inh {
    opacity: 0.6;
    padding-right: 9px;
  }
  .bleep button {
    display: grid;
    place-items: center;
    width: 16px;
    height: 16px;
    padding: 0;
    border: 0;
    border-radius: 3px;
    background: rgb(0 0 0 / 18%);
    color: inherit;
    cursor: pointer;
  }
</style>
