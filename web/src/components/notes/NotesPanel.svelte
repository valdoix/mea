<script lang="ts">
  import Segmented from "../Segmented.svelte";
  import { del, get, patch, post, put } from "../../lib/api";
  import { onEvent } from "../../lib/events";
  import { autosize } from "../../lib/gestures";
  import { timeAgo } from "../../lib/format";
  import { Bookmark, Heart, NotebookPen, Pin, PinOff, Plus, Trash, X } from "../../lib/icons";
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

<div class="stack notes">
  <div class="row between wrap">
    <Segmented
      bind:value={tab}
      small
      options={[
        { value: "notes", label: `Notes${notes.length ? ` · ${notes.length}` : ""}` },
        { value: "moments", label: `Best moments${moments.length ? ` · ${moments.length}` : ""}` },
      ]}
    />
    <input class="input search" type="search" bind:value={filter} placeholder="Filter" aria-label="Filter notes and moments" />
  </div>

  {#if tab === "notes"}
    <div class="row wrap">
      <button class="btn small primary" onclick={() => add(false)}><Plus size={14} /> {chatId ? "Note for this chat" : "New note"}</button>
      {#if chatId}<button class="btn small" onclick={() => add(true)}><Plus size={14} /> Global note</button>{/if}
    </div>
    <p class="tiny muted">Plans, ideas and what-ifs. Never sent to the model. Write <code>[[Name]]</code> to link a person, place or lore entry.</p>
    {#each shownNotes as n (n.id)}
      <article class="note card" class:pinned={n.pinned}>
        {#if openId === n.id}
          <div class="row">
            <input class="input title" value={n.title} placeholder="Title" oninput={(e) => edit(n, { title: e.currentTarget.value })} />
            <button class="btn ghost icon small" onclick={() => close(n)} aria-label="Close note"><X size={15} /></button>
          </div>
          <textarea class="textarea" use:autosize={{ max: 520, value: n.body }} use:focusEnd value={n.body} placeholder="What if [[Mira]] already knew?" oninput={(e) => edit(n, { body: e.currentTarget.value })}></textarea>
        {:else}
          <button class="open" onclick={() => (openId = n.id)} aria-label="Open note {n.title || 'untitled'}">
            <b class="small">{n.title || n.body.split("\n")[0]?.slice(0, 80) || "Empty note"}</b>
            {#if n.body && n.title}<span class="tiny muted body">{excerpt(n.body, 180)}</span>{/if}
          </button>
        {/if}
        {#if n.links.length}
          <div class="row wrap links">
            {#each n.links as l (l.text)}
              {#if l.href}<a class="chip {l.kind === 'lore' ? 'lavender' : 'mint'}" href={l.href}>{l.text}</a>{:else}<span class="chip faint" title="Nothing by this name yet">{l.text}</span>{/if}
            {/each}
          </div>
        {/if}
        <div class="row tiny muted meta">
          <span class="grow">{n.chatId ? (chatId ? "This chat" : "A chat") : "Global"} · {timeAgo(n.updatedAt)}</span>
          <button class="btn ghost icon small" onclick={() => edit(n, { pinned: !n.pinned })} aria-label={n.pinned ? "Unpin" : "Pin"} title={n.pinned ? "Unpin" : "Pin to the top"}>{#if n.pinned}<PinOff size={13} />{:else}<Pin size={13} />{/if}</button>
          <button class="btn ghost icon small" onclick={() => remove(n)} aria-label="Delete note"><Trash size={13} /></button>
        </div>
      </article>
    {:else}
      <div class="empty"><NotebookPen size={22} /><p class="small muted">{q ? "No notes match." : "No notes yet. Jot down where the story could go ✿"}</p></div>
    {/each}
  {:else}
    <p class="tiny muted">Bookmarked messages and passages you highlighted (select text in a message → Highlight). Memory treats them as important.</p>
    {#each shownMoments as m (`${m.kind}:${m.id}`)}
      <article class="moment card">
        <div class="row tiny muted">
          {#if m.kind === "bookmark"}<Bookmark size={12} />{:else}<Heart size={12} />{/if}
          <span class="grow truncate">{m.who}{#if !chatId} · {m.chatTitle}{/if}</span>
          <span>{timeAgo(m.at)}</span>
        </div>
        <blockquote class="small">{excerpt(m.text, m.kind === "bookmark" ? 360 : 600)}</blockquote>
        {#if m.note}<p class="tiny muted">{m.note}</p>{/if}
        <div class="row">
          {#if chatId && onjump}
            <button class="btn ghost small" onclick={() => onjump?.(m.seq)}>Go to it</button>
          {:else}
            <a class="btn ghost small" href="/chat/{m.chatId}?at={m.seq}">Go to it</a>
          {/if}
          <span class="grow"></span>
          <button class="btn ghost icon small" onclick={() => unmark(m)} aria-label="Remove from moments"><X size={14} /></button>
        </div>
      </article>
    {:else}
      <div class="empty"><Heart size={22} /><p class="small muted">{q ? "Nothing matches." : "No moments yet. Bookmark a message or highlight a line you love."}</p></div>
    {/each}
  {/if}
</div>

<style>
  .notes {
    gap: 0.7rem;
  }
  .search {
    max-width: 11rem;
    padding-block: 0.3rem;
  }
  .note,
  .moment {
    display: grid;
    gap: 0.4rem;
    padding: 0.65rem 0.8rem;
  }
  .note.pinned {
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  }
  .open {
    all: unset;
    cursor: pointer;
    display: grid;
    gap: 0.2rem;
  }
  .open:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: 4px;
  }
  .body {
    white-space: pre-wrap;
  }
  .title {
    font-weight: 600;
  }
  .links {
    gap: 0.3rem;
  }
  .links a {
    text-decoration: none;
  }
  .meta {
    gap: 0.2rem;
  }
  blockquote {
    margin: 0;
    padding-left: 0.7rem;
    border-left: 3px solid color-mix(in srgb, var(--accent) 50%, transparent);
    font-family: var(--font-story);
    white-space: pre-wrap;
  }
  .empty {
    display: grid;
    justify-items: center;
    gap: 0.3rem;
    padding: 1.5rem 0.5rem;
    text-align: center;
    color: var(--text-muted, inherit);
  }
</style>
