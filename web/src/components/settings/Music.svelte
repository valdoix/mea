<script lang="ts">
  import { del, get, patch, post, put } from "../../lib/api";
  import { Plus, X } from "../../lib/icons";
  import { errorToast, toast } from "../../lib/state.svelte";

  /**
   * J3: the soundtrack, on YouTube Music. Mea talks only to a YouTube Music app on this PC: the
   * YouTube Music Desktop App (its Companion Server) or th-ch's YouTube Music (its API Server). The
   * picker chooses from your library (songs and playlists you add, tagged with moods), songs by your
   * preferred artists (th-ch's app finds them and they join the library by themselves), leitmotifs pinned to people and
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
    /** th-ch's app can search, so preferred artists' songs join the library by themselves. */
    canSearch: boolean;
    /** Each preferred artist's songs in the library; null until they've been looked up. */
    tasteFound: Record<string, number | null>;
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
  // Preferred artists still being looked up: check back until they're found.
  $effect(() => {
    if (!cfg?.canSearch || !Object.values(cfg.tasteFound).some((n) => n == null)) return;
    const t = setTimeout(() => void load(), 4000);
    return () => clearTimeout(t);
  });
  async function save(patch: Partial<Config>) {
    try {
      cfg = await put<Config>("/api/music", patch);
    } catch (e) {
      errorToast(e);
    }
  }
  // One song at a time: sending the whole library could undo songs a lookup added since this page loaded.
  async function song(req: Promise<Config>) {
    try {
      cfg = await req;
    } catch (e) {
      errorToast(e);
    }
  }
  async function connect() {
    busy = true;
    try {
      const r = await post<{ code?: string; connected?: Config }>("/api/music/connect", {});
      if (r.connected) {
        cfg = r.connected;
        toast("YouTube Music is connected", { kind: "ok" });
      } else code = r.code ?? null;
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
      const r = await post<Config & { added?: number }>("/api/music/library", { ...(nowPlaying ? {} : { link }), moods, instrumental });
      cfg = r;
      if (r.added != null) toast(r.added ? `Added ${r.added} song${r.added === 1 ? "" : "s"} from the playlist` : "Every song in that playlist is already here", { kind: "ok" });
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
      <p class="small muted">Music that fits the scene, on <b>YouTube Music</b>: it changes on story beats (a new scene, a change of mood or time of day, a big moment), not every reply. Mea talks only to a YouTube Music app on this PC: the YouTube Music Desktop App (turn on its Companion Server) or th-ch's YouTube Music (turn on its API Server plugin, then click Allow when it asks about Mea). A playlist link you paste is read from YouTube Music's website, since neither app can list one.</p>
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
          <button class="btn primary" onclick={connect} disabled={busy}>{busy ? "Check YouTube Music…" : "Connect YouTube Music"}</button>
          <label class="field port"><span class="label">Port</span><input class="input" type="number" min="1" max="65535" value={cfg.port} onchange={(e) => save({ port: Number(e.currentTarget.value) })} /></label>
        </div>
      {/if}
    </section>

    <section class="panel stack">
      <h2>Library <span class="muted small">({cfg.library.length})</span></h2>
      <p class="tiny muted">The picker chooses from these. Your preferred artists' songs land here by themselves. Paste a song or a playlist link (a playlist adds each of its songs; with no moods picked, Mea tags them for you). Tag each with the moods it suits.</p>
      <div class="row wrap">
        <input class="input grow" bind:value={link} placeholder="A YouTube Music song or playlist link" aria-label="YouTube Music song or playlist link" />
        <button class="btn" onclick={() => add()} disabled={busy || !link.trim()}><Plus size={14} /> {busy && link.trim() ? "Adding…" : "Add"}</button>
        {#if cfg.connected}<button class="btn ghost" onclick={() => add(true)} disabled={busy}>Add what's playing</button>{/if}
      </div>
      <div class="row wrap moods">
        {#each MOODS as m (m)}<button type="button" class="chip" class:on={moods.includes(m)} onclick={() => (moods = toggle(moods, m))}>{m}</button>{/each}
        <label class="switch small"><input type="checkbox" bind:checked={instrumental} /> instrumental</label>
      </div>
      {#each cfg.library as t (t.videoId)}
        <div class="track">
          <div class="row between"><span class="small"><b>{t.title}</b>{#if t.artist} <span class="muted">· {t.artist}</span>{/if}{#if t.instrumental} <span class="tiny faint">instrumental</span>{/if}</span><button class="btn ghost icon small" onclick={() => song(del<Config>(`/api/music/library/${t.videoId}`))} aria-label="Remove {t.title}"><X size={13} /></button></div>
          <div class="row wrap moods">{#each MOODS as m (m)}<button type="button" class="chip tiny" class:on={t.moods.includes(m)} onclick={() => song(patch<Config>(`/api/music/library/${t.videoId}`, { moods: toggle(t.moods, m) }))}>{m}</button>{/each}</div>
        </div>
      {:else}
        <p class="tiny muted">Nothing yet. Paste a song or playlist link, or play something in YouTube Music and Add what's playing.</p>
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
      <p class="tiny muted">
        {#if cfg.canSearch}Mea finds your preferred artists' songs in YouTube Music, tags the moods each one suits, and adds them to the library (a song you remove stays removed).{:else if cfg.connected}Preferred artists only lift songs already in your library here: finding their other songs needs th-ch's YouTube Music (its API Server can search).{:else}Connect th-ch's YouTube Music and your preferred artists' songs join the library by themselves.{/if}
      </p>
      <label class="field"><span class="label">Preferred artists</span><input class="input" value={cfg.taste.preferred.join(", ")} onchange={(e) => save({ taste: { ...cfg!.taste, preferred: listOf(e.currentTarget.value) } })} placeholder="comma-separated" /></label>
      {#if cfg.canSearch && cfg.taste.preferred.length}
        <p class="tiny muted">{cfg.taste.preferred.map((a) => `${a}: ${cfg!.tasteFound[a] == null ? "looking…" : `${cfg!.tasteFound[a]} in the library`}`).join(" · ")}</p>
      {/if}
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
