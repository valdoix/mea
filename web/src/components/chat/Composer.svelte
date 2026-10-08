<script lang="ts">
  import Menu, { type MenuItem } from "../Menu.svelte";
  import Modal from "../Modal.svelte";
  import { get, patch, post, postStream, put } from "../../lib/api";
  import { onEvent } from "../../lib/events";
  import { autosize } from "../../lib/gestures";
  import { ArrowUp, Square, Sparkles, UserPen, WandSparkles, Send, Clapperboard, SlidersHorizontal, X } from "../../lib/icons";
  import { app, errorToast, toast } from "../../lib/state.svelte";
  import type { ChatDetail, ChatSettings } from "../../lib/types";

  let {
    chatId,
    detail,
    generating,
    disabled = false,
    onsend,
    onstop,
    oneditlast,
    onchange,
  }: {
    chatId: string;
    detail: ChatDetail;
    generating: boolean;
    disabled?: boolean;
    onsend: (content: string, generate: boolean, director?: boolean) => Promise<boolean>;
    onstop: () => void;
    oneditlast: () => void;
    onchange: () => void;
  } = $props();

  const settings = $derived(detail.chat.settings as ChatSettings);
  const director = $derived(Boolean(settings.director));
  let steerOpen = $state(false);
  let answer = $state<{ title: string; text: string } | null>(null);
  let answerOpen = $state(false);
  let paletteAt = $state(0);

  async function saveSettings(patchBody: Partial<ChatSettings>) {
    try {
      await patch(`/api/chats/${chatId}`, { settings: patchBody });
      onchange();
    } catch (e) {
      errorToast(e);
    }
  }

  // ---------- slash commands (CHAT-15) ----------
  const COMMANDS: { cmd: string; args: string; about: string }[] = [
    { cmd: "/ooc", args: "note · clear", about: "A standing out-of-character note for every reply" },
    { cmd: "/cue", args: "nudge", about: "A one-time nudge for the next reply" },
    { cmd: "/scene", args: "", about: "End the scene after the last message" },
    { cmd: "/chapter", args: "", about: "Start a new chapter at the last message" },
    { cmd: "/timeskip", args: "3 days · note", about: "Jump forward in story time" },
    { cmd: "/recap", args: "", about: "A \"previously on\" of the story so far" },
    { cmd: "/remember", args: "fact", about: "Add a memory" },
    { cmd: "/pin", args: "fact", about: "Add a memory that's always in the prompt" },
    { cmd: "/ask", args: "question", about: "Ask about the story, out of character (not added to the chat)" },
    { cmd: "/director", args: "", about: "Switch director mode: your messages become stage directions" },
    { cmd: "/truth", args: "rule", about: "A story truth that holds over everything else" },
  ];
  const palette = $derived.by(() => {
    const m = text.match(/^\/(\w*)$/);
    if (!m) return [];
    return COMMANDS.filter((c) => c.cmd.startsWith(`/${m[1]}`));
  });

  async function runCommand(raw: string): Promise<boolean> {
    const m = raw.trim().match(/^\/(\w+)\s*([\s\S]*)$/);
    if (!m) return false;
    const [, cmd, rest] = m as unknown as [string, string, string];
    const arg = rest.trim();
    const last = await get<{ messages: { id: string; seq: number }[] }>(`/api/chats/${chatId}/messages?limit=1`).then((r) => r.messages.at(-1)).catch(() => undefined);
    try {
      switch (cmd.toLowerCase()) {
        case "ooc":
          if (/^clear$/i.test(arg)) await saveSettings({ ooc: [] });
          else if (arg) await saveSettings({ ooc: [...(settings.ooc ?? []), { id: crypto.randomUUID().slice(0, 8), text: arg }] });
          toast(arg && !/^clear$/i.test(arg) ? "OOC note added" : "OOC notes cleared", { kind: "ok" });
          return true;
        case "cue":
          if (!arg) return (errorToast("Write the nudge after /cue"), true);
          await saveSettings({ cue: arg });
          toast("Cue set for the next reply", { kind: "ok" });
          return true;
        case "scene":
          if (last) await post(`/api/messages/${last.id}/end-scene`);
          toast("Scene ended here", { kind: "ok" });
          return true;
        case "chapter":
          if (last) await post(`/api/messages/${last.id}/new-chapter`);
          toast("New chapter", { kind: "ok" });
          return true;
        case "timeskip": {
          const mm = arg.match(/^((?:an?|\d+(?:\.\d+)?)\s*\w+)\s*(.*)$/i);
          if (!mm) return (errorToast("Write how long, like /timeskip 3 days"), true);
          await post(`/api/chats/${chatId}/timeskip`, { duration: mm[1], note: mm[2] || undefined });
          toast("Time skipped", { kind: "ok" });
          return true;
        }
        case "recap": {
          toast("Writing a recap…");
          const r = await post<{ recap: string }>(`/api/chats/${chatId}/recap`);
          answer = { title: "Previously…", text: r.recap };
          answerOpen = true;
          return true;
        }
        case "remember":
        case "pin":
          if (!arg) return (errorToast(`Write what to remember after /${cmd}`), true);
          await post(`/api/chats/${chatId}/memories`, { type: "fact", content: arg, importance: 8, pinned: cmd === "pin" });
          toast(cmd === "pin" ? "Pinned to memory" : "Remembered", { kind: "ok" });
          return true;
        case "ask": {
          if (!arg) return (errorToast("Write your question after /ask"), true);
          toast("Asking…");
          const r = await post<{ answer: string }>(`/api/chats/${chatId}/ask`, { question: arg });
          answer = { title: arg, text: r.answer };
          answerOpen = true;
          return true;
        }
        case "director":
          await saveSettings({ director: !director });
          toast(director ? "Director mode off" : "Director mode on: your messages are stage directions", { kind: "ok" });
          return true;
        case "truth":
          if (!arg) return (errorToast("Write the rule after /truth"), true);
          await saveSettings({ truths: [...(settings.truths ?? []), arg] });
          toast("Story truth added", { kind: "ok" });
          return true;
      }
    } catch (e) {
      errorToast(e);
      return true;
    }
    return false;
  }

  function pickCommand(c: { cmd: string; args: string }) {
    text = `${c.cmd}${c.args ? " " : ""}`;
    paletteAt = 0;
    queueMicrotask(() => input?.focus());
  }

  // ---------- guidance (CHAT-11, CHAT-12) ----------
  const chips = $derived(app.settings?.["chat.guidance"] ?? []);
  const activeG = $derived(new Set([...(settings.guidance?.active ?? []), ...(settings.guidance?.once ?? [])]));
  const steerCount = $derived(activeG.size + (settings.length ? 1 : 0) + (settings.pacing && settings.pacing !== "normal" ? 1 : 0) + (settings.cue ? 1 : 0) + (settings.ooc?.length ?? 0));
  function toggleChip(id: string, mode: "once" | "persistent") {
    const g = { active: [...(settings.guidance?.active ?? [])], once: [...(settings.guidance?.once ?? [])] };
    const list = mode === "once" ? g.once : g.active;
    const i = list.indexOf(id);
    if (i >= 0) list.splice(i, 1);
    else list.push(id);
    void saveSettings({ guidance: g });
  }

  // ---------- drafts that follow you (CHAT-17) ----------
  const device = (() => {
    try {
      let d = localStorage.getItem("mea.device");
      if (!d) localStorage.setItem("mea.device", (d = crypto.randomUUID().slice(0, 8)));
      return d;
    } catch {
      return "web";
    }
  })();
  let syncTimer: ReturnType<typeof setTimeout>;
  let lastSynced = "";
  async function pullDraft(force = false) {
    try {
      const d = await get<{ text: string; device: string | null; updated_at: number }>(`/api/chats/${chatId}/draft`);
      if (d.device === device && !force) return;
      if ((force || !focused) && d.text !== text && (d.text || !text || d.device !== device)) {
        if (d.text || force) {
          text = d.text;
          lastSynced = d.text;
          refit();
        }
      }
    } catch {
      // offline: the local draft stays
    }
  }
  $effect(() => {
    void chatId;
    void pullDraft(false);
  });
  $effect(() => {
    const t = text;
    clearTimeout(syncTimer);
    if (t === lastSynced) return;
    syncTimer = setTimeout(() => {
      lastSynced = t;
      put(`/api/chats/${chatId}/draft`, { text: t, device }).catch(() => {});
    }, 1200);
  });
  $effect(() =>
    onEvent((e) => {
      if (e.type === "draft.changed" && e.chatId === chatId && e.device !== device) void pullDraft(false);
    }),
  );

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
    if (/^\/\w+/.test(content.trim())) {
      text = "";
      refit();
      if (await runCommand(content)) return;
      text = content;
      errorToast(`Unknown command ${content.trim().split(/\s/)[0]}`);
      return;
    }
    text = "";
    refit();
    const ok = await onsend(content, generate, director);
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
    if (palette.length) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        paletteAt = (paletteAt + 1) % palette.length;
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        paletteAt = (paletteAt - 1 + palette.length) % palette.length;
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.ctrlKey && !e.metaKey)) {
        e.preventDefault();
        pickCommand(palette[Math.min(paletteAt, palette.length - 1)]!);
        return;
      }
    }
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
  {#if palette.length}
    <div class="palette card" role="listbox" aria-label="Commands">
      {#each palette as c, i (c.cmd)}
        <button class="pal" class:on={i === paletteAt} role="option" aria-selected={i === paletteAt} onmousedown={(e) => e.preventDefault()} onclick={() => pickCommand(c)}>
          <b class="mono">{c.cmd}</b>{#if c.args}<span class="tiny faint mono"> {c.args}</span>{/if}
          <span class="tiny muted grow">{c.about}</span>
        </button>
      {/each}
    </div>
  {/if}
  {#if steerOpen}
    <div class="steer card">
      <div class="row wrap gap">
        <span class="tiny muted">Length</span>
        {#each ["short", "normal", "long"] as l (l)}<button class="schip" class:on={settings.length === l} onclick={() => saveSettings({ length: settings.length === l ? null : (l as ChatSettings["length"]) })}>{l}</button>{/each}
        <span class="tiny muted sep">Pace</span>
        {#each ["slow", "normal", "fast"] as p (p)}<button class="schip" class:on={(settings.pacing ?? "normal") === p && settings.pacing != null} onclick={() => saveSettings({ pacing: settings.pacing === p ? null : (p as ChatSettings["pacing"]) })}>{p}</button>{/each}
      </div>
      <div class="row wrap gap">
        {#each chips as g (g.id)}
          <button class="schip" class:on={activeG.has(g.id)} onclick={() => toggleChip(g.id, g.mode)} title={`${g.text}${g.mode === "once" ? " (next reply only)" : " (stays on)"}`}>{g.mode === "once" ? "◦" : "•"} {g.name}</button>
        {/each}
        <a class="tiny" href="/settings/writing">Edit chips</a>
      </div>
      {#if settings.cue || settings.ooc?.length}
        <div class="row wrap gap">
          {#if settings.cue}<span class="schip on" title="For the next reply only">cue: {settings.cue} <button class="x" onclick={() => saveSettings({ cue: null })} aria-label="Clear cue"><X size={11} /></button></span>{/if}
          {#each settings.ooc ?? [] as o (o.id)}<span class="schip on" title="Standing OOC note">ooc: {o.text} <button class="x" onclick={() => saveSettings({ ooc: (settings.ooc ?? []).filter((x) => x.id !== o.id) })} aria-label="Remove note"><X size={11} /></button></span>{/each}
        </div>
      {/if}
    </div>
  {/if}
  <div class="composer card" class:busy={drafting} class:director>
    <button class="btn ghost icon tool" bind:this={toolsBtn} onclick={() => (toolsOpen = true)} disabled={generating || Boolean(drafting)} aria-label="Writing tools">
      <Sparkles size={19} />
    </button>
    <button class="btn ghost icon tool steer-btn" class:on={steerOpen || steerCount > 0} onclick={() => (steerOpen = !steerOpen)} aria-label="Steer the next reply" title="Length, pace, guidance, cues">
      <SlidersHorizontal size={18} />{#if steerCount}<span class="badge">{steerCount}</span>{/if}
    </button>
    <button class="btn ghost icon tool director-btn" class:on={director} onclick={() => saveSettings({ director: !director })} aria-label="Director mode" title={director ? "Director mode: your messages are stage directions (click to turn off)" : "Director mode: write stage directions instead of your character's lines"}>
      <Clapperboard size={18} />
    </button>
    <textarea
      bind:this={input}
      bind:value={text}
      use:autosize={app.isMobile ? 180 : 260}
      onkeydown={onkey}
      onfocus={() => (focused = true)}
      onblur={() => setTimeout(() => (focused = false), 150)}
      rows="1"
      placeholder={drafting === "impersonate" ? "Writing as you…" : drafting === "expand" ? "Expanding your draft…" : disabled ? "Set up a model in Settings to start" : director ? "Stage direction: what should happen next…" : "Write your message… (/ for commands)"}
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

<Modal bind:open={answerOpen} title={answer?.title ?? ""} size="md">
  {#if answer}<p class="answer">{answer.text}</p>{/if}
  {#snippet footer()}<button class="btn primary small" onclick={() => (answerOpen = false)}>Close</button>{/snippet}
</Modal>

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
  .composer.director {
    background: color-mix(in srgb, var(--butter) 18%, var(--surface));
  }
  .tool.on {
    color: var(--accent);
  }
  .steer-btn {
    position: relative;
  }
  .badge {
    position: absolute;
    top: 0;
    right: 0;
    min-width: 1rem;
    height: 1rem;
    border-radius: var(--r-pill);
    background: var(--accent);
    color: var(--on-accent, white);
    font: 700 0.62rem/1rem var(--font-ui);
  }
  .palette {
    display: grid;
    padding: 0.3rem;
    max-height: 16rem;
    overflow: auto;
  }
  .pal {
    display: flex;
    gap: 0.5rem;
    align-items: baseline;
    border: 0;
    background: none;
    text-align: left;
    padding: 0.4rem 0.5rem;
    border-radius: var(--r-sm);
    color: inherit;
    cursor: pointer;
  }
  .pal.on,
  .pal:hover {
    background: var(--surface-2);
  }
  .steer {
    display: grid;
    gap: 0.4rem;
    padding: 0.55rem 0.7rem;
  }
  .gap {
    gap: 0.3rem;
  }
  .sep {
    margin-left: 0.6rem;
  }
  .schip {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    border: 1px solid var(--border);
    background: var(--surface);
    border-radius: var(--r-pill);
    padding: 0.2rem 0.6rem;
    font: 600 var(--fs-xs) var(--font-ui);
    color: var(--text-muted);
    cursor: pointer;
  }
  .schip.on {
    background: color-mix(in srgb, var(--accent) 16%, var(--surface));
    color: var(--text);
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  }
  .x {
    border: 0;
    background: none;
    padding: 0;
    cursor: pointer;
    color: inherit;
    display: inline-flex;
  }
  .answer {
    white-space: pre-wrap;
    line-height: 1.6;
  }
  .composer.busy {
    background: color-mix(in srgb, var(--lavender) 14%, var(--surface));
  }
  textarea {
    flex: 1;
    min-width: 0;
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
    flex: none;
  }
  @media (max-width: 480px) {
    .composer {
      gap: 0.1rem;
    }
    .tool {
      width: 2.1rem;
      padding-inline: 0;
    }
    /* Director mode stays one tap away in /director; it shows here once it's on. */
    .tool.director-btn:not(.on) {
      display: none;
    }
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
