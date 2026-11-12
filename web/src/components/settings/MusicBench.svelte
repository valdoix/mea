<script lang="ts">
  import { get, put } from "../../lib/api";
  import { ChevronDown } from "../../lib/icons";
  import { errorToast } from "../../lib/state.svelte";

  /**
   * docs/34 1.4: the marked set. Scenes the soundtrack read, each with the songs it was likeliest to
   * play, marked fits, fine or wrong by Claude. You check a sample and change any mark you disagree
   * with; every change to the picker is scored against these marks (`bun run music:replay`).
   */
  type Mark = "fits" | "fine" | "wrong";
  const MARKS: Mark[] = ["fits", "fine", "wrong"];
  interface Song {
    videoId: string;
    title: string;
    artist: string;
    mark: Mark | null;
    by: "claude" | "you" | null;
  }
  interface Scene {
    id: string;
    moods: string[];
    situations: string[];
    gist: string;
    excerpt: string;
    checked: boolean;
    songs: Song[];
  }
  interface View {
    scenes: Scene[];
    counts: { scenes: number; checked: number; songs: number; byYou: number };
  }

  let v = $state<View | null>(null);
  let open = $state(false);
  $effect(() => {
    void get<View>("/api/music/bench")
      .then((r) => (v = r))
      .catch(() => (v = null));
  });

  async function mark(scene: Scene, song: Song, m: Mark) {
    try {
      v = await put<View>(`/api/music/bench/${encodeURIComponent(scene.id)}`, { videoId: song.videoId, mark: m });
    } catch (e) {
      errorToast(e);
    }
  }
  async function check(scene: Scene, checked: boolean) {
    try {
      v = await put<View>(`/api/music/bench/${encodeURIComponent(scene.id)}/checked`, { checked });
    } catch (e) {
      errorToast(e);
    }
  }
</script>

{#if v?.scenes.length}
  <section class="panel stack">
    <div class="row between">
      <h2>Picks to check</h2>
      <button class="btn ghost small fold" class:open onclick={() => (open = !open)} aria-expanded={open} aria-controls="music-bench">{open ? "Hide scenes" : "Show scenes"} <ChevronDown size={14} /></button>
    </div>
    <p class="tiny muted">
      {v.counts.scenes} scenes from your stories, each with the songs the soundtrack was likeliest to play, marked by Claude: <b>fits</b> (suits the scene), <b>fine</b> (works in the background) or <b>wrong</b> (grates). Look over a few and change any mark you disagree with. Changes to the soundtrack are measured against these. {v.counts.checked} checked, {v.counts.byYou} marks changed by you.
    </p>
    {#if open}
      <div id="music-bench" class="stack scenes">
        {#each v.scenes as s (s.id)}
          <article class="scene stack" class:done={s.checked}>
            <div class="row between wrap">
              <b class="gist">{s.gist}</b>
              <label class="switch small"><input type="checkbox" checked={s.checked} onchange={(e) => check(s, e.currentTarget.checked)} /> Checked</label>
            </div>
            <span class="tiny muted">Mood: {s.moods.join(", ")}{#if s.situations.length}{` · Happening: ${s.situations.join(", ")}`}{/if}</span>
            {#if s.excerpt}
              <details class="tiny"><summary>The end of the reply</summary><p class="excerpt">{s.excerpt}</p></details>
            {/if}
            <ul class="songs">
              {#each s.songs as song (song.videoId)}
                <li class="song">
                  <span class="name">{song.title}{#if song.artist}<span class="muted">{` · ${song.artist}`}</span>{/if}</span>
                  <span class="marks" role="group" aria-label={`Mark ${song.title}`}>
                    {#each MARKS as m (m)}
                      <button type="button" class="chip small {m}" class:on={song.mark === m} aria-pressed={song.mark === m} onclick={() => mark(s, song, m)}>{m}</button>
                    {/each}
                    {#if song.by === "you"}<span class="tiny muted">yours</span>{/if}
                  </span>
                </li>
              {/each}
            </ul>
          </article>
        {/each}
      </div>
    {/if}
  </section>
{/if}

<style>
  .scenes {
    gap: 0.9rem;
  }
  .scene {
    gap: 0.35rem;
    padding: 0.6rem 0.7rem;
    border: 1px solid var(--border);
    border-radius: 8px;
  }
  .scene.done {
    opacity: 0.7;
  }
  .gist {
    flex: 1;
    min-width: 12rem;
  }
  .excerpt {
    margin: 0.3rem 0 0;
    white-space: pre-wrap;
  }
  .songs {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.3rem;
  }
  .song {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.3rem 0.6rem;
  }
  .name {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .marks {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
  }
  .chip {
    cursor: pointer;
  }
  .chip.on.fits {
    background: var(--ok);
    color: var(--on-accent, #fff);
  }
  .chip.on.fine {
    background: var(--accent);
    color: var(--on-accent, #fff);
  }
  .chip.on.wrong {
    background: var(--danger);
    color: var(--on-accent, #fff);
  }
  .fold :global(svg) {
    transition: transform 0.15s;
  }
  .fold.open :global(svg) {
    transform: rotate(180deg);
  }
</style>
