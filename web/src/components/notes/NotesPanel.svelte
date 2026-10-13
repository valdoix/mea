<script lang="ts">
  import "../../styles/studio.css";
  import Rocker from "../desk/Rocker.svelte";
  import { del, get, patch, post, put } from "../../lib/api";
  import { onEvent } from "../../lib/events";
  import { autosize } from "../../lib/gestures";
  import { timeAgo } from "../../lib/format";
  import { Bookmark, Heart, NotebookPen, Pin, PinOff, Plus, Search, Trash, X } from "../../lib/icons";
  import { errorToast, toast } from "../../lib/state.svelte";

  /**
   * The notebook (QOL-01) and the best-moments reel (QOL-02). With a chat: that chat's notes plus
   * the global ones, and that chat's moments in story order. Without: every note and every moment.
   */
  let { chatId = null, onjump }: { chatId?: string | null; onjump?: (seq: number) => void } = $props();

  interface Note {
    id: string;
    chatId: string | null;
    title: string;
    body: string;
    pinned: boolean;
    updatedAt: number;
    links: { text: string; href: string | null; kind: "entity" | "lore" | "missing" }[];
  }
  interface Moment {
    kind: "bookmark" | "highlight";
    id: string;
    chatId: string;
    chatTitle: string;
    messageId: string;
    seq: number;
    who: string;
    text: string;
    note: string;
    at: number;
  }

  let tab = $state<"notes" | "moments">("notes");
  let notes = $state<Note[]>([]);
  let moments = $state<Moment[]>([]);
  let openId = $state<string | null>(null);
  let filter = $state("");
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  async function loadNotes() {
    try {
      notes = (await get<{ notes: Note[] }>(`/api/notes${chatId ? `?chat=${chatId}` : ""}`)).notes;
    } catch (e) {
      errorToast(e);
    }
  }
  async function loadMoments() {
    try {
      moments = (await get<{ moments: Moment[] }>(`/api/moments${chatId ? `?chat=${chatId}` : ""}`)).moments;
    } catch (e) {
      errorToast(e);
    }
  }
  $effect(() => {
    void chatId;
    void loadNotes();
    void loadMoments();
  });
  $effect(() =>
    onEvent((e) => {
      if (e.type === "message.changed" && (!chatId || e.chatId === chatId)) void loadMoments();
    }),
  );

  async function add(global = false) {
    const current = notes.find((x) => x.id === openId);
    if (current) close(current);
    try {
      const n = await post<Note>("/api/notes", { chatId: global ? null : chatId, title: "", body: "" });
      notes = [n, ...notes];
      openId = n.id;
    } catch (e) {
      errorToast(e);
    }
  }

  function edit(n: Note, patch: Partial<Pick<Note, "title" | "body" | "pinned" | "chatId">>) {
    Object.assign(n, patch);
    clearTimeout(timers.get(n.id));
    timers.set(
      n.id,
      setTimeout(async () => {
        try {
          const saved = await put<Note>(`/api/notes/${n.id}`, { title: n.title, body: n.body, pinned: n.pinned, chatId: n.chatId });
          n.links = saved.links;
          n.updatedAt = saved.updatedAt;
        } catch (e) {
          errorToast(e);
        }
      }, 500),
    );
  }

  /** A freshly opened note's text box takes the keyboard. */
  function focusEnd(el: HTMLTextAreaElement) {
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  }

  /** Closing a note you never wrote in throws it away. */
  function close(n: Note) {
    openId = null;
    if (n.title.trim() || n.body.trim()) return;
    clearTimeout(timers.get(n.id));
    notes = notes.filter((x) => x.id !== n.id);
    void del(`/api/notes/${n.id}`).catch(() => {});
  }

  async function remove(n: Note) {
    try {
      await del(`/api/notes/${n.id}`);
      notes = notes.filter((x) => x.id !== n.id);
      // QOL-05: every destructive action can be taken back.
      toast("Note deleted", {
        action: {
          label: "Undo",
          run: async () => {
            await post(`/api/notes/${n.id}/restore`);
            await loadNotes();
          },
        },
      });
    } catch (e) {
      errorToast(e);
    }
  }

  async function unmark(m: Moment) {
    try {
      if (m.kind === "highlight") {
        const r = await del<{ removed: { messageId: string; text: string; note: string } | null }>(`/api/highlights/${m.id}`);
        toast("Highlight removed", {
          action: { label: "Undo", run: async () => void (r.removed && (await post(`/api/messages/${r.removed.messageId}/highlights`, { text: r.removed.text, note: r.removed.note || undefined }))) },
        });
      } else {
        await patch(`/api/messages/${m.messageId}`, { bookmarked: false });
        toast("Bookmark removed", { action: { label: "Undo", run: () => void patch(`/api/messages/${m.messageId}`, { bookmarked: true }) } });
      }
      moments = moments.filter((x) => x.id !== m.id || x.kind !== m.kind);
    } catch (e) {
      errorToast(e);
    }
  }

  const q = $derived(filter.trim().toLowerCase());
  const shownNotes = $derived(q ? notes.filter((n) => `${n.title}\n${n.body}`.toLowerCase().includes(q)) : notes);
  const shownMoments = $derived(q ? moments.filter((m) => `${m.text}\n${m.note}\n${m.chatTitle}`.toLowerCase().includes(q)) : moments);
  const excerpt = (t: string, n = 260) => (t.length > n ? `${t.slice(0, n).trimEnd()}…` : t);
