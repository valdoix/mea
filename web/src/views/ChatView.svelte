<script lang="ts">
  import { onMount, tick } from "svelte";
  import { regexScope } from "../lib/regex.svelte";
  import Avatar from "../components/Avatar.svelte";
  import ChatPanel from "../components/chat/ChatPanel.svelte";
  import Composer from "../components/chat/Composer.svelte";
  import MemoryPanel from "../components/memory/MemoryPanel.svelte";
  import TrackerPanel from "../components/trackers/TrackerPanel.svelte";
  import Hud from "../components/trackers/Hud.svelte";
  import WorldPanel from "../components/world/WorldPanel.svelte";
  import ModelSwitcher from "../components/chat/ModelSwitcher.svelte";
  import ChatSearch from "../components/chat/ChatSearch.svelte";
  import ArchivistPanel from "../components/chat/ArchivistPanel.svelte";
  import SelectionMenu from "../components/chat/SelectionMenu.svelte";
  import { openTrackers, refreshTrackers, trk } from "../lib/trackers.svelte";
  import Segmented from "../components/Segmented.svelte";
  import Inspector from "../components/chat/Inspector.svelte";
  import MessageItem from "../components/chat/MessageItem.svelte";
  import Modal from "../components/Modal.svelte";
  import QuotaRing from "../components/QuotaRing.svelte";
  import { ApiError, del, get, patch, post, put } from "../lib/api";
  import { promptText } from "../lib/dialogs.svelte";
  import { onEvent, reportPresence } from "../lib/events";
  import { compact } from "../lib/format";
  import { ArrowDown, ArrowLeft, Library, PanelRight, Search } from "../lib/icons";
  import { renderMessage } from "../lib/render";
  import { back, navigate, route } from "../lib/router.svelte";
  import { app, errorToast, toast } from "../lib/state.svelte";
  import type { ArchiveCitation, Atom, Boundary, ChatDetail, Citation, ContinuityFlag, GlossaryTerm, Message, Profile, Summary } from "../lib/types";

  let { id }: { id: string } = $props();

  let detail = $state<ChatDetail | null>(null);
  let recapChecked = false;
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
  type DockTab = "chat" | "memory" | "story" | "world" | "ask";
  let dockTab = $state<DockTab>((["chat", "memory", "story", "world", "ask"].includes(localStorage.getItem("mea.dockTab") ?? "") ? localStorage.getItem("mea.dockTab") : "chat") as DockTab);
  const dockOptions = [
    { value: "chat" as const, label: "Chat" },
    { value: "memory" as const, label: "Memory" },
    { value: "story" as const, label: "Story" },
    { value: "world" as const, label: "World" },
    { value: "ask" as const, label: "Ask" },
  ];
  // Phase 3: continuity notes per message (CON-02), glossary terms (LORE-15).
  let flags = $state<Record<string, ContinuityFlag>>({});
  let terms = $state<GlossaryTerm[]>([]);
  let glossPick = $state<{ t: GlossaryTerm; x: number; y: number } | null>(null);
  let searchOpen = $state(false);
  let searchQ = $state("");
  let boundaries = $state<Boundary[]>([]);
  let highlight = $state<number | null>(null);
  let quotaChoice = $state<{ message: string; alternatives: { id: string; name: string; model: string }[]; retry: (profileId: string) => Promise<void> } | null>(null);
  let quotaOpen = $state(false);
  let knows = $state<{ scene: Summary | null; atoms: Atom[]; inMemory: boolean; seq: number } | null>(null);
  // SUM-15: "previously on…" when you come back after a while.
  let recap = $state<{ text: string } | null>(null);
  const seenKey = $derived(`mea.seen.${id}`);
  function markSeen() {
    try {
      localStorage.setItem(seenKey, String(Date.now()));
    } catch {
      // storage unavailable
    }
  }
  async function maybeRecap(d: ChatDetail) {
    const hours = app.settings?.["steer.config"]?.recapAfterHours ?? 0;
    if (!hours) return;
    let seen = 0;
    try {
      seen = Number(localStorage.getItem(seenKey)) || 0;
    } catch {
      seen = 0;
    }
    const away = Date.now() - (seen || d.chat.lastMessageAt || Date.now());
    if (away < hours * 3600_000) return;
    try {
      const r = await get<{ recap: string | null }>(`/api/chats/${id}/recap/auto?away=${away}`);
      if (r.recap) recap = { text: r.recap };
    } catch {
      // the recap is a nicety
    }
  }
  // SUM-20: summarized isn't hidden; this marks where the model's word-for-word window begins.
  const evicted = $derived(detail?.memory?.evictedThrough ?? 0);
  const firstVerbatim = $derived(evicted > 0 ? messages.find((m) => m.seq > evicted)?.seq ?? null : null);
  let knowsOpen = $state(false);

  const generating = $derived(Object.keys(gens).length > 0 || messages.some((m) => m.status === "streaming"));
  const lastMsg = $derived(messages.at(-1));
  const charName = $derived(detail?.character?.name ?? "Character");
  const personaName = $derived(detail?.persona?.name ?? "You");
  const styleClass = $derived(`style-${app.settings?.["appearance.chatStyle"] ?? "cards"}`);

  onMount(() => {
    app.currentChatId = id;
    openTrackers(id);
    reportPresence();
    // MEM-21: recall is warmed as the chat opens, so the first reply doesn't wait.
    void post(`/api/chats/${id}/warm`).catch(() => {});
    void loadTerms();
    const onHide = () => document.visibilityState === "hidden" && markSeen();
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      markSeen();
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
      regexScope.characterId = d.chat.characterId;
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
      if (!recapChecked) {
        recapChecked = true;
        void maybeRecap(d).finally(markSeen);
      }
      void loadBoundaries();
      void loadFlags();
      await tick();
      const at = Number(route.query.at);
      if (route.query.q) {
        searchQ = route.query.q;
        searchOpen = true;
      }
      if (at) void jumpTo(at);
      else if (route.query.m) void openCitation({ messageId: route.query.m, seq: null } as Citation);
      else scrollToBottom(false);
      refreshPreview();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
  $effect(() => {
    void load();
  });

  // A link to another message of this chat (?at= or ?m=) jumps there without reloading.
  let lastJump = `${route.query.at ?? ""}|${route.query.m ?? ""}`;
  $effect(() => {
    const key = `${route.query.at ?? ""}|${route.query.m ?? ""}`;
    if (!detail || key === lastJump || route.name !== "chat") return;
    lastJump = key;
    if (route.query.at) void jumpTo(Number(route.query.at));
    else if (route.query.m) void openCitation({ messageId: route.query.m, seq: null } as Citation);
  });

  async function loadFlags() {
    try {
      const r = await get<{ flags: ContinuityFlag[] }>(`/api/chats/${id}/continuity`);
      const next: Record<string, ContinuityFlag> = {};
      // Only the active swipe's notes matter.
      for (const f of r.flags) {
        const m = messages.find((x) => x.id === f.messageId);
        if (m && m.activeSwipe === f.swipeIdx && f.open > 0) next[f.messageId] = f;
      }
      flags = next;
    } catch {
      // notes are optional
    }
  }
  async function loadTerms() {
    try {
      terms = (await get<{ terms: GlossaryTerm[] }>(`/api/chats/${id}/glossary`)).terms;
    } catch {
      terms = [];
    }
  }
  /** Opens what a citation points at: a message, a memory, or a lore entry. */
  async function openCitation(c: Citation | ArchiveCitation) {
    const seq = c.seq ?? null;
    const messageId = c.messageId ?? null;
    if (messageId) {
      try {
        const r = await get<{ seq: number }>(`/api/messages/${messageId}/locate`);
        return void jumpTo(r.seq);
      } catch {
        // fall through to seq
      }
    }
    if (seq != null) return void jumpTo(seq);
    if (c.type === "lore" && "id" in c && c.id) {
      try {
        const r = await get<{ bookId: string }>(`/api/lore/entries/${c.id}/locate`);
        return navigate(`/lorebooks/${r.bookId}?entry=${c.id}`);
      } catch {
        return navigate("/lorebooks");
      }
    }
    navigate(`/chat/${id}/memory`);
  }

  async function loadBoundaries() {
    try {
      boundaries = (await get<{ boundaries: Boundary[] }>(`/api/chats/${id}/boundaries`)).boundaries;
    } catch {
      // dividers are optional
    }
  }

  /** Scrolls to a message by its number, loading older pages as needed (links from memory). */
  async function jumpTo(seq: number) {
    stick = false;
    for (let i = 0; i < 200 && hasMore && (messages[0]?.seq ?? 0) > seq; i++) {
      const page = await get<{ messages: Message[]; hasMore: boolean }>(`/api/chats/${id}/messages?before=${messages[0]!.seq}&limit=200`);
      messages = [...page.messages, ...messages];
      hasMore = page.hasMore;
    }
    await tick();
    const target = messages.find((m) => m.seq >= seq);
    const el = target && scroller?.querySelector(`[data-seq="${target.seq}"]`);
    if (el) {
      el.scrollIntoView({ block: "center" });
      highlight = target.seq;
      setTimeout(() => (highlight = null), 2600);
    }
  }

  const firstSeq = $derived(messages[0]?.seq ?? 0);
  const dividersAt = (seq: number) => (seq === firstSeq && !hasMore ? [] : boundaries.filter((b) => b.startSeq === seq && !(b.level === "scene" && boundaries.some((c) => c.level === "chapter" && c.startSeq === seq))));

  async function endScene(m: Message) {
    try {
      boundaries = (await post<{ boundaries: Boundary[] }>(`/api/messages/${m.id}/end-scene`)).boundaries;
      toast("Scene ended here. The next message starts a new one.", { kind: "ok" });
    } catch (e) {
      errorToast(e);
    }
  }

  async function newChapter(m: Message) {
    const title = await promptText({ title: "Start a new chapter here?", label: "Optional title (Mea writes one otherwise)", confirmLabel: "Start chapter" });
    if (title === null) return;
    try {
      boundaries = (await post<{ boundaries: Boundary[] }>(`/api/messages/${m.id}/new-chapter`)).boundaries;
      const ch = boundaries.find((b) => b.level === "chapter" && b.startSeq === m.seq);
      if (ch && title.trim()) await put(`/api/summaries/${ch.id}`, { title: title.trim() });
      void loadBoundaries();
      toast("New chapter", { kind: "ok" });
    } catch (e) {
      errorToast(e);
    }
  }

  async function showMemory(m: Message) {
    try {
      knows = { ...(await get<{ scene: Summary | null; atoms: Atom[]; inMemory: boolean }>(`/api/messages/${m.id}/memory`)), seq: m.seq };
      knowsOpen = true;
    } catch (e) {
      errorToast(e);
    }
  }

  /** A used-up quota is explained plainly; a paid reply happens only if you pick one (CONN-20). */
  function offerQuotaChoice(e: unknown, retry: (profileId: string) => Promise<void>) {
    if (!(e instanceof ApiError) || e.status !== 429) return false;
    const d = (e.details ?? {}) as { code?: string; alternatives?: { id: string; name: string; model: string }[] };
    if (e.code !== "quota_exhausted" && d.code !== "quota_exhausted") return false;
    quotaChoice = { message: e.message, alternatives: d.alternatives ?? [], retry };
    quotaOpen = true;
    return true;
  }

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
            // A smart retry (CONN-09) starts the reply over.
            if (e.reset) m.content = "";
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
        case "memory.changed":
          void loadBoundaries();
          break;
        case "continuity.changed":
          void loadFlags();
          break;
        case "trackers.changed":
          if (e.running) trk.running = true;
          else refreshTrackers(id);
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

  async function send(content: string, generate: boolean, director = false, profileId?: string): Promise<boolean> {
    stick = true;
    try {
      const r = await post<{ userMessage: Message | null; generationId?: string; messageId?: string }>(`/api/chats/${id}/send`, { content, generate, profileId, director: director || undefined });
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
      if (offerQuotaChoice(e, async (profileId) => void (await send("", true, false, profileId)))) {
        await load();
        return true;
      }
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
    const go = async (profileId?: string) => {
      const r = await post<{ generationId: string; messageId: string; swipeIdx: number }>(`/api/messages/${m.id}/swipe`, { feedback, profileId });
      gens[r.messageId] = r.generationId;
      stick = true;
    };
    try {
      await go();
    } catch (e) {
      if (!offerQuotaChoice(e, (p) => go(p).catch(errorToast))) errorToast(e);
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
    const go = async (profileId?: string) => {
      const r = await post<{ generationId: string; messageId: string }>(`/api/messages/${m.id}/continue`, { profileId });
      gens[r.messageId] = r.generationId;
      stick = true;
    };
    try {
      await go();
    } catch (e) {
      if (!offerQuotaChoice(e, (p) => go(p).catch(errorToast))) errorToast(e);
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

  /** CHAT-16: delete everything after this message, with undo. */
  async function rewind(m: Message) {
    try {
      const r = await post<{ deleted: string[] }>(`/api/messages/${m.id}/rewind`);
      if (!r.deleted.length) return;
      messages = messages.filter((x) => x.seq <= m.seq);
      refreshPreview();
      toast(`Rewound: ${r.deleted.length} message${r.deleted.length === 1 ? "" : "s"} moved to the trash`, {
        action: {
          label: "Undo",
          run: async () => {
            await post(`/api/chats/${id}/restore-messages`, { ids: r.deleted });
            await load();
          },
        },
      });
    } catch (e) {
      errorToast(e);
    }
  }

  function openStory() {
    dockTab = "story";
    localStorage.setItem("mea.dockTab", "story");
    if (app.isMobile) sheetOpen = true;
    else if (!panelOpen) togglePanel();
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
          <ModelSwitcher {detail} onchange={() => load()} />
          <button class="btn ghost icon" onclick={() => (searchOpen = !searchOpen)} aria-label="Search this chat" class:on={searchOpen}><Search size={18} /></button>
          <a class="btn ghost icon hide-sm" href="/chat/{id}/codex" aria-label="Codex: people, places, timeline" title="Codex"><Library size={18} /></a>
          <QuotaRing size={22} />
          <button class="btn ghost icon" onclick={togglePanel} aria-label="Chat settings" class:on={panelOpen && !app.isMobile}><PanelRight size={19} /></button>
        </div>
      </header>

      {#if searchOpen}
        <ChatSearch chatId={id} onclose={() => ((searchOpen = false), (searchQ = ""))} onjump={(seq, q) => ((searchQ = q), void jumpTo(seq))} />
      {/if}
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
            {#each dividersAt(m.seq) as b (b.id)}
              {#if b.level === "chapter"}
                <a class="divider chapter" href="/chat/{id}/memory" title={b.boundary ?? ""}>
                  <span class="orn">✿</span>
                  <span class="ctitle-div">{b.title || "A new chapter"}</span>
                  {#if b.storyTime}<span class="tiny muted">{b.storyTime}</span>{/if}
                </a>
              {:else}
                <a class="divider scene tiny" href="/chat/{id}/memory" title={b.boundary ?? ""}><span>{b.title || "· · ·"}</span></a>
              {/if}
            {/each}
            {#if firstVerbatim === m.seq && (messages[0]?.seq ?? 0) < m.seq}
              <div class="divider evict tiny" title="Messages above are still yours to read; the model gets them through the Story So Far and recalled memories.">
                <span>Above: remembered through summaries · Below: read word for word</span>
              </div>
            {/if}
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
              highlighted={highlight === m.seq}
              mark={searchOpen ? searchQ : ""}
              onendscene={m.id !== lastMsg?.id ? () => endScene(m) : undefined}
              onnewchapter={m.seq !== firstSeq || hasMore ? () => newChapter(m) : undefined}
              onmemory={() => showMemory(m)}
              chips={trk.chips[m.id] ?? []}
              storyTime={trk.times[m.id] ?? null}
              onrewind={() => rewind(m)}
              flag={flags[m.id] ?? null}
              onflagchange={(f) => {
                if (f && f.open > 0) flags[m.id] = f;
                else delete flags[m.id];
              }}
              oncite={openCitation}
              glossary={terms}
              onglossary={(t, at) => (glossPick = { t, x: Math.min(window.innerWidth - 300, Math.max(8, at.left)), y: at.bottom + 6 })}
              oncompare={async () => {
                compare = await get<Message>(`/api/messages/${m.id}`);
                compareOpen = true;
              }}
            />
          {/each}
          {#if !messages.length}
            <p class="muted center-text">No messages yet. Say hello ✿</p>
          {/if}
          {#if recap}
            <aside class="recap card" aria-label="Previously">
              <div class="row between"><b class="recap-title">Previously…</b><button class="btn ghost small" onclick={() => (recap = null)}>Dismiss</button></div>
              <p class="small">{recap.text}</p>
            </aside>
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
        <Hud onopen={openStory} />
        <Composer chatId={id} {detail} {generating} disabled={!hasModel} onsend={send} onstop={stop} oneditlast={editLastUser} onchange={() => load()} />
      </div>
    </div>

    {#if panelOpen && !app.isMobile}
      <aside class="dock">
        <div class="dock-tabs">
          <Segmented bind:value={dockTab} small options={dockOptions} onchange={(v) => localStorage.setItem("mea.dockTab", v)} />
        </div>
        {#if dockTab === "memory"}<MemoryPanel chatId={id} />{:else if dockTab === "story"}<TrackerPanel chatId={id} />{:else if dockTab === "world"}<WorldPanel chatId={id} />{:else if dockTab === "ask"}<ArchivistPanel chatId={id} onjump={openCitation} />{:else}<ChatPanel {detail} onchange={() => load()} oninspect={() => openInspector(null)} />{/if}
      </aside>
    {/if}
  </div>

  {#if app.isMobile}
    <Modal bind:open={sheetOpen} title="This chat">
      <div class="dock-tabs">
        <Segmented bind:value={dockTab} small options={dockOptions} onchange={(v) => localStorage.setItem("mea.dockTab", v)} />
      </div>
      {#if dockTab === "memory"}<MemoryPanel chatId={id} />{:else if dockTab === "story"}<TrackerPanel chatId={id} />{:else if dockTab === "world"}<WorldPanel chatId={id} />{:else if dockTab === "ask"}<ArchivistPanel chatId={id} onjump={(c) => ((sheetOpen = false), void openCitation(c))} />{:else}<ChatPanel {detail} onchange={() => load()} oninspect={() => ((sheetOpen = false), openInspector(null))} />{/if}
    </Modal>
  {/if}

  <Inspector bind:open={inspectorOpen} chatId={id} generationId={inspectGen} />

  <SelectionMenu chatId={id} root={scroller} idForSeq={(seq) => messages.find((x) => x.seq === seq)?.id ?? null} />

  {#if glossPick}
    <button class="gloss-scrim" onclick={() => (glossPick = null)} aria-label="Close"></button>
    <div class="gloss-pop card" style:left="{glossPick.x}px" style:top="{glossPick.y}px" role="dialog" aria-label={glossPick.t.title}>
      <div class="row"><b class="grow">{glossPick.t.title}</b>{#if glossPick.t.type}<span class="chip tiny">{glossPick.t.type}</span>{/if}</div>
      <p class="small">{glossPick.t.snippet}</p>
      <a class="tiny" href="/lorebooks/{glossPick.t.bookId}?entry={glossPick.t.entryId}">Open the entry</a>
    </div>
  {/if}

  <Modal bind:open={quotaOpen} title="Quota used up" size="sm">
    {#if quotaChoice}
      <div class="stack">
        <p>{quotaChoice.message}</p>
        {#if quotaChoice.alternatives.length}
          <p class="small muted">You can write this one reply with a pay-as-you-go model instead. It's billed to that key; nothing switches on its own.</p>
          {#each quotaChoice.alternatives as a (a.id)}
            <button class="btn" onclick={() => { quotaOpen = false; void quotaChoice?.retry(a.id); }}>Use {a.name} · {a.model}</button>
          {/each}
        {:else}
          <p class="small muted">Add a pay-as-you-go profile in Settings → Models if you want a way to keep writing until the reset.</p>
        {/if}
      </div>
    {/if}
    {#snippet footer()}<button class="btn ghost" onclick={() => (quotaOpen = false)}>Wait for the reset</button>{/snippet}
  </Modal>

  <Modal bind:open={knowsOpen} title="What memory knows from #{knows?.seq ?? ''}" size="md">
    {#if knows}
      <div class="stack">
        {#if !knows.inMemory}<p class="small muted">This message isn't in memory yet. Recent messages are recorded once the story moves past them.</p>{/if}
        {#if knows.scene}
          <div class="card knows">
            <div class="tiny muted">Scene · #{knows.scene.startSeq}–#{knows.scene.endSeq ?? "…"} · {knows.scene.state}</div>
            <b>{knows.scene.title || "Untitled scene"}</b>
            {#if knows.scene.content}<p class="small">{knows.scene.content}</p>{/if}
          </div>
        {/if}
        {#each knows.atoms as a (a.id)}
          <div class="card knows"><span class="chip">{a.type}</span> <span class="small">{a.content}</span></div>
        {:else}
          {#if knows.inMemory}<p class="small muted">No memories cite this message directly.</p>{/if}
        {/each}
        <a class="btn small" href="/chat/{id}/memory">Open memory</a>
      </div>
    {/if}
  </Modal>

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
  .gloss-scrim {
    position: fixed;
    inset: 0;
    z-index: 55;
    background: transparent;
    border: 0;
  }
  .gloss-pop {
    position: fixed;
    z-index: 56;
    width: min(290px, calc(100vw - 16px));
    padding: 0.6rem 0.7rem;
    display: grid;
    gap: 0.3rem;
    box-shadow: var(--shadow-2, 0 4px 18px rgb(0 0 0 / 0.15));
  }
  .gloss-pop p {
    margin: 0;
  }
  .column :global(.gloss) {
    text-decoration: underline dotted color-mix(in srgb, var(--accent) 60%, transparent);
    text-underline-offset: 3px;
    cursor: help;
  }
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
  .dock-tabs {
    margin-bottom: 1rem;
  }
  .divider {
    display: grid;
    justify-items: center;
    text-align: center;
    color: var(--text-muted);
    text-decoration: none !important;
    margin: 0.6rem 0;
  }
  .divider.chapter {
    gap: 0.15rem;
    padding: 1.4rem 0 0.8rem;
  }
  .ctitle-div {
    font-family: var(--font-display);
    font-variation-settings: "SOFT" 100;
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--text);
  }
  .divider.evict {
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 0.6rem;
    opacity: 0.75;
  }
  .divider.evict::before,
  .divider.evict::after {
    content: "";
    height: 1px;
    background: repeating-linear-gradient(90deg, var(--border) 0 6px, transparent 6px 10px);
  }
  .recap {
    margin: 1rem 0 0.5rem;
    padding: 0.8rem 1rem;
    background: color-mix(in srgb, var(--lavender) 22%, var(--surface));
    border: 1px solid color-mix(in srgb, var(--lavender) 60%, var(--border));
    animation: fade-up 0.4s var(--ease) both;
  }
  .recap p {
    margin: 0.4rem 0 0;
    white-space: pre-wrap;
  }
  .recap-title {
    font-family: var(--font-display);
    font-variation-settings: "SOFT" 100;
  }
  .divider.scene {
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 0.6rem;
  }
  .divider.scene::before,
  .divider.scene::after {
    content: "";
    height: 1px;
    background: var(--border);
  }
  .knows {
    padding: 0.6rem 0.8rem;
  }
  .knows p {
    margin: 0.3rem 0 0;
    white-space: pre-wrap;
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
