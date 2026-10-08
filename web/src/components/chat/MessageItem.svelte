<script lang="ts">
  import ContinuityNote from "./ContinuityNote.svelte";
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
  } from "../../lib/icons";
  import { renderMessage, renderStreaming } from "../../lib/render";
  import ChangeChips from "../trackers/ChangeChips.svelte";
  import type { Citation, ContinuityFlag, GlossaryTerm, TrackerChange } from "../../lib/types";
  import { app } from "../../lib/state.svelte";
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
    flag = null,
    onflagchange,
    oncite,
    glossary = [],
    onglossary,
  }: {
    mark?: string;
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
  const streaming = $derived(message.status === "streaming");
  const scope = $derived(`m-${message.id.slice(0, 8)}`);
  const html = $derived(streaming ? "" : markText(renderMessage(message.content, scope), mark));

  /** CHAT-18: highlight search matches in the rendered text (only between tags). */
  function markText(h: string, q: string) {
    if (!q || q.length < 2) return h;
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    return h.replace(/>([^<]+)</g, (_m, text: string) => `>${text.replace(re, (x) => `<mark>${x}</mark>`)}<`);
  }
  const swipeable = $derived(message.role === "assistant" && isLast && !streaming);
  const words = $derived(message.content.trim() ? message.content.trim().split(/\s+/).length : 0);
  const banned = $derived((message.meta?.banned as string[] | undefined) ?? []);

  // Re-render streaming text at most once per frame (PERF-03).
  $effect(() => {
    if (!streaming) return;
    const text = message.content;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => (streamHtml = renderStreaming(text)));
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
    list.push({ label: message.bookmarked ? "Remove bookmark" : "Bookmark", icon: Bookmark, onclick: () => onflag({ bookmarked: !message.bookmarked }) });
    list.push({ label: message.hidden ? "Include in prompt" : "Hide from prompt", icon: message.hidden ? Eye : EyeOff, onclick: () => onflag({ hidden: !message.hidden }) });
    if (message.meta?.generationId) list.push({ label: "What the model received", icon: ScrollText, onclick: oninspect });
    if (onmemory) list.push({ label: "What memory knows", icon: Brain, onclick: onmemory });
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
  use:longpress={{ onLong: openMenuAt }}
  data-seq={message.seq}
>
  <!-- Portrait and name sit above the message box, so the text gets the full width. -->
  <header class="head">
    <span class="portrait"><Avatar id={avatarId} name={displayName} size={app.isMobile ? 64 : 76} portrait shape="squircle" {palette} /></span>
    <span class="nameline">
      <span class="name">{displayName}</span>
      {#if message.bookmarked}<Bookmark size={13} class="bm" fill="currentColor" />{/if}
      {#if message.hidden}<span class="chip" title="Not sent to the model"><EyeOff size={11} /> hidden</span>{/if}
      <button class="btn ghost icon small more" bind:this={menuBtn} onclick={() => ((menuPoint = null), (menuOpen = true))} aria-label="Message actions"><Ellipsis size={16} /></button>
    </span>
    <span class="time" title={`${clock(message.createdAt)}${storyTime ? ` · in the story: ${storyTime}` : ""} · ${words} words`}>{storyTime && app.settings?.["appearance.chatStyle"] !== "bubbles" ? storyTime : clock(message.updatedAt || message.createdAt)}</span>
  </header>
  <div class="bubble">

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
          <div class="prose {scope}" use:gloss={{ terms: glossary, enabled: Boolean(onglossary) && glossary.length > 0 && app.settings?.["appearance.glossary"] !== false, html, onpick: (t, at) => onglossary?.(t, at) }}>{@html html}</div>
          {#if banned.length}<div class="tiny banned" title="Phrases from your banned list (Settings → Writing)">Banned phrases: {banned.join(", ")}</div>{/if}
          {#if message.status === "stopped"}<div class="tiny faint" style="margin-top:.3rem">Stopped{message.error ? ` · ${message.error}` : ""}</div>{/if}
        {/if}
      </div>
    {/if}

    {#if chips.length && !editing && !streaming}<ChangeChips changes={chips} />{/if}
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
  .banned {
    color: var(--warn);
    margin-top: 0.3rem;
  }
  .msg {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding: 0.5rem 0;
    content-visibility: auto;
    contain-intrinsic-size: auto 180px;
    animation: fade-up 0.3s var(--ease) both;
  }
  .bubble {
    min-width: 0;
    background: var(--tint-char);
    border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
    border-radius: var(--r-lg);
    padding: 0.8rem 1.05rem 0.8rem;
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
    flex-direction: column;
    align-items: center;
    gap: 0.3rem;
    padding: 0.2rem 0 0.15rem;
  }
  .portrait {
    display: inline-flex;
    border-radius: 28%;
    box-shadow:
      0 0 0 2.5px var(--bg),
      0 0 0 4.5px color-mix(in srgb, var(--accent) 60%, transparent),
      var(--shadow-1);
  }
  .user .portrait {
    box-shadow:
      0 0 0 2.5px var(--bg),
      0 0 0 4.5px color-mix(in srgb, var(--lavender) 75%, transparent),
      var(--shadow-1);
  }
  .nameline {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    /* balance the ··· button so the name stays visually centered */
    padding-left: 2rem;
  }
  .name {
    font-weight: 800;
    font-size: var(--fs-sm);
  }
  .user .name {
    color: var(--thought);
  }
  .assistant .name {
    color: var(--accent-ink);
  }
  .head :global(.bm) {
    color: var(--accent-strong);
  }
  .time {
    font-size: 0.68rem;
    color: var(--text-faint);
    margin-top: -0.3rem;
    opacity: 0;
    transition: opacity var(--t-fast);
  }
  .more {
    opacity: 0.55;
    transition: opacity var(--t-fast);
  }
  .msg:hover .time,
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

  /* Book style: flowing prose, no boxes; the name stays as a small header */
  :global(.style-book) .bubble {
    background: none;
    border: 0;
    padding: 0.1rem 0.2rem 0.4rem;
  }
  :global(.style-book) .msg {
    padding: 0.7rem 0;
    border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
  }
  :global(.style-book) .portrait {
    display: none;
  }
  /* Bubble style: messenger, your messages on the right */
  :global(.style-bubbles) .user .head {
    align-items: flex-end;
  }
  :global(.style-bubbles) .assistant .head {
    align-items: flex-start;
  }
  :global(.style-bubbles) .user .bubble {
    margin-left: 12%;
    border-top-right-radius: 6px;
  }
  :global(.style-bubbles) .assistant .bubble {
    margin-right: 12%;
    border-top-left-radius: 6px;
  }

  @media (max-width: 760px) {
    .bubble {
      padding: 0.7rem 0.85rem 0.7rem;
    }
    .more {
      opacity: 1;
    }
    .time {
      display: none;
    }
    .hide-sm {
      display: none;
    }
  }
</style>
