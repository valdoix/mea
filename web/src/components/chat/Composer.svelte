<script lang="ts">
  import Modal from "../Modal.svelte";
  import { get, patch, post, postStream, put } from "../../lib/api";
  import { onEvent } from "../../lib/events";
  import { autosize } from "../../lib/gestures";
  import { ArrowUp, Square, UserPen, WandSparkles, Send, Clapperboard, SlidersHorizontal, X, Milestone, Flag, Hourglass, History, Brain, Pin, MessageQuestion, ShieldCheck } from "../../lib/icons";
  import ModelSwitcher from "./ModelSwitcher.svelte";
  import DirectorsDesk from "./DirectorsDesk.svelte";
  import { deskRequest } from "../../lib/desk.svelte";
  import Segmented from "../Segmented.svelte";
  import { compact } from "../../lib/format";
  import { app, errorToast, toast } from "../../lib/state.svelte";
  import { askMeus, sendToMeus } from "../../lib/meus.svelte";
  import { buzz, device as prefs } from "../../lib/device.svelte";
  import { delight } from "../../lib/delight";
  import type { SpellIssue } from "../../lib/spell";
  import type { Boundary, ChatDetail, ChatSettings, LorePreview } from "../../lib/types";

  let {
    chatId,
    detail,
    generating,
    disabled = false,
    onsend,
    onstop,
    oneditlast,
    onchange,
    preview = null,
    oninspect,
    lastMessageId = null,
  }: {
    chatId: string;
    detail: ChatDetail;
    generating: boolean;
    disabled?: boolean;
    onsend: (content: string, generate: boolean, director?: boolean) => Promise<boolean>;
    onstop: () => void;
    oneditlast: () => void;
    onchange: () => void;
    /** About how big the next prompt is, against the context target. */
    preview?: { est: number; target: number } | null;
    oninspect?: () => void;
    lastMessageId?: string | null;
  } = $props();

  const settings = $derived(detail.chat.settings as ChatSettings);
  const director = $derived(Boolean(settings.director));
  let answer = $state<{ title: string; text: string; citations?: { n: number; type: string; excerpt: string; seq: number | null }[] } | null>(null);
  let answerOpen = $state(false);

  async function patchSettings(patchBody: Partial<ChatSettings>) {
    await patch(`/api/chats/${chatId}`, { settings: patchBody });
    onchange();
  }
  async function saveSettings(patchBody: Partial<ChatSettings>) {
    try {
      await patchSettings(patchBody);
    } catch (e) {
      errorToast(e);
    }
  }

  // ---------- story actions (CHAT-15) ----------
  // These used to be slash commands; now they're buttons in the composer's tray. Typed commands
  // (/ooc, /cue, /scene…) still work for anyone used to them.
  async function lastMessage() {
    return get<{ messages: { id: string; seq: number }[] }>(`/api/chats/${chatId}/messages?limit=1`)
      .then((r) => r.messages.at(-1))
      .catch(() => undefined);
  }
  /** M38: false when the action failed, so what you typed for it is kept. */
  async function act(fn: () => Promise<void>): Promise<boolean> {
    try {
      await fn();
      return true;
    } catch (e) {
      errorToast(e);
      return false;
    }
  }
  const actions = {
    ooc: (note: string) =>
      act(async () => {
        if (!note.trim()) return;
        await patchSettings({ ooc: [...(settings.ooc ?? []), { id: crypto.randomUUID().slice(0, 8), text: note.trim() }] });
        toast("Out-of-character note added", { kind: "ok" });
      }),
    clearOoc: () => act(async () => void (await patchSettings({ ooc: [] }))),
    cue: (nudge: string) =>
      act(async () => {
        if (!nudge.trim()) return;
        await patchSettings({ cue: nudge.trim() });
        toast("Cue set for the next reply", { kind: "ok" });
      }),
    endScene: () =>
      act(async () => {
        const last = await lastMessage();
        if (!last) return;
        await post(`/api/messages/${last.id}/end-scene`);
        toast("Scene ended here. The next message starts a new one.", { kind: "ok" });
        onchange();
      }),
    chapter: (title: string) =>
      act(async () => {
        const last = await lastMessage();
        if (!last) return;
        const r = await post<{ boundaries: Boundary[] }>(`/api/messages/${last.id}/new-chapter`);
        const ch = r.boundaries.find((b) => b.level === "chapter" && b.startSeq === last.seq);
        if (ch && title.trim()) await put(`/api/summaries/${ch.id}`, { title: title.trim() });
        toast("A new chapter begins", { kind: "ok" });
        delight("sparkle");
        onchange();
      }),
    timeskip: (duration: string, note: string) =>
      act(async () => {
        if (!duration.trim()) throw new Error("Say how long, like “3 days”");
        await post(`/api/chats/${chatId}/timeskip`, { duration: duration.trim(), note: note.trim() || undefined });
        toast("Time skipped", { kind: "ok" });
      }),
    recap: () =>
      act(async () => {
        toast("Writing a recap…");
        const r = await post<{ recap: string }>(`/api/chats/${chatId}/recap`);
        answer = { title: "Previously…", text: r.recap };
        answerOpen = true;
      }),
    remember: (fact: string, pinned: boolean) =>
      act(async () => {
        if (!fact.trim()) return;
        await post(`/api/chats/${chatId}/memories`, { type: "fact", content: fact.trim(), importance: 8, pinned });
        toast(pinned ? "Pinned to memory" : "Remembered", { kind: "ok" });
        delight("sparkle");
      }),
    ask: (question: string) =>
      act(async () => {
        if (!question.trim()) return;
        toast("Asking…");
        const r = await post<{ answer: string; citations?: { n: number; type: string; excerpt: string; seq: number | null }[] }>(`/api/chats/${chatId}/ask`, { question: question.trim() });
        answer = { title: question.trim(), text: r.answer, citations: r.citations };
        answerOpen = true;
      }),
    director: () =>
      act(async () => {
        await patchSettings({ director: !director });
        toast(director ? "Director mode off" : "Director mode on: your messages are stage directions", { kind: "ok" });
      }),
    truth: (rule: string) =>
      act(async () => {
        if (!rule.trim()) return;
        await patchSettings({ truths: [...(settings.truths ?? []), rule.trim()] });
        toast("Story truth added", { kind: "ok" });
      }),
  };

  /** Runs a typed command: "unknown" when it isn't one, "failed" when it didn't work (M38: the text stays). */
  async function runCommand(raw: string): Promise<"ok" | "failed" | "unknown"> {
    const m = raw.trim().match(/^\/(\w+)\s*([\s\S]*)$/);
    if (!m) return "unknown";
    const [, cmd, rest] = m as unknown as [string, string, string];
    const arg = rest.trim();
    const done = (ok: boolean) => (ok ? "ok" : "failed");
    switch (cmd.toLowerCase()) {
      case "ooc":
        return done(await (/^clear$/i.test(arg) ? actions.clearOoc() : actions.ooc(arg)));
      case "cue":
        return done(await actions.cue(arg));
      case "scene":
        return done(await actions.endScene());
      case "chapter":
        return done(await actions.chapter(arg));
      case "timeskip": {
        const mm = arg.match(/^((?:an?|\d+(?:\.\d+)?)\s*\w+)\s*(.*)$/i);
        if (!mm) return (errorToast("Say how long, like “3 days”"), "failed");
        return done(await actions.timeskip(mm[1]!, mm[2] ?? ""));
      }
      case "recap":
        return done(await actions.recap());
      case "remember":
      case "pin":
        return done(await actions.remember(arg, cmd.toLowerCase() === "pin"));
      case "ask":
        return done(await actions.ask(arg));
      case "meus":
        if (arg) sendToMeus(arg);
        else askMeus();
        return "ok";
      case "director":
        return done(await actions.director());
      case "truth":
        return done(await actions.truth(arg));
    }
    return "unknown";
  }

  // ---------- the tray: writing tools, steering and story actions, one button away ----------
  let trayOpen = $state(false);
  let trayTab = $state<"write" | "steer" | "story">("write");
  let trayEl = $state<HTMLDivElement | null>(null);
  let optsBtn = $state<HTMLButtonElement | null>(null);
  let f = $state({ cue: "", ooc: "", truth: "", chapter: "", skip: "", skipNote: "", fact: "", question: "" });
  function closeTrayOutside(e: MouseEvent) {
    const t = e.target as Node;
    if (trayOpen && trayEl && !trayEl.contains(t) && !optsBtn?.contains(t)) trayOpen = false;
  }
  // F2: the Desk's header button on phones opens the tray on the Story side.
  $effect(() => {
    if (deskRequest.seq) {
      trayTab = "story";
      trayOpen = true;
    }
  });
  async function trayDo(fn: () => Promise<unknown>, reset?: (keyof typeof f)[], close = false) {
    if ((await fn()) === false) return;
    for (const k of reset ?? []) f[k] = "";
    if (close) trayOpen = false;
  }
  const meterPct = $derived(preview ? Math.min(100, (preview.est / preview.target) * 100) : 0);

  // ---------- guidance (CHAT-11, CHAT-12) ----------
  const chips = $derived(app.settings?.["chat.guidance"] ?? []);
  const activeG = $derived(new Set([...(settings.guidance?.active ?? []), ...(settings.guidance?.once ?? [])]));
  const steerCount = $derived(activeG.size + (settings.length ? 1 : 0) + (settings.pacing && settings.pacing !== "normal" ? 1 : 0) + (settings.cue ? 1 : 0) + (settings.ooc?.length ?? 0));
  const lengthOpts = [
    { value: "short", label: "Short" },
    { value: "normal", label: "Normal" },
    { value: "long", label: "Long" },
  ];
  const paceOpts = [
    { value: "slow", label: "Slow" },
    { value: "normal", label: "Normal" },
    { value: "fast", label: "Fast" },
  ];
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
  let focused = $state(false);

  // ---------- @-mentions (QOL-03) ----------
  let names = $state<{ name: string; kind: string; hint?: string }[] | null>(null);
  let caret = $state(0);
  let mentionAt = $state(0);
  let mentionOff = $state(false);
  async function loadNames() {
    try {
      names = (await get<{ names: { name: string; kind: string; hint?: string }[] }>(`/api/chats/${chatId}/names`)).names;
    } catch {
      names = [];
    }
  }
  $effect(() =>
    onEvent((e) => {
      if (e.type === "memory.changed" && e.chatId === chatId && names) void loadNames();
    }),
  );
  const mentionQuery = $derived(text.slice(0, caret).match(/(?:^|[\s"(*])@([\p{L}'’-]{0,30})$/u)?.[1] ?? null);
  $effect(() => {
    if (mentionQuery !== null && !names) void loadNames();
  });
  const mentions = $derived.by(() => {
    if (mentionQuery === null || !names || mentionOff) return [];
    const q = mentionQuery.toLowerCase();
    const starts = names.filter((n) => n.name.toLowerCase().startsWith(q));
    const inside = names.filter((n) => !n.name.toLowerCase().startsWith(q) && n.name.toLowerCase().includes(q));
    return [...starts, ...inside].slice(0, 7);
  });
  $effect(() => {
    void mentionQuery;
    mentionAt = 0;
  });
  function pickMention(n: { name: string }) {
    const start = caret - (mentionQuery?.length ?? 0) - 1;
    text = text.slice(0, start) + n.name + text.slice(caret);
    const pos = start + n.name.length;
    queueMicrotask(() => {
      input?.focus();
      input?.setSelectionRange(pos, pos);
      caret = pos;
      refit();
    });
  }
  const trackCaret = () => (caret = input?.selectionStart ?? text.length);

  // ---------- spell and grammar check (QOL-04) ----------
  let issues = $state<SpellIssue[]>([]);
  const ignored = new Set<string>();
  let spellTimer: ReturnType<typeof setTimeout>;
  let spellNamesLoaded = false;
  $effect(() => {
    const t = text;
    clearTimeout(spellTimer);
    if (!prefs.spellcheck || !t.trim()) {
      issues = [];
      return;
    }
    spellTimer = setTimeout(async () => {
      try {
        const spell = await import("../../lib/spell");
        if (!spellNamesLoaded) {
          spellNamesLoaded = true;
          if (!names) await loadNames();
          await spell.addNames((names ?? []).map((n) => n.name));
        }
        const found = await spell.check(t);
        if (t === text) issues = found.filter((i) => !ignored.has(i.text.toLowerCase())).slice(0, 5);
      } catch {
        issues = [];
      }
    }, 700);
    return () => clearTimeout(spellTimer);
  });
  function applyFix(i: SpellIssue, replacement: string) {
    if (text.slice(i.start, i.end) !== i.text) return;
    text = text.slice(0, i.start) + replacement + text.slice(i.end);
    issues = [];
    refit();
  }
  function ignoreIssue(i: SpellIssue) {
    ignored.add(i.text.toLowerCase());
    issues = issues.filter((x) => x !== i);
  }


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

  // Warm recall for what's being typed so sending is faster (CTX-10, MEM-20). Errors don't matter here.
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

  // LORE-08: which lore entries your draft would bring in, shown as you type.
  let lorePreview = $state<LorePreview[]>([]);
  let lastLore = "";
  $effect(() => {
    const draft = text.trim();
    const id = chatId;
    if (draft.startsWith("/") || draft.length < 4) {
      lorePreview = [];
      return;
    }
    if (draft === lastLore) return;
    const t = setTimeout(() => {
      lastLore = draft;
      post<{ entries: LorePreview[] }>(`/api/chats/${id}/lore/preview`, { draft })
        .then((r) => (lorePreview = r.entries.slice(0, 5)))
        .catch(() => (lorePreview = []));
    }, 600);
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
      const ran = await runCommand(content);
      if (ran === "ok") return;
      // A command that failed, or isn't one, gives the text back (if nothing new was typed meanwhile).
      if (!text) {
        text = content;
        refit();
      }
      if (ran === "unknown") errorToast(`Unknown command ${content.trim().split(/\s/)[0]}`);
      return;
    }
    text = "";
    refit();
    buzz(12);
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
    if (mentions.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        mentionAt = (mentionAt + (e.key === "ArrowDown" ? 1 : mentions.length - 1)) % mentions.length;
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.ctrlKey && !e.metaKey)) {
        e.preventDefault();
        pickMention(mentions[Math.min(mentionAt, mentions.length - 1)]!);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        mentionOff = true;
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

</script>

<svelte:window onclick={closeTrayOutside} />

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
  {#if mentions.length}
    <div class="palette card" role="listbox" aria-label="Names">
      {#each mentions as n, i (n.name)}
        <button class="pal" class:on={i === mentionAt} role="option" aria-selected={i === mentionAt} onmousedown={(e) => e.preventDefault()} onclick={() => pickMention(n)}>
          <b>{n.name}</b>
          <span class="tiny muted grow wraps">{n.hint ?? n.kind}</span>
        </button>
      {/each}
    </div>
  {/if}
  {#if issues.length && !generating}
    <div class="spell" aria-label="Spelling and grammar">
      {#each issues as i (`${i.start}:${i.text}`)}
        <span class="schip" title={i.message}>
          <s>{i.text || "·"}</s>
          {#each i.suggestions as sug (sug)}<button class="fix" onclick={() => applyFix(i, sug)} title="Use “{sug}”">{sug || "(remove)"}</button>{:else}<span class="tiny muted">{i.kind}</span>{/each}
          <button class="x" onclick={() => ignoreIssue(i)} aria-label="Ignore “{i.text}”"><X size={11} /></button>
        </span>
      {/each}
    </div>
  {/if}
  {#if trayOpen}
    <div class="tray card" bind:this={trayEl} role="dialog" aria-label="Writing tools, steering and story">
      <div class="tray-top">
        <Segmented
          value={trayTab}
          options={[
            { value: "write", label: "Write" },
            { value: "steer", label: steerCount ? `Steer · ${steerCount}` : "Steer" },
            { value: "story", label: "Story" },
          ]}
          onchange={(v) => (trayTab = v)}
        />
        <button class="btn ghost icon small" onclick={() => (trayOpen = false)} aria-label="Close"><X size={16} /></button>
      </div>

      {#if trayTab === "write"}
        <div class="opts-grid">
          <button class="opt" onclick={() => trayDo(() => draft("impersonate"), [], true)} disabled={generating || Boolean(drafting)}>
            <span class="ic"><UserPen size={17} /></span><span><b>Write my next message</b><small>Third person, present tense</small></span>
          </button>
          <button class="opt" onclick={() => trayDo(() => draft("expand"), [], true)} disabled={generating || Boolean(drafting) || !text.trim()}>
            <span class="ic"><WandSparkles size={17} /></span><span><b>Expand my draft</b><small>Turn rough notes into prose</small></span>
          </button>
          <button class="opt" onclick={() => trayDo(() => send(false), [], true)} disabled={!text.trim() || generating}>
            <span class="ic"><Send size={17} /></span><span><b>Send without a reply</b><small>Add your turn and wait</small></span>
          </button>
          <button class="opt" class:on={director} onclick={() => actions.director()}>
            <span class="ic"><Clapperboard size={17} /></span><span><b>Director mode {director ? "on" : "off"}</b><small>Write stage directions instead</small></span>
          </button>
        </div>
        <div class="row wrap model-row">
          <span class="tlabel">This reply</span>
          <ModelSwitcher {detail} {onchange} up />
          {#if preview}
            <button class="meter" onclick={() => ((trayOpen = false), oninspect?.())} title="About {preview.est.toLocaleString()} of {preview.target.toLocaleString()} tokens. Open to see exactly what the model reads.">
              <span class="track"><span class="fill" style:width="{meterPct}%"></span></span>
              <span class="tiny muted">{compact(preview.est)} / {compact(preview.target)}</span>
            </button>
          {/if}
        </div>
        <div class="tsec">
          <span class="tlabel">Lore your message brings in</span>
          {#if lorePreview.length}
            <div class="row wrap gap">{#each lorePreview as l (l.id)}<span class="chip lavender tiny" title="{l.bookName} · {l.reason} · {l.tokens} tokens">📖 {l.title}</span>{/each}</div>
          {:else}
            <p class="tiny faint">Start typing: entries your words wake up appear here.</p>
          {/if}
        </div>
      {:else if trayTab === "steer"}
        <div class="tsec">
          <span class="tlabel">Length</span>
          <Segmented value={settings.length ?? "normal"} options={lengthOpts} onchange={(v) => saveSettings({ length: v === "normal" ? null : (v as ChatSettings["length"]) })} />
        </div>
        <div class="tsec">
          <span class="tlabel">Pace</span>
          <Segmented value={settings.pacing ?? "normal"} options={paceOpts} onchange={(v) => saveSettings({ pacing: v === "normal" ? null : (v as ChatSettings["pacing"]) })} />
        </div>
        <div class="tsec">
          <span class="tlabel">Nudges <a class="tiny" href="/settings/writing">edit</a></span>
          <div class="row wrap gap">
            {#each chips as g (g.id)}
              <button class="schip" class:on={activeG.has(g.id)} onclick={() => toggleChip(g.id, g.mode)} title={`${g.text}${g.mode === "once" ? " (next reply only)" : " (stays on)"}`}>{g.mode === "once" ? "◦" : "✦"} {g.name}</button>
            {:else}
              <span class="tiny faint">No nudges yet. Add some in Settings → Writing.</span>
            {/each}
          </div>
        </div>
        <div class="tsec">
          <span class="tlabel">A cue for the next reply only</span>
          {#if settings.cue}
            <span class="schip on">{settings.cue} <button class="x" onclick={() => saveSettings({ cue: null })} aria-label="Clear the cue"><X size={11} /></button></span>
          {:else}
            <form class="inline" onsubmit={(e) => (e.preventDefault(), trayDo(() => actions.cue(f.cue), ["cue"]))}>
              <input class="input" bind:value={f.cue} placeholder="She notices the second key…" />
              <button class="btn small" disabled={!f.cue.trim()}>Set</button>
            </form>
          {/if}
        </div>
        <div class="tsec">
          <span class="tlabel">Standing notes to the writer (out of character)</span>
          {#each settings.ooc ?? [] as o (o.id)}
            <span class="schip on">{o.text} <button class="x" onclick={() => saveSettings({ ooc: (settings.ooc ?? []).filter((x) => x.id !== o.id) })} aria-label="Remove note"><X size={11} /></button></span>
          {/each}
          <form class="inline" onsubmit={(e) => (e.preventDefault(), trayDo(() => actions.ooc(f.ooc), ["ooc"]))}>
            <input class="input" bind:value={f.ooc} placeholder="Keep replies under three paragraphs" />
            <button class="btn small" disabled={!f.ooc.trim()}>Add</button>
          </form>
        </div>
        <div class="tsec">
          <span class="tlabel"><ShieldCheck size={12} /> Story truths that always hold</span>
          {#each settings.truths ?? [] as t, i (i)}
            <span class="schip on">{t} <button class="x" onclick={() => saveSettings({ truths: (settings.truths ?? []).filter((_, j) => j !== i) })} aria-label="Remove truth"><X size={11} /></button></span>
          {/each}
          <form class="inline" onsubmit={(e) => (e.preventDefault(), trayDo(() => actions.truth(f.truth), ["truth"]))}>
            <input class="input" bind:value={f.truth} placeholder="Wren has never left the island" />
            <button class="btn small" disabled={!f.truth.trim()}>Add</button>
          </form>
        </div>
      {:else}
        <DirectorsDesk {chatId} {lastMessageId} onendscene={actions.endScene} onrecap={actions.recap} onanswer={(title, text) => ((answer = { title, text }), (answerOpen = true))} {onchange} onclose={() => (trayOpen = false)} />
        <form class="tsec" onsubmit={(e) => (e.preventDefault(), trayDo(() => actions.chapter(f.chapter), ["chapter"], true))}>
          <span class="tlabel"><Flag size={12} /> Start a new chapter</span>
          <div class="inline"><input class="input" bind:value={f.chapter} placeholder="A title, or leave it for Mea to write" /><button class="btn small" disabled={!lastMessageId}>Begin</button></div>
        </form>
        <form class="tsec" onsubmit={(e) => (e.preventDefault(), trayDo(() => actions.remember(f.fact, false), ["fact"]))}>
          <span class="tlabel"><Brain size={12} /> Something to remember</span>
          <div class="inline">
            <input class="input" bind:value={f.fact} placeholder="Ash is afraid of deep water" />
            <button class="btn small" disabled={!f.fact.trim()}>Remember</button>
            <button type="button" class="btn small" disabled={!f.fact.trim()} onclick={() => trayDo(() => actions.remember(f.fact, true), ["fact"])} title="Always in the prompt"><Pin size={13} /> Pin</button>
          </div>
        </form>
        <form class="tsec" onsubmit={(e) => (e.preventDefault(), trayDo(() => actions.ask(f.question), ["question"], true))}>
          <span class="tlabel"><MessageQuestion size={12} /> Ask about the story (out of character)</span>
          <div class="inline"><input class="input" bind:value={f.question} placeholder="When did she first mention her brother?" /><button class="btn small" disabled={!f.question.trim()}>Ask</button></div>
        </form>
      {/if}
    </div>
  {/if}
  <div class="composer card" class:busy={drafting} class:director>
    <button class="btn ghost icon tool opts" class:on={trayOpen} bind:this={optsBtn} onclick={() => (trayOpen = !trayOpen)} aria-label="Writing tools, steering and story actions" aria-expanded={trayOpen} title="Writing tools, steering and story actions">
      <SlidersHorizontal size={19} />{#if steerCount || director}<span class="pip" aria-hidden="true"></span>{/if}
    </button>
    {#if director}<button class="chip butter dir" onclick={() => actions.director()} title="Director mode is on: tap to turn it off"><Clapperboard size={12} /> Director</button>{/if}
    <textarea
      bind:this={input}
      bind:value={text}
      use:autosize={app.isMobile ? 180 : 260}
      onkeydown={onkey}
      onkeyup={trackCaret}
      onclick={trackCaret}
      oninput={() => ((mentionOff = false), trackCaret())}
      spellcheck={!prefs.spellcheck}
      onfocus={() => (focused = true)}
      onblur={() => setTimeout(() => (focused = false), 150)}
      rows="1"
      placeholder={drafting === "impersonate" ? "Writing as you…" : drafting === "expand" ? "Expanding your draft…" : disabled ? "Set up a model in Settings to start" : director ? "Stage direction: what should happen next…" : `Speak as ${detail.persona?.name ?? "yourself"}…`}
      aria-label="Message"
      readonly={Boolean(drafting)}
    ></textarea>
    {#if generating || drafting}
      <button class="btn icon send stop" onclick={stop} aria-label="Stop" title="Stop"><Square size={16} fill="currentColor" /></button>
    {:else}
      <button class="btn primary icon send" onclick={() => send()} disabled={disabled} aria-label={text.trim() ? "Send" : "Let them continue"} title={text.trim() ? "Send" : "Send nothing: the character keeps going"}>
        <ArrowUp size={19} />
      </button>
    {/if}
  </div>
</div>


<Modal bind:open={answerOpen} title={answer?.title ?? ""} size="md">
  {#if answer}
    <p class="answer">{answer.text}</p>
    {#if answer.citations?.length}
      <div class="cites">
        {#each answer.citations as c (c.n)}<div class="tiny"><span class="faint">[{c.n}] {c.type}{c.seq != null ? ` · #${c.seq}` : ""}</span> {c.excerpt.slice(0, 200)}</div>{/each}
      </div>
      <p class="tiny muted">More in the Ask tab of the chat panel, with links to each source.</p>
    {/if}
  {/if}
  {#snippet footer()}<button class="btn primary small" onclick={() => (answerOpen = false)}>Close</button>{/snippet}
</Modal>

<style>
  .composer-wrap {
    position: relative;
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
    color: var(--accent-ink);
  }
  /* Floats over the foot of the story: in the flow, every check that came and went resized the
     story above it and the end of the reply jumped. */
  .spell {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 100%;
    z-index: 5;
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin-bottom: 0.35rem;
    pointer-events: none;
  }
  .spell .schip {
    pointer-events: auto;
    box-shadow: var(--shadow-1);
  }
  .spell s {
    text-decoration-color: var(--danger);
    opacity: 0.8;
  }
  .spell .fix {
    border: 0;
    background: color-mix(in srgb, var(--mint) 45%, transparent);
    border-radius: 999px;
    padding: 0 0.45rem;
    font: inherit;
    color: inherit;
    cursor: pointer;
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
  .gap {
    gap: 0.3rem;
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
  .cites {
    display: grid;
    gap: 0.3rem;
    margin-top: 0.5rem;
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
  .opts {
    position: relative;
  }
  .pip {
    position: absolute;
    top: 0.45rem;
    right: 0.45rem;
    width: 0.45rem;
    height: 0.45rem;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 8px var(--accent);
  }
  .dir {
    align-self: center;
    flex: none;
    cursor: pointer;
  }
  .tray {
    display: grid;
    gap: 1rem;
    padding: 1rem 1.1rem 1.15rem;
    border-radius: var(--r-lg);
    max-height: min(62vh, 34rem);
    overflow-y: auto;
    animation: tray-in 0.32s var(--spring);
    background: var(--surface);
  }
  @keyframes tray-in {
    from {
      opacity: 0;
      transform: translateY(10px) scale(0.98);
    }
  }
  .tray-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .opts-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr));
    gap: 0.5rem;
  }
  .opt {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    padding: 0.65rem 0.75rem;
    border-radius: 16px;
    border: 1px solid var(--border);
    background: var(--surface-2);
    color: var(--text);
    text-align: left;
    cursor: pointer;
    font: inherit;
    transition:
      transform 0.3s var(--spring),
      background 0.2s,
      border-color 0.2s;
  }
  .opt:hover:not(:disabled) {
    transform: translateY(-1px);
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  }
  .opt:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .opt.on {
    border-color: color-mix(in srgb, var(--accent) 60%, var(--border));
    background: color-mix(in srgb, var(--accent) 12%, var(--surface-2));
  }
  .opt .ic {
    width: 2.2rem;
    height: 2.2rem;
    flex: none;
    display: grid;
    place-items: center;
    border-radius: 12px;
    background: color-mix(in srgb, var(--lamp, var(--butter)) 16%, transparent);
    color: var(--lamp, var(--accent-ink));
  }
  .opt b {
    display: block;
    font-size: var(--fs-sm);
    font-weight: 700;
  }
  .opt small {
    display: block;
    font-size: var(--fs-xs);
    color: var(--text-faint);
  }
  .tsec {
    display: grid;
    gap: 0.45rem;
    justify-items: start;
  }
  .tlabel {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font: 700 0.68rem var(--font-ui);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-faint);
  }
  .inline {
    display: flex;
    gap: 0.4rem;
    width: 100%;
  }
  .inline .input {
    flex: 1;
    min-width: 0;
    padding: 0.45rem 0.75rem;
  }
  .model-row {
    gap: 0.6rem;
  }
  .meter {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    border: 0;
    background: none;
    cursor: pointer;
    padding: 0.3rem 0.4rem;
    border-radius: var(--r-sm);
    color: inherit;
  }
  .meter:hover {
    background: var(--surface-2);
  }
  .track {
    width: 4rem;
    height: 0.4rem;
    border-radius: var(--r-pill);
    background: var(--surface-3);
    overflow: hidden;
  }
  .fill {
    display: block;
    height: 100%;
    background: linear-gradient(90deg, var(--lavender), var(--accent));
    border-radius: inherit;
  }
  .gap {
    gap: 0.3rem;
  }
  :global([data-shell="lantern"]) .tray {
    background: var(--pop);
  }
  :global([data-shell="lantern"]) .opt {
    background: color-mix(in srgb, var(--hi) 4%, transparent);
    border-color: var(--edge);
  }
  :global([data-shell="lantern"]) .opt .ic {
    box-shadow: 0 0 16px -6px var(--lamp);
  }
  :global([data-shell="lantern"]) .composer {
    background: var(--pop);
    border-radius: 24px;
    padding: 0.45rem;
  }
  :global([data-shell="lantern"]) .composer:focus-within {
    box-shadow:
      0 0 0 4px color-mix(in srgb, var(--accent) 10%, transparent),
      0 24px 60px -20px color-mix(in srgb, var(--lo) 70%, transparent),
      0 0 40px -10px color-mix(in srgb, var(--accent) 35%, transparent);
  }
  :global([data-shell="lantern"]) .send {
    border-radius: 16px;
    width: 2.9rem;
    min-height: 2.9rem;
  }
  :global([data-shell="lantern"]) .send:not(:disabled):hover {
    transform: scale(1.06) rotate(-8deg);
  }
  :global([data-shell="lantern"]) .tool {
    color: var(--text-muted);
  }
  :global([data-shell="lantern"]) .tool.on {
    color: var(--text);
    background: color-mix(in srgb, var(--hi) 10%, transparent);
  }
  :global([data-shell="lantern"]) textarea::placeholder {
    color: var(--text-faint);
    font-style: italic;
  }
</style>
