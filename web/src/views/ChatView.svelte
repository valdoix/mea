<script lang="ts">
  import { onMount, tick, untrack } from "svelte";
  import { regexScope } from "../lib/regex.svelte";
  import { storyStyle } from "../lib/storystyle.svelte";
  import Avatar from "../components/Avatar.svelte";
  import ChatPanel from "../components/chat/ChatPanel.svelte";
  import Composer from "../components/chat/Composer.svelte";
  import MemoryPanel from "../components/memory/MemoryPanel.svelte";
  import TrackerPanel from "../components/trackers/TrackerPanel.svelte";
  import WorldPanel from "../components/world/WorldPanel.svelte";
  import DisplayMenu from "../components/chat/DisplayMenu.svelte";
  import ChatSearch from "../components/chat/ChatSearch.svelte";
  import MeusPanel from "../components/chat/MeusPanel.svelte";
  import { meus, meusFor } from "../lib/meus.svelte";
  import { sugg, watchSuggestions } from "../lib/suggestions.svelte";
  import { watchFilings } from "../lib/filings.svelte";
  import { watchLessons } from "../lib/lessons.svelte";
  import { dockRequest, openDock, type DockTab } from "../lib/dock.svelte";
  import SelectionMenu from "../components/chat/SelectionMenu.svelte";
  import NotesPanel from "../components/notes/NotesPanel.svelte";
  import Scrubber from "../components/chat/Scrubber.svelte";
  import { delight } from "../lib/delight";
  import { lock } from "../lib/applock.svelte";
  import { cancelQueued, enqueueSend, outbox } from "../lib/outbox.svelte";
  import { openTrackers, refreshTrackers, trk } from "../lib/trackers.svelte";
  import Inspector from "../components/chat/Inspector.svelte";
  import MessageItem from "../components/chat/MessageItem.svelte";
  import Modal from "../components/Modal.svelte";
  import { ApiError, del, get, imageUrl, patch, post, put, storedMessage } from "../lib/api";
  import { confirm, promptText } from "../lib/dialogs.svelte";
  import { onEvent, reportPresence } from "../lib/events";
  import { ArrowDown, ArrowLeft, BookOpen, Brain, CloudRain, Globe, Heart, Library, MapPin, MessageCircle, MessagesSquare, Moon, NotebookPen, PanelLeft, PanelRight, Rows2, Scan, Search, SlidersHorizontal, Sun, Sunrise, Sunset } from "../lib/icons";
  import { DOCK_MIN, dockMax, layout, setDockWidth, setFocus, toggleDock, toggleRail } from "../lib/layout.svelte";
  import "../styles/studio.css";
  import { renderMessage } from "../lib/render";
  import { back, navigate, route } from "../lib/router.svelte";
  import { app, errorToast, saveSetting, toast } from "../lib/state.svelte";
  import { wreath } from "../lib/ornaments";
  import type { ArchiveCitation, Atom, Boundary, ChatDetail, Citation, CodexPage, ContinuityFlag, GlossaryTerm, Message, Profile, Summary } from "../lib/types";

  // The rooms' chapter flourishes: Wildflower's wreath, Marquee's bulbs, Citadel's maester chain.
  const WREATH = wreath();
  const BULBS_X = Array.from({ length: 16 }, (_, i) => i);
  const BULBS_Y = Array.from({ length: 4 }, (_, i) => i);
  const CHAIN = Array.from({ length: 27 }, (_, i) => i);

  let { id }: { id: string } = $props();

  let detail = $state<ChatDetail | null>(null);
  let recapChecked = false;
  let messages = $state<Message[]>([]);
  let hasMore = $state(false);
  let loadingOlder = $state(false);
  // M21: the view holds a window of pages. `hasMore`: older messages exist above it; `hasNewer`: the
  // window stops short of the live end, so streamed replies wait below and "Jump to latest" reloads it.
  let hasNewer = $state(false);
  let loadingNewer = $state(false);
  /** Which window is on screen: a page fetched for an earlier one is dropped. */
  let win = 0;
  let paging = false;
  let jumping = false;
  /** The chat's real last message, while the window doesn't hold it. */
  let liveEnd = $state<{ id: string; seq: number } | null>(null);
  /** Replies that finished below the window (MOB-10 unread count). */
  let outsideNew = $state<string[]>([]);
  const PAGE = 60;
  const WINDOW = 240;
  const JUMP_WINDOW = 100;
  let gens = $state<Record<string, string>>({});
  let hasModel = $state(true);
  const panelOpen = $derived(layout.dock && !layout.focus);
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
  // Meus took the Ask tab's place, so a remembered "ask" opens Meus.
  const savedDock = localStorage.getItem("mea.dockTab") === "ask" ? "meus" : localStorage.getItem("mea.dockTab");
  let dockTab = $state<DockTab>((["chat", "memory", "story", "world", "meus", "notes"].includes(savedDock ?? "") ? savedDock : "chat") as DockTab);
  const dockOptions = [
    { value: "chat" as const, label: "Chat", icon: SlidersHorizontal },
    { value: "memory" as const, label: "Memory", icon: Brain },
    { value: "story" as const, label: "Story", icon: Heart },
    { value: "world" as const, label: "World", icon: Globe },
    { value: "meus" as const, label: "Meus", icon: MessagesSquare },
    { value: "notes" as const, label: "Notes", icon: NotebookPen },
  ];
  // P1: suggestions waiting in the Inbox for this chat, as a badge on the Chat tab.
  $effect(() => watchSuggestions(id));
  $effect(() => watchFilings(id));
  $effect(() => watchLessons(id));
  function pickDock(v: DockTab) {
    dockTab = v;
    localStorage.setItem("mea.dockTab", v);
  }
  // The side panel resizes from a grip on its left edge; the width is remembered on this device.
  let resizing = $state(false);
  let gripX = 0;
  let gripW = 0;
  const dockWidth = () => layout.dockW ?? (parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--dock-w")) || 380);
  function gripDown(e: PointerEvent) {
    if (e.button) return;
    const aside = (e.currentTarget as HTMLElement).parentElement!;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    gripX = e.clientX;
    gripW = aside.getBoundingClientRect().width;
    resizing = true;
  }
  function gripMove(e: PointerEvent) {
    if (!resizing) return;
    setDockWidth(gripW + (gripX - e.clientX), false);
  }
  function gripUp() {
    if (!resizing) return;
    resizing = false;
    setDockWidth(layout.dockW);
  }
  function gripKey(e: KeyboardEvent) {
    const d = e.key === "ArrowLeft" ? 24 : e.key === "ArrowRight" ? -24 : 0;
    if (d) {
      e.preventDefault();
      setDockWidth(dockWidth() + d);
    } else if (e.key === "Home" || e.key === "Escape") setDockWidth(null);
  }
  // Phase 3: continuity notes per message (CON-02), glossary terms (LORE-15).
  let flags = $state<Record<string, ContinuityFlag>>({});
  let terms = $state<GlossaryTerm[]>([]);
  let glossPick = $state<{ t: GlossaryTerm; x: number; y: number; who?: CodexPage | null } | null>(null);
  /** LORE-15 lore terms, and UI-11 who's-who cards for people and places. */
  async function pickTerm(t: GlossaryTerm, at: DOMRect) {
    const pos = { x: Math.min(window.innerWidth - 310, Math.max(8, at.left)), y: Math.min(window.innerHeight - 260, at.bottom + 6) };
    if (!t.entryId.startsWith("entity:")) return void (glossPick = { t, ...pos });
    glossPick = { t, ...pos, who: null };
    try {
      const page = await get<CodexPage>(`/api/codex/${t.entryId.slice(7)}`);
      if (glossPick?.t === t) glossPick = { ...glossPick, who: page };
    } catch {
      // the short card still shows
    }
  }
  const tieWithYou = (p: CodexPage) => p.ties.find((x) => x.other && personaName && x.other.toLowerCase() === personaName.toLowerCase());
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
  /** The chat's last message, only when the window reaches it. */
  const lastMsg = $derived(hasNewer ? undefined : messages.at(-1));
  const endSeq = $derived(hasNewer ? Math.max(liveEnd?.seq ?? 0, messages.at(-1)?.seq ?? 0) : (messages.at(-1)?.seq ?? 0));
  const endId = $derived(hasNewer ? (liveEnd?.id ?? null) : (lastMsg?.id ?? null));
  $effect(() => {
    if (lastMsg) liveEnd = { id: lastMsg.id, seq: lastMsg.seq };
  });
  const charName = $derived(detail?.character?.name ?? "Character");
  // UI-08: the chat's ambience: accent from the portrait, art behind the story.
  const amb = $derived(detail?.chat.settings.ambience ?? {});
  const ambAccent = $derived(amb.accent && detail?.character?.palette?.[0] ? detail.character.palette[0] : undefined);
  const personaName = $derived(detail?.persona?.name ?? "You");
  const styleClass = $derived(`style-${app.settings?.["appearance.chatStyle"] ?? "cards"}`);
  // L-quotes: the story's quote style shows on every message, not only replies written after it was set.
  $effect(() => {
    const q = detail?.chat.settings.style?.quotes || detail?.defaults?.characterStyle?.quotes;
    storyStyle.quotes = q === "curly" || q === "straight" ? q : null;
  });

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
      storyStyle.quotes = null;
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
      win++;
      messages = page.messages;
      hasMore = page.hasMore;
      hasNewer = false;
      outsideNew = [];
      hasModel = profiles.profiles.some((p) => p.connectionId && p.modelId);
      applyActive(d);
      if (!recapChecked) {
        recapChecked = true;
        void maybeRecap(d).finally(markSeen);
      }
      void loadBoundaries();
      void loadFlags();
      void loadHighlights();
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
  // Loads once per chat: a link within it (?at=, ?m=) changes the route but not the chat, so it only
  // jumps (below) instead of reloading the end and then jumping as well (M21).
  const chatKey = $derived(id);
  $effect(() => {
    void chatKey;
    untrack(() => void load());
  });

  /** Replies being written right now, from the chat's detail: their text so far, and their generation. */
  function applyActive(d: ChatDetail) {
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
  }

  /**
   * M37: back from a dropped connection (an app switch on a phone): fetch only the end of the chat and
   * merge it in, keeping the older pages you loaded and your place.
   */
  async function catchUp() {
    if (!detail || !messages.length) return void load();
    // M21: reading further back, the end isn't on screen: refresh what's going on, append nothing.
    if (hasNewer) {
      try {
        const d = await get<ChatDetail>(`/api/chats/${id}`);
        detail = d;
        applyActive(d);
        void loadBoundaries();
        void loadFlags();
        refreshPreview();
      } catch {
        // the next reconnect tries again
      }
      return;
    }
    try {
      // The last few are read again too: they may have been edited, swiped or deleted meanwhile.
      const from = messages[Math.max(0, messages.length - 10)]!.seq - 1;
      const [d, page] = await Promise.all([get<ChatDetail>(`/api/chats/${id}`), get<{ messages: Message[]; hasMore: boolean }>(`/api/chats/${id}/messages?after=${from}&limit=200`)]);
      if (page.hasMore) return void load();
      detail = d;
      gens = {};
      const fresh = new Set(page.messages.map((m) => m.id));
      messages = messages.filter((m) => m.seq <= from || fresh.has(m.id));
      for (const m of page.messages) upsert(m);
      applyActive(d);
      void loadBoundaries();
      void loadFlags();
      refreshPreview();
    } catch {
      // the next reconnect tries again
    }
  }

  // A link to another message of this chat (?at= or ?m=) jumps there without reloading.
  let lastJump = `${route.query.at ?? ""}|${route.query.m ?? ""}`;
  $effect(() => {
    const key = `${route.query.at ?? ""}|${route.query.m ?? ""}`;
    if (!detail || key === lastJump || route.name !== "chat") return;
    lastJump = key;
    if (route.query.at) void jumpTo(Number(route.query.at));
    else if (route.query.m) void openCitation({ messageId: route.query.m, seq: null } as Citation);
  });

  // UI-10: the scrubber's marks (chapters, bookmarks, highlights) and where the view is.
  let momentMarks = $state<{ seq: number; kind: "bookmark" | "highlight"; title: string }[]>([]);
  const scrubMarks = $derived([
    ...boundaries.filter((b) => b.level === "chapter").map((b) => ({ seq: b.startSeq, kind: "chapter" as const, title: b.title || "A new chapter" })),
    ...momentMarks,
  ]);
  let viewSeq = $state(0);
  let viewRaf = 0;
  function trackView() {
    cancelAnimationFrame(viewRaf);
    viewRaf = requestAnimationFrame(() => {
      if (!scroller) return;
      const top = scroller.getBoundingClientRect().top + 8;
      for (const el of scroller.querySelectorAll<HTMLElement>("article.msg")) {
        if (el.getBoundingClientRect().bottom > top) {
          viewSeq = Number(el.dataset.seq) || viewSeq;
          return;
        }
      }
    });
  }
  // MOB-10: replies that arrived while you were reading further up.
  let seenSeq = $state(0);
  $effect(() => {
    if (stick) seenSeq = lastMsg?.seq ?? 0;
  });
  const unread = $derived(stick ? 0 : messages.filter((m) => m.seq > seenSeq && m.role === "assistant" && m.status !== "streaming").length + outsideNew.length);

  // QOL-02: passages you highlighted, marked in their messages.
  let passages = $state<Record<string, string[]>>({});
  async function loadHighlights() {
    void get<{ moments: { kind: "bookmark" | "highlight"; seq: number; text: string }[] }>(`/api/moments?chat=${id}`).then(
      (r) => (momentMarks = r.moments.map((m) => ({ seq: m.seq, kind: m.kind, title: m.text.replace(/\s+/g, " ").slice(0, 60) }))),
      () => {},
    );
    try {
      const r = await get<{ highlights: { messageId: string; text: string }[] }>(`/api/chats/${id}/highlights`);
      const next: Record<string, string[]> = {};
      for (const h of r.highlights) (next[h.messageId] ??= []).push(h.text);
      passages = next;
    } catch {
      // optional
    }
  }

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
      const [g, n] = await Promise.all([
        get<{ terms: GlossaryTerm[] }>(`/api/chats/${id}/glossary`),
        get<{ names: { name: string; kind: string; hint?: string; entityId?: string }[] }>(`/api/chats/${id}/names`).catch(() => ({ names: [] })),
      ]);
      // UI-11: people and places from memory become tappable too (you aren't).
      const have = new Set(g.terms.map((t) => t.term.toLowerCase()));
      const people = n.names
        .filter((x) => x.entityId && x.hint !== "you" && x.name.length >= 3 && !have.has(x.name.toLowerCase()))
        .map((x) => ({ term: x.name, entryId: `entity:${x.entityId}`, bookId: "", title: x.name, type: x.kind, snippet: x.hint ?? "" }));
      terms = [...g.terms, ...people];
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
    // A1: a lesson opens the Story tab's Lessons.
    if (c.type === "lesson") return openDock("story", "lessons");
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

  /**
   * Scrolls to a message by its number (links from memory, search, the scrubber). M21: a message
   * outside the window swaps in one window around it instead of every page down to the end.
   */
  async function jumpTo(seq: number) {
    stick = false;
    const first = messages[0]?.seq ?? 0;
    const last = messages.at(-1)?.seq ?? 0;
    const inside = messages.length > 0 && (seq >= first || !hasMore) && (seq <= last || !hasNewer);
    jumping = true;
    try {
      if (!inside) {
        const mine = ++win;
        const page = await get<{ messages: Message[]; hasMore: boolean; hasNewer: boolean }>(`/api/chats/${id}/messages?around=${seq}&limit=${JUMP_WINDOW}`);
        if (mine !== win) return;
        messages = page.messages;
        hasMore = page.hasMore;
        hasNewer = page.hasNewer;
        if (!hasNewer) outsideNew = [];
      }
      await tick();
      const target = messages.find((m) => m.seq >= seq) ?? messages.at(-1);
      const el = target && scroller?.querySelector(`[data-seq="${target.seq}"]`);
      if (el) {
        el.scrollIntoView({ block: "center" });
        highlight = target.seq;
        setTimeout(() => (highlight = null), 2600);
      }
    } catch (e) {
      errorToast(e);
    } finally {
      // The scroll the jump itself caused shouldn't page; the next one may.
      requestAnimationFrame(() => {
        jumping = false;
        void onScroll();
      });
    }
  }

  /** "Jump to latest": back to the end of the chat, reloading it when the window stops short of it. */
  async function showLatest(smooth = true) {
    if (!hasNewer) {
      stick = true;
      scrollToBottom(smooth);
      return;
    }
    const mine = ++win;
    jumping = true;
    try {
      const [d, page] = await Promise.all([get<ChatDetail>(`/api/chats/${id}`), get<{ messages: Message[]; hasMore: boolean }>(`/api/chats/${id}/messages?limit=${PAGE}`)]);
      if (mine !== win) return;
      detail = d;
      messages = page.messages;
      hasMore = page.hasMore;
      hasNewer = false;
      outsideNew = [];
      applyActive(d);
      stick = true;
      await tick();
      scrollToBottom(false);
    } catch (e) {
      errorToast(e);
    } finally {
      requestAnimationFrame(() => (jumping = false));
    }
  }

  const firstSeq = $derived(messages[0]?.seq ?? 0);
  const dividersAt = (seq: number) =>
    boundaries.filter((b) => b.startSeq === seq && !(b.level === "scene" && ((seq === firstSeq && !hasMore) || boundaries.some((c) => c.level === "chapter" && c.startSeq === seq))));
  // Lantern: chapters are numbered, and each knows how many scenes it holds.
  const chapters = $derived(boundaries.filter((b) => b.level === "chapter").sort((a, b) => a.startSeq - b.startSeq));
  const openingChapter = $derived(!hasMore && chapters.some((c) => c.startSeq === firstSeq));
  function roman(n: number) {
    const map: [number, string][] = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
    let out = "";
    for (const [v, r] of map) while (n >= v) ((out += r), (n -= v));
    return out;
  }
  function chapterInfo(b: Boundary) {
    const i = chapters.findIndex((c) => c.id === b.id);
    const next = chapters[i + 1]?.startSeq ?? Infinity;
    const scenes = boundaries.filter((x) => x.level === "scene" && x.startSeq >= b.startSeq && x.startSeq < next).length;
    return { n: roman(i + 1), scenes };
  }
  /** A little picture for a scene, from when and where it happens. */
  function sceneIcon(b: Boundary) {
    const t = `${b.title} ${b.storyTime ?? ""}`.toLowerCase();
    if (/rain|storm|gale|snow|thunder|fog|mist/.test(t)) return CloudRain;
    if (/dawn|sunrise|morning/.test(t)) return Sunrise;
    if (/dusk|sunset|evening/.test(t)) return Sunset;
    if (/night|midnight|moon|dark|bell/.test(t)) return Moon;
    if (/noon|afternoon|day|sun/.test(t)) return Sun;
    return MapPin;
  }
  const hud = $derived(trk.data?.hud && trk.data.config.mode !== "off" ? trk.data.hud : "");
  const chatStyle = $derived(app.settings?.["appearance.chatStyle"] ?? "cards");

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
      // M21: a message outside the window isn't added; one past its end waits for "Jump to latest".
      if (hasNewer && m.seq > (messages.at(-1)?.seq ?? 0)) return void noteOutside(m);
      if (hasMore && m.seq < (messages[0]?.seq ?? 0)) return;
      messages.push(m);
      messages.sort((a, b) => a.seq - b.seq);
    }
  }

  function noteOutside(m: Message) {
    if (!liveEnd || m.seq >= liveEnd.seq) liveEnd = { id: m.id, seq: m.seq };
    if (m.role === "assistant" && m.status !== "streaming" && m.seq > seenSeq && !outsideNew.includes(m.id)) outsideNew = [...outsideNew, m.id];
  }

  $effect(() =>
    onEvent((e) => {
      if (e.type === "reconnected") {
        void catchUp();
        return;
      }
      if (!("chatId" in e) || e.chatId !== id) return;
      switch (e.type) {
        case "gen.start": {
          gens[e.messageId] = e.generationId;
          const m = messages.find((x) => x.id === e.messageId);
          // M21: the window stops short of the end: the reply streams below it, unseen.
          if (!m && hasNewer) break;
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
            // A smart retry (CONN-09) or the plan watch starts the reply over.
            if (e.reset) {
              m.content = "";
              m.reasoning = null;
            }
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

  /**
   * Changes the window without moving what you're reading: a message on screen is the anchor, and
   * the scroll position follows it as pages are added or dropped above.
   */
  async function keepPlace(change: () => void) {
    const anchor = scroller ? [...scroller.querySelectorAll<HTMLElement>("article.msg")].find((el) => el.getBoundingClientRect().bottom > scroller!.getBoundingClientRect().top + 8) : undefined;
    const seq = anchor?.dataset.seq;
    const before = anchor?.getBoundingClientRect().top ?? 0;
    change();
    await tick();
    const after = seq && scroller?.querySelector<HTMLElement>(`article.msg[data-seq="${seq}"]`);
    if (scroller && after) scroller.scrollTop += after.getBoundingClientRect().top - before;
  }

  async function onScroll() {
    if (!scroller) return;
    trackView();
    const fromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    stick = !hasNewer && fromBottom < 140;
    if (paging || jumping || !messages.length) return;
    // M21: pinned to the latest for a long while, the oldest pages are let go (they load again on the way up).
    if (stick && messages.length > WINDOW + PAGE) {
      const start = trimStart(messages);
      if (start > 0)
        await keepPlace(() => {
          messages = messages.slice(start);
          hasMore = true;
        });
      return;
    }
    if (scroller.scrollTop < 400 && hasMore) await pageOlder();
    else if (fromBottom < 400 && hasNewer) await pageNewer();
  }

  /**
   * Messages that must stay mounted however far away they are: one being edited, one holding the
   * text selection, or one with focus inside (an open menu). The window grows past WINDOW meanwhile.
   */
  function pinnedSeqs() {
    const pinned = new Set<number>();
    if (!scroller) return pinned;
    const add = (el: Element | null | undefined) => {
      const seq = Number((el?.closest("article.msg") as HTMLElement | null)?.dataset.seq);
      if (seq) pinned.add(seq);
    };
    for (const el of scroller.querySelectorAll("article.msg.editing")) add(el);
    if (document.activeElement && scroller.contains(document.activeElement)) add(document.activeElement);
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) {
      for (let i = 0; i < sel.rangeCount; i++) {
        const r = sel.getRangeAt(i);
        for (const el of scroller.querySelectorAll("article.msg")) if (r.intersectsNode(el)) add(el);
      }
    }
    return pinned;
  }
  /** Where to cut the top so about WINDOW remain, never above a pinned message. */
  function trimStart(list: Message[]) {
    let start = Math.max(0, list.length - WINDOW);
    if (!start) return 0;
    const pinned = pinnedSeqs();
    const i = list.findIndex((m) => pinned.has(m.seq));
    if (i >= 0) start = Math.min(start, i);
    return start;
  }
  /** Where to cut the bottom so about WINDOW remain, never below a pinned message. */
  function trimEnd(list: Message[]) {
    if (list.length <= WINDOW) return list.length;
    const pinned = pinnedSeqs();
    const i = list.findLastIndex((m) => pinned.has(m.seq));
    return Math.max(WINDOW, i + 1);
  }

  /** An older page on top; past the window's size, the newest pages (far below the view) are let go. */
  async function pageOlder() {
    const mine = win;
    paging = true;
    loadingOlder = true;
    try {
      const page = await get<{ messages: Message[]; hasMore: boolean }>(`/api/chats/${id}/messages?before=${messages[0]!.seq}&limit=${PAGE}`);
      if (mine !== win) return;
      await keepPlace(() => {
        const next = [...page.messages, ...messages];
        hasMore = page.hasMore;
        const end = trimEnd(next);
        if (end < next.length) {
          next.length = end;
          hasNewer = true;
          stick = false;
        }
        messages = next;
      });
    } catch {
      // the next scroll tries again
    } finally {
      paging = false;
      loadingOlder = false;
    }
  }

  /** A newer page below; past the window's size, the oldest pages (far above the view) are let go. */
  async function pageNewer() {
    const mine = win;
    paging = true;
    loadingNewer = true;
    try {
      const last = messages.at(-1)!.seq;
      const page = await get<{ messages: Message[]; hasMore: boolean }>(`/api/chats/${id}/messages?after=${last}&limit=${PAGE}`);
      if (mine !== win) return;
      await keepPlace(() => {
        let next = [...messages, ...page.messages.filter((m) => m.seq > last)];
        const start = trimStart(next);
        if (start > 0) {
          next = next.slice(start);
          hasMore = true;
        }
        messages = next;
        hasNewer = page.hasMore;
        if (!hasNewer) outsideNew = [];
      });
    } catch {
      // the next scroll tries again
    } finally {
      paging = false;
      loadingNewer = false;
    }
  }

  async function send(content: string, generate: boolean, director = false, profileId?: string): Promise<boolean> {
    // M21: a message goes at the end, so the end comes back on screen first.
    if (hasNewer) await showLatest(false);
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
      // M38: only a message the server says it kept leaves the composer; otherwise the text comes back.
      const stored = storedMessage(e);
      if ((stored || !content.trim()) && offerQuotaChoice(e, async (profileId) => void (await send("", true, false, profileId)))) {
        await load();
        return true;
      }
      // ARCH-11 / MOB-13: Mea can't be reached: the message waits on this device and goes out when it's back.
      if (e instanceof ApiError && e.status === 0 && content.trim()) {
        enqueueSend(id, content, director);
        toast("Mea can't be reached. Your message will be sent when it's back.", { kind: "info" });
        return true;
      }
      if (e instanceof ApiError && e.status !== 0) {
        if (stored) await load();
        toast(e.message, { kind: "error", action: !hasModel ? { label: "Set up a model", run: () => navigate("/settings/models") } : undefined });
        return stored;
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

  /** Deletes the version on screen for good; the others stay. */
  async function removeSwipe(m: Message) {
    const idx = m.activeSwipe;
    if (!(await confirm({ title: `Delete version ${idx + 1} of ${m.swipeCount}?`, message: "This version is gone for good. The others stay.", confirmLabel: "Delete", danger: true }))) return;
    try {
      upsert(await del<Message>(`/api/messages/${m.id}/swipes/${idx}`));
      refreshPreview();
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
      // The rewound message is the new end, so the window reaches it.
      hasNewer = false;
      outsideNew = [];
      liveEnd = { id: m.id, seq: m.seq };
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

  // P1: a Status tile or a chip asked for a tab.
  $effect(() => {
    if (!dockRequest.seq || !dockRequest.tab) return;
    const tab = dockRequest.tab;
    untrack(() => {
      pickDock(tab);
      if (app.isMobile) sheetOpen = true;
      else if (!layout.dock) toggleDock();
    });
  });

  function openStory() {
    pickDock("story");
    if (app.isMobile) sheetOpen = true;
    else if (!layout.dock) toggleDock();
  }

  async function flag(m: Message, flags: { hidden?: boolean; bookmarked?: boolean }) {
    try {
      upsert(await patch<Message>(`/api/messages/${m.id}`, flags));
      if (flags.bookmarked !== undefined) {
        void loadHighlights();
        if (flags.bookmarked) {
          const r = scroller?.querySelector(`[data-seq="${m.seq}"]`)?.getBoundingClientRect();
          delight("heart", r ? { x: r.left + 40, y: r.top + 30 } : undefined);
        }
      }
      if (flags.hidden !== undefined) {
        toast(flags.hidden ? "Hidden from the prompt (still visible here)" : "Included in the prompt again");
        refreshPreview();
      }
    } catch (e) {
      errorToast(e);
    }
  }

  function editLastUser() {
    if (hasNewer) return;
    const m = [...messages].reverse().find((x) => x.role === "user");
    if (m) editSignals[m.id] = (editSignals[m.id] ?? 0) + 1;
  }

  function onkey(e: KeyboardEvent) {
    if (e.key === "Escape" && glossPick) {
      glossPick = null;
      return;
    }
    if (e.key === "Escape" && layout.focus) {
      setFocus(false);
      return;
    }
    if (!lastMsg || lastMsg.role !== "assistant") return;
    // M39: Option/Alt+arrows move by word in a text field; a dialog or the lock has the keyboard.
    const t = e.target as HTMLElement | null;
    if (t?.closest?.("input, textarea, select, [contenteditable]:not([contenteditable='false'])") || document.querySelector("[aria-modal='true']") || lock.locked) return;
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

  // "Ask Meus" from anywhere in the chat opens its tab.
  let meusWant = meus.want;
  function openMeusTab() {
    pickDock("meus");
    if (app.isMobile) sheetOpen = true;
    else {
      if (layout.focus) setFocus(false);
      if (!layout.dock) toggleDock();
    }
  }
  $effect(() => {
    if (meus.want === meusWant) return;
    meusWant = meus.want;
    openMeusTab();
  });
  // …and from other pages (the inbox, Cast, the Codex, the command palette), once this chat is open.
  $effect(() => {
    if (!meusFor.chatId || meusFor.chatId !== id) return;
    meusFor.chatId = "";
    openMeusTab();
  });

  function togglePanel() {
    if (app.isMobile) sheetOpen = true;
    else {
      if (layout.focus) setFocus(false);
      toggleDock();
    }
  }

  function openInspector(genId: string | null) {
    inspectGen = genId;
    inspectorOpen = true;
  }

</script>

<svelte:window onkeydown={onkey} />

{#if error}
  <div class="center"><div class="stack" style="text-align:center"><h2>Couldn't open this chat</h2><p class="muted">{error}</p><a href="/">Back home</a></div></div>
{:else if detail}
  <div class="chat" class:with-panel={panelOpen && !app.isMobile} class:focus={layout.focus} class:art={Boolean(amb.imageId)} style:--accent={ambAccent} style:--panel="{Math.round((amb.panel ?? 0.86) * 100)}%" style:--dock-w={layout.dockW ? `${layout.dockW}px` : undefined}>
    <div class="main-col">
      <header class="bar" class:compact={layout.focus}>
        {#if app.isMobile}
          <button class="btn ghost icon" onclick={() => back("/")} aria-label="Back"><ArrowLeft size={20} /></button>
        {/if}
        <div class="who">
          <a class="pic" href={detail.character ? `/character/${detail.character.id}` : "/"} aria-label="{charName}'s page">
            <Avatar id={detail.character?.avatarId} name={charName} size={app.isMobile ? 40 : layout.focus ? 42 : 58} palette={detail.character?.palette ?? []} />
          </a>
          <div class="grow names">
            <a class="cname truncate" href={detail.character ? `/character/${detail.character.id}` : "/"}>{charName}<em class="ctitle hide-sm"> · {detail.chat.title}</em></a>
            {#if !layout.focus && (hud || detail.chat.mode === "narrator" || trk.running)}
              <button class="sub" onclick={openStory} title="Story state: open the Story panel">
                {#if detail.chat.mode === "narrator"}<span class="chip lavender">Narrator</span>{/if}
                {#if trk.running}<span class="live" aria-label="Reading the latest reply"></span>{/if}
                {#if hud}<span class="hudline truncate">{hud}</span>{/if}
              </button>
            {/if}
          </div>
        </div>
        <div class="row tools">
          {#if !layout.focus}
            <div class="styles hide-sm" role="radiogroup" aria-label="Chat style">
              <button role="radio" aria-checked={chatStyle === "cards"} class:on={chatStyle === "cards"} onclick={() => saveSetting("appearance.chatStyle", "cards")} title="Cards"><Rows2 size={15} /> Cards</button>
              <button role="radio" aria-checked={chatStyle === "book"} class:on={chatStyle === "book"} onclick={() => saveSetting("appearance.chatStyle", "book")} title="Book"><BookOpen size={15} /> Book</button>
              <button role="radio" aria-checked={chatStyle === "bubbles"} class:on={chatStyle === "bubbles"} onclick={() => saveSetting("appearance.chatStyle", "bubbles")} title="Bubbles"><MessageCircle size={15} /> Bubbles</button>
            </div>
            <span class="sep hide-sm"></span>
            <button class="btn ghost icon" onclick={() => (searchOpen = !searchOpen)} aria-label="Search this chat" title="Search this chat" class:on={searchOpen}><Search size={18} /></button>
            <a class="btn ghost icon hide-sm" href="/chat/{id}/codex" aria-label="Codex: people, places, timeline" title="Codex"><Library size={18} /></a>
            <a class="btn ghost icon" href="/chat/{id}/read" aria-label="Reading mode" title="Read it as a book"><BookOpen size={18} /></a>
            <DisplayMenu />
            <span class="sep hide-sm"></span>
            {#if app.shell === "lantern" && !app.isMobile}
              <button class="btn ghost icon" onclick={() => toggleRail(true)} class:on={layout.railChat} aria-label={layout.railChat ? "Hide navigation" : "Show navigation"} title={layout.railChat ? "Hide navigation" : "Show navigation"}><PanelLeft size={18} /></button>
            {/if}
            <button class="btn ghost icon" onclick={togglePanel} aria-label={app.isMobile ? "Memory, story and world" : panelOpen ? "Hide the side panel" : "Show the side panel"} title={panelOpen && !app.isMobile ? "Hide the side panel" : "Memory, story, world and notes"} class:on={panelOpen && !app.isMobile}><PanelRight size={18} /></button>
          {/if}
          {#if layout.focus}
            <button class="btn small leave" onclick={() => setFocus(false)}><span class="spark">✦</span> Leave focus</button>
          {:else}
            <button class="btn ghost icon" onclick={() => setFocus(true)} aria-label="Focus on the story" title="Focus on the story: hide everything else"><Scan size={18} /></button>
          {/if}
        </div>
      </header>

      {#if searchOpen}
        <ChatSearch chatId={id} onclose={() => ((searchOpen = false), (searchQ = ""))} onjump={(seq, q) => ((searchQ = q), void jumpTo(seq))} />
      {/if}
      {#if amb.imageId}
        <div class="ambience" aria-hidden="true">
          <div class="art-img" style:background-image="url({imageUrl(amb.imageId, app.dataLight ? 'm' : 'l')})" style:filter="blur({amb.blur ?? 6}px)"></div>
          <div class="art-dim" style:background="rgb(0 0 0 / {amb.dim ?? 0.25})"></div>
          {#if amb.vignette !== false}<div class="art-vignette"></div>{/if}
        </div>
      {/if}
      <div class="scroller" bind:this={scroller} onscroll={onScroll}>
        <div class="column {styleClass}">
          {#if hasMore}
            <div class="older tiny muted">{loadingOlder ? "Loading earlier messages…" : "Scroll up for earlier messages"}</div>
          {:else}
            {#if !openingChapter}
              <div class="start">
                <span class="orn-line"><span></span><i>✿</i><span></span></span>
                <span class="begins">The story of {charName} and {personaName} begins</span>
              </div>
            {/if}
          {/if}
          {#each messages as m (m.id)}
            {#each dividersAt(m.seq) as b (b.id)}
              {#if b.level === "chapter"}
                {@const info = chapterInfo(b)}
                <a class="chapter-h" href="/chat/{id}/memory" title="Open this chapter in memory">
                  <span class="orn-line"><span></span><i>{app.theme === "citadel" ? "❧" : "✦"}</i><span></span></span>
                  {#if app.theme === "wildflower"}{@html WREATH}{:else if app.theme === "overprint"}<span class="o-big" aria-hidden="true">{info.n}</span>{:else if app.theme === "marquee"}<span class="m-bulbs t" aria-hidden="true">{#each BULBS_X as i (i)}<i></i>{/each}</span><span class="m-bulbs b" aria-hidden="true">{#each BULBS_X as i (i)}<i></i>{/each}</span><span class="m-bulbs l" aria-hidden="true">{#each BULBS_Y as i (i)}<i></i>{/each}</span><span class="m-bulbs r" aria-hidden="true">{#each BULBS_Y as i (i)}<i></i>{/each}</span>{/if}
                  <span class="ch-num">Chapter <b>{info.n}</b></span>
                  <span class="ch-title">{b.title || (b.startSeq === firstSeq && !hasMore ? "The beginning" : "A new chapter")}</span>
                  {#if b.storyTime || info.scenes}
                    <span class="ch-meta">
                      {#if b.storyTime}<span>{b.storyTime}</span>{/if}
                      {#if b.storyTime && info.scenes}<i></i>{/if}
                      {#if info.scenes}<span>{info.scenes} scene{info.scenes === 1 ? "" : "s"}</span>{/if}
                    </span>
                  {/if}
                  {#if app.theme === "citadel"}<span class="c-chain" aria-hidden="true">{#each CHAIN as i (i)}<i></i>{/each}</span>{/if}
                </a>
              {:else}
                {@const Icon = sceneIcon(b)}
                <a class="scene-h" href="/chat/{id}/memory" title="Open this scene in memory">
                  <span class="sc-line"></span>
                  <span class="sc-body">
                    <span class="sc-ic"><Icon size={14} /></span>
                    <span class="sc-text"><b>{b.title || "A new scene"}</b>{#if b.storyTime}<span>{b.storyTime}</span>{/if}</span>
                  </span>
                  <span class="sc-line"></span>
                </a>
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
              ondeleteswipe={() => removeSwipe(m)}
              onflag={(f) => flag(m, f)}
              oninspect={() => openInspector(m.meta?.generationId ?? null)}
              highlighted={highlight === m.seq}
              mark={searchOpen ? searchQ : ""}
              passages={passages[m.id] ?? []}
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
              onglossary={(t, at) => void pickTerm(t, at)}
              oncompare={async () => {
                compare = await get<Message>(`/api/messages/${m.id}`);
                compareOpen = true;
              }}
            />
          {/each}
          {#if !messages.length}
            <p class="muted center-text">No messages yet. Say hello ✿</p>
          {/if}
          {#if hasNewer}
            <div class="older newer tiny muted">{loadingNewer ? "Loading later messages…" : "Scroll down for later messages"}</div>
          {/if}
          {#each hasNewer ? [] : outbox.items.filter((q) => q.chatId === id) as q (q.id)}
            <div class="queued" aria-label="Waiting to send">
              <p class="prose small">{q.content}</p>
              <div class="row tiny muted"><span class="grow">Waiting to send, when Mea is reachable</span><button class="btn ghost small" onclick={() => cancelQueued(q.id)}>Cancel</button></div>
            </div>
          {/each}
          {#if recap && !hasNewer}
            <aside class="recap card" aria-label="Previously">
              <div class="row between"><b class="recap-title">Previously…</b><button class="btn ghost small" onclick={() => (recap = null)}>Dismiss</button></div>
              <p class="small">{recap.text}</p>
            </aside>
          {/if}
        </div>
      </div>

      {#if !stick}
        <button class="jump btn icon" onclick={() => void showLatest()} aria-label={unread ? `Jump to latest: ${unread} new` : "Jump to latest"}><ArrowDown size={18} />{#if unread}<span class="unread">{unread > 99 ? "99+" : unread}</span>{/if}</button>
      {/if}
      {#if endSeq > 30}
        <Scrubber max={endSeq} current={viewSeq || endSeq} marks={scrubMarks} onjump={(seq) => void jumpTo(seq)} />
      {/if}

      <div class="composer-area">
        {#if !hasModel}
          <div class="notice warn tiny setup">No model is set up yet. <a href="/settings/models">Connect NanoGPT</a> to start writing.</div>
        {/if}
        <Composer chatId={id} {detail} {generating} disabled={!hasModel} onsend={send} onstop={stop} oneditlast={editLastUser} onchange={() => load()} {preview} oninspect={() => openInspector(null)} lastMessageId={endId} />
      </div>
    </div>

    {#if panelOpen && !app.isMobile}
      <aside class="dock" class:resizing>
        <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions (a focusable separator is a splitter: arrows resize it) -->
        <div
          class="dock-grip"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the side panel"
          aria-valuemin={DOCK_MIN}
          aria-valuemax={dockMax()}
          aria-valuenow={dockWidth()}
          tabindex="0"
          title="Drag to resize · double-click to reset"
          onpointerdown={gripDown}
          onpointermove={gripMove}
          onpointerup={gripUp}
          onpointercancel={gripUp}
          ondblclick={() => setDockWidth(null)}
          onkeydown={gripKey}
        ></div>
        <div class="dock-scroll studio">
          {@render dockTabs()}
          {#key dockTab}<div class="dock-pane">
            {#if dockTab === "memory"}<MemoryPanel chatId={id} onjump={(m) => void openCitation({ messageId: m, seq: null } as Citation)} />{:else if dockTab === "story"}<TrackerPanel chatId={id} />{:else if dockTab === "world"}<WorldPanel chatId={id} />{:else if dockTab === "meus"}<MeusPanel chatId={id} onjump={openCitation} />{:else if dockTab === "notes"}<NotesPanel chatId={id} onjump={jumpTo} />{:else}<ChatPanel {detail} onchange={() => load()} oninspect={() => openInspector(null)} />{/if}
          </div>{/key}
        </div>
      </aside>
    {/if}
  </div>

  {#if app.isMobile}
    <Modal bind:open={sheetOpen} title="This chat">
      <div class="studio sheet-desk">
      {@render dockTabs()}
      {#if dockTab === "memory"}<MemoryPanel chatId={id} onjump={(m) => ((sheetOpen = false), void openCitation({ messageId: m, seq: null } as Citation))} />{:else if dockTab === "story"}<TrackerPanel chatId={id} />{:else if dockTab === "world"}<WorldPanel chatId={id} />{:else if dockTab === "meus"}<MeusPanel chatId={id} onjump={(c) => ((sheetOpen = false), void openCitation(c))} />{:else if dockTab === "notes"}<NotesPanel chatId={id} onjump={(seq) => ((sheetOpen = false), void jumpTo(seq))} />{:else}<ChatPanel {detail} onchange={() => load()} oninspect={() => ((sheetOpen = false), openInspector(null))} />{/if}
      </div>
    </Modal>
  {/if}

  {#snippet dockTabs()}
    <div class="st-selector" role="tablist" aria-label="Side panel">
      {#each dockOptions as o (o.value)}
        <button type="button" role="tab" aria-selected={dockTab === o.value} onclick={() => pickDock(o.value)}
          ><o.icon size={17} /><span>{o.label}</span>{#if o.value === "chat" && sugg.count}<b class="dock-badge" aria-label="{sugg.count} suggestions waiting">{sugg.count > 99 ? "99+" : sugg.count}</b>{/if}</button
        >
      {/each}
    </div>
  {/snippet}

  <Inspector bind:open={inspectorOpen} chatId={id} generationId={inspectGen} />

  <SelectionMenu chatId={id} root={scroller} idForSeq={(seq) => messages.find((x) => x.seq === seq)?.id ?? null} onhighlight={loadHighlights} />

  {#if glossPick}
    <button class="gloss-scrim" onclick={() => (glossPick = null)} aria-label="Close"></button>
    <div class="gloss-pop card" style:left="{glossPick.x}px" style:top="{glossPick.y}px" role="dialog" aria-label={glossPick.t.title}>
      {#if glossPick.who !== undefined}
        {@const p = glossPick.who}
        <div class="row who">
          {#if glossPick.t.title.toLowerCase() === charName.toLowerCase()}<Avatar id={detail?.character?.avatarId} name={charName} size={40} palette={detail?.character?.palette ?? []} />{/if}
          <b class="grow">{p?.entity.name ?? glossPick.t.title}</b>
          <span class="chip tiny">{p?.entity.kind ?? glossPick.t.type}</span>
          {#if p && p.entity.status !== "active" && p.entity.status !== "unknown"}<span class="chip tiny peach">{p.entity.status}</span>{/if}
        </div>
        {#if p}
          {#if p.card || p.entity.description}<p class="small">{(p.card || p.entity.description).slice(0, 240)}</p>{/if}
          {#if p.facts.length}<ul class="tiny facts">{#each p.facts.slice(0, 3) as f (f.id)}<li>{f.content}</li>{/each}</ul>{/if}
          {@const tie = tieWithYou(p)}
          {#if tie}<p class="tiny muted">With you: {tie.label}</p>{/if}
          {#if p.entity.lastSeq}<p class="tiny muted">Last seen at message {p.entity.lastSeq}{p.appearances.at(-1)?.storyTime ? ` · ${p.appearances.at(-1)?.storyTime}` : ""}</p>{/if}
        {:else}
          <p class="small muted">{glossPick.t.snippet || "Loading…"}</p>
        {/if}
        <a class="tiny" href="/chat/{id}/codex?entity={glossPick.t.entryId.slice(7)}">Open in the Codex</a>
      {:else}
        <div class="row"><b class="grow">{glossPick.t.title}</b>{#if glossPick.t.type}<span class="chip tiny">{glossPick.t.type}</span>{/if}</div>
        <p class="small">{glossPick.t.snippet}</p>
        <a class="tiny" href="/lorebooks/{glossPick.t.bookId}?entry={glossPick.t.entryId}">Open the entry</a>
      {/if}
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
  .dock-badge {
    position: absolute;
    top: 3px;
    right: 6px;
    min-width: 15px;
    height: 15px;
    padding: 0 4px;
    border-radius: 8px;
    background: var(--accent);
    color: var(--on-accent);
    font: 800 9px/15px var(--font-ui);
    letter-spacing: 0;
  }
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
  .gloss-pop .who {
    gap: 0.5rem;
  }
  .gloss-pop .facts {
    margin: 0;
    padding-left: 1.1rem;
    display: grid;
    gap: 0.15rem;
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
    color: var(--accent-ink);
    animation: pulse 1.4s infinite;
  }
  .chat {
    display: grid;
    grid-template-columns: 1fr;
    /* one row as tall as the screen, so the chat and the side panel each scroll on their own */
    grid-template-rows: minmax(0, 1fr);
    height: 100dvh;
  }
  .chat.with-panel {
    grid-template-columns: minmax(0, 1fr) min(var(--dock-w), 55vw);
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
  .tools {
    gap: 0.35rem;
  }
  .ambience {
    position: absolute;
    inset: 0;
    z-index: 0;
    overflow: hidden;
    pointer-events: none;
  }
  .ambience > div {
    position: absolute;
    inset: 0;
  }
  .art-img {
    inset: -40px !important;
    background-size: cover;
    background-position: center;
  }
  .art-vignette {
    background: radial-gradient(ellipse at center, transparent 45%, rgb(0 0 0 / 45%) 100%);
  }
  .chat.art .bar {
    position: relative;
  }
  .chat.art .scroller,
  .chat.art .composer-area {
    position: relative;
    z-index: 1;
  }
  .chat.art :global(.msg .nameline),
  .chat.art :global(.msg .time),
  .chat.art :global(.divider),
  .chat.art :global(.start) {
    background: color-mix(in srgb, var(--surface) var(--panel), transparent);
    border-radius: var(--r-pill);
    padding: 0.05rem 0.55rem;
    backdrop-filter: blur(6px);
  }
  .chat.art :global(.bubble) {
    background: color-mix(in srgb, var(--surface) var(--panel), transparent);
    backdrop-filter: blur(8px);
  }
  .scroller {
    flex: 1;
    overflow-y: auto;
    overscroll-behavior: contain;
    scroll-padding-bottom: 2rem;
    /* M21: pages come and go above the view; keepPlace() anchors by hand, so the browser mustn't too. */
    overflow-anchor: none;
  }
  .column {
    max-width: var(--chat-w, var(--measure));
    transition: max-width 0.4s var(--ease);
    margin: 0 auto;
    padding: 1.2rem 1.1rem 1.5rem;
  }
  .center-text {
    text-align: center;
    padding: 2rem 0;
  }
  .composer-area {
    padding: 0.4rem 1rem calc(0.8rem + var(--safe-bottom));
    max-width: calc(var(--chat-w, var(--measure)) + 2rem);
    width: 100%;
    margin: 0 auto;
    display: grid;
    gap: 0.4rem;
  }
  .setup {
    text-align: center;
  }
  .queued {
    margin: 0.6rem 0 0.6rem auto;
    max-width: 85%;
    padding: 0.6rem 0.9rem;
    border-radius: var(--r-lg);
    border: 1px dashed var(--border-strong, var(--border));
    background: color-mix(in srgb, var(--tint-user) 60%, transparent);
    opacity: 0.85;
  }
  .queued p {
    margin: 0 0 0.3rem;
    white-space: pre-wrap;
  }
  .unread {
    position: absolute;
    top: -0.35rem;
    right: -0.35rem;
    min-width: 1.15rem;
    height: 1.15rem;
    padding: 0 0.3rem;
    border-radius: 999px;
    background: var(--accent-strong);
    color: white;
    font: 700 0.65rem/1.15rem var(--font-ui);
  }
  .jump {
    position: absolute;
    right: 1.2rem;
    bottom: 6.5rem;
    border-radius: 50%;
    box-shadow: var(--shadow-2);
    z-index: 4;
  }
  .divider {
    display: grid;
    justify-items: center;
    text-align: center;
    color: var(--text-muted);
    text-decoration: none !important;
    margin: 0.6rem 0;
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
  .knows {
    padding: 0.6rem 0.8rem;
  }
  .knows p {
    margin: 0.3rem 0 0;
    white-space: pre-wrap;
  }
  .dock {
    position: relative;
    min-width: 0;
    min-height: 0;
    border-left: 1px solid var(--border);
    background: color-mix(in srgb, var(--surface-2) 45%, var(--bg));
    height: 100dvh;
  }
  .dock-scroll {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 10px;
    align-content: start;
    height: 100%;
    overflow-x: hidden;
    overflow-y: auto;
    padding: 12px 12px 2rem;
    border-radius: inherit;
    scrollbar-width: thin;
    scrollbar-color: var(--border-strong) transparent;
  }
  .dock-pane {
    min-width: 0;
    animation: pane-in 0.28s var(--ease);
  }
  @keyframes pane-in {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }
  /* The grip on the panel's left edge: drag to resize, double-click to reset. */
  .dock-grip {
    position: absolute;
    z-index: 3;
    top: 0;
    bottom: 0;
    left: -7px;
    width: 14px;
    cursor: col-resize;
    touch-action: none;
  }
  .dock-grip::after {
    content: "";
    position: absolute;
    top: 50%;
    left: 50%;
    width: 4px;
    height: 46px;
    margin: -23px 0 0 -2px;
    border-radius: 4px;
    background: var(--border-strong);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--surface) 60%, transparent);
    opacity: 0;
    transition:
      opacity 0.2s,
      background 0.2s,
      height 0.2s;
  }
  .dock:hover > .dock-grip::after,
  .dock-grip:focus-visible::after {
    opacity: 0.8;
  }
  .dock.resizing > .dock-grip::after,
  .dock-grip:hover::after {
    opacity: 1;
    height: 72px;
    margin-top: -36px;
    background: var(--accent);
  }
  .dock-grip:focus-visible {
    outline: none;
  }
  .dock.resizing {
    user-select: none;
  }
  .sheet-desk {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 10px;
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

  /* ---------- Header ---------- */
  .who {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    min-width: 0;
    flex: 1;
  }
  .pic {
    display: grid;
    flex: none;
    padding: 3px;
    border-radius: 50%;
    text-decoration: none !important;
    background: conic-gradient(from var(--ring), var(--accent), var(--lamp), var(--sea), var(--lavender), var(--accent));
    animation: lantern-spin 7s linear infinite;
  }
  .pic :global(.avatar) {
    border-radius: 50% !important;
    box-shadow: 0 0 0 3px var(--bg);
  }
  .names {
    display: grid;
    min-width: 0;
    gap: 0.35rem;
  }
  .cname {
    font-family: var(--font-display);
    font-variation-settings: "SOFT" 100;
    font-weight: 600;
    font-size: 1.2rem;
    line-height: 1.05;
    color: var(--text) !important;
    text-decoration: none !important;
  }
  .ctitle {
    font-size: 0.6em;
    font-style: italic;
    font-weight: 400;
    color: var(--text-faint);
  }
  .sub {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    min-width: 0;
    border: 0;
    background: none;
    padding: 0;
    cursor: pointer;
    color: var(--text-muted);
    font: 600 var(--fs-xs) var(--font-ui);
    text-align: left;
  }
  .hudline {
    padding: 0.22rem 0.7rem;
    border-radius: var(--r-pill);
    background: var(--surface-2);
    border: 1px solid var(--border);
    min-width: 0;
  }
  .sub:hover .hudline {
    color: var(--text);
  }
  .live {
    width: 0.45rem;
    height: 0.45rem;
    border-radius: 50%;
    flex: none;
    background: var(--accent);
    animation: pulse 1.2s ease-in-out infinite;
  }
  .tools {
    gap: 0.2rem;
    flex: none;
  }
  .tools .on {
    background: var(--surface-2);
    color: var(--text);
  }
  .sep {
    width: 1px;
    height: 22px;
    margin: 0 0.3rem;
    background: var(--border);
  }
  .styles {
    display: inline-flex;
    gap: 2px;
    padding: 3px;
    border-radius: 14px;
    background: var(--surface-2);
  }
  .styles button {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    border: 0;
    background: none;
    padding: 0.42rem 0.7rem;
    border-radius: 10px;
    font: 650 var(--fs-xs) var(--font-ui);
    color: var(--text-muted);
    cursor: pointer;
    transition:
      background 0.2s,
      color 0.2s;
  }
  .styles button:hover {
    color: var(--text);
  }
  .styles button.on {
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow-1);
  }
  .leave .spark {
    color: var(--lamp, var(--accent-strong));
  }
  .bar.compact {
    padding-top: calc(0.7rem + var(--safe-top));
    padding-bottom: 0.3rem;
  }

  /* ---------- The story begins, chapters, scenes ---------- */
  .start,
  .older {
    display: grid;
    justify-items: center;
    gap: 0.55rem;
    padding: 1.4rem 0 1.8rem;
    text-align: center;
  }
  .begins {
    font: italic 400 1.05rem var(--font-story);
    color: var(--text-muted);
  }
  .orn-line {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    color: var(--lamp, var(--accent-strong));
  }
  .orn-line span {
    width: 5.5rem;
    height: 1px;
    background: linear-gradient(90deg, transparent, currentColor);
    opacity: 0.7;
  }
  .orn-line span:last-child {
    background: linear-gradient(90deg, currentColor, transparent);
  }
  .orn-line i {
    font-style: normal;
    font-size: 0.8rem;
    text-shadow: 0 0 12px currentColor;
    animation: lantern-glow 3s ease-in-out infinite alternate;
  }
  .chapter-h {
    position: relative;
    display: grid;
    justify-items: center;
    gap: 0.3rem;
    margin: 1.6rem 0 2.3rem;
    padding: 1.6rem 0.6rem 0.4rem;
    text-align: center;
    color: var(--text) !important;
    text-decoration: none !important;
  }
  .chapter-h::before {
    content: "";
    position: absolute;
    left: 50%;
    top: -0.6rem;
    width: min(26rem, 100%);
    height: 13rem;
    transform: translateX(-50%);
    background: radial-gradient(closest-side, color-mix(in srgb, var(--lamp, var(--butter)) 16%, transparent), transparent);
    pointer-events: none;
  }
  .ch-num {
    margin-top: 0.7rem;
    font: 700 0.7rem var(--font-ui);
    letter-spacing: 0.42em;
    text-transform: uppercase;
    color: var(--text-faint);
  }
  .ch-num b {
    color: var(--lamp, var(--accent-ink));
  }
  .ch-title {
    padding: 0 0.12em;
    font: italic 600 clamp(2rem, 4.6vw, 3.2rem) / 1.05 var(--font-display);
    font-variation-settings: "SOFT" 100;
    color: var(--text);
  }
  .ch-meta {
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
    margin-top: 0.45rem;
    font: 600 0.7rem var(--font-ui);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-faint);
  }
  .ch-meta i {
    width: 3px;
    height: 3px;
    border-radius: 50%;
    background: var(--text-faint);
  }
  .scene-h {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    margin: 0.8rem 0 1.6rem;
    color: var(--text) !important;
    text-decoration: none !important;
  }
  .sc-line {
    flex: 1;
    height: 1px;
    min-width: 1rem;
    background: linear-gradient(90deg, transparent, var(--border-strong));
  }
  .sc-line:last-child {
    background: linear-gradient(90deg, var(--border-strong), transparent);
  }
  .sc-body {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    min-width: 0;
    max-width: 80%;
    padding: 0.42rem 1.1rem 0.42rem 0.42rem;
    border-radius: var(--r-pill);
    background: var(--surface-2);
    border: 1px solid var(--border);
    transition: transform 0.3s var(--spring);
  }
  .scene-h:hover .sc-body {
    transform: translateY(-1px);
  }
  .sc-ic {
    width: 2rem;
    height: 2rem;
    flex: none;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: color-mix(in srgb, var(--lamp, var(--butter)) 18%, transparent);
    color: var(--lamp, var(--accent-ink));
  }
  .sc-text {
    display: grid;
    min-width: 0;
  }
  .sc-text b {
    font: 400 1.1rem/1.15 var(--font-display);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sc-text span {
    font-size: 0.7rem;
    color: var(--text-faint);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .column.style-cards .scene-h {
    margin-left: calc(var(--portrait-w, 76px) + 1rem);
  }
  .column.style-book .sc-body {
    flex-direction: column;
    gap: 0.25rem;
    padding: 0;
    background: none;
    border: 0;
    text-align: center;
  }
  .column.style-book .sc-ic {
    background: none;
    width: auto;
    height: auto;
  }
  .column.style-bubbles .sc-line {
    display: none;
  }
  .column.style-bubbles .scene-h {
    justify-content: center;
  }

  /* ---------- Lantern: the glass stage ---------- */
  :global([data-shell="lantern"]) .chat {
    height: 100%;
    column-gap: 14px;
  }
  :global([data-shell="lantern"]) .chat.with-panel {
    grid-template-columns: minmax(0, 1fr) min(var(--dock-w), 55vw);
  }
  :global([data-shell="lantern"]) .main-col {
    height: 100%;
    overflow: hidden;
    isolation: isolate;
    border-radius: 30px;
    background: linear-gradient(160deg, color-mix(in srgb, var(--hi) 7%, transparent), color-mix(in srgb, var(--hi) 2%, transparent));
    border: 1px solid color-mix(in srgb, var(--hi) 9%, transparent);
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, var(--hi) 6%, transparent),
      0 24px 60px -24px color-mix(in srgb, var(--lo) 65%, transparent);
    backdrop-filter: blur(24px) saturate(150%);
    -webkit-backdrop-filter: blur(24px) saturate(150%);
    transition:
      border-radius 0.6s var(--ease),
      background 0.6s var(--ease);
  }
  :global([data-shell="lantern"]) .chat.focus .main-col {
    border-radius: 0;
    border-color: transparent;
    background: transparent;
    box-shadow: none;
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
  :global([data-shell="lantern"]) .bar {
    background: transparent;
    border-bottom: 0;
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
    padding: calc(1rem + var(--safe-top)) 1.1rem 0.7rem 1.3rem;
  }
  :global([data-shell="lantern"]) .bar.compact {
    padding-top: calc(0.8rem + var(--safe-top));
  }
  :global([data-shell="lantern"]) .cname {
    font-size: 2rem;
    font-weight: 400;
  }
  :global([data-shell="lantern"]) .bar.compact .cname {
    font-size: 1.5rem;
  }
  :global([data-shell="lantern"]) .hudline {
    background: var(--fill);
    border-color: var(--edge);
  }
  :global([data-shell="lantern"]) .tools .on,
  :global([data-shell="lantern"]) .styles button.on {
    background: color-mix(in srgb, var(--hi) 12%, transparent);
    box-shadow:
      inset 0 0 0 1px color-mix(in srgb, var(--hi) 14%, transparent),
      0 0 16px color-mix(in srgb, var(--lavender) 18%, transparent);
  }
  :global([data-shell="lantern"]) .styles {
    background: var(--well);
    box-shadow: inset 0 0 0 1px var(--edge);
  }
  :global([data-shell="lantern"]) .sep {
    background: var(--edge);
  }
  :global([data-shell="lantern"]) .dock {
    height: 100%;
    border-radius: 28px;
    border: 1px solid color-mix(in srgb, var(--hi) 9%, transparent);
    background: linear-gradient(160deg, color-mix(in srgb, var(--hi) 7%, transparent), color-mix(in srgb, var(--hi) 2%, transparent));
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, var(--hi) 6%, transparent),
      0 24px 60px -24px color-mix(in srgb, var(--lo) 65%, transparent);
    backdrop-filter: blur(24px) saturate(150%);
    -webkit-backdrop-filter: blur(24px) saturate(150%);
    animation: dock-in 0.5s var(--ease);
  }
  @keyframes dock-in {
    from {
      opacity: 0;
      transform: translateX(16px);
    }
  }
  :global([data-shell="lantern"]) .ch-title {
    font-weight: 400;
    font-size: clamp(2.6rem, 5.4vw, 4rem);
    background: var(--flame, linear-gradient(180deg, #fff6ea 20%, #ffd08f 72%, #ff9ec0));
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    filter: drop-shadow(0 6px 26px color-mix(in srgb, var(--accent) 25%, transparent));
  }
  :global([data-shell="lantern"]) .sc-body {
    background: color-mix(in srgb, var(--hi) 4.5%, transparent);
    border-color: var(--edge);
  }
  :global([data-shell="lantern"]) .sc-ic {
    box-shadow: 0 0 16px -4px var(--lamp);
  }
  :global([data-shell="lantern"]) .sc-line {
    background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--hi) 14%, transparent));
  }
  :global([data-shell="lantern"]) .sc-line:last-child {
    background: linear-gradient(90deg, color-mix(in srgb, var(--hi) 14%, transparent), transparent);
  }
  :global([data-shell="lantern"]) .jump {
    background: color-mix(in srgb, var(--pop) 90%, transparent);
    border-color: var(--edge);
  }
  @media (max-width: 760px) {
    :global([data-shell="lantern"]) .main-col {
      border-radius: 0;
      border: 0;
    }
    :global([data-shell="lantern"]) .cname {
      font-size: 1.45rem;
    }
    :global([data-shell="lantern"]) .bar {
      padding: calc(0.6rem + var(--safe-top)) 0.5rem 0.5rem 0.3rem;
    }
    .column.style-cards .scene-h {
      margin-left: 0;
    }
    .pic {
      padding: 2px;
    }
    .styles.hide-sm,
    .sep.hide-sm {
      display: none;
    }
    .tools {
      gap: 0;
    }
  }
</style>
