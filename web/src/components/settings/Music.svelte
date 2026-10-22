<script lang="ts">
  import { del, get, patch, post, put } from "../../lib/api";
  import { ChevronDown, Plus, X } from "../../lib/icons";
  import { confirm } from "../../lib/dialogs.svelte";
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
    /** docs/18: look for the library's lyrics on LRCLIB and YouTube Music. */
    lyricsOnline: boolean;
    /** docs/18, 3.2: how much a song's words count when picking. */
    wordsDial: "off" | "little" | "lean";
    words: Record<string, WordsState>;
    /** read: songs whose words have been read for what they're about (their lyric sheet). */
    wordsCount: { have: number; timed: number; pending: number; of: number; read: number };
  }
  type WordsState = "timed" | "plain" | "none" | "instrumental" | "pending";
  /** docs/18, 2.1: what the helper read out of a song's words. */
  interface Sheet {
    situations: string[];
    themes: string[];
    voice: "to-you" | "about-them" | "we" | "self";
    passages: { from: number; to: number; kind: string; gist: string; situations: string[]; peak: boolean }[];
  }
  const VOICE_LABEL: Record<Sheet["voice"], string> = { "to-you": "sung to someone", "about-them": "about someone not there", we: "about us", self: "inward" };
  interface Words {
    source: "lrclib" | "ytmusic" | "pasted" | "none";
    timed: boolean;
    lines: { t: number | null; text: string }[];
  }
  const WORDS_LABEL: Record<WordsState, string> = { timed: "words · timed", plain: "words", none: "no words", instrumental: "instrumental", pending: "words…" };
  const SOURCE_LABEL: Record<Words["source"], string> = { lrclib: "from LRCLIB", ytmusic: "from YouTube Music", pasted: "pasted by you", none: "" };
  let cfg = $state<Config | null>(null);
  let code = $state<string | null>(null);
  let link = $state("");
  let moods = $state<Mood[]>([]);
  let instrumental = $state(false);
  let motifWho = $state("");
  let motifTrack = $state("");
  let busy = $state(false);
  // The song list folds away (remembered on this device); adding stays open.
  const OPEN_KEY = "mea.music.libraryOpen";
  let libraryOpen = $state(readOpen());
  function readOpen() {
    try {
      return localStorage.getItem(OPEN_KEY) === "1";
    } catch {
      return false;
    }
  }
  // Search the library: every word must match a title, an artist or a mood; and one artist, if picked.
  let query = $state("");
  let artistPick = $state("");
  const artists = $derived.by(() => {
    const n = new Map<string, number>();
    for (const t of cfg?.library ?? []) if (t.artist) n.set(t.artist, (n.get(t.artist) ?? 0) + 1);
    return [...n.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  });
  const shown = $derived.by(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return (cfg?.library ?? []).filter((t) => {
      if (artistPick && t.artist !== artistPick) return false;
      const hay = `${t.title} ${t.artist} ${t.moods.join(" ")}${t.instrumental ? " instrumental" : ""} ${WORDS_LABEL[cfg?.words[t.videoId] ?? "pending"]}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  });
  // The picked artist's songs are all gone: show everyone again.
  $effect(() => {
    if (artistPick && !artists.some(([a]) => a === artistPick)) artistPick = "";
  });
  const filtering = $derived(Boolean(query.trim() || artistPick));
  // Quick remove: tick songs (or every song shown), then remove them in one go.
  let picked = $state<string[]>([]);
  const pickedSet = $derived(new Set(picked));
  const allShownPicked = $derived(shown.length > 0 && shown.every((t) => pickedSet.has(t.videoId)));
  function pickShown() {
    const ids = shown.map((t) => t.videoId);
    picked = allShownPicked ? picked.filter((id) => !ids.includes(id)) : [...new Set([...picked, ...ids])];
  }
  async function removePicked() {
    const n = picked.length;
    if (!n || !(await confirm({ title: `Remove ${n} song${n === 1 ? "" : "s"}?`, message: "They leave the library, and lookups for your preferred artists won't add them back.", confirmLabel: "Remove", danger: true }))) return;
    try {
      cfg = await post<Config>("/api/music/library/remove", { ids: picked });
      picked = [];
      toast(`Removed ${n} song${n === 1 ? "" : "s"}`, { kind: "ok" });
    } catch (e) {
      errorToast(e);
    }
  }
  function toggleLibrary() {
    libraryOpen = !libraryOpen;
    try {
      localStorage.setItem(OPEN_KEY, libraryOpen ? "1" : "0");
    } catch {
      // Not remembered; it still opens.
    }
  }

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
  // Lyrics still being looked up: the badges fill in as they're found.
  $effect(() => {
    if (!cfg?.lyricsOnline || !cfg.wordsCount.pending) return;
    const t = setTimeout(() => void load(), 5000);
    return () => clearTimeout(t);
  });
  // One song's words, open under it: what Mea has, a box to paste your own, and Find again.
  let wordsOf = $state<string | null>(null);
  /** undefined while it loads; null: Mea has none. */
  let words = $state<Words | null | undefined>(undefined);
  let sheet = $state<Sheet | null>(null);
  let wordsText = $state("");
  let wordsBusy = $state(false);
  async function openWords(videoId: string) {
    if (wordsOf === videoId) return void (wordsOf = null);
    wordsOf = videoId;
    words = undefined;
    sheet = null;
    wordsText = "";
    try {
      const r = await get<{ words: Words | null; sheet: Sheet | null }>(`/api/music/lyrics/${videoId}`);
      words = r.words;
      sheet = r.sheet;
    } catch (e) {
      errorToast(e);
    }
  }
  async function wordsDo(req: () => Promise<{ words: Words | null; sheet: Sheet | null; view: Config }>, done: string) {
    wordsBusy = true;
    try {
      const r = await req();
      words = r.words;
      sheet = r.sheet;
      cfg = r.view;
      wordsText = "";
      toast(done, { kind: "ok" });
    } catch (e) {
      errorToast(e);
    } finally {
      wordsBusy = false;
    }
  }
  const stamp = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
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
      <div class="row between">
        <h2>Library <span class="muted small">({cfg.library.length})</span></h2>
        {#if cfg.library.length}<button class="btn ghost small fold" class:open={libraryOpen} onclick={toggleLibrary} aria-expanded={libraryOpen} aria-controls="music-library">{libraryOpen ? "Hide songs" : "Show songs"} <ChevronDown size={14} /></button>{/if}
      </div>
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
      <div class="row wrap">
        <label class="switch small"><input type="checkbox" checked={cfg.lyricsOnline} onchange={(e) => save({ lyricsOnline: e.currentTarget.checked })} /> Find lyrics online</label>
        <span class="tiny muted">Asks LRCLIB (lrclib.net) and YouTube Music for your songs' words, by title, artist and length only. They're kept on this PC, so the soundtrack can tell what a song is about.</span>
      </div>
      <label class="field words-dial"><span class="label">Words</span>
        <select class="select" value={cfg.wordsDial} onchange={(e) => save({ wordsDial: e.currentTarget.value as Config["wordsDial"] })}>
          <option value="off">Off: pick by mood only</option>
          <option value="little">A little: a song whose words fit what's happening is likelier</option>
          <option value="lean">Lean in: the words count fully, and a fitting chorus more</option>
        </select>
      </label>
      {#if cfg.wordsCount.of}
        <p class="tiny muted">Words for {cfg.wordsCount.have} of {cfg.wordsCount.of} songs ({cfg.wordsCount.timed} timed{#if cfg.wordsCount.read < cfg.wordsCount.have}, {cfg.wordsCount.read} read so far{/if}){#if cfg.lyricsOnline && cfg.wordsCount.pending} · looking up {cfg.wordsCount.pending}…{/if}</p>
      {/if}
      {#if libraryOpen || !cfg.library.length}
      <div class="stack" id="music-library">
      {#if cfg.library.length > 1}
        <div class="row wrap">
          <input class="input grow" type="search" bind:value={query} placeholder="Search by title, artist or mood" aria-label="Search the library" />
          {#if artists.length > 1}<select class="select" bind:value={artistPick} aria-label="Only this artist"><option value="">All artists</option>{#each artists as [a, n] (a)}<option value={a}>{a} ({n})</option>{/each}</select>{/if}
          {#if filtering}<span class="tiny muted">{shown.length} of {cfg.library.length}</span>{/if}
        </div>
        <div class="row wrap bulk">
          <label class="switch small"><input type="checkbox" checked={allShownPicked} onchange={pickShown} disabled={!shown.length} /> Select {filtering ? "all shown" : "all"}</label>
          {#if picked.length}
            <span class="tiny muted">{picked.length} selected</span>
            <button class="btn ghost small" onclick={() => (picked = [])}>Clear</button>
            <button class="btn small danger" onclick={removePicked}><X size={13} /> Remove {picked.length}</button>
          {/if}
        </div>
      {/if}
      {#each shown as t (t.videoId)}
        <div class="track">
          <div class="row between"><label class="pick small"><input type="checkbox" checked={pickedSet.has(t.videoId)} onchange={() => (picked = toggle(picked, t.videoId))} aria-label="Select {t.title}" /><span><b>{t.title}</b>{#if t.artist} <span class="muted">· {t.artist}</span>{/if}</span></label><span class="row tight"><button type="button" class="chip tiny words {cfg.words[t.videoId] ?? 'pending'}" class:on={wordsOf === t.videoId} onclick={() => openWords(t.videoId)} aria-expanded={wordsOf === t.videoId} title="The song's words">{WORDS_LABEL[cfg.words[t.videoId] ?? "pending"]}</button><button class="btn ghost icon small" onclick={() => song(del<Config>(`/api/music/library/${t.videoId}`))} aria-label="Remove {t.title}"><X size={13} /></button></span></div>
          <div class="row wrap moods">{#each MOODS as m (m)}<button type="button" class="chip tiny" class:on={t.moods.includes(m)} onclick={() => song(patch<Config>(`/api/music/library/${t.videoId}`, { moods: toggle(t.moods, m) }))}>{m}</button>{/each}</div>
          {#if wordsOf === t.videoId}
            <div class="stack words-card">
              {#if words?.lines.length}
                <p class="tiny muted">{words.timed ? "Timed" : "Plain"} words, {SOURCE_LABEL[words.source]}.</p>
                {#if sheet}
                  <div class="sheet">
                    <p class="small">{#if sheet.situations.length}<b>{sheet.situations.join(", ")}</b>{" · "}{/if}{VOICE_LABEL[sheet.voice]}{#if sheet.themes.length}{" · "}<span class="muted">{sheet.themes.join(", ")}</span>{/if}</p>
                    {#each sheet.passages as p, i (i)}
                      <p class="tiny"><span class="faint at">{words.timed && words.lines[p.from]?.t != null ? stamp(words.lines[p.from]!.t!) : ""}</span><b>{p.kind}{p.peak ? " ★" : ""}</b>{" "}{p.gist}{#if p.situations.length}{" "}<span class="muted">· {p.situations.join(", ")}</span>{/if}</p>
                    {/each}
                  </div>
                {:else}
                  <p class="tiny muted">Not read for what it's about yet.</p>
                {/if}
                <div class="lyrics">{#each words.lines as l, i (i)}<div class:gap={!l.text}>{#if words.timed && l.t != null}<span class="faint at">{stamp(l.t)}</span>{/if}{l.text}</div>{/each}</div>
              {:else if words === undefined}
                <p class="tiny muted">Loading…</p>
              {:else if words}
                <p class="tiny muted">No words found for this song.</p>
              {:else}
                <p class="tiny muted">{cfg.lyricsOnline ? "Not looked up yet." : "No words yet. Paste them, or turn on Find lyrics online."}</p>
              {/if}
              <textarea class="input" rows="4" bind:value={wordsText} placeholder="Paste the words: plain, or LRC with times ([01:23.45] a line)" aria-label="Paste words for {t.title}"></textarea>
              <div class="row wrap">
                <button class="btn small" disabled={wordsBusy || !wordsText.trim()} onclick={() => wordsDo(() => put(`/api/music/lyrics/${t.videoId}`, { text: wordsText }), "Words saved")}>Save words</button>
                {#if cfg.lyricsOnline}<button class="btn ghost small" disabled={wordsBusy} onclick={() => wordsDo(() => post(`/api/music/lyrics/${t.videoId}/find`, {}), "Looked again")}>{wordsBusy ? "Looking…" : "Find again"}</button>{/if}
                {#if words?.source === "pasted"}<button class="btn ghost small" disabled={wordsBusy} onclick={() => wordsDo(() => put(`/api/music/lyrics/${t.videoId}`, { text: "" }), "Pasted words removed")}>Remove pasted words</button>{/if}
              </div>
            </div>
          {/if}
        </div>
      {:else}
        {#if cfg.library.length}<p class="tiny muted">No song matches.</p>{:else}<p class="tiny muted">Nothing yet. Paste a song or playlist link, or play something in YouTube Music and Add what's playing.</p>{/if}
      {/each}
      </div>
      {/if}
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
  .fold :global(svg) {
    transition: transform 0.15s;
  }
  .fold.open :global(svg) {
    transform: rotate(180deg);
  }
  .pick {
    display: flex;
    gap: 0.45rem;
    align-items: baseline;
    cursor: pointer;
  }
  .bulk {
    gap: 0.5rem;
    align-items: center;
  }
  .words-dial {
    max-width: 34rem;
  }
  .tight {
    gap: 0.25rem;
    align-items: center;
  }
  .words.none,
  .words.pending {
    opacity: 0.6;
  }
  .words-card {
    padding-top: 0.3rem;
    border-top: 1px solid var(--line, var(--border));
  }
  .lyrics {
    max-height: 14rem;
    overflow-y: auto;
    font-size: 0.85em;
    line-height: 1.45;
  }
  .sheet {
    display: grid;
    gap: 0.15rem;
  }
  .sheet .at {
    display: inline-block;
    min-width: 2.6em;
    font-variant-numeric: tabular-nums;
  }
  .lyrics .at {
    display: inline-block;
    min-width: 2.6em;
    font-variant-numeric: tabular-nums;
  }
  .lyrics .gap {
    height: 0.6em;
  }
  .track {
    display: grid;
    gap: 0.3rem;
    padding: 0.45rem 0.6rem;
    border-radius: 10px;
    background: var(--surface-2, var(--surface));
  }
</style>
