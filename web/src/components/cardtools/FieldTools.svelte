<script lang="ts">
  import Menu, { type MenuItem } from "../Menu.svelte";
  import DiffModal from "./DiffModal.svelte";
  import { post } from "../../lib/api";
  import { promptText } from "../../lib/dialogs.svelte";
  import { ArrowDown, ArrowUp, FileText, Loader, PenLine, Scissors, Shield, Sparkles, WandSparkles } from "../../lib/icons";
  import { errorToast } from "../../lib/state.svelte";

  /**
   * Field-level AI actions (CHAR-11, PER-04): expand, condense, prose, point of view, a style, a
   * surgical edit. The result is a diff you accept whole or in parts.
   */
  let {
    kind,
    field,
    label,
    text,
    card,
    onapply,
    pov = "third",
    tense = "present",
  }: {
    kind: "character" | "persona";
    field: string;
    label: string;
    text: string;
    /** The whole card as it is on screen, for context. */
    card: () => Record<string, unknown>;
    onapply: (text: string) => void;
    pov?: "first" | "second" | "third";
    tense?: "present" | "past";
  } = $props();

  let menuOpen = $state(false);
  let btn = $state<HTMLButtonElement | null>(null);
  let working = $state(false);
  let proposal = $state<{ before: string; after: string; title: string } | null>(null);
  let diffOpen = $state(false);
  const greeting = $derived(field === "first_mes" || field === "alternate_greetings");

  /** Runs an action; `instruction` can carry a fix from a card check. */
  export async function run(action: string, instruction?: string) {
    if (!text.trim()) return;
    let ins = instruction;
    if ((action === "edit" || action === "rewrite") && ins === undefined) {
      const v = await promptText({
        title: action === "edit" ? `Change the ${label.toLowerCase()}` : `Rewrite the ${label.toLowerCase()} in a style`,
        label: action === "edit" ? "What exactly should change?" : "Which style?",
        placeholder: action === "edit" ? "She's 34, not 28; she lost the left eye, not the right" : "Spare and wry, like a noir narrator",
        confirmLabel: action === "edit" ? "Change it" : "Rewrite",
      });
      if (!v?.trim()) return;
      ins = v.trim();
    }
    working = true;
    try {
      const r = await post<{ text: string; tokens: { before: number; after: number } }>("/api/card-tools/assist", { kind, field, action, text, card: card(), instruction: ins, pov, tense });
      proposal = { before: text, after: r.text, title: `${label}: ${TITLES[action] ?? "proposal"} (${r.tokens.before} → ${r.tokens.after} tokens)` };
      diffOpen = true;
    } catch (e) {
      errorToast(e);
    } finally {
      working = false;
    }
  }

  const TITLES: Record<string, string> = { expand: "expanded", condense: "condensed", prose: "as prose", pov: "point of view fixed", rewrite: "restyled", edit: "edited", unpuppet: "{{user}} left free" };

  const items = $derived<MenuItem[]>([
    { label: "Expand", icon: ArrowDown, hint: "More depth, same facts", onclick: () => run("expand") },
    { label: "Condense", icon: ArrowUp, hint: "Fewer tokens, every fact kept", onclick: () => run("condense") },
    { label: "Make it prose", icon: FileText, hint: "W++, brackets and lists become sentences", onclick: () => run("prose") },
    { label: "Fix point of view and tense", icon: Scissors, hint: `${pov} person, ${tense}`, onclick: () => run("pov") },
    { label: "Rewrite in a style…", icon: Sparkles, onclick: () => run("rewrite") },
    { label: "Change something…", icon: PenLine, hint: "A precise edit; nothing else moves", onclick: () => run("edit") },
    ...(greeting ? [{ label: "Stop it acting for {{user}}", icon: Shield, onclick: () => run("unpuppet") }] : []),
  ]);
</script>

<button class="btn ghost icon small tools" bind:this={btn} onclick={() => (menuOpen = true)} disabled={working || !text.trim()} aria-label="AI actions for the {label.toLowerCase()}" title="AI actions">
  {#if working}<span class="spin"><Loader size={14} /></span>{:else}<WandSparkles size={14} />{/if}
</button>
<Menu bind:open={menuOpen} {items} anchor={btn} title={label} />
{#if proposal}
  <DiffModal bind:open={diffOpen} title={proposal.title} before={proposal.before} after={proposal.after} onaccept={(t) => onapply(t)} />
{/if}

<style>
  .tools {
    vertical-align: middle;
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
