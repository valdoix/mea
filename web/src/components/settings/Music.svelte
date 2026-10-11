<script lang="ts">
  import { get, post, put } from "../../lib/api";
  import { Plus, X } from "../../lib/icons";
  import { errorToast, toast } from "../../lib/state.svelte";

  /**
   * J3: the soundtrack, on YouTube Music. Mea talks only to the YouTube Music Desktop App on this
   * PC (its Companion Server); there's no search, so the picker chooses from your library: tracks
   * you add (a link, or what's playing now) and tag with moods, leitmotifs pinned to people and
   * bonds, and your taste. Off until you connect.
   */
  const MOODS = ["calm", "tender", "melancholy", "tense", "dread", "bright", "epic", "mystery", "night"] as const;
  type Mood = (typeof MOODS)[number];
  interface Track {
    videoId: string;
    title: string;
    artist: string;
    moods: Mood[];
    instrumental: boolean;
  }
  interface Config {
    enabled: boolean;
    port: number;
    connected: boolean;
    library: Track[];
    leitmotifs: { who: string; videoId: string }[];
    taste: { preferred: string[]; banned: string[]; instrumentalInDialogue: boolean };
  }
  let cfg = $state<Config | null>(null);
  let code = $state<string | null>(null);
  let link = $state("");
  let moods = $state<Mood[]>([]);
  let instrumental = $state(false);
  let motifWho = $state("");
  let motifTrack = $state("");
  let busy = $state(false);

  async function load() {
    try {
      cfg = await get<Config>("/api/music");
    } catch (e) {
      errorToast(e);
    }
  }
  $effect(() => {
    void load();
  });
  async function save(patch: Partial<Config>) {
    try {
      cfg = await put<Config>("/api/music", patch);
    } catch (e) {
      errorToast(e);
    }
  }
  async function connect() {
    busy = true;
    try {
      code = (await post<{ code: string }>("/api/music/connect", {})).code;
    } catch (e) {
      errorToast(e);
    } finally {
      busy = false;
    }
  }
  async function finish() {
    if (!code) return;
    busy = true;
    try {
      cfg = await post<Config>("/api/music/connect/finish", { code });
      code = null;
      toast("YouTube Music is connected", { kind: "ok" });
    } catch (e) {
      errorToast(e);
    } finally {
      busy = false;
    }
  }
  async function add(nowPlaying = false) {
    busy = true;
    try {
      cfg = await post<Config>("/api/music/library", { ...(nowPlaying ? {} : { link }), moods, instrumental });
      link = "";
      moods = [];
      instrumental = false;
    } catch (e) {
      errorToast(e);
    } finally {
      busy = false;
    }
  }
  const toggle = <T,>(xs: T[], x: T) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]);
  const listOf = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
</script>

