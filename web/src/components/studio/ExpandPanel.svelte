<script lang="ts">
  import { brainstorm } from "../../lib/cowriter.svelte";
  import { promptText } from "../../lib/dialogs.svelte";
  import { autosize } from "../../lib/gestures";
  import { Layers, Loader, MessagesSquare, PenLine, Plus, RefreshCw, Sparkles, X } from "../../lib/icons";
  import type { Expansion, ExpansionPatch } from "../../lib/types";

  /**
   * "Expand my idea": the idea, fleshed out section by section. Every section is yours to edit;
   * "Go deeper" works on one, "Rework" on all of them with a steer. Shared by every studio.
   */
  let {
    expansion,
    busy,
    what = "idea",
    disabled = false,
    onexpand,
    ondeepen,
    onpatch,
  }: {
    expansion: Expansion | null;
    /** The studio's busy label: "expand", or "deepen:<section id>". */
    busy: string;
    what?: string;
    disabled?: boolean;
    onexpand: (steer: string) => void;
    ondeepen: (sectionId: string, steer: string) => void;
    onpatch: (patch: ExpansionPatch, key: string, delay?: number) => void;
  } = $props();

  let steer = $state("");
  let open = $state(true);
  const words = $derived(expansion?.sections.reduce((n, s) => n + s.text.split(/\s+/).filter(Boolean).length, 0) ?? 0);

  async function rewrite(id: string, heading: string) {
    const v = await promptText({ title: `Rewrite “${heading}”`, label: "What should change?", placeholder: "Make the guild the real villain; add a debt", confirmLabel: "Rewrite" });
    if (v?.trim()) ondeepen(id, v.trim());
  }

  function addSection() {
    if (!expansion) return;
    const id = crypto.randomUUID();
    expansion.sections.push({ id, heading: "Notes", text: "" });
    onpatch({ sections: [{ id, heading: "Notes", text: "" }] }, `exp:${id}`, 0);
  }
</script>

<section class="panel stack expand">
  <div class="row between wrap">
    <button class="head" onclick={() => (open = !open)} aria-expanded={open}>
      <Layers size={16} />
      <b>Expand my {what}</b>
      {#if expansion?.sections.length}<span class="tiny muted">{expansion.sections.length} sections · {words} words</span>{/if}
    </button>
    <button class="btn ghost small" onclick={() => brainstorm(expansion?.sections.length ? "" : `Let's brainstorm my ${what} before expanding it. `)} title="Think it through with Meus, who can change and add sections"><MessagesSquare size={13} /> Brainstorm</button>
    {#if expansion?.sections.length}
      <label class="switch tiny" title="Feed it to the next steps"><input type="checkbox" checked={expansion.use} onchange={(e) => { expansion!.use = e.currentTarget.checked; onpatch({ use: expansion!.use }, "exp:use", 0); }} /> Use it</label>
    {/if}
  </div>

  {#if open}
    {#if !expansion?.sections.length}
      <p class="small muted">Turns your {what} into a fully fleshed-out concept, section by section: names, places, tensions, secrets and openings a story can use. Your words stay canon, nothing is hedged, and every section is yours to edit. Or brainstorm it with Meus first, who can write and change sections as you talk.</p>
      <div class="row wrap">
        <input class="input grow" bind:value={steer} placeholder="Optional: lean it (darker, cozier, more political…)" aria-label="Lean the expansion" />
        <button class="btn primary" onclick={() => onexpand(steer)} disabled={disabled || Boolean(busy)}>
          {#if busy === "expand"}<span class="spin"><Loader size={15} /></span> Expanding…{:else}<Sparkles size={15} /> Expand my {what}{/if}
        </button>
      </div>
    {:else}
      {#each expansion.sections as s (s.id)}
        <div class="section" class:working={busy === `deepen:${s.id}`}>
          <div class="row">
            <input class="heading" value={s.heading} oninput={(e) => { s.heading = e.currentTarget.value; onpatch({ sections: [{ id: s.id, heading: s.heading }] }, `exp:${s.id}`); }} aria-label="Section heading" />
            {#if busy === `deepen:${s.id}`}<span class="spin"><Loader size={14} /></span>{/if}
            <button class="btn ghost icon small" onclick={() => brainstorm(`Let's brainstorm the "${s.heading}" section: `)} title="Brainstorm this section with Meus" aria-label="Brainstorm {s.heading}"><MessagesSquare size={13} /></button>
            <button class="btn ghost small" onclick={() => ondeepen(s.id, "")} disabled={disabled || Boolean(busy)} title="More depth: specifics, consequences, connections"><Plus size={13} /> Go deeper</button>
            <button class="btn ghost small" onclick={() => rewrite(s.id, s.heading)} disabled={disabled || Boolean(busy)} title="Rewrite it your way"><PenLine size={13} /> Rewrite</button>
            <button class="btn ghost icon small" onclick={() => { expansion!.sections = expansion!.sections.filter((x) => x.id !== s.id); onpatch({ remove: [s.id] }, `exp:remove:${s.id}`, 0); }} aria-label="Remove section"><X size={13} /></button>
          </div>
          <textarea class="textarea story" use:autosize={{ max: 600, value: s.text }} value={s.text} oninput={(e) => { s.text = e.currentTarget.value; onpatch({ sections: [{ id: s.id, text: s.text }] }, `exp:${s.id}`); }}></textarea>
        </div>
      {/each}
      <div class="row wrap">
        <button class="btn ghost small" onclick={addSection}><Plus size={13} /> Section</button>
        <input class="input grow" bind:value={steer} placeholder="Rework all of it: darker, more mystery, fewer factions…" aria-label="How to rework it" />
        <button class="btn small" onclick={() => onexpand(steer)} disabled={disabled || Boolean(busy)}>
          {#if busy === "expand"}<span class="spin"><Loader size={14} /></span> Reworking…{:else}<RefreshCw size={14} /> Rework{/if}
        </button>
      </div>
      <span class="tiny muted">{expansion.use ? "The plan and every entry are written against this. Your edits count as canon." : "Not used: the next steps read only your own idea."}</span>
    {/if}
  {/if}
</section>

<style>
  .expand {
    border: 1px solid color-mix(in srgb, var(--lavender) 60%, var(--border));
  }
  .head {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    border: 0;
    background: none;
    color: var(--text);
    font: inherit;
    cursor: pointer;
    padding: 0;
  }
  .section {
    display: grid;
    gap: 0.3rem;
    border-top: 1px solid var(--border);
    padding-top: 0.6rem;
  }
  .section.working textarea {
    opacity: 0.6;
  }
  .heading {
    flex: 1;
    min-width: 0;
    border: 0;
    background: none;
    color: var(--text);
    font: 700 var(--fs-md) / 1.3 var(--font-display);
    padding: 0.2rem 0;
    outline: none;
    border-bottom: 2px solid transparent;
  }
  .heading:focus {
    border-bottom-color: var(--accent);
  }
  .grow {
    flex: 1 1 14rem;
    min-width: 0;
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
  @media (max-width: 640px) {
    .section .row {
      flex-wrap: wrap;
    }
    .heading {
      flex-basis: 100%;
    }
  }
</style>
