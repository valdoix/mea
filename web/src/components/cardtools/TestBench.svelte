<script lang="ts">
  import { untrack } from "svelte";
  import { get, postStream } from "../../lib/api";
  import { FlaskConical, Loader, RotateCcw, Send, Square } from "../../lib/icons";
  import { renderMessage, renderStreaming } from "../../lib/render";
  import { errorToast } from "../../lib/state.svelte";
  import type { Persona } from "../../lib/types";

  /**
   * Test bench (CHAR-16): a sandbox conversation with the card as it is on screen, saved or not.
   * Built like a real chat (preset, controls, persona, lore), but nothing is stored.
   */
  let { characterId, card, mode }: { characterId: string; card: () => Record<string, unknown>; mode?: "companion" | "narrator" } = $props();

  type Msg = { role: "user" | "assistant"; content: string };
  let personas = $state<Persona[]>([]);
  let personaId = $state("");
  let personaVariants = $state<{ id: string; name: string }[]>([]);
  let personaVariantId = $state("");
  let probes = $state<{ label: string; text: string }[]>([]);
  let greeting = $state(0);
  let messages = $state<Msg[]>([]);
  let draft = $state("");
  let streaming = $state("");
  let working = $state(false);
  let abort: AbortController | null = null;
  let list = $state<HTMLDivElement | null>(null);

  const greetings = $derived.by(() => {
    const c = card();
    return [String(c.first_mes ?? ""), ...((c.alternate_greetings as string[] | undefined) ?? [])].filter((g) => g.trim());
  });

  $effect(() => {
    get<{ personas: Persona[] }>("/api/personas").then((r) => (personas = r.personas), () => {});
    get<{ probes: { label: string; text: string }[] }>("/api/card-tools/voice/situations").then((r) => (probes = r.probes), () => {});
  });
  $effect(() => {
    const id = personaId;
    personaVariantId = "";
    if (id) get<{ variants: { id: string; name: string }[] }>(`/api/personas/${id}/variants`).then((r) => (personaVariants = r.variants), () => (personaVariants = []));
    else personaVariants = [];
  });

  function reset() {
    abort?.abort();
    const g = greetings[greeting];
    messages = g ? [{ role: "assistant", content: g }] : [];
    streaming = "";
  }
  // Only a new choice of greeting restarts; editing the card mid-test doesn't.
  $effect(() => {
    void greeting;
    untrack(reset);
  });

  async function send(text?: string) {
    const content = (text ?? draft).trim();
    if (content) messages = [...messages, { role: "user", content }];
    if (text === undefined) draft = "";
    await reply();
  }

  async function reply() {
    working = true;
    streaming = "";
    abort = new AbortController();
    try {
      for await (const chunk of postStream<{ text?: string; done?: boolean; error?: string }>(
        "/api/card-tools/bench",
        { characterId, card: card(), mode, personaId: personaId || null, personaVariantId: personaVariantId || null, messages: $state.snapshot(messages) },
        abort.signal,
      )) {
        if (chunk.text) {
          streaming += chunk.text;
          list?.scrollTo({ top: list.scrollHeight });
        }
        if (chunk.error) errorToast(new Error(chunk.error));
      }
      if (streaming.trim()) messages = [...messages, { role: "assistant", content: streaming }];
    } catch (e) {
      if ((e as Error).name !== "AbortError") errorToast(e);
      else if (streaming.trim()) messages = [...messages, { role: "assistant", content: streaming }];
    } finally {
      streaming = "";
      working = false;
      abort = null;
    }
  }

  function again() {
    if (messages.at(-1)?.role === "assistant" && messages.length > 1) messages = messages.slice(0, -1);
    void reply();
  }

  const name = $derived(String(card().name ?? "Character"));
  const fill = (s: string) => s.replace(/\{\{char\}\}/gi, name).replace(/\{\{user\}\}/gi, personas.find((p) => p.id === personaId)?.name ?? personas.find((p) => p.isDefault)?.name ?? "You");
</script>

<div class="stack bench">
  <p class="small muted"><FlaskConical size={14} /> A sandbox with the card as it is on screen, even unsaved. It uses this character's preset, lore and your persona, like a real chat, but nothing is saved: no chat, no memory.</p>
  <div class="row wrap">
    {#if greetings.length > 1}
      <select class="select mini" bind:value={greeting} aria-label="Start from">{#each greetings as _g, i (i)}<option value={i}>{i === 0 ? "First message" : `Alternate greeting ${i}`}</option>{/each}</select>
    {/if}
    <select class="select mini" bind:value={personaId} aria-label="Persona"><option value="">My default persona</option>{#each personas as p (p.id)}<option value={p.id}>{p.name}</option>{/each}</select>
    {#if personaVariants.length}<select class="select mini" bind:value={personaVariantId} aria-label="Persona variant"><option value="">Base</option>{#each personaVariants as v (v.id)}<option value={v.id}>{v.name}</option>{/each}</select>{/if}
    <button class="btn ghost small" onclick={reset}><RotateCcw size={13} /> Start over</button>
  </div>

  <div class="msgs card" bind:this={list}>
    {#each messages as m, i (i)}
      <div class="msg {m.role}"><span class="who tiny">{m.role === "user" ? "You" : name}</span><div class="prose small">{@html renderMessage(fill(m.content), `bench-${i}`)}</div></div>
    {:else}
      <p class="tiny muted">No greeting: say something to begin.</p>
    {/each}
    {#if working}
      <div class="msg assistant"><span class="who tiny">{name}</span><div class="prose small">{#if streaming}{@html renderStreaming(streaming)}{:else}<span class="spin"><Loader size={14} /></span>{/if}</div></div>
    {/if}
  </div>

  <div class="row wrap probes">
    {#each probes as p (p.label)}<button class="chip tiny probe" onclick={() => send(p.text)} disabled={working} title={p.text}>{p.label}</button>{/each}
  </div>
  <div class="row composer">
    <textarea class="textarea" rows="2" bind:value={draft} placeholder="Say something to {name}…" onkeydown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), send())}></textarea>
    {#if working}
      <button class="btn" onclick={() => abort?.abort()} aria-label="Stop"><Square size={15} /></button>
    {:else}
      <button class="btn primary" onclick={() => send()} disabled={!draft.trim()} aria-label="Send"><Send size={15} /></button>
      <button class="btn ghost" onclick={again} disabled={!messages.length} title="Another reply to the last message" aria-label="Another reply"><RotateCcw size={15} /></button>
    {/if}
  </div>
</div>

<style>
  .mini {
    width: auto;
    padding-top: 0.3rem;
    padding-bottom: 0.3rem;
    font-size: var(--fs-xs);
  }
  .msgs {
    display: grid;
    gap: 0.8rem;
    padding: 0.9rem 1rem;
    max-height: min(60vh, 34rem);
    overflow: auto;
  }
  .msg {
    display: grid;
    gap: 0.15rem;
  }
  .msg.user {
    padding-left: 1.5rem;
  }
  .msg.user .prose {
    background: var(--tint-user);
    border-radius: var(--r-sm, 8px);
    padding: 0.3rem 0.6rem;
  }
  .who {
    font-weight: 700;
    color: var(--text-muted);
  }
  .probe {
    cursor: pointer;
    border: 1px solid var(--border);
    font: inherit;
    font-size: var(--fs-xs);
  }
  .composer {
    align-items: flex-end;
  }
  .composer textarea {
    flex: 1;
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
</style>
