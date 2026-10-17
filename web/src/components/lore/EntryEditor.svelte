<script lang="ts">
  import Modal from "../Modal.svelte";
  import TagInput from "../TagInput.svelte";
  import FactsList from "./FactsList.svelte";
  import { get, post } from "../../lib/api";
  import { promptText } from "../../lib/dialogs.svelte";
  import { autosize } from "../../lib/gestures";
  import { Plus, Trash, WandSparkles } from "../../lib/icons";
  import { errorToast, toast } from "../../lib/state.svelte";
  import type { LoreEntry } from "../../lib/types";

  let { entry = $bindable(), full, siblings = [], onchange }: { entry: LoreEntry | undefined; full: boolean; siblings?: { id: string; title: string }[]; onchange?: () => void } = $props();

  const nullableBool = (v: string) => (v === "" ? null : v === "true");

  // Phase 3 fields live in `extra`, so SillyTavern imports and exports carry them (LORE-09, LORE-10).
  type Secret = { text: string; knownBy: string[] };
  const x = $derived((entry?.extra ?? {}) as { type?: string; aliases?: string[]; secrets?: Secret[]; parent?: string; folder?: string; essentials?: string; semantic?: boolean; entity?: string });
  function setX(key: string, value: unknown) {
    if (!entry) return;
    const next = { ...(entry.extra ?? {}) } as Record<string, unknown>;
    if (value === undefined || value === "" || (Array.isArray(value) && !value.length)) delete next[key];
    else next[key] = value;
    entry.extra = next;
    onchange?.();
  }
  const TYPES = [
    ["", "Plain entry"],
    ["character", "Character"],
    ["location", "Location"],
    ["item", "Item"],
    ["faction", "Faction"],
    ["concept", "Concept"],
    ["event", "Event"],
    ["rule", "Rule"],
  ];
  // docs/15, 7.3: a shorter text, every name and number kept (yours waits in the Inbox), and its Undo.
  async function shorten() {
    if (!entry?.id) return;
    assisting = true;
    try {
      const r = await post<{ status: string; reason?: string }>(`/api/lore/entries/${entry.id}/compact`, {});
      toast(r.status === "proposed" ? "A shorter version is waiting in the Inbox" : r.status === "replaced" ? "Shortened (Undo is on the entry)" : r.status === "rejected" ? `Kept as it was: the shorter version ${r.reason}` : `Kept as it was: ${r.reason}`, { kind: "ok" });
    } catch (e) {
      errorToast(e);
    } finally {
      assisting = false;
    }
  }
  async function undoShorten() {
    if (!entry?.id) return;
    try {
      await post(`/api/lore/entries/${entry.id}/compact/decide`, { action: "undo" });
      const x = { ...(entry.extra as { compactUndo?: { content: string } }) };
      if (x.compactUndo) entry.content = x.compactUndo.content;
      delete x.compactUndo;
      entry.extra = x;
      toast("The longer text is back", { kind: "ok" });
    } catch (e) {
      errorToast(e);
    }
  }
  async function insertTemplate() {
    if (!entry || !x.type) return;
    try {
      const r = await get<{ content: string }>(`/api/lore/templates/${x.type}?name=${encodeURIComponent(entry.comment)}`);
      entry.content = entry.content.trim() ? `${entry.content.trim()}\n\n${r.content}` : r.content;
      onchange?.();
    } catch (e) {
      errorToast(e);
    }
  }

  // ---------- AI assist (LORE-11): a proposal shown before/after, accepted by you ----------
  interface Proposal {
    comment: string;
    content: string;
    keys: string[];
    aliases: string[];
    essentials: string;
    tokens: { before: number; after: number };
  }
  let proposal = $state<Proposal | null>(null);
  let proposalAction = $state("");
  let assisting = $state(false);
  async function assist(action: "draft" | "keys" | "condense" | "rewrite") {
    if (!entry) return;
    let idea: string | undefined;
    if (action === "draft") {
      const v = await promptText({ title: "Draft an entry", label: "A one-line idea", placeholder: "A crooked inn by the docks, run by Joss, with a smugglers' cellar", confirmLabel: "Draft" });
      if (!v?.trim()) return;
      idea = v.trim();
    }
    assisting = true;
    try {
      proposal = await post<Proposal>("/api/lore/assist", { action, idea, comment: entry.comment || undefined, content: entry.content || undefined, keys: entry.keys, type: x.type || undefined });
      proposalAction = action;
    } catch (e) {
      errorToast(e);
    } finally {
      assisting = false;
    }
  }
  function acceptProposal() {
    if (!entry || !proposal) return;
    if (proposal.content) entry.content = proposal.content;
    if (proposal.comment && !entry.comment.trim()) entry.comment = proposal.comment;
    entry.keys = [...new Set([...entry.keys, ...proposal.keys])];
    if (proposal.aliases.length) setX("aliases", [...new Set([...(x.aliases ?? []), ...proposal.aliases])]);
    if (proposal.essentials && !x.essentials) setX("essentials", proposal.essentials);
    proposal = null;
    onchange?.();
  }
