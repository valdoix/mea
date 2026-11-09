<script lang="ts">
  import ChangeChips from "../../trackers/ChangeChips.svelte";
  import NotThere from "../../trackers/NotThere.svelte";
  import ContinuityNote from "../ContinuityNote.svelte";
  import FiledChips from "../FiledChips.svelte";
  import { filed } from "../../../lib/filings.svelte";
  import { folio, openColumn, type NoteKind } from "../../../lib/folio.svelte";
  import { Bookmark, Brain, ExternalLink, Globe, Heart, MessagesSquare } from "../../../lib/icons";
  import { byRank } from "../../../lib/castroll";
  import type { Citation, ContinuityFlag, GlossaryTerm, Message, TrackerChange } from "../../../lib/types";

  /**
   * Folio: what Mea noticed in one message, beside it. `margin` is the full note with a leader line,
   * `spine` the same notes folded to dots while columns are open, and `tuck` chips under the message
   * on a phone. A note pulls out into a column; a person or place opens their Codex page.
   */
  let {
    message,
    chatId,
    chips = [],
    flag = null,
    passages = [],
    terms = [],
    mode,
    canRegenerate = false,
    onflagchange,
    oncite,
  }: {
    message: Message;
    chatId: string;
    chips?: TrackerChange[];
    flag?: ContinuityFlag | null;
    passages?: string[];
    terms?: GlossaryTerm[];
    mode: "margin" | "spine" | "tuck";
    canRegenerate?: boolean;
    onflagchange: (f: ContinuityFlag | null) => void;
    oncite: (c: Citation) => void;
  } = $props();

  const WORLD = new Set(["clock", "weather", "place", "scene", "calendar", "faction", "deadline", "gauge", "pressure"]);
  const MEMORY = new Set(["knowledge", "secret", "milestone", "journal", "clue", "plant", "motif"]);
  const meta: Record<NoteKind, { label: string; icon: typeof Brain; tab: "memory" | "story" | "world" | "meus" | "notes" }> = {
    memory: { label: "Memory", icon: Brain, tab: "memory" },
    story: { label: "Story", icon: Heart, tab: "story" },
    world: { label: "World", icon: Globe, tab: "world" },
    meus: { label: "Meus", icon: MessagesSquare, tab: "meus" },
    notes: { label: "Notes", icon: Bookmark, tab: "notes" },
  };

  // Private thoughts and hidden feelings stay in the drawer under the reply.
  const shown = $derived(chips.filter((c) => c.kind !== "thought" && c.kind !== "mask").sort(byRank));
  const kindOf = (c: TrackerChange): NoteKind => (WORLD.has(c.kind) ? "world" : c.memory || MEMORY.has(c.kind) ? "memory" : "story");
  const groups = $derived.by(() => {
    const by: Record<NoteKind, TrackerChange[]> = { memory: [], story: [], world: [], meus: [], notes: [] };
    for (const c of shown) by[kindOf(c)].push(c);
    return by;
  });
  const hasFiled = $derived((filed.byMessage[message.id] ?? []).length > 0);
  const hasNotes = $derived(passages.length > 0 || message.bookmarked);
  /** What this message has, in margin order, for the dots and chips. */
  const kinds = $derived(
    (["memory", "story", "world", "meus", "notes"] as NoteKind[]).filter((k) => {
      if (!folio.filters[k]) return false;
      if (k === "memory") return groups.memory.length > 0 || hasFiled;
      if (k === "meus") return Boolean(flag);
      if (k === "notes") return hasNotes;
      return groups[k].length > 0;
    }),
  );

  let openTuck = $state<NoteKind | null>(null);
  let more = $state(false);

  const count = (k: NoteKind) => (k === "memory" ? groups.memory.length + (filed.byMessage[message.id]?.length ?? 0) : k === "meus" ? (flag?.open ?? 0) : k === "notes" ? passages.length + (message.bookmarked ? 1 : 0) : groups[k].length);
  const pull = (k: NoteKind) => openColumn(meta[k].tab, { from: message.seq });
  /** Someone or somewhere this note is about, when the Codex knows them. */
  const entityOf = (c: TrackerChange) => {
    const name = c.subject?.toLowerCase();
    return name ? terms.find((t) => t.entryId.startsWith("entity:") && t.title.toLowerCase() === name) : undefined;
  };
  function openEntity(t: GlossaryTerm) {
    openColumn("entity", { entityId: t.entryId.slice(7), chatId, title: t.title, from: message.seq });
  }
</script>

{#snippet note(k: NoteKind)}
  {@const Icon = meta[k].icon}
  <div class="mn {k}">
    <span class="g"><Icon size={14} /></span>
    <div class="mb">
      <span class="k">{meta[k].label}</span>
      {#if k === "meus" && flag}
        <ContinuityNote {flag} {canRegenerate} onchange={onflagchange} {oncite} />
      {:else if k === "notes"}
        {#if message.bookmarked}<p>Bookmarked</p>{/if}
        {#each passages as p, i (i)}<p class="quote">“{p}”</p>{/each}
      {:else}
        {@const list = groups[k]}
        <!-- A line each, as a pencilled note; what the world did off the page keeps its Why and Undo. -->
        {#each list.filter((c) => !c.event) as c, i (i)}<p class="line" class:up={c.tone === "up"} class:down={c.tone === "down"} title={c.reason}>{#if c.subject && !c.text.toLowerCase().includes(c.subject.toLowerCase())}<b>{c.subject}:</b> {/if}{c.text}<NotThere change={c} /></p>{/each}
        {#if list.some((c) => c.event)}<ChangeChips changes={list.filter((c) => c.event)} />{/if}
        {#if k === "memory"}<FiledChips messageId={message.id} />{/if}
        {@const who = list.map(entityOf).find(Boolean)}
        {#if who}<button class="pull" onclick={() => openEntity(who)}><ExternalLink size={12} /> Open {who.title} as a column</button>{/if}
      {/if}
      <button class="pull quiet" onclick={() => pull(k)}><ExternalLink size={12} /> Open {meta[k].label} as a column</button>
    </div>
  </div>
{/snippet}

{#if mode === "margin"}
  <div class="f-notes" class:empty={!kinds.length}>
    {#each more ? kinds : kinds.slice(0, 3) as k (k)}{@render note(k)}{/each}
    {#if !more && kinds.length > 3}<button class="pull quiet always" onclick={() => (more = true)}>{kinds.length - 3} more</button>{/if}
  </div>
{:else if mode === "spine"}
  <div class="f-spine">
    {#each kinds as k (k)}
      {@const Icon = meta[k].icon}
      <button class="dot {k}" class:pulled={folio.columns.some((c) => c.kind === meta[k].tab && c.from === message.seq)} onclick={() => pull(k)} aria-label="{meta[k].label}: open as a column" title="{meta[k].label} · {count(k)}"><Icon size={12} /></button>
    {/each}
  </div>
{:else if kinds.length}
  <div class="f-tucks">
    <div class="tucks">
      {#each kinds as k (k)}
        {@const Icon = meta[k].icon}
        <button class="tuck {k}" aria-expanded={openTuck === k} onclick={() => (openTuck = openTuck === k ? null : k)}><Icon size={12} /> {meta[k].label}{count(k) > 1 ? ` · ${count(k)}` : ""}</button>
      {/each}
    </div>
    {#if openTuck && kinds.includes(openTuck)}<div class="tuck-open">{@render note(openTuck)}</div>{/if}
  </div>
{/if}