</script>

<div class="studio st-stack nb">
  <Rocker
    label="Notes or best moments"
    value={tab}
    options={[
      { value: "notes", label: "Notes", sub: notes.length ? `${notes.length} on the board` : "nothing yet" },
      { value: "moments", label: "Best moments", sub: moments.length ? `${moments.length} kept` : "nothing yet" },
    ]}
    onchange={(v) => (tab = v)}
  />
  <label class="find"><Search size={14} /><input type="search" bind:value={filter} placeholder="Filter" aria-label="Filter notes and moments" /></label>

  {#if tab === "notes"}
    <div class="st-keys">
      <button class="st-key small primary" type="button" onclick={() => add(false)}><Plus size={14} /> {chatId ? "Note for this chat" : "New note"}</button>
      {#if chatId}<button class="st-key small" type="button" onclick={() => add(true)}><Plus size={14} /> Global note</button>{/if}
    </div>
    <p class="st-hint top">Plans, ideas and what-ifs. Never sent to the model. Write <code>[[Name]]</code> to link a person, place or lore entry.</p>
    {#each shownNotes as n (n.id)}
      <article class="ix" class:pinned={n.pinned} class:editing={openId === n.id}>
        {#if n.pinned}<span class="tack" aria-hidden="true"></span>{/if}
        {#if openId === n.id}
          <div class="ix-h">
            <input class="ix-title" value={n.title} placeholder="Title" aria-label="Title" oninput={(e) => edit(n, { title: e.currentTarget.value })} />
            <button class="ix-btn" type="button" onclick={() => close(n)} aria-label="Close note" title="Close"><X size={15} /></button>
          </div>
          <textarea class="ix-body" use:autosize={{ max: 520, value: n.body }} use:focusEnd value={n.body} placeholder="What if [[Mira]] already knew?" aria-label="Note" oninput={(e) => edit(n, { body: e.currentTarget.value })}></textarea>
        {:else}
          <button class="ix-open" type="button" onclick={() => (openId = n.id)} aria-label="Open note {n.title || 'untitled'}">
            <b>{n.title || n.body.split("\n")[0]?.slice(0, 80) || "Empty note"}</b>
            {#if n.body && n.title}<span>{excerpt(n.body, 180)}</span>{/if}
          </button>
        {/if}
        {#if n.links.length}
          <div class="st-tags">
            {#each n.links as l (l.text)}
              {#if l.href}<a class="st-chip {l.kind === 'lore' ? 'lav' : 'mint'} lnk" href={l.href}>{l.text}</a>{:else}<span class="st-chip faint" title="Nothing by this name yet">{l.text}</span>{/if}
            {/each}
          </div>
        {/if}
        <div class="ix-meta">
          <span class="st-grow">{n.chatId ? (chatId ? "This chat" : "A chat") : "Global"} · {timeAgo(n.updatedAt)}</span>
          <button class="ix-btn" type="button" onclick={() => edit(n, { pinned: !n.pinned })} aria-label={n.pinned ? "Unpin" : "Pin"} title={n.pinned ? "Unpin" : "Pin to the top"}>{#if n.pinned}<PinOff size={13} />{:else}<Pin size={13} />{/if}</button>
          <button class="ix-btn" type="button" onclick={() => remove(n)} aria-label="Delete note" title="Delete"><Trash size={13} /></button>
        </div>
      </article>
    {:else}
      <div class="st-empty"><NotebookPen size={22} /><p>{q ? "No notes match." : "No notes yet. Jot down where the story could go ✿"}</p></div>
    {/each}
  {:else}
    <p class="st-hint top">Bookmarked messages and passages you highlighted (select text in a message → Highlight). Memory treats them as important.</p>
    {#each shownMoments as m (`${m.kind}:${m.id}`)}
      <article class="clip" class:hl={m.kind === "highlight"}>
        <div class="clip-h">
          {#if m.kind === "bookmark"}<Bookmark size={12} />{:else}<Heart size={12} />{/if}
          <span class="st-grow who">{m.who}{#if !chatId} · {m.chatTitle}{/if}</span>
          <span>{timeAgo(m.at)}</span>
        </div>
        <blockquote>{excerpt(m.text, m.kind === "bookmark" ? 360 : 600)}</blockquote>
        {#if m.note}<p class="clip-note">{m.note}</p>{/if}
        <div class="st-keys">
          {#if chatId && onjump}
            <button class="st-key small ghost" type="button" onclick={() => onjump?.(m.seq)}>Go to it</button>
          {:else}
            <a class="st-key small ghost" href="/chat/{m.chatId}?at={m.seq}">Go to it</a>
          {/if}
          <span class="st-grow"></span>
          <button class="ix-btn" type="button" onclick={() => unmark(m)} aria-label="Remove from moments" title="Remove"><X size={14} /></button>
        </div>
      </article>
    {:else}
      <div class="st-empty"><Heart size={22} /><p>{q ? "Nothing matches." : "No moments yet. Bookmark a message or highlight a line you love."}</p></div>
    {/each}
  {/if}
</div>

<style>
  .find {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 12px;
    border-radius: var(--r-sm);
    background: var(--st-well);
    box-shadow: var(--st-inset-sm);
    color: var(--text-faint);
  }
  .find input {
    flex: 1;
    min-width: 0;
    padding: 8px 0;
    border: 0;
    outline: 0;
    background: none;
    color: var(--text);
    font: 13px/1.3 var(--font-ui);
  }
  /* the wrapper (or the open card) shows the focus instead */
  .find input:focus-visible,
  .ix-title:focus-visible,
  .ix-body:focus-visible {
    box-shadow: none;
  }
  .find:focus-within {
    box-shadow: inset 0 0 0 1.5px var(--accent);
  }
  .top {
    margin-top: -4px;
  }
  .top code {
    font-size: 11.5px;
  }

  /* notes as ruled index cards */
  .ix {
    position: relative;
    display: grid;
    gap: 8px;
    padding: 12px 14px 10px;
    border-radius: 4px 4px var(--r-sm) var(--r-sm);
    background: var(--surface);
    border: var(--st-bw) solid var(--st-edge);
    box-shadow: var(--st-card);
  }
  .ix.pinned {
    border-color: color-mix(in srgb, var(--accent) 50%, var(--st-edge));
  }
  .ix.editing {
    box-shadow:
      var(--st-card),
      0 0 0 1.5px var(--accent);
  }
  .tack {
    position: absolute;
    top: -6px;
    left: 50%;
    width: 14px;
    height: 14px;
    margin-left: -7px;
    border-radius: 50%;
    background: radial-gradient(circle at 35% 35%, color-mix(in srgb, #fff 55%, var(--accent)), var(--accent) 60%, color-mix(in srgb, var(--accent) 60%, #000));
    box-shadow: 0 2px 3px rgb(0 0 0 / 30%);
  }
  /* the red rule under the title, then blue ruled lines that follow the text */
  .ix-h,
  .ix-open b {
    padding-bottom: 6px;
    border-bottom: 1.5px solid color-mix(in srgb, var(--danger) 45%, transparent);
  }
  .ix-body,
  .ix-open span {
    background: repeating-linear-gradient(transparent 0 21px, color-mix(in srgb, var(--st-cool) 24%, transparent) 21px 22px);
  }
  .ix-h {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .ix-title {
    flex: 1;
    min-width: 0;
    padding: 0;
    border: 0;
    outline: 0;
    background: none;
    color: var(--text);
    font: 600 calc(15px * var(--st-hs)) / 1.2 var(--st-head);
  }
  .ix-body {
    width: 100%;
    min-height: 66px;
    padding: 0;
    border: 0;
    outline: 0;
    background: none;
    color: var(--text);
    font: 14px/22px var(--st-story);
    resize: none;
  }
  .ix-open {
    all: unset;
    display: grid;
    gap: 4px;
    cursor: pointer;
  }
  .ix-open:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
    border-radius: 3px;
  }
  .ix-open b {
    font: 600 calc(15px * var(--st-hs)) / 1.25 var(--st-head);
  }
  .ix-open span {
    margin-top: 2px;
    font: 13.5px/22px var(--st-story);
    color: var(--text-muted);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .ix-meta {
    display: flex;
    align-items: center;
    gap: 4px;
    font: 700 9.5px/1.3 var(--st-meta);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-faint);
  }
  .ix-btn {
    display: grid;
    place-items: center;
    flex: 0 0 auto;
    width: 26px;
    height: 26px;
    padding: 0;
    border: 0;
    border-radius: 6px;
    background: none;
    color: var(--text-faint);
    cursor: pointer;
  }
  .ix-btn:hover {
    background: var(--st-fill);
    color: var(--text);
  }
  :root .studio a.lnk {
    text-decoration: none;
    color: inherit;
  }

  /* moments as clippings */
  .clip {
    display: grid;
    gap: 8px;
    padding: 12px 14px 10px;
    border-radius: var(--r-sm);
    background: var(--surface);
    border: var(--st-bw) solid var(--st-edge);
    box-shadow: var(--st-card);
  }
  .clip-h {
    display: flex;
    align-items: center;
    gap: 6px;
    font: 700 9.5px/1.3 var(--st-meta);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-faint);
  }
  .clip-h :global(svg) {
    flex: 0 0 auto;
    color: var(--accent-ink);
  }
  .who {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .clip blockquote {
    margin: 0;
    padding: 2px 0 2px 12px;
    border-left: 3px solid var(--accent);
    font: 14px/1.55 var(--st-story);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .clip.hl blockquote {
    border-left-color: var(--st-warm);
    background: linear-gradient(90deg, color-mix(in srgb, var(--st-warm) 16%, transparent), transparent 70%);
  }
  .clip-note {
    margin: 0;
    font-size: 12px;
    color: var(--text-muted);
  }
</style>
