<script lang="ts">
  import { onMount, tick } from "svelte";
  import Avatar from "../components/Avatar.svelte";
  import ChatPanel from "../components/chat/ChatPanel.svelte";
  import Composer from "../components/chat/Composer.svelte";
  import Inspector from "../components/chat/Inspector.svelte";
  import MessageItem from "../components/chat/MessageItem.svelte";
  import Modal from "../components/Modal.svelte";
  import QuotaRing from "../components/QuotaRing.svelte";
  import { ApiError, del, get, patch, post, put } from "../lib/api";
  import { promptText } from "../lib/dialogs.svelte";
  import { onEvent, reportPresence } from "../lib/events";
  import { compact } from "../lib/format";
  import { ArrowDown, ArrowLeft, PanelRight } from "../lib/icons";
  import { renderMessage } from "../lib/render";
  import { back, navigate } from "../lib/router.svelte";
  import { app, errorToast, toast } from "../lib/state.svelte";
  import type { ChatDetail, Message, Profile } from "../lib/types";

  let { id }: { id: string } = $props();

  let detail = $state<ChatDetail | null>(null);
  let messages = $state<Message[]>([]);
  let hasMore = $state(false);
  let loadingOlder = $state(false);
  let gens = $state<Record<string, string>>({});
  let hasModel = $state(true);
  let panelOpen = $state(localStorage.getItem("mea.panel") !== "0");
  let sheetOpen = $state(false);
  let inspectorOpen = $state(false);
  let inspectGen = $state<string | null>(null);
  let compare = $state<Message | null>(null);
  let compareOpen = $state(false);
  let preview = $state<{ est: number; target: number } | null>(null);
  let scroller = $state<HTMLDivElement | null>(null);
  let stick = $state(true);
  let editSignals = $state<Record<string, number>>({});
  let error = $state("");

  const generating = $derived(Object.keys(gens).length > 0 || messages.some((m) => m.status === "streaming"));
  const lastMsg = $derived(messages.at(-1));
  const charName = $derived(detail?.character?.name ?? "Character");
  const personaName = $derived(detail?.persona?.name ?? "You");
  const styleClass = $derived(`style-${app.settings?.["appearance.chatStyle"] ?? "cards"}`);

  onMount(() => {
    app.currentChatId = id;
    reportPresence();
    return () => {
      app.currentChatId = null;
      reportPresence();
    };
  });

  async function load() {
    try {
      const [d, page, profiles] = await Promise.all([
        get<ChatDetail>(`/api/chats/${id}`),
        get<{ messages: Message[]; hasMore: boolean }>(`/api/chats/${id}/messages?limit=60`),
        get<{ profiles: Profile[] }>("/api/profiles"),
      ]);
      detail = d;
      messages = page.messages;
      hasMore = page.hasMore;
      hasModel = profiles.profiles.some((p) => p.connectionId && p.modelId);
      const g: Record<string, string> = {};
      for (const a of d.active) {
        g[a.messageId] = a.generationId;
        const m = messages.find((x) => x.id === a.messageId);
        if (m) {
          m.status = "streaming";
          m.content = a.text;
          m.reasoning = a.reasoning || m.reasoning;
        }
      }
      gens = g;
      await tick();
      scrollToBottom(false);
      refreshPreview();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
  $effect(() => {
    void load();
  });

  let previewTimer: ReturnType<typeof setTimeout>;
  function refreshPreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(async () => {
      try {
        const p = await get<{ estPromptTokens: number; trace: { budget: { contextTarget: number } } }>(`/api/chats/${id}/prompt-preview`);
        preview = { est: p.estPromptTokens, target: p.trace.budget.contextTarget };
      } catch {
        preview = null;
      }
    }, 600);
  }

  async function fetchMessage(messageId: string) {
    try {
      const m = await get<Message>(`/api/messages/${messageId}`);
      upsert(m);
    } catch {
      // deleted
      messages = messages.filter((x) => x.id !== messageId);
    }
  }

  function upsert(m: Message) {
    const i = messages.findIndex((x) => x.id === m.id);
    if (i >= 0) {
      const cur = messages[i]!;
      // While streaming, the client's live text is ahead of what the server has saved.
      if (gens[m.id] && cur.status === "streaming" && cur.content.length > m.content.length) {
        m.content = cur.content;
        m.reasoning = cur.reasoning;
        m.status = "streaming";
      }
      messages[i] = m;
      if (cur.seq !== m.seq) messages.sort((a, b) => a.seq - b.seq);
    } else {
      messages.push(m);
      messages.sort((a, b) => a.seq - b.seq);
    }
  }

  $effect(() =>
    onEvent((e) => {
      if (e.type === "reconnected") {
        void load();
        return;
      }
      if (!("chatId" in e) || e.chatId !== id) return;
      switch (e.type) {
        case "gen.start": {
          gens[e.messageId] = e.generationId;
          const m = messages.find((x) => x.id === e.messageId);
          if (!m) {
            // Placeholder so no early tokens are lost while the message loads.
            messages.push({
              id: e.messageId,
              chatId: id,
              seq: (messages.at(-1)?.seq ?? 0) + 1,
              role: "assistant",
              name: null,
              hidden: false,
              bookmarked: false,
              activeSwipe: e.swipeIdx,
              swipeCount: e.swipeIdx + 1,
              content: "",
              reasoning: null,
              status: "streaming",
              error: null,
              meta: {},
              createdAt: Date.now(),
              updatedAt: Date.now(),
            });
            void fetchMessage(e.messageId);
            break;
          }
          const newSwipe = e.swipeIdx >= m.swipeCount;
          m.status = "streaming";
          if (newSwipe) {
            m.swipeCount = e.swipeIdx + 1;
            m.activeSwipe = e.swipeIdx;
            m.content = "";
            m.reasoning = null;
          }
          break;
        }
        case "gen.delta": {
          const m = messages.find((x) => x.id === e.messageId);
          if (m) {
            if (m.status !== "streaming") m.status = "streaming";
            m.content += e.text;
            if (e.reasoning) m.reasoning = (m.reasoning ?? "") + e.reasoning;
          }
          break;
        }
        case "gen.end":
          delete gens[e.messageId];
          void fetchMessage(e.messageId);
          if (e.status === "error" && e.error) toast(e.error, { kind: "error" });
          refreshPreview();
          break;
        case "message.changed":
          if (!gens[e.messageId]) void fetchMessage(e.messageId);
          break;
        case "chat.changed":
          get<ChatDetail>(`/api/chats/${id}`).then((d) => (detail = d)).catch(() => {});
          refreshPreview();
          break;
      }
    }),
  );

  // Stay pinned to the bottom while a reply streams, unless the user scrolled up.
  $effect(() => {
    void messages.length;
    void lastMsg?.content.length;
    if (stick) queueMicrotask(() => scrollToBottom(false));
  });

  function scrollToBottom(smooth = true) {
    if (!scroller) return;
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }

  async function onScroll() {
    if (!scroller) return;
    stick = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 140;
    if (scroller.scrollTop < 400 && hasMore && !loadingOlder && messages.length) {
      loadingOlder = true;
      const prevHeight = scroller.scrollHeight;
      try {
        const page = await get<{ messages: Message[]; hasMore: boolean }>(`/api/chats/${id}/messages?before=${messages[0]!.seq}&limit=60`);
        messages = [...page.messages, ...messages];
        hasMore = page.hasMore;
        await tick();
        scroller.scrollTop += scroller.scrollHeight - prevHeight;
      } finally {
        loadingOlder = false;
      }
    }
  }

  async function send(content: string, generate: boolean): Promise<boolean> {
    stick = true;
    try {
      const r = await post<{ userMessage: Message | null; generationId?: string; messageId?: string }>(`/api/chats/${id}/send`, { content, generate });
      if (r.userMessage) upsert(r.userMessage);
      if (r.messageId && r.generationId) {
        gens[r.messageId] = r.generationId;
        if (!messages.some((m) => m.id === r.messageId)) void fetchMessage(r.messageId);
      }
      // The user message may arrive after the reply placeholder; keep sequence order.
      messages.sort((a, b) => a.seq - b.seq);
      await tick();
      scrollToBottom();
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status !== 0) {
        await load();
        toast(e.message, { kind: "error", action: !hasModel ? { label: "Set up a model", run: () => navigate("/settings/models") } : undefined });
        return true;
      }
      errorToast(e);
      return false;
    }
  }

  async function regen(m: Message, withNote = false) {
    let feedback: string | undefined;
    if (withNote) {
      const note = await promptText({ title: "What should change?", label: "A note for this attempt only", placeholder: "More dialogue · slower pace · she wouldn't say that…", multiline: true, confirmLabel: "Regenerate" });
      if (note === null) return;
      feedback = note.trim() || undefined;
    }
    try {
      const r = await post<{ generationId: string; messageId: string; swipeIdx: number }>(`/api/messages/${m.id}/swipe`, { feedback });
      gens[r.messageId] = r.generationId;
      stick = true;
    } catch (e) {
      errorToast(e);
    }
  }

  async function swipeTo(m: Message, dir: -1 | 1) {
    const next = m.activeSwipe + dir;
    if (next < 0) return;
    if (next >= m.swipeCount) {
      if (m.id === lastMsg?.id && m.role === "assistant" && !generating) await regen(m);
      return;
    }
    await setSwipe(m, next);
  }

  async function setSwipe(m: Message, idx: number) {
    m.activeSwipe = idx;
    m.content = m.swipes?.[idx]?.content ?? m.content;
    try {
      upsert(await patch<Message>(`/api/messages/${m.id}`, { activeSwipe: idx }));
      refreshPreview();
    } catch (e) {
      errorToast(e);
    }
  }

  async function continueMsg(m: Message) {
    try {
      const r = await post<{ generationId: string; messageId: string }>(`/api/messages/${m.id}/continue`);
      gens[r.messageId] = r.generationId;
      stick = true;
    } catch (e) {
      errorToast(e);
    }
  }

  async function stop() {
    for (const g of Object.values(gens)) await post(`/api/generations/${g}/stop`).catch(() => {});
  }

  async function edit(m: Message, content: string) {
    try {
      upsert(await put<Message>(`/api/messages/${m.id}`, { content }));
      refreshPreview();
    } catch (e) {
      errorToast(e);
      throw e;
    }
  }

  async function remove(m: Message) {
    try {
      await del(`/api/messages/${m.id}`);
      messages = messages.filter((x) => x.id !== m.id);
      refreshPreview();
      toast("Message deleted", {
        action: {
          label: "Undo",
          run: async () => {
            upsert(await post<Message>(`/api/messages/${m.id}/restore`));
            refreshPreview();
          },
        },
      });
    } catch (e) {
      errorToast(e);
    }
  }

  async function flag(m: Message, flags: { hidden?: boolean; bookmarked?: boolean }) {
    try {
      upsert(await patch<Message>(`/api/messages/${m.id}`, flags));
      if (flags.hidden !== undefined) {
        toast(flags.hidden ? "Hidden from the prompt (still visible here)" : "Included in the prompt again");
        refreshPreview();
      }
    } catch (e) {
      errorToast(e);
    }
  }

  function editLastUser() {
    const m = [...messages].reverse().find((x) => x.role === "user");
    if (m) editSignals[m.id] = (editSignals[m.id] ?? 0) + 1;
  }

  function onkey(e: KeyboardEvent) {
    if (!lastMsg || lastMsg.role !== "assistant") return;
    if (e.altKey && e.key.toLowerCase() === "r" && !generating) {
      e.preventDefault();
      void regen(lastMsg);
    } else if (e.altKey && e.key === "ArrowLeft") {
      e.preventDefault();
      void swipeTo(lastMsg, -1);
    } else if (e.altKey && e.key === "ArrowRight") {
      e.preventDefault();
      void swipeTo(lastMsg, 1);
    }
  }

  function togglePanel() {
    if (app.isMobile) sheetOpen = true;
    else {
      panelOpen = !panelOpen;
      localStorage.setItem("mea.panel", panelOpen ? "1" : "0");
    }
  }

  function openInspector(genId: string | null) {
    inspectGen = genId;
    inspectorOpen = true;
  }

  const meterPct = $derived(preview ? Math.min(100, (preview.est / preview.target) * 100) : 0);
