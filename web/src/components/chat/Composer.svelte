<script lang="ts">
  import Menu, { type MenuItem } from "../Menu.svelte";
  import { post, postStream } from "../../lib/api";
  import { autosize } from "../../lib/gestures";
  import { ArrowUp, Square, Sparkles, UserPen, WandSparkles, Send } from "../../lib/icons";
  import { app, errorToast } from "../../lib/state.svelte";

  let {
    chatId,
    generating,
    disabled = false,
    onsend,
    onstop,
    oneditlast,
  }: {
    chatId: string;
    generating: boolean;
    disabled?: boolean;
    onsend: (content: string, generate: boolean) => Promise<boolean>;
    onstop: () => void;
    oneditlast: () => void;
  } = $props();

  const key = $derived(`mea.draft.${chatId}`);
  let text = $state("");
  let input = $state<HTMLTextAreaElement | null>(null);
  let drafting = $state<"impersonate" | "expand" | null>(null);
  let draftAbort: AbortController | null = null;
  let toolsOpen = $state(false);
  let toolsBtn = $state<HTMLButtonElement | null>(null);
  let focused = $state(false);

  $effect(() => {
    try {
      text = localStorage.getItem(key) ?? "";
    } catch {
      text = "";
    }
  });

  $effect(() => {
    try {
      if (text) localStorage.setItem(key, text);
      else localStorage.removeItem(key);
    } catch {
      // storage unavailable
    }
  });

  // Warm recall for what's being typed so sending is faster (CTX-10). Errors don't matter here.
  let lastPrefetch = "";
  $effect(() => {
    const draft = text.trim();
    const id = chatId;
    if (draft.length < 12 || draft === lastPrefetch || generating) return;
    const t = setTimeout(() => {
      lastPrefetch = draft;
      post(`/api/chats/${id}/prefetch`, { draft }).catch(() => {});
    }, 900);
    return () => clearTimeout(t);
  });

  function refit() {
    queueMicrotask(() => input?.dispatchEvent(new Event("input")));
  }

  async function send(generate = true) {
    if (generating || drafting || disabled) return;
    const content = text;
    text = "";
    refit();
    const ok = await onsend(content, generate);
    if (!ok) {
      text = content;
      refit();
    }
  }

  async function draft(kind: "impersonate" | "expand") {
    if (generating || drafting) return;
    if (kind === "expand" && !text.trim()) {
      errorToast("Write a rough draft first, then expand it");
      return;
    }
    drafting = kind;
    draftAbort = new AbortController();
    const original = text;
    let out = "";
    try {
      for await (const chunk of postStream<{ text?: string; error?: string; done?: boolean }>(`/api/chats/${chatId}/draft`, { kind, draft: original }, draftAbort.signal)) {
        if (chunk.error) throw new Error(chunk.error);
        if (chunk.text) {
          out += chunk.text;
          text = out;
          refit();
        }
      }
      if (!out.trim()) text = original;
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        errorToast(e);
        text = original;
      }
    } finally {
      drafting = null;
      draftAbort = null;
      refit();
      input?.focus();
    }
  }

  function onkey(e: KeyboardEvent) {
    // Enter makes a new line; Ctrl/Cmd+Enter sends (an opt-in setting can make plain Enter send on desktop).
    const enterSends = (app.settings?.["chat.enterToSend"] ?? false) && !app.isMobile;
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && (enterSends || e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void send();
    } else if (e.key === "ArrowUp" && !text) {
      e.preventDefault();
      oneditlast();
    } else if (e.key === "Escape" && (generating || drafting)) {
      e.preventDefault();
      stop();
    }
  }

  function stop() {
    if (drafting) draftAbort?.abort();
    else onstop();
  }

  function insert(before: string, after = "") {
    if (!input) return;
    const s = input.selectionStart ?? text.length;
    const e = input.selectionEnd ?? text.length;
    text = text.slice(0, s) + before + text.slice(s, e) + after + text.slice(e);
    queueMicrotask(() => {
      input?.focus();
      const pos = s + before.length + (e - s);
      input?.setSelectionRange(pos, pos);
      refit();
    });
  }

  const tools: MenuItem[] = $derived([
    { label: "Impersonate: write my next message", icon: UserPen, onclick: () => draft("impersonate") },
    { label: "Expand my rough draft", icon: WandSparkles, onclick: () => draft("expand"), disabled: !text.trim() },
    { label: "Send without a reply", icon: Send, onclick: () => send(false), disabled: !text.trim() },
  ]);
