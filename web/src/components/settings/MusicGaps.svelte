<script lang="ts">
  import { get, post } from "../../lib/api";
  import { confirm } from "../../lib/dialogs.svelte";
  import { ChevronDown } from "../../lib/icons";
  import { errorToast, toast } from "../../lib/state.svelte";

  /**
   * docs/34 Part 6: what the library is missing. The kinds of scene your stories ask for next to the
   * songs you have for them; for a gap, on your yes, songs by your artists whose words Mea read and
   * whose cards fit. Nothing joins the library until you add it, and one you turn down never comes back.
   */
  interface Gap {
    kind: string;
    line: string;
    scenes: number;
    misses: number;
    fit: number;
    examples: string[];
  }
  interface Suggested {
    videoId: string;
    title: string;
    artist: string;
    card: { about: string; bond: string; stance: string; heat: string; energy: number } | null;
    instrumental: boolean;
  }
  interface Suggestions {
    byKind: Record<string, { at: number; looked: number; songs: Suggested[] }>;
    busy: string | null;
    calls: number;
    lookAt: number;
  }
  interface View {
    gaps: Gap[];
    background: { safe: { videoId: string; title: string; artist: string }[]; instrumentals: number };
    suggestions: Suggestions;
  }
  const INSTRUMENTALS = "instrumentals";

  let { onadded }: { onadded: () => void } = $props();
  let v = $state<View | null>(null);
  let open = $state(false);
  async function load() {
    try {
      v = await get<View>("/api/music/gaps");
    } catch {
      v = null;
    }
  }
  $effect(() => {
    if (open) void load();
  });
  // A look is running: check back until it's done.
  $effect(() => {
    if (!open || !v?.suggestions.busy) return;
    const t = setTimeout(() => void load(), 4000);
    return () => clearTimeout(t);
  });

  async function look(g: Gap | null) {
    const s = v!.suggestions;
    const ok = g
      ? await confirm({ title: `Look for songs: ${g.line}?`, message: `Mea searches YouTube Music for songs by your library's artists (it sends their names, nothing from your stories), finds the words of up to ${s.lookAt} you don't have, and your helper model reads them: about ${s.calls} calls. Only the ones that fit are shown, and nothing joins the library until you add it.`, confirmLabel: "Look" })
      : await confirm({ title: "Look for instrumentals?", message: "A few plain searches on YouTube Music (piano, ambient, guitar, strings). No helper calls. Nothing joins the library until you add it.", confirmLabel: "Look" });
    if (!ok) return;
    try {
      v = { ...v!, suggestions: await post<Suggestions>("/api/music/gaps/look", { kind: g?.kind ?? INSTRUMENTALS }) };
    } catch (e) {
      errorToast(e);
    }
  }
  async function answer(kind: string, s: Suggested, add: boolean) {
    try {
      v = { ...v!, suggestions: await post<Suggestions>("/api/music/gaps/answer", { kind, videoId: s.videoId, add }) };
      if (add) {
        toast(`${s.title} added`, { kind: "ok" });
        onadded();
        void load();
      }
    } catch (e) {
      errorToast(e);
    }
  }
  const cardLine = (c: NonNullable<Suggested["card"]>) => [c.bond, c.stance, c.heat === "none" ? "no heat" : c.heat, `energy ${c.energy}`].join(" · ");
  const lineOf = (kind: string) => (kind === INSTRUMENTALS ? "instrumentals" : (v?.gaps.find((g) => g.kind === kind)?.line ?? kind.replace(/^about:/, "about ").replaceAll("|", " · ").replaceAll("?", "").replace(/ · ( · )+/g, " · ")));
</script>

<section class="panel stack">
  <div class="row between">
    <h2>What the library is missing</h2>
    <button class="btn ghost small fold" class:open onclick={() => (open = !open)} aria-expanded={open} aria-controls="music-gaps">{open ? "Hide" : "Show"} <ChevronDown size={14} /></button>
  </div>
  <p class="tiny muted">The kinds of scene your stories ask for music for, next to the songs you have that suit them. Worst first: the ones that most often ended with nothing fitting or a skip.</p>
  {#if open}
    <div id="music-gaps" class="stack">
      {#if !v}
        <p class="tiny muted">Loading…</p>
      {:else}
        {#if !v.gaps.length}<p class="tiny muted">Not enough scenes read yet. The soundtrack reads a scene each time it picks a song.</p>{/if}
        {#each v.gaps as g (g.kind)}
          <div class="gap row between wrap">
            <span class="small">
              <b>{g.line}</b>: asked for in {g.scenes} scene{g.scenes === 1 ? "" : "s"}, {g.fit} song{g.fit === 1 ? "" : "s"} fit{#if g.misses}, {g.misses} ended with nothing fitting or a skip{/if}.
              {#if g.examples.length}<span class="tiny muted">{` Such as ${g.examples.join(", ")}.`}</span>{/if}
            </span>
            <button class="btn ghost small" disabled={Boolean(v.suggestions.busy)} onclick={() => look(g)}>{v.suggestions.busy === g.kind ? "Looking…" : "Find songs"}</button>
          </div>
        {/each}

        {#each Object.entries(v.suggestions.byKind) as [kind, found] (kind)}
          <div class="stack found">
            <p class="small"><b>For {lineOf(kind)}</b> <span class="tiny muted">({found.songs.length} of {found.looked} looked at; one you turn down never comes back)</span></p>
            {#each found.songs as s (s.videoId)}
              <div class="row between wrap">
                <span class="small">{s.title}<span class="muted">{` · ${s.artist}`}</span>{#if s.card}<span class="tiny muted">{` · ${cardLine(s.card)}${s.card.about ? ` · ${s.card.about}` : ""}`}</span>{:else if s.instrumental}<span class="tiny muted"> · instrumental</span>{/if}</span>
                <span class="row tight">
                  <a class="btn ghost small" href={`https://music.youtube.com/watch?v=${s.videoId}`} target="_blank" rel="noreferrer">Listen</a>
                  <button class="btn small" onclick={() => answer(kind, s, true)}>Add</button>
                  <button class="btn ghost small" onclick={() => answer(kind, s, false)}>No thanks</button>
                </span>
              </div>
            {/each}
          </div>
        {/each}

        <h3 class="small">Safe under anything</h3>
        <p class="tiny muted">
          When nothing in the library is about a scene, Mea plays for the mood from songs sung to anyone, with no heat, an easy feel and nothing dark: {v.background.safe.length} of yours{#if v.background.safe.length}{` (such as ${v.background.safe
              .slice(0, 4)
              .map((s) => s.title)
              .join(", ")})`}{/if}, and {v.background.instrumentals} instrumental{v.background.instrumentals === 1 ? "" : "s"}.
          <button class="btn ghost small" disabled={Boolean(v.suggestions.busy)} onclick={() => look(null)}>{v.suggestions.busy === INSTRUMENTALS ? "Looking…" : "Find instrumentals"}</button>
        </p>
      {/if}
    </div>
  {/if}
</section>

<style>
  .gap {
    gap: 0.4rem 0.8rem;
    align-items: center;
  }
  .gap > .small {
    flex: 1;
    min-width: 14rem;
  }
  .found {
    gap: 0.3rem;
    padding: 0.5rem 0.7rem;
    border: 1px solid var(--border);
    border-radius: 8px;
  }
</style>