</script>

<svelte:window onkeydown={onkey} />

{#if error}
  <div class="center"><div class="stack" style="text-align:center"><h2>Couldn't open this chat</h2><p class="muted">{error}</p><a href="/">Back home</a></div></div>
{:else if detail}
  <div class="chat" class:with-panel={panelOpen && !app.isMobile}>
    <div class="main-col">
      <header class="bar">
        {#if app.isMobile}
          <button class="btn ghost icon" onclick={() => back("/")} aria-label="Back"><ArrowLeft size={20} /></button>
        {/if}
        <a href={detail.character ? `/character/${detail.character.id}` : "/"} class="who">
          <Avatar id={detail.character?.avatarId} name={charName} size={app.isMobile ? 34 : 40} palette={detail.character?.palette ?? []} />
          <span class="grow names">
            <span class="cname truncate">{charName}</span>
            <span class="ctitle truncate">{detail.chat.title}</span>
          </span>
        </a>
        <div class="row tools">
          {#if detail.chat.mode === "narrator"}<span class="chip lavender hide-sm">Narrator</span>{/if}
          {#if preview}
            <button class="meter" onclick={() => openInspector(null)} title="Prompt size: about {preview.est.toLocaleString()} of {preview.target.toLocaleString()} tokens. Click to inspect.">
              <span class="track"><span class="fill" style:width="{meterPct}%"></span></span>
              <span class="tiny muted hide-sm">{compact(preview.est)} / {compact(preview.target)}</span>
            </button>
          {/if}
          <QuotaRing size={22} />
          <button class="btn ghost icon" onclick={togglePanel} aria-label="Chat settings" class:on={panelOpen && !app.isMobile}><PanelRight size={19} /></button>
        </div>
      </header>

      <div class="scroller" bind:this={scroller} onscroll={onScroll}>
        <div class="column {styleClass}">
          {#if hasMore}
            <div class="older tiny muted">{loadingOlder ? "Loading earlier messages…" : "Scroll up for earlier messages"}</div>
          {:else}
            <div class="start">
              <span class="orn">✿</span>
              <span class="tiny muted">The story of {charName} and {personaName} begins</span>
            </div>
          {/if}
          {#each messages as m (m.id)}
            <MessageItem
              message={m}
              isLast={m.id === lastMsg?.id}
              canGenerate={!generating && hasModel}
              avatarId={m.role === "user" ? (detail.persona?.avatarId ?? null) : (detail.character?.avatarId ?? null)}
              displayName={m.role === "user" ? personaName : m.role === "assistant" ? (m.name ?? charName) : "Note"}
              palette={m.role === "assistant" ? (detail.character?.palette ?? []) : []}
              editSignal={editSignals[m.id] ?? 0}
              onswipe={(dir) => swipeTo(m, dir)}
              onregen={(note) => regen(m, note)}
              oncontinue={() => continueMsg(m)}
              onedit={(c) => edit(m, c)}
              ondelete={() => remove(m)}
              onflag={(f) => flag(m, f)}
              oninspect={() => openInspector(m.meta?.generationId ?? null)}
              oncompare={async () => {
                compare = await get<Message>(`/api/messages/${m.id}`);
                compareOpen = true;
              }}
            />
          {/each}
          {#if !messages.length}
            <p class="muted center-text">No messages yet. Say hello ✿</p>
          {/if}
        </div>
      </div>

      {#if !stick}
        <button class="jump btn icon" onclick={() => ((stick = true), scrollToBottom())} aria-label="Jump to latest"><ArrowDown size={18} /></button>
      {/if}

      <div class="composer-area">
        {#if !hasModel}
          <div class="notice warn tiny setup">No model is set up yet. <a href="/settings/models">Connect NanoGPT</a> to start writing.</div>
        {/if}
        <Composer chatId={id} {generating} disabled={!hasModel} onsend={send} onstop={stop} oneditlast={editLastUser} />
      </div>
    </div>

    {#if panelOpen && !app.isMobile}
      <aside class="dock">
        <ChatPanel {detail} onchange={() => load()} oninspect={() => openInspector(null)} />
      </aside>
    {/if}
  </div>

  {#if app.isMobile}
    <Modal bind:open={sheetOpen} title="This chat">
      <ChatPanel {detail} onchange={() => load()} oninspect={() => ((sheetOpen = false), openInspector(null))} />
    </Modal>
  {/if}

  <Inspector bind:open={inspectorOpen} chatId={id} generationId={inspectGen} />

  <Modal bind:open={compareOpen} title="Compare versions" size="xl">
    {#if compare?.swipes}
      <div class="compare">
        {#each compare.swipes as s (s.idx)}
          <div class="cmp card" class:current={s.idx === compare.activeSwipe}>
            <div class="row between tiny muted"><b>Version {s.idx + 1}</b><span>{s.meta?.model ?? ""}</span></div>
            <div class="prose small">{@html renderMessage(s.content, `cmp-${s.idx}`)}</div>
            {#if s.idx !== compare.activeSwipe}
              <button class="btn small" onclick={() => { if (compare) void setSwipe(compare, s.idx); compareOpen = false; }}>Use this one</button>
            {:else}
              <span class="chip rose">Current</span>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </Modal>
{:else}
  <div class="center"><span class="heart">✿</span></div>
{/if}

<style>
  .center {
    height: 100%;
    display: grid;
    place-items: center;
  }
  .heart {
    font-size: 2rem;
    color: var(--accent-strong);
    animation: pulse 1.4s infinite;
  }
  .chat {
    display: grid;
    grid-template-columns: 1fr;
    height: 100dvh;
  }
  .chat.with-panel {
    grid-template-columns: 1fr var(--dock-w);
  }
  .main-col {
    display: flex;
    flex-direction: column;
    min-width: 0;
    height: 100dvh;
    position: relative;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: calc(0.55rem + var(--safe-top)) 0.9rem 0.55rem;
    border-bottom: 1px solid var(--border);
    background: var(--glass);
    backdrop-filter: blur(12px);
    z-index: 5;
  }
  .who {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    min-width: 0;
    flex: 1;
    color: var(--text);
    text-decoration: none !important;
  }
  .names {
    display: grid;
    min-width: 0;
  }
  .cname {
    font-family: var(--font-display);
    font-variation-settings: "SOFT" 100;
    font-weight: 600;
    font-size: 1.1rem;
  }
  .ctitle {
    font-size: var(--fs-xs);
    color: var(--text-muted);
  }
  .tools {
    gap: 0.35rem;
  }
  .tools .on {
    background: var(--surface-2);
  }
  .meter {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    border: 0;
    background: none;
    cursor: pointer;
    padding: 0.3rem;
    border-radius: var(--r-sm);
  }
  .meter:hover {
    background: var(--surface-2);
  }
  .track {
    width: 3.2rem;
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
    transition: width 0.5s var(--ease);
  }
  .scroller {
    flex: 1;
    overflow-y: auto;
    overscroll-behavior: contain;
    scroll-padding-bottom: 2rem;
  }
  .column {
    max-width: var(--measure);
    margin: 0 auto;
    padding: 1.2rem 1.1rem 1.5rem;
  }
  .start,
  .older {
    display: grid;
    justify-items: center;
    gap: 0.3rem;
    padding: 1rem 0 1.4rem;
    text-align: center;
  }
  .orn {
    color: var(--accent-strong);
    font-size: 1.2rem;
  }
  .center-text {
    text-align: center;
    padding: 2rem 0;
  }
  .composer-area {
    padding: 0.4rem 1rem calc(0.8rem + var(--safe-bottom));
    max-width: calc(var(--measure) + 2rem);
    width: 100%;
    margin: 0 auto;
    display: grid;
    gap: 0.4rem;
  }
  .setup {
    text-align: center;
  }
  .jump {
    position: absolute;
    right: 1.2rem;
    bottom: 6.5rem;
    border-radius: 50%;
    box-shadow: var(--shadow-2);
    z-index: 4;
  }
  .dock {
    border-left: 1px solid var(--border);
    background: color-mix(in srgb, var(--surface-2) 45%, var(--bg));
    overflow-y: auto;
    padding: 1.2rem 1.1rem 2rem;
    height: 100dvh;
  }
  .compare {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
    gap: 0.8rem;
  }
  .cmp {
    padding: 0.8rem 1rem;
    display: grid;
    gap: 0.6rem;
    align-content: start;
  }
  .cmp.current {
    box-shadow: 0 0 0 2px var(--accent);
  }
  @media (max-width: 760px) {
    .bar {
      padding-left: 0.3rem;
      padding-right: 0.5rem;
    }
    .column {
      padding: 0.8rem 0.7rem 1rem;
    }
    .composer-area {
      padding: 0.35rem 0.6rem calc(0.55rem + var(--safe-bottom));
    }
    .hide-sm {
      display: none;
    }
    .jump {
      bottom: 5.8rem;
    }
  }
</style>