</script>

<div class="composer-wrap">
  {#if app.isMobile && focused}
    <div class="symbols" role="toolbar" aria-label="Insert symbols">
      <button onmousedown={(e) => e.preventDefault()} onclick={() => insert('"', '"')}>" "</button>
      <button onmousedown={(e) => e.preventDefault()} onclick={() => insert("*", "*")}>* *</button>
      <button onmousedown={(e) => e.preventDefault()} onclick={() => insert("(", ")")}>( )</button>
      <button onmousedown={(e) => e.preventDefault()} onclick={() => insert("—")}>—</button>
      <button onmousedown={(e) => e.preventDefault()} onclick={() => insert("…")}>…</button>
      <button onmousedown={(e) => e.preventDefault()} onclick={() => insert("(OOC: ", ")")}>OOC</button>
    </div>
  {/if}
  <div class="composer card" class:busy={drafting}>
    <button class="btn ghost icon tool" bind:this={toolsBtn} onclick={() => (toolsOpen = true)} disabled={generating || Boolean(drafting)} aria-label="Writing tools">
      <Sparkles size={19} />
    </button>
    <textarea
      bind:this={input}
      bind:value={text}
      use:autosize={app.isMobile ? 180 : 260}
      onkeydown={onkey}
      onfocus={() => (focused = true)}
      onblur={() => setTimeout(() => (focused = false), 150)}
      rows="1"
      placeholder={drafting === "impersonate" ? "Writing as you…" : drafting === "expand" ? "Expanding your draft…" : disabled ? "Set up a model in Settings to start" : "Write your message…"}
      aria-label="Message"
      readonly={Boolean(drafting)}
    ></textarea>
    {#if generating || drafting}
      <button class="btn icon send stop" onclick={stop} aria-label="Stop"><Square size={16} fill="currentColor" /></button>
    {:else}
      <button class="btn primary icon send" onclick={() => send()} disabled={disabled} aria-label={text.trim() ? "Send" : "Let them continue"} title={text.trim() ? (app.isMobile ? "Send" : "Send (Ctrl+Enter)") : "Send nothing: the character keeps going"}>
        <ArrowUp size={19} />
      </button>
    {/if}
  </div>
</div>

<Menu bind:open={toolsOpen} items={tools} anchor={toolsBtn} title="Writing tools" />

<style>
  .composer-wrap {
    display: grid;
    gap: 0.4rem;
  }
  .composer {
    display: flex;
    align-items: flex-end;
    gap: 0.35rem;
    padding: 0.4rem;
    border-radius: var(--r-lg);
    transition: box-shadow var(--t);
  }
  .composer:focus-within {
    box-shadow: var(--shadow-1), var(--focus);
  }
  .composer.busy {
    background: color-mix(in srgb, var(--lavender) 14%, var(--surface));
  }
  textarea {
    flex: 1;
    border: 0;
    background: none;
    resize: none;
    color: var(--text);
    font-family: var(--font-story);
    font-size: var(--fs-story);
    line-height: 1.5;
    padding: 0.5rem 0.3rem;
    outline: none;
    max-height: 260px;
    min-height: 2.5rem;
  }
  .tool {
    color: var(--thought);
  }
  .send {
    border-radius: 50%;
    flex: none;
  }
  .stop {
    background: var(--text);
    color: var(--bg);
    border-color: transparent;
  }
  .symbols {
    display: flex;
    gap: 0.35rem;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .symbols button {
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    border-radius: var(--r-pill);
    padding: 0.35rem 0.8rem;
    font: 700 var(--fs-sm) var(--font-ui);
    flex: none;
  }
</style>