{#if cfg}
  <div class="stack">
    <section class="panel stack">
      <h2>Soundtrack</h2>
      <p class="small muted">Music that fits the scene, on <b>YouTube Music</b>: it changes on story beats (a new scene, a change of mood or time of day, a big moment), not every reply. Mea talks only to the YouTube Music Desktop App on this PC; turn on its Companion Server in the app's settings.</p>
      {#if cfg.connected}
        <div class="row wrap">
          <label class="switch"><input type="checkbox" checked={cfg.enabled} onchange={(e) => save({ enabled: e.currentTarget.checked })} /> On</label>
          <span class="tiny muted">Connected. Turn the music on per chat from its header (♪), or in Story setup › Look.</span>
          <button class="btn ghost small" onclick={async () => (cfg = await post<Config>("/api/music/disconnect", {}))}>Disconnect</button>
        </div>
      {:else if code}
        <p class="small">YouTube Music is showing a request from Mea with the code <b class="code">{code}</b>. Approve it there, then:</p>
        <div class="row"><button class="btn primary" onclick={finish} disabled={busy}>{busy ? "Waiting…" : "I approved it"}</button><button class="btn ghost" onclick={() => (code = null)}>Cancel</button></div>
      {:else}
        <div class="row wrap">
          <button class="btn primary" onclick={connect} disabled={busy}>Connect YouTube Music</button>
          <label class="field port"><span class="label">Port</span><input class="input" type="number" min="1" max="65535" value={cfg.port} onchange={(e) => save({ port: Number(e.currentTarget.value) })} /></label>
        </div>
      {/if}
    </section>

    <section class="panel stack">
      <h2>Library <span class="muted small">({cfg.library.length})</span></h2>
      <p class="tiny muted">The picker chooses from these. Tag each with the moods it suits.</p>
      <div class="row wrap">
        <input class="input grow" bind:value={link} placeholder="A YouTube Music link" aria-label="YouTube Music link" />
        <button class="btn" onclick={() => add()} disabled={busy || !link.trim()}><Plus size={14} /> Add</button>
        {#if cfg.connected}<button class="btn ghost" onclick={() => add(true)} disabled={busy}>Add what's playing</button>{/if}
      </div>
      <div class="row wrap moods">
        {#each MOODS as m (m)}<button type="button" class="chip" class:on={moods.includes(m)} onclick={() => (moods = toggle(moods, m))}>{m}</button>{/each}
        <label class="switch small"><input type="checkbox" bind:checked={instrumental} /> instrumental</label>
      </div>
      {#each cfg.library as t (t.videoId)}
        <div class="track">
          <div class="row between"><span class="small"><b>{t.title}</b>{#if t.artist} <span class="muted">· {t.artist}</span>{/if}{#if t.instrumental} <span class="tiny faint">instrumental</span>{/if}</span><button class="btn ghost icon small" onclick={() => save({ library: cfg!.library.filter((x) => x.videoId !== t.videoId) })} aria-label="Remove {t.title}"><X size={13} /></button></div>
          <div class="row wrap moods">{#each MOODS as m (m)}<button type="button" class="chip tiny" class:on={t.moods.includes(m)} onclick={() => save({ library: cfg!.library.map((x) => (x.videoId === t.videoId ? { ...x, moods: toggle(x.moods, m) } : x)) })}>{m}</button>{/each}</div>
        </div>
      {:else}
        <p class="tiny muted">Nothing yet. Paste a link, or play something in YouTube Music and Add what's playing.</p>
      {/each}
    </section>

    <section class="panel stack">
      <h2>Leitmotifs</h2>
      <p class="tiny muted">A song for a person ("Spike") or a bond ("Spike & Buffy"): it comes back when they share a scene.</p>
      {#each cfg.leitmotifs as l, i (i)}
        <div class="row between small"><span>{l.who} → {cfg.library.find((t) => t.videoId === l.videoId)?.title ?? l.videoId}</span><button class="btn ghost icon small" onclick={() => save({ leitmotifs: cfg!.leitmotifs.filter((_, j) => j !== i) })} aria-label="Remove"><X size={13} /></button></div>
      {/each}
      <div class="row wrap">
        <input class="input grow" bind:value={motifWho} placeholder="Spike & Buffy" aria-label="Who" />
        <select class="select" bind:value={motifTrack} aria-label="Song"><option value="">A song from the library</option>{#each cfg.library as t (t.videoId)}<option value={t.videoId}>{t.title}</option>{/each}</select>
        <button class="btn" disabled={!motifWho.trim() || !motifTrack} onclick={() => (save({ leitmotifs: [...cfg!.leitmotifs, { who: motifWho.trim(), videoId: motifTrack }] }), (motifWho = ""), (motifTrack = ""))}>Pin</button>
      </div>
    </section>

    <section class="panel stack">
      <h2>Taste</h2>
      <label class="field"><span class="label">Preferred artists</span><input class="input" value={cfg.taste.preferred.join(", ")} onchange={(e) => save({ taste: { ...cfg!.taste, preferred: listOf(e.currentTarget.value) } })} placeholder="comma-separated" /></label>
      <label class="field"><span class="label">Never play</span><input class="input" value={cfg.taste.banned.join(", ")} onchange={(e) => save({ taste: { ...cfg!.taste, banned: listOf(e.currentTarget.value) } })} placeholder="comma-separated artists" /></label>
      <label class="switch"><input type="checkbox" checked={cfg.taste.instrumentalInDialogue} onchange={(e) => save({ taste: { ...cfg!.taste, instrumentalInDialogue: e.currentTarget.checked } })} /> Instrumental only during dialogue</label>
    </section>
  </div>
{/if}

<style>
  .grow {
    flex: 1;
    min-width: 12rem;
  }
  .port {
    max-width: 7rem;
  }
  .code {
    font-size: 1.2em;
    letter-spacing: 0.1em;
  }
  .moods {
    gap: 0.3rem;
  }
  .chip {
    cursor: pointer;
  }
  .chip.on {
    background: var(--accent);
    color: var(--on-accent, #fff);
  }
  .track {
    display: grid;
    gap: 0.3rem;
    padding: 0.45rem 0.6rem;
    border-radius: 10px;
    background: var(--surface-2, var(--surface));
  }
</style>
