<script lang="ts" module>
  // Folding one roll folds them all, and it stays that way next time.
  const KEY = "mea.castroll.folded";
  const fold = $state({ on: (() => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } })() });
  function setFolded(on: boolean) {
    fold.on = on;
    try { localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* private mode: just this session */ }
  }
</script>

<script lang="ts">
  import Modal from "../Modal.svelte";
  import { ChevronDown, Info } from "../../lib/icons";
  import { storyColors, voiceColor } from "../../lib/voices";
  import { trk } from "../../lib/trackers.svelte";
  import { byRank, castRoll } from "../../lib/castroll";
  import type { TrackerChange } from "../../lib/types";

  /** The cast roll: what this reply changed, filed under the person it happened to. */
  let { changes: all }: { changes: TrackerChange[]; max?: number } = $props();
  let open = $state(false);
  // Private thoughts and hidden feelings live in the drawer under the reply, never here.
  const changes = $derived(all.filter((c) => c.kind !== "thought" && c.kind !== "mask"));
  const colors = $derived(storyColors(trk.data));
  const rows = $derived(castRoll(changes, [...colors.keys()]));
  const people = $derived(rows.filter((r) => r.name));
  const sorted = $derived([...changes].sort(byRank));
  const color = (name: string) => colors.get(name.toLowerCase()) || voiceColor(name, trk.data?.profiles[name.toLowerCase()]?.color);
  const short = (name: string) => name.match(/['‘’"“]([^'‘’"”]+)['‘’"”]/)?.[1] ?? name.split(/\s+/)[0]!;

  const icon: Record<string, string> = { clock: "🕰", weather: "🌦", place: "📍", cast: "👥", mood: "🎭", body: "🩹", look: "👗", trait: "✨", bond: "💞", romance: "💗", knowledge: "🧠", secret: "🤫", item: "🎒", thread: "🧵", promise: "🤝", owe: "⚖", deadline: "⏰", plant: "🌱", clue: "🔎", gauge: "📊", faction: "🏛", reputation: "🏷", calendar: "📅", motif: "🔁", milestone: "🌟", death: "🕯", custom: "📌", journal: "📓", scene: "🎬", drive: "🎯", pressure: "🌀", edit: "✏️" };
  const sourceLabel: Record<string, string> = { model: "the tracker model", inline: "the story model", user: "you", init: "the card", timeskip: "a time skip", engine: "the world off the page" };
  const tip = (c: { reason?: string; flag?: string }) => [c.reason, c.flag].filter(Boolean).join(" · ") || undefined;
  const count = (n: number) => `${n} change${n === 1 ? "" : "s"}`;
</script>