</script>

{#if entry}
<div class="stack">
  <div class="row wrap">
    <label class="field grow"><span class="label">Title</span><input class="input" bind:value={entry.comment} placeholder="e.g. The lighthouse" /></label>
    <label class="switch" title="Always in the prompt"><input type="checkbox" bind:checked={entry.constant} /> Always on</label>
    <label class="switch"><input type="checkbox" bind:checked={entry.enabled} /> Enabled</label>
  </div>
  <label class="field">
    <span class="label">Keywords <span class="faint">matched in recent messages · /regex/ allowed</span></span>
    <TagInput bind:value={entry.keys} placeholder={entry.constant ? "Not needed for always-on entries" : "Add a keyword and press Enter"} />
  </label>
  <div class="row wrap">
    <label class="field narrow"><span class="label">Type</span>
      <select class="select" value={x.type ?? ""} onchange={(e) => setX("type", e.currentTarget.value || undefined)}>{#each TYPES as [v, l] (v)}<option value={v}>{l}</option>{/each}</select>
    </label>
    {#if x.type}<button class="btn ghost small" onclick={insertTemplate} title="Suggested fields for this type">Insert fields</button>{/if}
    <label class="field grow"><span class="label">Also called <span class="faint">aliases count as keywords</span></span><TagInput bind:value={() => x.aliases ?? [], (v) => setX("aliases", v)} placeholder="the old inn, the Gull" /></label>
  </div>
  <label class="field">
    <span class="label">Content</span>
    <textarea class="textarea story" use:autosize={500} bind:value={entry.content} placeholder="What the model should know when this fires"></textarea>
  </label>
  <div class="row wrap assist">
    <WandSparkles size={14} />
    <button class="btn ghost small" onclick={() => assist("draft")} disabled={assisting}>Draft from an idea</button>
    <button class="btn ghost small" onclick={() => assist("keys")} disabled={assisting || !entry.content.trim()}>Suggest keywords</button>
    <button class="btn ghost small" onclick={() => assist("condense")} disabled={assisting || !entry.content.trim()}>Condense</button>
    <button class="btn ghost small" onclick={() => assist("rewrite")} disabled={assisting || !entry.content.trim()}>Tidy the style</button>
    {#if entry.id && entry.content.length > 2400}<button class="btn ghost small" onclick={shorten} disabled={assisting} title="Every name and number kept; the facts aren't touched">Shorten</button>{/if}
    {#if (entry.extra as { compactUndo?: unknown })?.compactUndo}<button class="btn ghost small" onclick={undoShorten}>Undo the shortening</button>{/if}
    {#if assisting}<span class="tiny muted">Thinking…</span>{/if}
  </div>
  <label class="field">
    <span class="label">Essentials <span class="faint">one sentence; used when the budget is tight, or when a child entry fires</span></span>
    <input class="input" value={x.essentials ?? ""} onchange={(e) => setX("essentials", e.currentTarget.value.trim() || undefined)} placeholder="Port Ellis is a cold fishing town on the northern coast." />
  </label>
  {#if entry.id}<FactsList entryId={entry.id} type={x.type ?? null} />{/if}

  {#if full}
    <div class="grid2">
      <label class="field">
        <span class="label">Secondary keywords</span>
        <TagInput bind:value={entry.secondaryKeys} placeholder="Optional filter" />
      </label>
      <label class="field">
        <span class="label">Secondary logic</span>
        <select class="select" bind:value={entry.logic}>
          <option value="and_any">AND any secondary</option>
          <option value="and_all">AND all secondary</option>
          <option value="not_any">NOT any secondary</option>
          <option value="not_all">NOT all secondary</option>
        </select>
      </label>
      <label class="field">
        <span class="label">Position</span>
        <select class="select" bind:value={entry.position}>
          <option value="before_char">Before character</option>
          <option value="after_char">After character</option>
          <option value="an_top">Top of author's note</option>
          <option value="an_bottom">Bottom of author's note</option>
          <option value="ex_top">Before examples</option>
          <option value="ex_bottom">After examples</option>
          <option value="depth">In chat at depth…</option>
        </select>
      </label>
      {#if entry.position === "depth"}
        <div class="row">
          <label class="field grow"><span class="label">Depth</span><input class="input" type="number" min="0" bind:value={entry.depth} /></label>
          <label class="field grow">
            <span class="label">Role</span>
            <select class="select" bind:value={entry.role}><option value="system">System</option><option value="user">User</option><option value="assistant">Assistant</option></select>
          </label>
        </div>
      {/if}
      <label class="field"><span class="label">Order <span class="faint">higher = more priority</span></span><input class="input" type="number" bind:value={entry.order} /></label>
      <label class="field">
        <span class="label">Probability <span class="faint">{entry.useProbability ? `${entry.probability}%` : "off"}</span></span>
        <div class="row"><input type="checkbox" bind:checked={entry.useProbability} aria-label="Use probability" /><input type="range" min="0" max="100" bind:value={entry.probability} disabled={!entry.useProbability} /></div>
      </label>
      <label class="field"><span class="label">Scan depth <span class="faint">blank = book default</span></span><input class="input" type="number" min="0" value={entry.scanDepth ?? ""} oninput={(e) => (entry.scanDepth = e.currentTarget.value === "" ? null : Number(e.currentTarget.value))} /></label>
      <label class="field">
        <span class="label">Case sensitive</span>
        <select class="select" value={String(entry.caseSensitive ?? "")} onchange={(e) => (entry.caseSensitive = nullableBool(e.currentTarget.value))}><option value="">Book default</option><option value="true">Yes</option><option value="false">No</option></select>
      </label>
      <label class="field">
        <span class="label">Whole words</span>
        <select class="select" value={String(entry.matchWholeWords ?? "")} onchange={(e) => (entry.matchWholeWords = nullableBool(e.currentTarget.value))}><option value="">Book default</option><option value="true">Yes</option><option value="false">No</option></select>
      </label>
      <label class="field"><span class="label">Inclusion group</span><input class="input" bind:value={entry.group} placeholder="Only one entry per group fires" /></label>
      <label class="field"><span class="label">Group weight</span><input class="input" type="number" min="0" bind:value={entry.groupWeight} /></label>
      <label class="field"><span class="label">Sticky <span class="faint">messages</span></span><input class="input" type="number" min="0" bind:value={entry.sticky} /></label>
      <label class="field"><span class="label">Cooldown <span class="faint">messages</span></span><input class="input" type="number" min="0" bind:value={entry.cooldown} /></label>
      <label class="field"><span class="label">Delay <span class="faint">until message #</span></span><input class="input" type="number" min="0" bind:value={entry.delay} /></label>
    </div>
    <div class="grid2">
      <label class="field">
        <span class="label">Part of <span class="faint">its essentials come along</span></span>
        <select class="select" value={x.parent ?? ""} onchange={(e) => setX("parent", e.currentTarget.value || undefined)}>
          <option value="">Nothing</option>
          {#each siblings.filter((s) => s.id !== (entry as { id?: string }).id) as s (s.id)}<option value={s.id}>{s.title}</option>{/each}
        </select>
      </label>
      <label class="field"><span class="label">Folder</span><input class="input" value={x.folder ?? ""} onchange={(e) => setX("folder", e.currentTarget.value.trim() || undefined)} placeholder="Places › Port Ellis" /></label>
      <label class="field">
        <span class="label">Fires on meaning</span>
        <select class="select" value={x.semantic === undefined ? "" : String(x.semantic)} onchange={(e) => setX("semantic", e.currentTarget.value === "" ? undefined : e.currentTarget.value === "true")}>
          <option value="">Book default</option><option value="true">Yes, also without keywords</option><option value="false">No, keywords only</option>
        </select>
      </label>
      <label class="field"><span class="label">Linked to <span class="faint">fires when they're in the scene</span></span><input class="input" value={x.entity ?? ""} onchange={(e) => setX("entity", e.currentTarget.value.trim() || undefined)} placeholder="A person, place or thing" /></label>
    </div>
    <div class="field">
      <span class="label">Secrets <span class="faint">told to the model with who knows them; the leak guard watches them</span></span>
      {#each x.secrets ?? [] as sec, i (i)}
        <div class="row secret">
          <input class="input grow" value={sec.text} onchange={(e) => setX("secrets", (x.secrets ?? []).map((v, j) => (j === i ? { ...v, text: e.currentTarget.value } : v)))} placeholder="The cellar hides smuggled brandy" />
          <input class="input who" value={sec.knownBy.join(", ")} onchange={(e) => setX("secrets", (x.secrets ?? []).map((v, j) => (j === i ? { ...v, knownBy: e.currentTarget.value.split(/\s*,\s*/).filter(Boolean) } : v)))} placeholder="Known by: Joss" />
          <button class="btn ghost icon small" onclick={() => setX("secrets", (x.secrets ?? []).filter((_, j) => j !== i))} aria-label="Remove secret"><Trash size={13} /></button>
        </div>
      {/each}
      <button class="btn ghost small" onclick={() => setX("secrets", [...(x.secrets ?? []), { text: "", knownBy: [] }])}><Plus size={13} /> Secret</button>
    </div>
    <label class="field">
      <span class="label">Only when the story state matches <span class="faint">optional tracker condition</span></span>
      <input
        class="input mono"
        value={(entry.extra?.trackerWhen as string | undefined) ?? ""}
        oninput={(e) => (entry.extra = { ...(entry.extra ?? {}), trackerWhen: e.currentTarget.value || undefined })}
        placeholder="location contains harbor · time_of_day = night"
      />
    </label>
    <div class="row wrap toggles">
      <label class="switch"><input type="checkbox" bind:checked={entry.groupOverride} /> Prioritize in group</label>
      <label class="switch"><input type="checkbox" checked={Boolean(entry.useGroupScoring)} onchange={(e) => (entry.useGroupScoring = e.currentTarget.checked || null)} /> Group scoring</label>
      <label class="switch"><input type="checkbox" bind:checked={entry.excludeRecursion} /> Not triggered by other entries</label>
      <label class="switch"><input type="checkbox" bind:checked={entry.preventRecursion} /> Doesn't trigger other entries</label>
      <label class="switch"><input type="checkbox" bind:checked={entry.delayUntilRecursion} /> Only via other entries</label>
    </div>
  {/if}
</div>

<Modal open={Boolean(proposal)} onclose={() => (proposal = null)} title={proposalAction === "keys" ? "Suggested keywords" : proposalAction === "draft" ? "A draft" : "Suggested version"} size="lg">
  {#if proposal}
    <div class="stack">
      {#if proposalAction !== "keys"}
        <div class="diff">
          <div><div class="label">Now ({proposal.tokens.before} tokens)</div><p class="small pre before">{entry.content || "(empty)"}</p></div>
          <div><div class="label">Suggested ({proposal.tokens.after} tokens)</div><p class="small pre after">{proposal.content}</p></div>
        </div>
      {/if}
      {#if proposal.keys.length}<div class="small"><span class="muted">Keywords</span> {proposal.keys.map((k) => (entry?.keys.includes(k) ? k : `+${k}`)).join(", ")}</div>{/if}
      {#if proposal.aliases.length}<div class="small"><span class="muted">Aliases</span> {proposal.aliases.join(", ")}</div>{/if}
      {#if proposal.essentials}<div class="small"><span class="muted">Essentials</span> {proposal.essentials}</div>{/if}
    </div>
  {/if}
  {#snippet footer()}
    <button class="btn ghost" onclick={() => (proposal = null)}>Keep mine</button>
    <button class="btn primary" onclick={acceptProposal}>Use it</button>
  {/snippet}
</Modal>
{/if}

<style>
  .grid2 {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
    gap: 0.8rem;
  }
  .toggles {
    gap: 1rem;
  }
  .narrow {
    width: 11rem;
  }
  .assist {
    gap: 0.2rem;
    color: var(--text-muted);
    margin-top: -0.4rem;
  }
  .secret {
    gap: 0.4rem;
    margin-bottom: 0.3rem;
    flex-wrap: wrap;
  }
  .secret .grow {
    min-width: 12rem;
    flex: 1;
  }
  .who {
    width: 11rem;
  }
  .diff {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.8rem;
  }
  .pre {
    white-space: pre-wrap;
    margin: 0.3rem 0 0;
    padding: 0.5rem;
    border-radius: var(--r-sm, 8px);
  }
  .before {
    background: color-mix(in srgb, var(--danger) 8%, transparent);
  }
  .after {
    background: color-mix(in srgb, var(--mint, #8fd6b5) 18%, transparent);
  }
  .field.grow {
    min-width: 0;
    flex: 1 1 14rem;
  }
  @media (max-width: 640px) {
    .narrow {
      width: auto;
      flex: 1 1 100%;
    }
    .diff {
      grid-template-columns: 1fr;
    }
    .who {
      width: 100%;
    }
  }
</style>
