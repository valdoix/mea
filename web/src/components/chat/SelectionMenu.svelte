<script lang="ts">
  import Modal from "../Modal.svelte";
  import { del, get, post } from "../../lib/api";
  import { Ban, Bookmark, BookmarkPlus, BookOpen, CircleAlert, EyeOff, Heart, Lock, MessagesSquare, Scissors, FilePlus } from "../../lib/icons";
  import { type Filing, filedToast } from "../../lib/filings.svelte";
  import Menu, { type MenuItem } from "../Menu.svelte";
  import { editOffpage, kept, neverSay } from "../../lib/offpage.svelte";
  import { askMeus } from "../../lib/meus.svelte";
  import { errorToast, toast } from "../../lib/state.svelte";
  import { delight } from "../../lib/delight";
  import type { Atom } from "../../lib/types";

  /**
   * "Remember this" / "That's wrong" (MEM-41): select text in any message and turn it into a
   * memory, pin it, or correct what memory got wrong, in two taps.
   */
  let {
    chatId,
    root,
    idForSeq,
    onhighlight,
    canKeep,
    onkeep,
  }: {
    chatId: string;
    root: HTMLElement | null;
    idForSeq: (seq: number) => string | null;
    onhighlight?: () => void;
    /** A2: "Keep this, redo the rest" works on the latest reply only. */
    canKeep?: (messageId: string) => boolean;
    onkeep?: (messageId: string, text: string) => void;
  } = $props();

  /** `y` is where the bar's bottom edge sits above the selection, or (`below`) its top edge under it. */
  let sel = $state<{ text: string; messageId: string; x: number; y: number; below?: boolean } | null>(null);
  let fixOpen = $state(false);
  let wrong = $state("");
  let right = $state("");
  let matches = $state<(Atom & { match: number })[]>([]);
  let picked = $state<Set<string>>(new Set());
  let fixMessage = $state<string | null>(null);
  let timer: ReturnType<typeof setTimeout>;

  const BAR = 640;
  function read() {
    const s = window.getSelection();
    if (!s || s.isCollapsed || !root) return (sel = null);
    const text = s.toString().replace(/\s+/g, " ").trim();
    const anchor = s.anchorNode instanceof Element ? s.anchorNode : s.anchorNode?.parentElement;
    const prose = anchor?.closest(".prose");
    const msg = anchor?.closest("article.msg") as HTMLElement | null;
    if (!text || text.length < 3 || text.length > 1500 || !prose || !msg || !root.contains(msg)) return (sel = null);
    const id = idForSeq(Number(msg.dataset.seq));
    if (!id) return (sel = null);
    const rect = s.getRangeAt(0).getBoundingClientRect();
    // The bar wraps to at most BAR wide (two rows on narrow screens), centred over the selection.
    const w = Math.min(BAR, window.innerWidth - 16);
    sel = { text, messageId: id, x: Math.min(window.innerWidth - w - 8, Math.max(8, rect.left + rect.width / 2 - w / 2)), ...(rect.top < 110 ? { y: rect.bottom + 6, below: true } : { y: rect.top - 6 }) };
  }
  $effect(() => {
    const onChange = () => {
      clearTimeout(timer);
      timer = setTimeout(read, 220);
    };
    document.addEventListener("selectionchange", onChange);
    return () => {
      document.removeEventListener("selectionchange", onChange);
      clearTimeout(timer);
    };
  });

  async function remember(pin: boolean) {
    if (!sel) return;
    try {
      await post(`/api/chats/${chatId}/remember`, { messageId: sel.messageId, text: sel.text, pin });
      toast(pin ? "Pinned: it's in every prompt from now on" : "Remembered", { kind: "ok" });
      delight("sparkle", { x: sel.x + 90, y: sel.y + 20 });
      window.getSelection()?.removeAllRanges();
      sel = null;
    } catch (e) {
      errorToast(e);
    }
  }
  /** QOL-02: keep the passage as a highlight (a best moment, and a memory signal). */
  async function highlight() {
    if (!sel) return;
    try {
      const h = await post<{ id: string }>(`/api/messages/${sel.messageId}/highlights`, { text: sel.text });
      delight("heart", { x: sel.x + 90, y: sel.y + 20 });
      window.getSelection()?.removeAllRanges();
      sel = null;
      onhighlight?.();
      toast("Highlighted ♡", { kind: "ok", action: { label: "Undo", run: () => void del(`/api/highlights/${h.id}`).then(() => onhighlight?.()) } });
    } catch (e) {
      errorToast(e);
    }
  }
  async function startFix() {
    if (!sel) return;
    wrong = sel.text;
    right = "";
    fixMessage = sel.messageId;
    picked = new Set();
    fixOpen = true;
    try {
      matches = (await post<{ matches: (Atom & { match: number })[] }>(`/api/chats/${chatId}/correct/preview`, { wrong, messageId: fixMessage })).matches;
      picked = new Set(matches.filter((m) => m.match >= 0.35).map((m) => m.id));
    } catch (e) {
      errorToast(e);
    }
  }
  async function submitFix() {
    if (!right.trim()) return;
    try {
      const r = await post<{ superseded: Atom[] }>(`/api/chats/${chatId}/correct`, { wrong, right: right.trim(), messageId: fixMessage ?? undefined, memoryIds: picked.size ? [...picked] : undefined });
      toast(r.superseded.length ? `Corrected: ${r.superseded.length} wrong ${r.superseded.length === 1 ? "memory" : "memories"} replaced` : "Saved as a confirmed memory", { kind: "ok" });
      fixOpen = false;
      sel = null;
    } catch (e) {
      errorToast(e);
    }
  }
  /** Talk it over with Meus: the passage and where it's from start the message. */
  function toMeus() {
    if (!sel) return;
    const seq = (window.getSelection()?.anchorNode?.parentElement?.closest("article.msg") as HTMLElement | null)?.dataset.seq;
    askMeus(`About this${seq ? ` (in #${seq})` : ""}: “${sel.text.slice(0, 600)}” `);
    window.getSelection()?.removeAllRanges();
    sel = null;
  }
  // B1: "Never say this" (the selected words join a secret kept off the page) and "Keep off the page".
  let pickOpen = $state(false);
  let pickPoint = $state<{ x: number; y: number } | null>(null);
  let pickItems = $state<MenuItem[]>([]);
  let pickTitle = $state("");
  function neverSayThis() {
    if (!sel) return;
    const word = sel.text.slice(0, 60);
    const messageId = sel.messageId;
    const list = kept();
    const done = () => {
      window.getSelection()?.removeAllRanges();
      sel = null;
    };
    if (!list.length) {
      editOffpage(null, { neverSay: [word], messageId });
      return done();
    }
    pickItems = [...list.map((o) => ({ label: o.label, onclick: () => void neverSay(o, word, messageId) })), { label: "A new secret…", onclick: () => editOffpage(null, { neverSay: [word], messageId }) }];
    pickTitle = "Never say this, for which secret?";
    pickPoint = { x: sel.x, y: sel.y + 4 };
    pickOpen = true;
    done();
  }
  // ---------- F3: selection asides ----------
  type AsideKind = "truth" | "motif" | "calendar" | "clock" | "plant" | "owner";
  let asideForm = $state<{ kind: "calendar" | "clock"; text: string; messageId: string; when: string; title: string; eventKind: string } | null>(null);
  let asideOpen = $state(false);

  async function fileAside(kind: AsideKind, text: string, messageId: string, extra: Record<string, string> = {}) {
    try {
      const r = await post<{ filing: Filing }>(`/api/chats/${chatId}/aside`, { kind, text, messageId, ...extra });
      filedToast(r.filing);
      return true;
    } catch (e) {
      errorToast(e);
      return false;
    }
  }
  /** "File as…": Pin as truth, Running bit, Add to calendar, Set the clock, Plant this, This belongs to… */
  async function asides() {
    if (!sel) return;
    const text = sel.text.trim().replace(/[.,;:!?]+$/, "");
    const messageId = sel.messageId;
    const at = { x: sel.x, y: sel.y + 4 };
    window.getSelection()?.removeAllRanges();
    sel = null;
    let hints: { date: string | null; kind: string | null; clock: string | null; title: string | null } = { date: null, kind: null, clock: null, title: null };
    try {
      hints = await get(`/api/chats/${chatId}/aside/hints?text=${encodeURIComponent(text.slice(0, 300))}`);
    } catch {
      // hints only pre-fill
    }
    const short = text.split(/\s+/).length <= 8;
    pickItems = [
      { label: "Pin as truth", hint: "A rule for this story, sent every turn", onclick: () => void fileAside("truth", text, messageId) },
      { label: "Running bit", hint: "A callback the story can return to", onclick: () => void fileAside("motif", text, messageId) },
      { label: "Add to calendar", hint: hints.date ?? "Pick the day", onclick: () => openAside("calendar", text, messageId, hints) },
      ...(hints.clock ? [{ label: "Set the clock", hint: hints.clock, onclick: () => openAside("clock", text, messageId, hints) }] : []),
      { label: "Plant this", hint: "Something to pay off later", onclick: () => void fileAside("plant", text, messageId) },
      ...(short ? [{ label: "This belongs to…", onclick: () => void belongsTo(text, messageId, at) }] : []),
    ];
    pickTitle = `File “${text.slice(0, 30)}${text.length > 30 ? "…" : ""}” as`;
    pickPoint = at;
    pickOpen = true;
  }
  function openAside(kind: "calendar" | "clock", text: string, messageId: string, hints: { date: string | null; kind: string | null; clock: string | null; title: string | null }) {
    asideForm = { kind, text, messageId, when: (kind === "calendar" ? hints.date : hints.clock) ?? "", title: hints.title ?? text.slice(0, 80), eventKind: hints.kind ?? "" };
    asideOpen = true;
  }
  async function saveAside() {
    if (!asideForm) return;
    const f = asideForm;
    const ok = await fileAside(f.kind, f.kind === "calendar" ? `${f.title}, ${f.when}` : f.text, f.messageId, { when: f.when, ...(f.eventKind ? { eventKind: f.eventKind } : {}) });
    if (ok) asideOpen = false;
  }
  /** E2: "This belongs to…": the selected thing becomes someone's, in the story's records. */
  async function belongsTo(thing: string, messageId: string, at: { x: number; y: number }) {
    try {
      const r = await get<{ people: { name: string; dead: boolean }[]; userName: string }>(`/api/chats/${chatId}/cast`);
      const own = (name: string) => () => void fileAside("owner", thing.slice(0, 80), messageId, { owner: name });
      pickItems = [...r.people.filter((x) => !x.dead).map((x) => ({ label: x.name, onclick: own(x.name) })), ...(r.userName ? [{ label: `${r.userName} (you)`, onclick: own(r.userName) }] : [])];
      pickTitle = `Whose is “${thing.slice(0, 30)}”?`;
      pickPoint = at;
      setTimeout(() => (pickOpen = true), 0);
    } catch (e) {
      errorToast(e);
    }
  }
  function keepOffPage() {
    if (!sel) return;
    editOffpage(null, { label: sel.text.slice(0, 300), neverSay: sel.text.split(/\s+/).length <= 3 ? [sel.text.slice(0, 60)] : [], messageId: sel.messageId });
    window.getSelection()?.removeAllRanges();
    sel = null;
  }

  // ---------- docs/15, 1.4: Remember as a fact ----------
  type FactPick = { value: string; messageId: string; candidates: { entryId: string; bookName: string; title: string; why: string }[] };
  let factPick = $state<FactPick | null>(null);
  let factEntry = $state("");
  let factValue = $state("");
  let factOpen = $state(false);
  /** 3.4: "That's never true" files a never fact (on any version of the reply) instead. */
  let factNever = $state(false);
  async function rememberFact(never = false) {
    if (!sel) return;
    const { text, messageId } = sel;
    window.getSelection()?.removeAllRanges();
    sel = null;
    try {
      const r = await post<FactPick>(`/api/chats/${chatId}/lore/fact/pick`, { messageId, text });
      if (!r.candidates.length) return toast("No lore entry this chat uses is about this. Link a lorebook, or add the entry first.");
      factPick = r;
      factEntry = r.candidates[0]!.entryId;
      factValue = r.value;
      factNever = never;
      factOpen = true;
    } catch (e) {
      errorToast(e);
    }
  }
  async function saveFact() {
    if (!factPick || !factEntry || !factValue.trim()) return;
    try {
      const r = await post<{ undo: string }>(`/api/lore/entries/${factEntry}/facts`, factNever ? { value: factValue.trim(), messageId: factPick.messageId, chatId, slot: "never", kind: "never" } : { value: factValue.trim(), messageId: factPick.messageId, chatId, fromText: true });
      const title = factPick.candidates.find((c) => c.entryId === factEntry)?.title ?? "the entry";
      factOpen = false;
      toast(factNever ? `Kept as never true for ${title}: replies that break it are flagged` : `Kept as a fact on ${title}`, { kind: "ok", action: { label: "Undo", run: () => void post(`/api/undo/${r.undo}`).catch(errorToast) } });
    } catch (e) {
      errorToast(e);
    }
  }

  /** A2: a new take that keeps the reply up to (and including) the selected sentence. */
  function keepThis() {
    if (!sel || !onkeep) return;
    onkeep(sel.messageId, sel.text);
    window.getSelection()?.removeAllRanges();
    sel = null;
  }
  function toggle(id: string) {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    picked = next;
  }
</script>

{#if sel && !fixOpen}
  <div class="selbar card" class:below={sel.below} style:left="{sel.x}px" style:top="{sel.y}px" role="toolbar" aria-label="Selected text">
    <button class="btn ghost small" onmousedown={(e) => e.preventDefault()} onclick={highlight}><Heart size={14} /> Highlight</button>
    <button class="btn ghost small" onmousedown={(e) => e.preventDefault()} onclick={() => remember(false)}><BookmarkPlus size={14} /> Remember</button>
    <button class="btn ghost small" onmousedown={(e) => e.preventDefault()} onclick={() => remember(true)}><Bookmark size={14} /> Pin</button>
    <button class="btn ghost small" onmousedown={(e) => e.preventDefault()} onclick={startFix}><CircleAlert size={14} /> That's wrong</button>
    <button class="btn ghost small" onmousedown={(e) => e.preventDefault()} onclick={toMeus}><MessagesSquare size={14} /> Ask Meus</button>
    <button class="btn ghost small" onmousedown={(e) => e.preventDefault()} onclick={neverSayThis} title="Add these words to a secret kept off the page"><EyeOff size={14} /> Never say this</button>
    <button class="btn ghost small" onmousedown={(e) => e.preventDefault()} onclick={() => rememberFact()} title="Keep it as a fact on a lore entry; it follows this version of the reply"><BookOpen size={14} /> Remember as a fact</button>
    <button class="btn ghost small" onmousedown={(e) => e.preventDefault()} onclick={() => rememberFact(true)} title="File what this says as something that never happens; replies that break it get a note"><Ban size={14} /> That's never true</button>
    <button class="btn ghost small" onmousedown={(e) => e.preventDefault()} onclick={asides} title="Pin as truth, running bit, calendar, clock, plant, belongs to…"><FilePlus size={14} /> File as…</button>
    <button class="btn ghost small" onmousedown={(e) => e.preventDefault()} onclick={keepOffPage} title="Hold this back from the narration"><Lock size={14} /> Keep off the page</button>
    {#if onkeep && canKeep?.(sel.messageId)}<button class="btn ghost small" onmousedown={(e) => e.preventDefault()} onclick={keepThis} title="A new take that keeps everything up to here"><Scissors size={14} /> Keep this, redo the rest</button>{/if}
  </div>
{/if}

<Menu bind:open={pickOpen} items={pickItems} point={pickPoint} title={pickTitle} />

<Modal bind:open={asideOpen} title={asideForm?.kind === "calendar" ? "Add to the calendar" : "Set the story's clock"} size="sm">
  {#if asideForm}
    <div class="stack">
      {#if asideForm.kind === "calendar"}
        <label class="field"><span class="label">What</span><input class="input" bind:value={asideForm.title} maxlength="80" /></label>
        <label class="field"><span class="label">Day</span><input class="input" bind:value={asideForm.when} placeholder="19 January" maxlength="60" /></label>
        <label class="field">
          <span class="label">Kind</span>
          <select class="select" bind:value={asideForm.eventKind}><option value="">A day to remember</option><option value="birthday">Birthday</option><option value="anniversary">Anniversary</option><option value="holiday">Feast or holiday</option><option value="appointment">Appointment</option></select>
        </label>
      {:else}
        <p class="small muted">“{asideForm.text.slice(0, 120)}”</p>
        <label class="field"><span class="label">The time</span><input class="input" bind:value={asideForm.when} placeholder="21:00, next morning, Day 3 08:00" maxlength="60" /><span class="hint">The clock only moves forward from where the story is.</span></label>
      {/if}
    </div>
  {/if}
  {#snippet footer()}
    <button class="btn ghost" onclick={() => (asideOpen = false)}>Cancel</button>
    <button class="btn primary" onclick={saveAside} disabled={!asideForm?.when.trim()}>{asideForm?.kind === "calendar" ? "Add" : "Set the clock"}</button>
  {/snippet}
</Modal>

<Modal bind:open={factOpen} title={factNever ? "That's never true" : "Remember as a fact"} size="sm">
  {#if factPick}
    <div class="stack">
      <label class="field">
        <span class="label">On</span>
        <select class="select" bind:value={factEntry}>
          {#each factPick.candidates as c (c.entryId)}<option value={c.entryId}>{c.title} · {c.bookName}</option>{/each}
        </select>
        <span class="hint">{factPick.candidates.find((c) => c.entryId === factEntry)?.why ?? ""}</span>
      </label>
      <label class="field">
        <span class="label">{factNever ? "What never happens" : "The fact"}</span>
        <input class="input" bind:value={factValue} maxlength="500" />
        <span class="hint">{factNever ? "Say it as what they can't or don't do: “Can't swim”, “Has never met Arya”. It holds in this chat on every version of the reply." : "It holds in this chat from this message on, and goes if this version of the reply is swiped away."}</span>
      </label>
    </div>
  {/if}
  {#snippet footer()}
    <button class="btn ghost" onclick={() => (factOpen = false)}>Cancel</button>
    <button class="btn primary" onclick={saveFact} disabled={!factValue.trim() || !factEntry}>Keep the fact</button>
  {/snippet}
</Modal>

<Modal bind:open={fixOpen} title="Correct what memory knows" size="md">
  <div class="stack">
    <label class="field"><span class="label">What's wrong</span><textarea class="textarea" rows="2" bind:value={wrong}></textarea></label>
    <label class="field"><span class="label">What's right</span><textarea class="textarea" rows="2" bind:value={right} placeholder="Mira's eyes are green."></textarea><span class="hint">Saved as a confirmed memory. Your corrections win over anything the AI wrote, and never fade.</span></label>
    {#if matches.length}
      <div class="field">
        <span class="label">Memories that say the wrong thing</span>
        {#each matches as m (m.id)}
          <label class="match"><input type="checkbox" checked={picked.has(m.id)} onchange={() => toggle(m.id)} /> <span class="small">{m.content}</span></label>
        {/each}
        <span class="hint">The ones you tick are replaced by your correction (they're kept in history, not deleted).</span>
      </div>
    {:else}
      <p class="tiny muted">No memories repeat this yet; your correction is saved for later.</p>
    {/if}
  </div>
  {#snippet footer()}
    <button class="btn ghost" onclick={() => (fixOpen = false)}>Cancel</button>
    <button class="btn primary" onclick={submitFix} disabled={!right.trim()}>Correct it</button>
  {/snippet}
</Modal>

<style>
  .selbar {
    position: fixed;
    z-index: 60;
    display: flex;
    flex-wrap: wrap;
    max-width: min(640px, calc(100vw - 16px));
    gap: 0.1rem;
    padding: 0.2rem;
    box-shadow: var(--shadow-2, 0 4px 18px rgb(0 0 0 / 0.15));
    /* It wraps to two rows on narrow screens: anchored by its bottom edge, above the selection. */
    transform: translateY(-100%);
  }
  .selbar.below {
    transform: none;
  }
  .match {
    display: flex;
    gap: 0.45rem;
    align-items: baseline;
    padding: 0.2rem 0;
  }
</style>
