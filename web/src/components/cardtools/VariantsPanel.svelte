<script lang="ts">
  import Avatar from "../Avatar.svelte";
  import { del, get, post, put } from "../../lib/api";
  import { confirm } from "../../lib/dialogs.svelte";
  import { wordDiff } from "../../lib/diff";
  import { autosize } from "../../lib/gestures";
  import { Loader, MessageHeart, Plus, RotateCcw, Shirt, Sparkles, Trash } from "../../lib/icons";
  import { navigate } from "../../lib/router.svelte";
  import { errorToast, toast } from "../../lib/state.svelte";

  /**
   * Versions and variants (CHAR-06, PER-05): an outfit, an era, an AU. A variant overrides only the
   * fields you choose; everything else follows the base, so edits to the base reach every variant.
   */
  type Overlay = Record<string, string | string[]>;
  type Variant = { id: string; name: string; note: string; overlay: Overlay; avatarId: string | null };
  let {
    ownerType,
    ownerId,
    base,
    gallery = [],
  }: { ownerType: "character" | "persona"; ownerId: string; base: () => Record<string, unknown>; gallery?: string[] } = $props();

  const FIELDS: Record<string, [string, string][]> = {
    character: [
      ["description", "Description"],
      ["personality", "Personality"],
      ["scenario", "Scenario"],
      ["first_mes", "First message"],
      ["mes_example", "Example dialogue"],
      ["system_prompt", "System prompt"],
      ["post_history_instructions", "Rules"],
    ],
    persona: [
      ["description", "Description"],
      ["appearance", "Appearance"],
      ["personality", "Personality"],
      ["background", "Background"],
      ["pronouns", "Pronouns"],
    ],
  };
  const fields = $derived(FIELDS[ownerType]!);
  const path = $derived(ownerType === "persona" ? "personas" : "characters");

  let variants = $state<Variant[]>([]);
  let selected = $state<Variant | null>(null);
  let idea = $state("");
  let drafting = $state(false);
  let proposal = $state<{ name: string; note: string; overlay: Overlay } | null>(null);
  let saving = $state(false);

  async function load() {
    try {
      variants = (await get<{ variants: Variant[] }>(`/api/${path}/${ownerId}/variants`)).variants;
      if (selected) selected = structuredClone($state.snapshot(variants.find((v) => v.id === selected!.id) ?? null));
    } catch (e) {
      errorToast(e);
    }
  }
  $effect(() => {
    void ownerId;
    void load();
  });

  async function draft() {
    drafting = true;
    try {
      proposal = await post(`/api/${path}/${ownerId}/variants/draft`, { idea });
    } catch (e) {
      errorToast(e);
    } finally {
      drafting = false;
    }
  }

  async function create(input: { name: string; note?: string; overlay?: Overlay }) {
    try {
      const v = await post<Variant>(`/api/${path}/${ownerId}/variants`, input);
      proposal = null;
      idea = "";
      await load();
      selected = structuredClone(v);
    } catch (e) {
      errorToast(e);
    }
  }

  async function save() {
    if (!selected) return;
    saving = true;
    try {
      await put(`/api/variants/${selected.id}`, { name: selected.name, note: selected.note, overlay: $state.snapshot(selected.overlay), avatarId: selected.avatarId });
      await load();
      toast("Variant saved", { kind: "ok" });
    } catch (e) {
      errorToast(e);
    } finally {
      saving = false;
    }
  }

  async function remove(v: Variant) {
    if (!(await confirm({ title: `Delete “${v.name}”?`, message: "Chats playing it go back to the base.", confirmLabel: "Delete", danger: true }))) return;
    await del(`/api/variants/${v.id}`);
    if (selected?.id === v.id) selected = null;
    await load();
  }

  async function chat(v: Variant) {
    try {
      const c = await post<{ id: string }>("/api/chats", { characterId: ownerId, variantId: v.id });
      navigate(`/chat/${c.id}`);
    } catch (e) {
      errorToast(e);
    }
  }

  const baseText = (k: string) => String(base()[k] ?? "");
  const overridden = $derived(selected ? fields.filter(([k]) => typeof selected!.overlay[k] === "string") : []);
  const free = $derived(selected ? fields.filter(([k]) => typeof selected!.overlay[k] !== "string") : []);
</script>

