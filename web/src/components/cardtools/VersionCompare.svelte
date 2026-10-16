<script lang="ts">
  import Modal from "../Modal.svelte";
  import { get } from "../../lib/api";
  import { wordDiff } from "../../lib/diff";
  import { errorToast } from "../../lib/state.svelte";

  /** A version next to its original, field by field, plus the lorebooks each one uses (docs/14). */
  type Field = { key: string; label: string; original: string; version: string; same: boolean };
  type Book = { id: string; name: string };
  type Entry = { title: string; state: string; from: string; original: string; version: string };
  type Compared = { originId: string; fields: Field[]; books: { shared: Book[]; originalOnly: Book[]; versionOnly: Book[] }; entries?: Entry[] };

  let { open = $bindable(false), kind, id, originName }: { open?: boolean; kind: "character" | "persona"; id: string; originName: string } = $props();

  let data = $state<Compared | null>(null);
  let showSame = $state(false);

  $effect(() => {
    if (!open) return;
    data = null;
    get<Compared>(`/api/${kind === "persona" ? "personas" : "characters"}/${id}/compare`)
      .then((r) => (data = r))
      .catch((e) => {
        errorToast(e);
        open = false;
      });
  });

  const changed = $derived(data?.fields.filter((f) => !f.same) ?? []);
  const same = $derived(data?.fields.filter((f) => f.same) ?? []);
</script>

<Modal bind:open title="Compare with {originName}" size="xl">
  {#if !data}
    <p class="muted small">Reading both…</p>
  {:else}
    <div class="stack">
      <p class="small muted">{changed.length ? `${changed.length} field${changed.length === 1 ? "" : "s"} differ` : "Every field matches the original"}{same.length ? `, ${same.length} the same` : ""}. Removed text is struck through, added text is highlighted.</p>
      {#each changed as f (f.key)}
        <section class="field-cmp">
          <span class="label">{f.label}</span>
          <div class="cols">
            <div class="col"><span class="tiny faint">{originName}</span><p class="text">{f.original || "—"}</p></div>
            <div class="col"><span class="tiny faint">This version</span><p class="text">{#each wordDiff(f.original, f.version) as part, i (i)}<span class={part.type}>{part.text}</span>{/each}</p></div>
          </div>
        </section>
      {/each}
      {#if same.length}
        <button class="btn ghost small" onclick={() => (showSame = !showSame)}>{showSame ? "Hide" : "Show"} the {same.length} field{same.length === 1 ? "" : "s"} that match</button>
        {#if showSame}
          {#each same as f (f.key)}
            <section class="field-cmp"><span class="label">{f.label}</span><p class="text small">{f.version}</p></section>
          {/each}
        {/if}
      {/if}
      <section class="stack tight">
        <span class="label">Lorebooks</span>
        {#if data.books.shared.length}<p class="small">Shared with the original: {data.books.shared.map((b) => b.name).join(", ")}</p>{/if}
        {#if data.books.versionOnly.length}<p class="small">Only this version: {data.books.versionOnly.map((b) => b.name).join(", ")}</p>{/if}
        {#if data.books.originalOnly.length}<p class="small">Only the original: {data.books.originalOnly.map((b) => b.name).join(", ")}</p>{/if}
        {#if !data.books.shared.length && !data.books.versionOnly.length && !data.books.originalOnly.length}<p class="small muted">Neither has a lorebook.</p>{/if}
      </section>
      {#if data.entries?.length}
        <section class="stack tight">
          <span class="label">Entries <span class="faint">{data.entries.filter((e) => e.state === "kept").length} kept · {data.entries.filter((e) => e.state === "changed").length} translated · {data.entries.filter((e) => e.state === "new").length} new</span></span>
          {#each data.entries.filter((e) => e.state !== "kept") as e, i (i)}
            <section class="field-cmp">
              <span class="label">{e.from && e.from !== e.title ? `${e.from} → ${e.title}` : e.title}{e.state === "new" ? " (new)" : ""}</span>
              <div class="cols">
                <div class="col"><span class="tiny faint">{originName}</span><p class="text small">{e.original || "—"}</p></div>
                <div class="col"><span class="tiny faint">This version</span><p class="text small">{e.version}</p></div>
              </div>
            </section>
          {/each}
        </section>
      {/if}
    </div>
  {/if}
</Modal>

<style>
  .field-cmp {
    border-top: 1px solid var(--border);
    padding-top: 0.6rem;
  }
  .cols {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.8rem;
  }
  @media (max-width: 640px) {
    .cols {
      grid-template-columns: 1fr;
    }
  }
  .col {
    min-width: 0;
  }
  .text {
    margin: 0.2rem 0 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    max-height: 18rem;
    overflow: auto;
  }
  .del {
    background: color-mix(in srgb, var(--danger) 14%, transparent);
    text-decoration: line-through;
  }
  .add {
    background: color-mix(in srgb, var(--mint) 35%, transparent);
  }
</style>
