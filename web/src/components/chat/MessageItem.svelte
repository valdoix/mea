<script lang="ts">
  import ContinuityNote from "./ContinuityNote.svelte";
  import { post } from "../../lib/api";
  import { wordDiff } from "../../lib/diff";
  import { errorToast } from "../../lib/state.svelte";
  import { gloss } from "../../lib/glossary";
  import Avatar from "../Avatar.svelte";
  import Menu, { type MenuItem } from "../Menu.svelte";
  import { autosize, longpress, swipe } from "../../lib/gestures";
  import {
    Bookmark,
    ChevronLeft,
    ChevronRight,
    Copy,
    Ellipsis,
    EyeOff,
    Eye,
    Pencil,
    RotateCcw,
    ScrollText,
    StepForward,
    Trash,
    CircleAlert,
    Feather,
    Brain,
    Milestone,
    Flag,
    Info,
    Undo,
    MessagesSquare,
  } from "../../lib/icons";
  import { askMeus } from "../../lib/meus.svelte";
  import { renderMessage, renderStreaming } from "../../lib/render";
  import { applyRegex, regexScope } from "../../lib/regex.svelte";
  import ChangeChips from "../trackers/ChangeChips.svelte";
  import ThoughtsDrawer from "../trackers/ThoughtsDrawer.svelte";
  import { trk } from "../../lib/trackers.svelte";
  import { living } from "../../lib/living";
  import { voices, voicesFrom } from "../../lib/voices";
  import type { Citation, ContinuityFlag, EditSuggestion, GlossaryTerm, TrackerChange } from "../../lib/types";
  import { app } from "../../lib/state.svelte";
  import { device } from "../../lib/device.svelte";
  import { clock } from "../../lib/format";
  import type { Message } from "../../lib/types";

  let {
    message,
    isLast,
    canGenerate,
    avatarId,
    displayName,
    palette = [],
    onswipe,
    onregen,
    oncontinue,
    onedit,
    ondelete,
    ondeleteswipe,
    onflag,
    oninspect,
    oncompare,
    editSignal = 0,
    highlighted = false,
    onendscene,
    onnewchapter,
    onmemory,
    chips = [],
    storyTime = null,
    onrewind,
    mark = "",
    passages = [],
    flag = null,
    onflagchange,
    oncite,
    glossary = [],
    onglossary,
  }: {
    mark?: string;
    /** QOL-02: highlighted passages to mark in the text. */
    passages?: string[];
    /** CON-02: this reply's continuity notes. */
    flag?: ContinuityFlag | null;
    onflagchange?: (f: ContinuityFlag | null) => void;
    oncite?: (c: Citation) => void;
    /** LORE-15: lore terms to underline, and what tapping one does. */
    glossary?: GlossaryTerm[];
    onglossary?: (t: GlossaryTerm, at: DOMRect) => void;
    chips?: TrackerChange[];
    storyTime?: string | null;
    onrewind?: () => void;
    highlighted?: boolean;
    onendscene?: () => void;
    onnewchapter?: () => void;
    onmemory?: () => void;
    editSignal?: number;
    message: Message;
    isLast: boolean;
    canGenerate: boolean;
    avatarId: string | null;
    displayName: string;
    palette?: string[];
    onswipe: (dir: -1 | 1) => void;
    onregen: (feedback?: boolean) => void;
    oncontinue: () => void;
    onedit: (content: string) => Promise<void>;
    ondelete: () => void;
    /** Deletes the version on screen, when there is more than one. */
    ondeleteswipe?: () => void;
    onflag: (flags: { hidden?: boolean; bookmarked?: boolean }) => void;
    oninspect: () => void;
    oncompare: () => void;
  } = $props();

  let editing = $state(false);
  let draft = $state("");
  let menuOpen = $state(false);
  let menuBtn = $state<HTMLButtonElement | null>(null);
  let menuPoint = $state<{ x: number; y: number } | null>(null);
  let showReasoning = $state(false);
  let streamHtml = $state("");
  let raf = 0;

  const isUser = $derived(message.role === "user");
  // Lantern: the portrait beside each box follows the Display setting.
  const portraitPx = $derived(app.isMobile ? 32 : ({ small: 56, large: 76, grand: 104 }[device.portrait] ?? 76));
  const streaming = $derived(message.status === "streaming");
  const scope = $derived(`m-${message.id.slice(0, 8)}`);
  // PROMPT-08: display-only regex scripts change what's shown, never the stored text.
  const shown = $derived(message.role === "system" ? message.content : applyRegex(message.content, app.settings?.["regex.scripts"], { role: isUser ? "user" : "ai", mode: "display", characterId: regexScope.characterId }));
  const page = $derived(living(app.settings));
  const html = $derived(streaming ? "" : markPassages(markText(renderMessage(shown, scope, { artifacts: page.artifacts }), mark), passages));
  // Speaker colours: the story state's cast, plus whoever wrote this message.
  const cast = $derived(voicesFrom(trk.data, [{ name: displayName, isUser }]));

  /** QOL-02: a highlighted passage is marked where it sits inside one stretch of text (between tags). */
  function markPassages(h: string, list: string[]) {
    if (!list.length) return h;
    const res = list.filter((t) => t.length >= 3).map((t) => new RegExp(t.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"), "i"));
    return h.replace(/>([^<]+)</g, (_m, text: string) => `>${res.reduce((acc, re) => acc.replace(re, (x) => `<mark class="hl">${x}</mark>`), text)}<`);
  }

  /** CHAT-18: highlight search matches in the rendered text (only between tags). */
  function markText(h: string, q: string) {
    if (!q || q.length < 2) return h;
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    return h.replace(/>([^<]+)</g, (_m, text: string) => `>${text.replace(re, (x) => `<mark>${x}</mark>`)}<`);
  }
  const swipeable = $derived(message.role === "assistant" && isLast && !streaming);
  const words = $derived(message.content.trim() ? message.content.trim().split(/\s+/).length : 0);
  const banned = $derived((message.meta?.banned as string[] | undefined) ?? []);
  // CON-04 / CON-05: what the guards changed when the reply was saved, with a way back.
  const guard = $derived(message.meta?.guard as { trimmed?: string; fixed?: { from: string; to: string }[]; original?: string } | undefined);
  // STEER-03: the post-pass editor's fixes, waiting as a diff (or applied, with undo).
  const suggestion = $derived(message.meta?.edit as EditSuggestion | undefined);
  let diffOpen = $state(false);
  async function decide(action: "apply" | "dismiss" | "undo") {
    try {
      await post(`/api/messages/${message.id}/edit-suggestion`, { action });
      diffOpen = false;
    } catch (err) {
      errorToast(err);
    }
  }

  // Re-render streaming text at most once per frame (PERF-03).
  $effect(() => {
    if (!streaming) return;
    const text = message.content;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => (streamHtml = renderStreaming(text, { artifacts: page.artifacts })));
    return () => cancelAnimationFrame(raf);
  });

  function startEdit() {
    draft = message.content;
    editing = true;
  }

  let lastSignal = 0;
  $effect(() => {
    if (editSignal && editSignal !== lastSignal) {
      lastSignal = editSignal;
      startEdit();
    }
  });
  async function saveEdit() {
    await onedit(draft);
    editing = false;
  }

  const items = $derived.by(() => {
    const list: MenuItem[] = [
      { label: "Copy", icon: Copy, onclick: () => navigator.clipboard?.writeText(message.content) },
      { label: "Edit", icon: Pencil, onclick: startEdit, disabled: streaming },
    ];
    if (message.role === "assistant" && isLast) {
      list.push({ label: "Regenerate", icon: RotateCcw, onclick: () => onregen(), disabled: !canGenerate, hint: app.isMobile ? undefined : "Alt+R" });
      list.push({ label: "Regenerate with a note…", icon: Feather, onclick: () => onregen(true), disabled: !canGenerate });
      list.push({ label: "Continue", icon: StepForward, onclick: oncontinue, disabled: !canGenerate || !message.content });
    }
    if (message.swipeCount > 1) list.push({ label: "Compare versions", icon: ScrollText, onclick: oncompare });
    if (message.role === "assistant" && message.swipeCount > 1 && ondeleteswipe) list.push({ label: "Delete this version", icon: Trash, danger: true, onclick: ondeleteswipe, disabled: streaming });
    list.push({ label: message.bookmarked ? "Remove bookmark" : "Bookmark", icon: Bookmark, onclick: () => onflag({ bookmarked: !message.bookmarked }) });
    list.push({ label: message.hidden ? "Include in prompt" : "Hide from prompt", icon: message.hidden ? Eye : EyeOff, onclick: () => onflag({ hidden: !message.hidden }) });
    if (message.meta?.generationId) list.push({ label: "What the model received", icon: ScrollText, onclick: oninspect });
    if (onmemory) list.push({ label: "What memory knows", icon: Brain, onclick: onmemory });
    list.push({ label: "Fix with Meus", icon: MessagesSquare, onclick: () => askMeus(`Something's wrong in #${message.seq}: `) });
    if (onendscene) list.push({ label: "End the scene after this", icon: Milestone, onclick: onendscene });
    if (onnewchapter) list.push({ label: "Start a new chapter here", icon: Flag, onclick: onnewchapter });
    if (onrewind && !isLast) list.push({ label: "Rewind to here", icon: Undo, onclick: onrewind, hint: "deletes what comes after" });
    list.push({ label: "Delete", icon: Trash, danger: true, onclick: ondelete });
    return list;
  });

  function openMenuAt(p: { x: number; y: number }) {
    menuPoint = p;
    menuOpen = true;
  }
</script>

<article
  class="msg {message.role}"
  class:hidden-msg={message.hidden}
  class:editing
  class:highlighted
  class:streaming
  class:bookmarked={message.bookmarked}
  use:longpress={{ onLong: openMenuAt }}
  data-seq={message.seq}
>
  <!-- The portrait sits beside the box; the name, time and actions sit inside it. -->
  <div class="portrait-col">
    <span class="portrait"><Avatar id={avatarId} name={displayName} size={portraitPx} portrait shape="squircle" {palette} /></span>
  </div>
  <div class="bubble">
    <header class="head">
      <span class="head-av"><Avatar id={avatarId} name={displayName} size={28} {palette} /></span>
      <span class="name">{displayName}</span>
      {#if message.bookmarked}<Bookmark size={13} class="bm" fill="currentColor" />{/if}
      {#if message.hidden}<span class="chip" title="Not sent to the model"><EyeOff size={11} /> hidden</span>{/if}
      <span class="time" title={`${clock(message.createdAt)}${storyTime ? ` · in the story: ${storyTime}` : ""} · ${words} words`}>{storyTime && app.settings?.["appearance.chatStyle"] !== "bubbles" ? storyTime : clock(message.updatedAt || message.createdAt)}</span>
      <button class="btn ghost icon small more" bind:this={menuBtn} onclick={() => ((menuPoint = null), (menuOpen = true))} aria-label="Message actions"><Ellipsis size={16} /></button>
    </header>

    {#if message.reasoning && !isUser}
      <button class="reasoning-toggle tiny" onclick={() => (showReasoning = !showReasoning)}>
        {streaming && !message.content ? "Thinking…" : showReasoning ? "Hide reasoning" : "Show reasoning"}
      </button>
      {#if showReasoning}<div class="reasoning small">{message.reasoning}</div>{/if}
    {/if}

    {#if editing}
      <textarea class="textarea story edit" use:autosize={600} bind:value={draft} onkeydown={(e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void saveEdit(); }
        if (e.key === "Escape") editing = false;
      }}></textarea>
      <div class="row" style="justify-content:flex-end;margin-top:.4rem">
        <button class="btn ghost small" onclick={() => (editing = false)}>Cancel</button>
        <button class="btn primary small" onclick={saveEdit}>Save</button>
      </div>
    {:else}
      <div class="body" use:swipe={{ enabled: swipeable && app.isMobile, onLeft: () => onswipe(1), onRight: () => onswipe(-1) }}>
        {#if streaming}
          {#if message.content}
            <div class="prose {scope}">{@html streamHtml}<span class="caret"></span></div>
          {:else}
            <div class="typing" aria-label="Writing"><span></span><span></span><span></span></div>
          {/if}
        {:else if message.status === "error" && !message.content}
          <div class="notice error row"><CircleAlert size={16} /><span class="grow">{message.error ?? "Something went wrong."}</span></div>
          {#if isLast}<button class="btn small" style="margin-top:.5rem" onclick={() => onregen()} disabled={!canGenerate}><RotateCcw size={14} /> Try again</button>{/if}
        {:else}
          <div class="prose {scope}" use:gloss={{ terms: glossary, enabled: Boolean(onglossary) && glossary.length > 0 && app.settings?.["appearance.glossary"] !== false, html, onpick: (t, at) => onglossary?.(t, at) }} use:voices={{ html, voices: cast, style: page.voices }}>{@html html}</div>
          {#if banned.length}<div class="tiny banned" title="Phrases from your banned list (Settings → Writing)">Banned phrases: {banned.join(", ")}</div>{/if}
          {#if suggestion?.status === "proposed" && suggestion.original === message.content}
            <div class="editor-note tiny">
              <button class="linkish" onclick={() => (diffOpen = !diffOpen)}>The editor suggests {suggestion.notes.length || "some"} fix{suggestion.notes.length === 1 ? "" : "es"}</button>{#if suggestion.notes.length && !diffOpen}: {suggestion.notes.join("; ")}{/if}
              {#if diffOpen}
                <p class="diff">{#each wordDiff(suggestion.original, suggestion.text) as part, i (i)}<span class={part.type}>{part.text}</span>{/each}</p>
                <div class="row">
                  <button class="btn primary small" onclick={() => decide("apply")}>Apply</button>
                  <button class="btn ghost small" onclick={() => decide("dismiss")}>Dismiss</button>
                </div>
              {/if}
            </div>
          {:else if suggestion?.status === "applied" && suggestion.text === message.content}
            <div class="tiny guardnote">Tidied by the editor{suggestion.notes.length ? `: ${suggestion.notes.join("; ")}` : ""}. <button class="linkish" onclick={() => decide("undo")}>Undo</button></div>
          {/if}
          {#if guard && (guard.trimmed || guard.fixed?.length) && guard.original !== message.content}
            <div class="tiny guardnote" title={guard.trimmed ? `Cut: ${guard.trimmed}` : undefined}>
              {#if guard.fixed?.length}Names corrected: {guard.fixed.map((f) => `${f.from} → ${f.to}`).join(", ")}.{/if}
              {#if guard.trimmed}The end was cut where it wrote for you.{/if}
              {#if guard.original}<button class="linkish" onclick={() => onedit(guard.original!)}>Undo</button>{/if}
            </div>
          {/if}
          {#if message.status === "stopped"}<div class="tiny faint" style="margin-top:.3rem">Stopped{message.error ? ` · ${message.error}` : ""}</div>{/if}
        {/if}
      </div>
    {/if}

    {#if chips.length && !editing && !streaming}<ChangeChips changes={chips} />{/if}
    {#if !isUser && !editing && !streaming && page.thoughts !== "never"}<ThoughtsDrawer changes={chips} open={page.thoughts === "always"} />{/if}
    {#if flag && !editing && !streaming && onflagchange && oncite}<ContinuityNote {flag} canRegenerate={isLast && canGenerate} onchange={onflagchange} {oncite} />{/if}

    {#if message.role === "assistant" && (message.swipeCount > 1 || isLast) && !editing}
      <footer class="swipes">
        {#if message.swipeCount > 1 || isLast}
          <button class="btn ghost icon small" onclick={() => onswipe(-1)} disabled={message.activeSwipe === 0 || streaming} aria-label="Previous version"><ChevronLeft size={16} /></button>
          <span class="tiny muted count">{message.activeSwipe + 1}/{message.swipeCount}</span>
          <button
            class="btn ghost icon small"
            onclick={() => onswipe(1)}
            disabled={streaming || (!isLast && message.activeSwipe >= message.swipeCount - 1) || (isLast && message.activeSwipe >= message.swipeCount - 1 && !canGenerate)}
            aria-label={isLast && message.activeSwipe >= message.swipeCount - 1 ? "Write a new version" : "Next version"}><ChevronRight size={16} /></button
          >
          {#if message.swipeCount > 1 && ondeleteswipe}<button class="btn ghost icon small drop" onclick={ondeleteswipe} disabled={streaming} aria-label="Delete this version" title="Delete this version"><Trash size={14} /></button>{/if}
        {/if}
        {#if isLast && !streaming}
          <button class="btn ghost small" onclick={() => onregen()} disabled={!canGenerate} title="Regenerate (Alt+R)"><RotateCcw size={14} /> <span class="hide-sm">Regenerate</span></button>
          {#if message.content}<button class="btn ghost small" onclick={oncontinue} disabled={!canGenerate} title="Continue this reply"><StepForward size={14} /> <span class="hide-sm">Continue</span></button>{/if}
        {/if}
        {#if message.meta?.model && !app.isMobile}<span class="tiny faint model truncate" title="Model">{message.meta.model}</span>{/if}
        {#if message.meta?.generationId && !streaming}<button class="btn ghost icon small receipt" onclick={oninspect} aria-label="What this reply was given: memories, summaries, lore" title="What this reply was given"><Info size={14} /></button>{/if}
      </footer>
    {/if}
  </div>
</article>

<Menu bind:open={menuOpen} {items} anchor={menuBtn} point={menuPoint} title={displayName} />

<style>
  /* M5: whatever a message's HTML positions stays inside the message, so it can't cover or fake the app.
     M21: a long chat only lays out and paints the messages near the view. */
  .body > .prose {
    contain: layout paint;
    overflow-clip-margin: 1rem;
    content-visibility: auto;
    contain-intrinsic-size: auto 8em;
  }
  .banned {
    color: var(--warn);
    margin-top: 0.3rem;
  }
  .guardnote {
    color: var(--text-muted);
    margin-top: 0.3rem;
  }
  .editor-note {
    margin-top: 0.35rem;
    color: var(--text-muted);
  }
  .editor-note .diff {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    background: var(--surface);
    border-radius: var(--r-sm);
    padding: 0.45rem 0.6rem;
    margin: 0.35rem 0;
    color: var(--text);
    font-size: var(--fs-sm);
  }
  .editor-note :global(.del) {
    background: color-mix(in srgb, var(--danger) 14%, transparent);
    text-decoration: line-through;
  }
  .editor-note :global(.add) {
    background: color-mix(in srgb, var(--mint) 35%, transparent);
  }
  .linkish {
    border: 0;
    background: none;
    padding: 0 0.2rem;
    color: var(--accent-ink);
    font: inherit;
    text-decoration: underline;
    cursor: pointer;
  }
  .msg {
    display: grid;
    grid-template-columns: var(--portrait-w, 76px) minmax(0, 1fr);
    gap: 1rem;
    align-items: start;
    padding: 0.55rem 8px;
    margin-inline: -8px;
    content-visibility: auto;
    contain-intrinsic-size: auto 180px;
    animation: fade-up 0.4s var(--ease) backwards;
  }
  .portrait-col {
    position: sticky;
    top: 0.6rem;
    display: grid;
    justify-items: center;
  }
  .portrait {
    display: inline-flex;
    border-radius: 26%;
    box-shadow:
      0 0 0 2.5px var(--bg),
      0 0 0 4.5px color-mix(in srgb, var(--accent) 60%, transparent),
      var(--shadow-1);
    transition: transform 0.4s var(--spring);
  }
  .msg:hover .portrait {
    transform: translateY(-2px) rotate(-1.5deg);
  }
  .user .portrait {
    box-shadow:
      0 0 0 2.5px var(--bg),
      0 0 0 4.5px color-mix(in srgb, var(--lavender) 75%, transparent),
      var(--shadow-1);
  }
  .bubble {
    min-width: 0;
    background: var(--tint-char);
    border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
    border-radius: var(--r-lg);
    padding: var(--pad-y, 0.8rem) var(--pad-x, 1.05rem);
    position: relative;
  }
  .user .bubble {
    background: var(--tint-user);
  }
  .system .bubble {
    background: var(--tint-note);
  }
  .hidden-msg .bubble {
    opacity: 0.55;
    border-style: dashed;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 1.7rem;
    margin: -0.25rem -0.4rem 0.35rem 0;
    position: relative;
    z-index: 1;
  }
  .head-av {
    display: none;
  }
  .head-av :global(.avatar) {
    border-radius: 50% !important;
  }
  .name {
    font-weight: 800;
    font-size: var(--fs-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  .user .name {
    color: var(--thought);
  }
  .assistant .name {
    color: var(--accent-ink);
  }
  .head :global(.bm) {
    color: var(--accent-ink);
  }
  .time {
    font-size: 0.72rem;
    color: var(--text-faint);
  }
  .more {
    margin-left: auto;
    opacity: 0.5;
    transition: opacity var(--t-fast);
  }
  .msg:hover .more,
  .more:focus-visible {
    opacity: 1;
  }
  .reasoning-toggle {
    background: none;
    border: 0;
    padding: 0;
    color: var(--thought);
    font: 700 var(--fs-xs) var(--font-ui);
    cursor: pointer;
    margin-bottom: 0.3rem;
  }
  .reasoning {
    border-left: 3px solid var(--lavender);
    padding: 0.2rem 0 0.2rem 0.75rem;
    margin-bottom: 0.6rem;
    color: var(--text-muted);
    white-space: pre-wrap;
    max-height: 16rem;
    overflow-y: auto;
  }
  .caret {
    display: inline-block;
    width: 0.5em;
    height: 1em;
    margin-left: 0.1em;
    vertical-align: -0.12em;
    border-radius: 2px;
    background: var(--accent-strong);
    animation: pulse 1s ease-in-out infinite;
  }
  .typing {
    display: flex;
    gap: 0.3rem;
    padding: 0.5rem 0;
  }
  .typing span {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    background: var(--accent-strong);
    animation: pulse 1.2s ease-in-out infinite;
  }
  .typing span:nth-child(2) {
    animation-delay: 0.15s;
  }
  .typing span:nth-child(3) {
    animation-delay: 0.3s;
  }
  .swipes {
    display: flex;
    align-items: center;
    gap: 0.15rem;
    margin: 0.4rem -0.4rem -0.3rem;
    flex-wrap: wrap;
  }
  .drop {
    opacity: 0.55;
  }
  .drop:hover:not(:disabled) {
    opacity: 1;
    color: var(--danger);
  }
  .count {
    min-width: 2.2rem;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  .model {
    margin-left: auto;
    max-width: 12rem;
  }
  .edit {
    min-height: 8rem;
  }
  .highlighted .bubble {
    box-shadow: 0 0 0 2px var(--accent);
    transition: box-shadow 0.4s var(--ease);
  }
  .receipt {
    opacity: 0.55;
  }
  .receipt:hover {
    opacity: 1;
  }

  /* Book style: flowing prose, no boxes or portraits; a small name above each turn */
  :global(.style-book) .msg {
    grid-template-columns: minmax(0, 1fr);
    padding: 0.7rem 0;
    border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
  }
  :global(.style-book) .portrait-col {
    display: none;
  }
  :global(.style-book) .bubble {
    background: none;
    border: 0;
    padding: 0.1rem 0.2rem 0.4rem;
  }
  :global(.style-book) .name {
    font: italic 400 1.05rem var(--font-display);
    letter-spacing: 0;
    text-transform: none;
  }
  :global(.style-book) .user .prose {
    padding-left: 1.4em;
    border-left: 1px solid color-mix(in srgb, var(--lavender) 45%, transparent);
  }
  /* Bubble style: messenger, your messages on the right, small round portraits */
  :global(.style-bubbles) .msg {
    grid-template-columns: calc(var(--portrait-w, 76px) * 0.6) minmax(0, 1fr);
    gap: 0.6rem;
    align-items: end;
  }
  :global(.style-bubbles) .user {
    grid-template-columns: minmax(0, 1fr) calc(var(--portrait-w, 76px) * 0.6);
  }
  :global(.style-bubbles) .user .portrait-col {
    order: 2;
  }
  :global(.style-bubbles) .portrait-col {
    position: static;
  }
  :global(.style-bubbles) .portrait {
    border-radius: 50%;
  }
  :global(.style-bubbles) .portrait :global(.avatar) {
    width: calc(var(--portrait-w, 76px) * 0.6) !important;
    height: calc(var(--portrait-w, 76px) * 0.6) !important;
    border-radius: 50% !important;
  }
  :global(.style-bubbles) .bubble {
    max-width: 88%;
    border-bottom-left-radius: 6px;
  }
  :global(.style-bubbles) .user .bubble {
    justify-self: end;
    border-bottom-left-radius: var(--r-lg);
    border-bottom-right-radius: 6px;
  }

  /* ---------- Lantern: glowing glass cards ---------- */
  :global([data-shell="lantern"]) .bubble {
    background: linear-gradient(165deg, color-mix(in srgb, var(--hi) 7.5%, transparent), color-mix(in srgb, var(--hi) 2%, transparent) 60%);
    border-color: transparent;
    box-shadow: 0 18px 40px -26px color-mix(in srgb, var(--lo) 80%, transparent);
    overflow: hidden;
    --hairline: linear-gradient(160deg, color-mix(in srgb, var(--accent) 48%, transparent), color-mix(in srgb, var(--hi) 5%, transparent) 35%, color-mix(in srgb, var(--hi) 3%, transparent) 75%, color-mix(in srgb, var(--lavender) 24%, transparent));
  }
  :global([data-shell="lantern"]) .bubble::before {
    content: "";
    position: absolute;
    inset: 0;
    padding: 1px;
    border-radius: inherit;
    background: var(--hairline);
    -webkit-mask:
      linear-gradient(#000 0 0) content-box,
      linear-gradient(#000 0 0);
    mask:
      linear-gradient(#000 0 0) content-box,
      linear-gradient(#000 0 0);
    -webkit-mask-composite: xor;
    mask-composite: exclude;
    pointer-events: none;
  }
  :global([data-shell="lantern"]) .bubble::after {
    content: "";
    position: absolute;
    width: 260px;
    height: 200px;
    left: -80px;
    top: -110px;
    background: radial-gradient(closest-side, color-mix(in srgb, var(--lamp) 12%, transparent), transparent);
    pointer-events: none;
  }
  :global([data-shell="lantern"]) .user .bubble {
    background: linear-gradient(165deg, color-mix(in srgb, var(--sky) 11%, transparent), color-mix(in srgb, var(--lavender) 5%, transparent) 70%);
    --hairline: linear-gradient(160deg, color-mix(in srgb, var(--sky) 45%, transparent), color-mix(in srgb, var(--hi) 4%, transparent) 40%, color-mix(in srgb, var(--sky) 14%, transparent));
  }
  :global([data-shell="lantern"]) .user .bubble::after {
    background: radial-gradient(closest-side, color-mix(in srgb, var(--sky) 11%, transparent), transparent);
  }
  :global([data-shell="lantern"]) .system .bubble {
    background: linear-gradient(165deg, color-mix(in srgb, var(--lamp) 9%, transparent), color-mix(in srgb, var(--hi) 2%, transparent) 70%);
    --hairline: linear-gradient(160deg, color-mix(in srgb, var(--lamp) 45%, transparent), color-mix(in srgb, var(--hi) 4%, transparent) 50%);
  }
  :global([data-shell="lantern"]) .bookmarked .bubble {
    --hairline: linear-gradient(160deg, color-mix(in srgb, var(--lamp) 75%, transparent), color-mix(in srgb, var(--accent) 20%, transparent) 40%, color-mix(in srgb, var(--hi) 4%, transparent) 70%, color-mix(in srgb, var(--lamp) 40%, transparent));
  }
  :global([data-shell="lantern"]) .streaming .bubble {
    --hairline: conic-gradient(from var(--ring), var(--accent), var(--lamp), var(--sea), var(--lavender), var(--accent));
    animation: lantern-spin 4s linear infinite;
  }
  :global([data-shell="lantern"]) .highlighted .bubble {
    box-shadow:
      0 0 0 2px var(--lamp),
      0 0 40px -6px color-mix(in srgb, var(--lamp) 55%, transparent);
  }
  :global([data-shell="lantern"]) .portrait {
    border-radius: 22px;
    box-shadow:
      0 0 0 2px var(--bg),
      0 0 0 3.5px color-mix(in srgb, var(--accent) 55%, transparent),
      0 14px 30px -12px color-mix(in srgb, var(--lo) 70%, transparent);
  }
  :global([data-shell="lantern"]) .portrait :global(.avatar) {
    border-radius: 22px;
  }
  :global([data-shell="lantern"]) .user .portrait {
    box-shadow:
      0 0 0 2px var(--bg),
      0 0 0 3.5px color-mix(in srgb, var(--sky) 50%, transparent),
      0 14px 30px -12px color-mix(in srgb, var(--lo) 70%, transparent);
  }
  :global([data-shell="lantern"]) .assistant .name {
    color: var(--rose);
  }
  :global([data-shell="lantern"]) .user .name {
    color: var(--sky);
  }
  :global([data-shell="lantern"]) :global(.style-book) .bubble,
  :global([data-shell="lantern"]) :global(.style-book) .user .bubble {
    background: none;
    box-shadow: none;
  }
  :global([data-shell="lantern"]) :global(.style-book) .bubble::before,
  :global([data-shell="lantern"]) :global(.style-book) .bubble::after {
    display: none;
  }
  :global([data-shell="lantern"]) :global(.style-book) .msg {
    border-bottom-color: color-mix(in srgb, var(--hi) 6%, transparent);
  }
  :global([data-shell="lantern"]) :global(.style-bubbles) .bubble {
    background: color-mix(in srgb, var(--hi) 8%, transparent);
  }
  :global([data-shell="lantern"]) :global(.style-bubbles) .user .bubble {
    background: linear-gradient(135deg, color-mix(in srgb, var(--sky) 30%, transparent), color-mix(in srgb, var(--lavender) 22%, transparent));
  }
  :global([data-shell="lantern"]) :global(.style-bubbles) .bubble::after {
    display: none;
  }

  @media (max-width: 760px) {
    .msg {
      grid-template-columns: minmax(0, 1fr);
    }
    .portrait-col {
      display: none;
    }
    .head-av {
      display: inline-flex;
    }
    :global(.style-book) .head-av {
      display: none;
    }
    :global(.style-bubbles) .msg,
    :global(.style-bubbles) .user {
      grid-template-columns: minmax(0, 1fr);
    }
    .bubble {
      padding: calc(var(--pad-y, 0.8rem) * 0.8) calc(var(--pad-x, 1.05rem) * 0.7);
    }
    .more {
      opacity: 1;
    }
    .hide-sm {
      display: none;
    }
  }
</style>