<div class="stack">
  <p class="small muted">A variant is the same {ownerType === "persona" ? "you" : "character"} in another outfit, era or universe. It overrides only the fields you choose; everything else follows the base, so edits to the base reach every variant. {ownerType === "character" ? "Each chat picks which variant it plays." : "Each chat picks which variant you play."}</p>

  <section class="panel stack tight">
    <span class="label"><Sparkles size={14} /> New variant from an idea</span>
    <div class="row wrap">
      <input class="input grow" bind:value={idea} placeholder="Winter outfit · modern AU · ten years later · as a vampire" onkeydown={(e) => e.key === "Enter" && idea.trim() && draft()} aria-label="Variant idea" />
      <button class="btn primary" onclick={draft} disabled={drafting || !idea.trim()}>{#if drafting}<span class="spin"><Loader size={14} /></span> Drafting…{:else}Draft it{/if}</button>
      <button class="btn ghost" onclick={() => create({ name: idea.trim() || "New variant" })}><Plus size={14} /> Blank</button>
    </div>
    {#if proposal}
      <div class="proposal stack tight">
        <b>{proposal.name}</b>{#if proposal.note}<span class="small muted">{proposal.note}</span>{/if}
        {#each Object.entries(proposal.overlay) as [k, v] (k)}
          <div class="small"><span class="label">{fields.find(([f]) => f === k)?.[1] ?? k}</span>
            <p class="diff">{#each wordDiff(baseText(k), String(v)) as part, i (i)}<span class={part.type}>{part.text}</span>{/each}</p>
          </div>
        {:else}
          <span class="tiny muted">The model changed nothing. Try a more specific idea.</span>
        {/each}
        <div class="row">
          <button class="btn ghost small" onclick={() => (proposal = null)}>Discard</button>
          <button class="btn primary small" onclick={() => create(proposal!)} disabled={!Object.keys(proposal.overlay).length}>Save as a variant</button>
        </div>
      </div>
    {/if}
  </section>

  {#each variants as v (v.id)}
    <div class="variant card" class:on={selected?.id === v.id}>
      <button class="pick" onclick={() => (selected = selected?.id === v.id ? null : structuredClone($state.snapshot(v)))}>
        <Shirt size={15} />
        <span class="grow"><b>{v.name}</b><span class="tiny muted">{v.note || `${Object.keys(v.overlay).length} field${Object.keys(v.overlay).length === 1 ? "" : "s"} changed`}</span></span>
      </button>
      {#if ownerType === "character"}<button class="btn ghost small" onclick={() => chat(v)}><MessageHeart size={13} /> Chat</button>{/if}
      <button class="btn ghost icon small" onclick={() => remove(v)} aria-label="Delete variant"><Trash size={13} /></button>
    </div>
    {#if selected?.id === v.id}
      <div class="editor stack">
        <div class="row wrap">
          <label class="field grow"><span class="label">Name</span><input class="input" bind:value={selected.name} /></label>
          <label class="field grow"><span class="label">Note</span><input class="input" bind:value={selected.note} placeholder="What's different" /></label>
        </div>
        {#if ownerType === "character" && gallery.length}
          <div class="field">
            <span class="label">Portrait for this variant</span>
            <div class="row wrap">
              <button class="pic" class:on={!selected.avatarId} onclick={() => (selected!.avatarId = null)}>Base</button>
              {#each gallery as g (g)}<button class="pic" class:on={selected.avatarId === g} onclick={() => (selected!.avatarId = g)} aria-label="Use this portrait"><Avatar id={g} name={selected.name} size={48} /></button>{/each}
            </div>
          </div>
        {/if}
        {#each overridden as [k, label] (k)}
          <label class="field">
            <span class="label">{label} <button class="btn ghost small" onclick={(e) => { e.preventDefault(); const o = { ...selected!.overlay }; delete o[k]; selected!.overlay = o; }}><RotateCcw size={12} /> Use the base</button></span>
            <textarea class="textarea story" use:autosize={{ max: 420, value: String(selected.overlay[k]) }} value={String(selected.overlay[k])} oninput={(e) => (selected!.overlay[k] = e.currentTarget.value)}></textarea>
          </label>
        {/each}
        {#if free.length}
          <div class="row wrap">
            <span class="tiny muted">Following the base: {free.map(([, l]) => l.toLowerCase()).join(", ")}.</span>
            <select class="select mini" onchange={(e) => { const k = e.currentTarget.value; if (k) { selected!.overlay = { ...selected!.overlay, [k]: baseText(k) }; e.currentTarget.value = ""; } }} aria-label="Change a field">
              <option value="">Change a field…</option>
              {#each free as [k, l] (k)}<option value={k}>{l}</option>{/each}
            </select>
          </div>
        {/if}
        <div class="row"><button class="btn primary" onclick={save} disabled={saving}>{saving ? "Saving…" : "Save variant"}</button></div>
      </div>
    {/if}
  {:else}
    <p class="small muted">No variants yet.</p>
  {/each}
</div>

<style>
  .grow {
    flex: 1 1 12rem;
    min-width: 0;
  }
  .proposal {
    border-top: 1px solid var(--border);
    padding-top: 0.6rem;
  }
  .diff {
    margin: 0.2rem 0 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    max-height: 12rem;
    overflow: auto;
  }
  .del {
    background: color-mix(in srgb, var(--danger) 14%, transparent);
    text-decoration: line-through;
  }
  .add {
    background: color-mix(in srgb, var(--mint) 35%, transparent);
  }
  .variant {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.3rem 0.6rem 0.3rem 0.3rem;
  }
  .variant.on {
    border: 2px solid var(--accent);
  }
  .pick {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    border: 0;
    background: none;
    font: inherit;
    color: var(--text);
    text-align: left;
    cursor: pointer;
    padding: 0.4rem;
  }
  .pick .grow {
    display: grid;
  }
  .editor {
    padding: 0.2rem 0.4rem 0.8rem 1.4rem;
    border-left: 2px solid var(--accent);
  }
  .pic {
    border: 2px solid transparent;
    border-radius: 12px;
    background: none;
    padding: 2px;
    cursor: pointer;
    font: inherit;
    font-size: var(--fs-xs);
    color: var(--text);
    min-height: 2.5rem;
  }
  .pic.on {
    border-color: var(--accent);
  }
  .mini {
    width: auto;
    padding-top: 0.3rem;
    padding-bottom: 0.3rem;
    font-size: var(--fs-xs);
  }
  .spin {
    display: inline-grid;
    animation: spin 1s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