{#snippet orb(name: string, size: "sm" | "md" | "lg")}
  <span class="orb {size}" style:--vc={color(name)} aria-hidden="true">{short(name).slice(0, 1)}</span>
{/snippet}

{#if changes.length}
  <section class="roll" class:folded={fold.on} aria-label="What this reply changed">
    <header>
      <button class="head" onclick={() => setFolded(!fold.on)} aria-expanded={!fold.on}>
        <span class="title">What changed</span>
        <span class="sub">{count(changes.length)}{people.length ? ` · ${people.length} ${people.length === 1 ? "person" : "people"}` : ""}{rows.length > people.length ? `${people.length ? " +" : " ·"} the world` : ""}</span>
        <span class="faces">{#each people.slice(0, 6) as r (r.name)}{@render orb(r.name!, "sm")}{/each}</span>
        <span class="chev"><ChevronDown size={16} /></span>
      </button>
      <button class="why" onclick={() => (open = true)} title="Why each of these changed" aria-label="Why each of these changed"><Info size={15} /></button>
    </header>

    {#if !fold.on}
      <div class="rows">
        {#each rows as r, i (r.name ?? "")}
          <div class="person" class:world={!r.name} style:--vc={r.name ? color(r.name) : undefined} style:--i={i}>
            <div class="id">
              {#if r.name}<span class="ring">{@render orb(r.name, "lg")}</span>{:else}<span class="globe" aria-hidden="true">🌍</span>{/if}
              <span class="nm">{r.name ?? "The world"}</span>
              <span class="count">{count(r.beats.length)}</span>
            </div>

            {#if r.name}
              <div class="beats">
                {#each r.beats as b, j (j)}
                  <div class="beat" class:flagged={Boolean(b.c.flag)} title={tip(b.c)}>
                    <span class="e" aria-hidden="true">{icon[b.c.kind] ?? "•"}</span>
                    {#if b.type === "feel"}
                      <div class="feel">
                        <span class="verb">feels</span>
                        <span class="meter" class:bad={!b.good}>{b.feeling} <b>{b.delta.startsWith("−") ? "▼" : "▲"}{b.delta.replace(/^[+−]/, "")}</b></span>
                        <span class="verb">toward</span>
                        <span class="toward">{@render orb(b.toward, "sm")}{b.toward}</span>
                      </div>
                    {:else if b.type === "know"}
                      <div>
                        <span class="verb">{b.verb}</span> <q class="know">{b.text}</q>
                        <!-- News that travelled off the page: they weren't in the scene, so say how it reached them. -->
                        {#if b.c.source === "engine" && b.c.reason}<span class="offpage">off the page · {b.c.reason}</span>{/if}
                      </div>
                    {:else if b.type === "vow"}
                      <div>
                        <span class="verb">{b.verb}</span>{#if b.whom}&nbsp;<b>{b.whom}</b>{/if}
                        <span class="vow" class:owe={b.c.kind === "owe"}>{b.text}</span>
                      </div>
                    {:else}
                      <div class="tagline">
                        <span class="tag" class:up={b.c.tone === "up"} class:down={b.c.tone === "down"} class:due={b.c.tone === "due" || b.c.tone === "warn"}>{b.tag}</span>
                        {#if b.toward}<span class="toward">{@render orb(b.toward, "sm")}{b.toward}</span>{/if}
                        {b.text}
                      </div>
                    {/if}
                  </div>
                {/each}
              </div>
            {:else}
              <div class="chips">
                {#each r.beats as b, j (j)}
                  <span class="chip {b.c.tone ?? ''}" class:flagged={Boolean(b.c.flag)} title={tip(b.c)}><span aria-hidden="true">{icon[b.c.kind] ?? "•"}</span> <span>{b.c.text}</span></span>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </section>
{/if}

<Modal bind:open title="What changed" size="sm">
  <div class="stack tight">
    {#each sorted as c, i (i)}
      <div class="row-c">
        <div><span aria-hidden="true">{icon[c.kind] ?? "•"}</span> <b>{c.text}</b></div>
        {#if c.reason}<div class="tiny muted">{c.reason}</div>{/if}
        {#if c.flag}<div class="tiny warn-t">{c.flag}</div>{/if}
        <div class="tiny faint">from {sourceLabel[c.source] ?? c.source}{c.memory ? " · remembered" : ""}</div>
      </div>
    {/each}
  </div>
</Modal>

<style>
  .roll {
    margin-top: 0.55rem;
    container-type: inline-size;
    border-radius: var(--r-lg, 18px);
    border: 1px solid color-mix(in srgb, var(--accent) 16%, var(--border));
    background:
      radial-gradient(60% 80% at 0% 0%, color-mix(in srgb, var(--peach, #ffd9c7) 16%, transparent), transparent 70%),
      radial-gradient(50% 70% at 100% 100%, color-mix(in srgb, var(--lavender, #c7b4ff) 14%, transparent), transparent 70%),
      color-mix(in srgb, var(--surface) 70%, transparent);
    overflow: hidden;
  }
  header {
    display: flex;
    align-items: center;
  }
  .head {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.25rem 0.55rem;
    padding: 0.55rem 0.4rem 0.55rem 0.85rem;
    border: 0;
    background: none;
    color: inherit;
    cursor: pointer;
    text-align: left;
  }
  .title {
    font: italic 500 1.05rem/1 var(--font-display, var(--font-story));
    color: var(--accent);
  }
  .sub {
    font: 500 var(--fs-xs) / 1.2 var(--font-ui);
    color: var(--text-muted);
  }
  .faces {
    margin-left: auto;
    display: flex;
    padding-left: 0.4rem;
  }
  .faces :global(.orb) {
    margin-left: -0.35rem;
    box-shadow: 0 0 0 2px var(--surface);
  }
  .chev {
    display: grid;
    color: var(--text-faint);
    transition: transform 0.25s var(--ease, ease);
  }
  .folded .chev {
    transform: rotate(-90deg);
  }
  .why {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    margin-right: 0.4rem;
    border: 0;
    border-radius: 50%;
    background: none;
    color: var(--text-faint);
    cursor: pointer;
  }
  .why:hover,
  .head:hover .chev {
    color: var(--text);
  }
  .why:hover {
    background: var(--surface-2);
  }

  .rows {
    padding: 0 0.85rem 0.35rem;
  }
  .person {
    display: grid;
    grid-template-columns: 7.5rem 1fr;
    gap: 0.9rem;
    padding: 0.75rem 0;
    border-top: 1px solid color-mix(in srgb, var(--accent) 12%, var(--border));
    animation: enter 0.45s calc(var(--i) * 50ms) both var(--ease, ease);
  }
  .id {
    display: grid;
    justify-items: start;
    align-content: start;
    gap: 0.3rem;
    min-width: 0;
  }
  .ring {
    display: grid;
    padding: 2.5px;
    border-radius: 50%;
    background: conic-gradient(from 200deg, var(--vc), color-mix(in srgb, var(--vc) 40%, #fff), var(--vc));
    transition: transform 0.3s cubic-bezier(0.3, 1.6, 0.5, 1);
  }
  .person:hover .ring {
    transform: rotate(-8deg) scale(1.05);
  }
  .globe {
    width: 2.6rem;
    height: 2.6rem;
    display: grid;
    place-items: center;
    font-size: 1.3rem;
    border-radius: 50%;
    background: radial-gradient(circle at 30% 26%, #fffa, transparent 40%), color-mix(in srgb, var(--ok) 35%, var(--surface-2));
  }
  .nm {
    font: 600 0.92rem/1.2 var(--font-display, var(--font-story));
    overflow-wrap: anywhere;
  }
  .count {
    font: 600 0.66rem/1 var(--font-ui);
    padding: 0.2rem 0.45rem;
    border-radius: var(--r-pill);
    color: color-mix(in srgb, var(--vc, var(--ok)) 60%, var(--text));
    background: color-mix(in srgb, var(--vc, var(--ok)) 16%, transparent);
  }

  .orb {
    display: inline-grid;
    place-items: center;
    flex: none;
    border-radius: 50%;
    color: #0e0a18;
    font-family: "Instrument Serif", Georgia, serif;
    background: radial-gradient(circle at 30% 26%, #fffa, transparent 38%), var(--vc);
  }
  .orb.sm {
    width: 1.15rem;
    height: 1.15rem;
    font-size: 0.68rem;
  }
  .orb.lg {
    width: 2.6rem;
    height: 2.6rem;
    font-size: 1.3rem;
  }

  .beats {
    display: grid;
    gap: 0.45rem;
    align-content: start;
    min-width: 0;
  }
  .beat {
    display: grid;
    grid-template-columns: 1.3rem 1fr;
    gap: 0.4rem;
    font: 400 var(--fs-sm, 0.9rem) / 1.45 var(--font-ui);
    overflow-wrap: anywhere;
  }
  .beat .e {
    text-align: center;
  }
  .beat.flagged .e {
    filter: drop-shadow(0 0 3px var(--warn));
  }
  .verb {
    color: var(--text-muted);
  }
  .feel {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem 0.4rem;
  }
  .toward {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-weight: 600;
  }
  .tagline .toward {
    margin-right: 0.25rem;
  }
  .meter {
    font: 600 var(--fs-xs) / 1.6 var(--font-ui);
    padding: 0 0.5rem;
    border-radius: var(--r-pill);
    color: var(--ok);
    background: color-mix(in srgb, var(--ok) 14%, transparent);
  }
  .meter.bad {
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 13%, transparent);
  }
  .meter b {
    font-size: 0.92em;
    margin-left: 0.15rem;
  }
  .know {
    font: italic 400 1.02em/1.45 var(--font-story);
    quotes: "“" "”";
  }
  .offpage {
    display: block;
    font: 400 var(--fs-xs) / 1.5 var(--font-ui);
    color: var(--text-faint);
  }
  .know::before,
  .know::after {
    color: var(--accent);
  }
  .vow {
    position: relative;
    display: block;
    margin-top: 0.3rem;
    padding: 0.45rem 0.75rem;
    border-radius: 4px var(--r, 12px) var(--r, 12px) var(--r, 12px);
    background: color-mix(in srgb, var(--surface) 85%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent) 18%, var(--border));
    font: italic 400 1.04em/1.45 var(--font-story);
  }
  .vow::after {
    content: "🤝 sworn";
    position: absolute;
    right: 0.6rem;
    top: -0.6rem;
    padding: 0.15rem 0.45rem;
    border-radius: var(--r-pill);
    background: var(--accent);
    color: var(--accent-ink, #fff);
    font: 600 0.62rem/1.2 var(--font-ui);
    font-style: normal;
    transform: rotate(3deg);
  }
  .vow.owe::after {
    content: "⚖ owed";
  }
  .tag {
    display: inline-block;
    margin-right: 0.3rem;
    padding: 0.1rem 0.35rem;
    border-radius: 5px;
    font: 700 0.62rem/1.4 var(--font-ui);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    vertical-align: 0.08em;
    color: color-mix(in srgb, var(--vc) 55%, var(--text));
    background: color-mix(in srgb, var(--vc) 18%, transparent);
  }
  .tag.up {
    color: var(--ok);
    background: color-mix(in srgb, var(--ok) 14%, transparent);
  }
  .tag.down {
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 13%, transparent);
  }
  .tag.due {
    color: var(--warn, #b7791f);
    background: color-mix(in srgb, var(--warn, #b7791f) 14%, transparent);
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 0.35rem;
    align-content: start;
    min-width: 0;
  }
  .chip {
    display: inline-flex;
    gap: 0.35rem;
    max-width: 100%;
    padding: 0.25rem 0.6rem;
    border-radius: var(--r, 12px);
    border: 1px solid var(--border);
    background: color-mix(in srgb, var(--surface) 80%, transparent);
    font: 400 var(--fs-xs) / 1.45 var(--font-ui);
    /* The shared .chip is one clipped line; these carry whole sentences, so they wrap. */
    align-items: flex-start;
    overflow: visible;
    white-space: normal;
    overflow-wrap: anywhere;
  }
  .chip.up {
    color: var(--ok);
    border-color: color-mix(in srgb, var(--ok) 40%, var(--border));
  }
  .chip.down {
    color: var(--danger);
    border-color: color-mix(in srgb, var(--danger) 35%, var(--border));
  }
  .chip.due,
  .chip.warn,
  .chip.flagged {
    color: var(--warn, #b7791f);
    border: 1px dashed color-mix(in srgb, var(--warn, #b7791f) 55%, var(--border));
  }

  .row-c {
    padding: 0.4rem 0;
    border-top: 1px solid var(--border);
  }
  .warn-t {
    color: var(--warn, #b7791f);
  }
  @keyframes enter {
    from {
      opacity: 0;
      transform: translateX(-8px);
    }
  }
  @container (max-width: 460px) {
    .person {
      grid-template-columns: 1fr;
      gap: 0.55rem;
    }
    /* The name keeps room to read: in a very narrow chat the count drops below it. */
    .id {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.3rem 0.6rem;
    }
    .nm {
      flex: 1 1 4.5rem;
    }
    .faces {
      display: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .person {
      animation: none;
    }
    .ring,
    .chev {
      transition: none;
    }
  }
</style>
