<script lang="ts">
  import Modal from "../Modal.svelte";
  import { api, download, get } from "../../lib/api";
  import { onEvent } from "../../lib/events";
  import { BookOpen, Download, Import } from "../../lib/icons";
  import { errorToast, toast } from "../../lib/state.svelte";

  // DATA-04 (book export) and DATA-05 (memory export / import).
  let { open = $bindable(false), chatId }: { open?: boolean; chatId: string } = $props();

  let opts = $state({ clean: true, voices: "prose" as "prose" | "names", user: true });
  let outline = $state<{ title: string; chapters: { title: string; subtitle: string; scenes: number; paragraphs: number }[] } | null>(null);
  const query = $derived(`clean=${opts.clean ? 1 : 0}&voices=${opts.voices}&user=${opts.user ? 1 : 0}`);

  $effect(() => {
    if (!open) return;
    const q = query;
    get<typeof outline>(`/api/chats/${chatId}/book/outline?${q}`).then((o) => (outline = o), errorToast);
  });

  function book(format: "epub" | "html" | "pdf") {
    const url = `/api/chats/${chatId}/book?format=${format}&${query}`;
    if (format === "pdf") window.open(url, "_blank", "noopener");
    else download(url);
  }

  let fileInput = $state<HTMLInputElement | null>(null);
  let importing = $state<{ done: number; total: number; label: string } | null>(null);
  $effect(() =>
    onEvent((e) => {
      if (e.type !== "import.progress" || e.chatId !== chatId) return;
      importing = { done: e.done, total: e.total, label: e.label };
      if (e.total && e.done >= e.total) {
        toast("Memory imported", { kind: "ok" });
        setTimeout(() => (importing = null), 1200);
      }
    }),
  );

  let mode = $state<"merge" | "replace">("merge");
  async function importMemory(file: File) {
    const form = new FormData();
    form.append("file", file);
    form.append("mode", mode);
    try {
      const r = await api<{ counts: Record<string, number> }>("POST", `/api/chats/${chatId}/memory/import`, form);
      const n = Object.values(r.counts).reduce((a, b) => a + b, 0);
      importing = { done: 0, total: n, label: "Starting" };
      toast(`Importing ${n.toLocaleString()} items in the background`, { kind: "info" });
    } catch (e) {
      errorToast(e);
    }
  }
</script>

<Modal bind:open title="Export" size="md">
  <div class="stack">
    <section class="stack tight">
      <h3><BookOpen size={16} /> As a book</h3>
      <p class="tiny muted">Your story in chapters, using the chapter titles from memory.</p>
      <label class="switch"><input type="checkbox" bind:checked={opts.clean} /> Clean up the prose (no OOC asides or markup)</label>
      <label class="switch"><input type="checkbox" bind:checked={opts.user} /> Include your messages</label>
      {#if opts.user}
        <label class="field"><span class="label">Your messages</span>
          <select class="select" bind:value={opts.voices}>
            <option value="prose">Woven in, in italics</option>
            <option value="names">Under each speaker's name, like a script</option>
          </select>
        </label>
      {/if}
      {#if outline}
        <div class="outline">
          <b class="small">{outline.title}</b>
          {#each outline.chapters.slice(0, 40) as c, i (i)}
            <div class="row tiny"><span class="grow wraps">{c.title}{#if c.subtitle}<span class="faint"> · {c.subtitle}</span>{/if}</span><span class="faint">{c.paragraphs} ¶</span></div>
          {/each}
          {#if outline.chapters.length > 40}<span class="tiny faint">…and {outline.chapters.length - 40} more</span>{/if}
        </div>
      {/if}
      <div class="row wrap">
        <button class="btn small primary" onclick={() => book("epub")}><Download size={14} /> EPUB</button>
        <button class="btn small" onclick={() => book("html")}><Download size={14} /> HTML</button>
        <button class="btn small" onclick={() => book("pdf")}><Download size={14} /> PDF</button>
      </div>
      <p class="tiny muted">PDF opens the book with the print dialog: choose "Save as PDF".</p>
    </section>

    <section class="stack tight">
      <h3>Memory</h3>
      <p class="tiny muted">Summaries, memories, people and places, journals, trackers and notes, as one JSON file. Import it into another chat (a branch, or a fresh copy of the story).</p>
      <label class="field"><span class="label">When importing</span>
        <select class="select" bind:value={mode}>
          <option value="merge">Add to this chat's memory</option>
          <option value="replace">Replace this chat's memory</option>
        </select>
      </label>
      <div class="row wrap">
        <button class="btn small" onclick={() => download(`/api/chats/${chatId}/memory/export`)}><Download size={14} /> Export memory</button>
        <button class="btn small" onclick={() => fileInput?.click()} disabled={Boolean(importing)}><Import size={14} /> Import memory</button>
        <input bind:this={fileInput} type="file" accept=".json,application/json" hidden onchange={(e) => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ""; if (f) void importMemory(f); }} />
      </div>
      {#if importing}
        <div class="stack tight" aria-live="polite">
          <progress max={importing.total || 1} value={importing.done}></progress>
          <span class="tiny muted">{importing.label} · {importing.done.toLocaleString()} / {importing.total.toLocaleString()}</span>
        </div>
      {/if}
    </section>
  </div>
</Modal>

<style>
  h3 {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 1rem;
    margin: 0;
  }
  .outline {
    display: grid;
    gap: 0.15rem;
    max-height: 12rem;
    overflow-y: auto;
    padding: 0.5rem 0.7rem;
    border: 1px solid var(--border);
    border-radius: 8px;
  }
  progress {
    width: 100%;
  }
</style>
