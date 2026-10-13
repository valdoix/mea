<script lang="ts">
  import Almanac from "../components/trackers/Almanac.svelte";
  import DataEditor from "../components/trackers/DataEditor.svelte";
  import PressureCard, { type PressurePerson } from "../components/trackers/PressureCard.svelte";
  import Belongings from "../components/trackers/Belongings.svelte";
  import RelGraph from "../components/world/RelGraph.svelte";
  import TagInput from "../components/TagInput.svelte";
  import Avatar from "../components/Avatar.svelte";
  import Modal from "../components/Modal.svelte";
  import Segmented from "../components/Segmented.svelte";
  import { del, get, post, put } from "../lib/api";
  import { diffLines, editLine } from "../lib/dataedit";
  import { confirm } from "../lib/dialogs.svelte";
  import { ArrowLeft, Merge, MessagesSquare, Pin, Trash, Upload } from "../lib/icons";
  import { openMeusIn } from "../lib/meus.svelte";
  import { trackerEdit } from "../lib/trackers.svelte";
  import { uploadImage } from "../lib/images";
  import { navigate } from "../lib/router.svelte";
  import { errorToast, toast } from "../lib/state.svelte";
  import { voiceColor } from "../lib/voices";
  import type { CastPerson, CastProfile, TrackerChange } from "../lib/types";

  let { id }: { id: string } = $props();

  type Tab = "almanac" | "timeline" | "web" | "cast" | "data";
  const params = new URLSearchParams(location.search);
  let tab = $state<Tab>((params.get("tab") as Tab) ?? "almanac");
  let dataFocus = $state(params.get("focus") ?? "");

  // ---------- timeline (TRK-28) ----------
  interface Series {
    key: string;
    label: string;
    min: number;
    max: number;
    points: { seq: number; v: number }[];
  }
  let entries = $state<(TrackerChange & { messageId: string; seq: number })[]>([]);
  let series = $state<Series[]>([]);
  let kind = $state("");
  let q = $state("");
  async function loadTimeline() {
    try {
      const r = await get<{ entries: typeof entries; series: Series[] }>(`/api/chats/${id}/trackers/timeline`);
      entries = r.entries;
      series = r.series.filter((s) => s.points.length >= 2);
    } catch (e) {
      errorToast(e);
    }
  }
  const kinds = $derived([...new Set(entries.map((e) => e.kind))].sort());
  const shown = $derived(entries.filter((e) => (!kind || e.kind === kind) && (!q || `${e.text} ${e.reason ?? ""} ${e.subject ?? ""}`.toLowerCase().includes(q.toLowerCase()))).slice(-400).reverse());
  function sparkPath(s: Series) {
    const xs = s.points.map((p) => p.seq);
    const lo = Math.min(...xs);
    const hi = Math.max(...xs, lo + 1);
    const x = (v: number) => ((v - lo) / (hi - lo)) * 100;
    const y = (v: number) => 28 - ((v - s.min) / (s.max - s.min || 1)) * 26;
    let d = "";
    s.points.forEach((p, i) => {
      // Step line: a value holds until it changes.
      d += i === 0 ? `M${x(p.seq)},${y(p.v)}` : `H${x(p.seq)}V${y(p.v)}`;
    });
    return d + "H100";
  }

  // ---------- relationship graph (TRK-29, G2) ----------
  let webFocus = $state<string | null>(null);
  /** G2: "See their web": the graph, focused on one person. */
  function seeWeb(p: CastPerson) {
    editOpen = false;
    webFocus = p.char?.id ?? null;
    tab = "web";
  }

  // ---------- cast (CHAT-26, CHAT-27) ----------
  let people = $state<CastPerson[]>([]);
  let editing = $state<CastPerson | null>(null);
  let form = $state<CastProfile>({ name: "" });
  let editOpen = $state(false);
  let fileInput = $state<HTMLInputElement | null>(null);
  async function loadCast() {
    try {
      const r = await get<{ people: CastPerson[]; userName: string }>(`/api/chats/${id}/cast`);
      people = r.people;
      userName = r.userName;
      void loadPressures();
    } catch (e) {
      errorToast(e);
    }
  }
  // E1: hidden pressures, by character id (shown folded on each card).
  let pressures = $state<Record<string, PressurePerson>>({});
  async function loadPressures() {
    try {
      const r = await get<{ people: PressurePerson[] }>(`/api/chats/${id}/pressures`);
      pressures = Object.fromEntries(r.people.map((x) => [x.id, x]));
    } catch {
      pressures = {};
    }
  }
  // What the story holds about them, as an editable copy (CHAT-26: you can correct anything).
  interface StoryForm {
    aliases: string[];
    tier: string;
    activity: string;
    place: string;
    mood: string;
    look: string;
    traits: string;
    drives: { want?: string; need?: string; fear?: string; tactic?: string };
    mask: { shown?: string; felt?: string; tell?: string };
    dead: boolean;
  }
  type StoryChar = NonNullable<CastPerson["char"]>;
  let story = $state<StoryForm | null>(null);
  let mergeInto = $state("");
  let userName = $state("");
  const storyOf = (c: StoryChar): StoryForm => ({
    aliases: [...c.aliases],
    tier: c.tier ?? "off",
    activity: c.activity ?? "",
    place: c.place ?? "",
    mood: c.mood?.name ?? "",
    look: c.look ?? "",
    traits: c.traits.map((t) => t.text).join("\n"),
    drives: { want: "", need: "", fear: "", tactic: "", ...c.drives },
    mask: { shown: "", felt: "", tell: "", ...c.mask },
    dead: Boolean(c.dead),
  });
  function openEdit(p: CastPerson | null) {
    editing = p;
    form = p ? { ...(p.profile ?? {}), name: p.name } : { name: "" };
    story = p?.char ? storyOf(p.char) : null;
    mergeInto = "";
    editOpen = true;
  }
  /** Ledger lines for whatever changed in the story fields. */
  function storyLines(c: StoryChar, f: StoryForm): string[] {
    const at = (...k: string[]) => ["chars", c.id, ...k];
    const was = storyOf(c);
    const lines: string[] = [];
    for (const k of ["activity", "place", "look"] as const) if (f[k].trim() !== was[k].trim()) lines.push(editLine(at(k), f[k].trim() || null));
    if (f.tier !== was.tier) lines.push(editLine(at("tier"), f.tier));
    if (f.dead !== was.dead) lines.push(editLine(at("dead"), f.dead || null));
    if (JSON.stringify(f.aliases) !== JSON.stringify(was.aliases)) lines.push(editLine(at("aliases"), f.aliases));
    if (f.mood.trim() !== was.mood.trim()) lines.push(editLine(at("mood"), f.mood.trim() ? { ...(c.mood ?? { seq: c.lastSeq }), name: f.mood.trim(), prev: c.mood?.name } : null));
    if (f.traits.trim() !== was.traits.trim()) {
      const texts = f.traits.split("\n").map((t) => t.trim()).filter(Boolean);
      lines.push(editLine(at("traits"), texts.map((t) => c.traits.find((x) => x.text === t) ?? { text: t, by: "user", seq: c.lastSeq })));
    }
    const clean = (o: Record<string, string | undefined>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v?.trim()).map(([k, v]) => [k, v!.trim()]));
    lines.push(...diffLines(clean(was.drives), clean(f.drives), at("drives")));
    lines.push(...diffLines(clean(was.mask), clean(f.mask), at("mask")));
    return lines;
  }
  async function saveProfile() {
    if (!form.name.trim()) return;
    try {
      if (editing?.char && story) {
        const lines = storyLines(editing.char, story);
        if (lines.length && !(await trackerEdit(id, lines))) return;
      }
      await put(`/api/chats/${id}/cast/${encodeURIComponent(editing?.name ?? form.name)}`, $state.snapshot(form));
      editOpen = false;
      toast("Saved", { kind: "ok" });
      await loadCast();
    } catch (e) {
      errorToast(e);
    }
  }
  /** Meus reads the story and proposes the merge (or split) that's right, cast, Codex and all. */
  function askMeusAbout(name: string) {
    editOpen = false;
    openMeusIn(id, `Is ${name} the same person as someone else in the cast, or two people under one name? Check the story and sort it out.`, true);
    navigate(`/chat/${id}`);
  }

  async function mergePerson() {
    const into = mergeInto === "__user" ? { name: userName, id: "user" } : people.find((x) => x.key === mergeInto);
    if (!editing || !into) return;
    if (!(await confirm({ title: `Merge ${editing.name} into ${into.name}?`, message: `Everything the story knows about ${editing.name} (bonds, things, secrets, traits) moves to ${into.name}, and "${editing.name}" becomes another name for them.`, confirmLabel: "Merge" }))) return;
    try {
      await post(`/api/chats/${id}/cast/merge`, { from: editing.char?.id ?? editing.name, into: into.id === "user" ? "user" : ((into as CastPerson).char?.id ?? into.name) });
      editOpen = false;
      toast(`${editing.name} is now part of ${into.name}`, { kind: "ok" });
      await loadCast();
    } catch (e) {
      errorToast(e);
    }
  }
  async function forgetPerson() {
    if (!editing) return;
    if (!(await confirm({ title: `Forget ${editing.name}?`, message: "They leave the cast and the story's records, with their bonds. If the story names them again, they come back fresh.", confirmLabel: "Forget", danger: true }))) return;
    try {
      await del(`/api/chats/${id}/cast/${encodeURIComponent(editing.name)}?forget=1`);
      editOpen = false;
      await loadCast();
    } catch (e) {
      errorToast(e);
    }
  }
  function allFields(p: CastPerson) {
    editOpen = false;
    dataFocus = `chars.${p.id}`;
    tab = "data";
  }
  async function upload(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    try {
      form.avatarId = await uploadImage(f);
    } catch (e) {
      errorToast(e);
    }
  }
  async function togglePin(p: CastPerson) {
    try {
      await put(`/api/chats/${id}/cast/${encodeURIComponent(p.name)}`, { pinned: !p.profile?.pinned });
      await loadCast();
    } catch (e) {
      errorToast(e);
    }
  }

  $effect(() => {
    if (tab === "timeline") void loadTimeline();
    else if (tab === "cast") void loadCast();
  });
  const STAMINA = [
    ["", "From the card"],
    ["ordinary", "Ordinary"],
    ["hardy", "Hardy"],
    ["frail", "Frail"],
    ["superhuman", "Superhuman"],
    ["shifter", "Shifter"],
    ["vampire", "Vampire"],
    ["immortal", "Immortal"],
    ["construct", "Construct"],
  ];
</script>

<div class="page">
  <div class="row head">
    <a class="btn ghost icon" href="/chat/{id}" aria-label="Back to the chat"><ArrowLeft size={18} /></a>
    <h1 class="grow">Story</h1>
    <Segmented
      bind:value={tab}
      small
      options={[
        { value: "almanac" as const, label: "Almanac" },
        { value: "timeline" as const, label: "Timeline" },
        { value: "web" as const, label: "Relationships" },
        { value: "cast" as const, label: "Cast" },
        { value: "data" as const, label: "Data" },
      ]}
    />
  </div>

  {#if tab === "almanac"}
    <Almanac chatId={id} />
  {:else if tab === "data"}
    <p class="tiny muted">Everything the story keeps, field by field. Your edits are written into the story's ledger, so they hold when you rewind or swipe. Lock a record to stop the story changing it.</p>
    {#key dataFocus}<DataEditor chatId={id} focus={dataFocus} />{/key}
  {:else if tab === "timeline"}
    {#if series.length}
      <section class="sparks">
        {#each series as s (s.key)}
          <div class="spark card" title="{s.label}: {s.points.at(-1)?.v}">
            <div class="tiny row between"><span class="wraps">{s.label}</span><b>{s.points.at(-1)?.v}</b></div>
            <svg viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><path d={sparkPath(s)} /></svg>
          </div>
        {/each}
      </section>
    {/if}
    <div class="row wrap filters">
      <select class="select narrow" bind:value={kind}>
        <option value="">Every kind of change</option>
        {#each kinds as k (k)}<option value={k}>{k}</option>{/each}
      </select>
      <input class="input grow" bind:value={q} placeholder="When did… (search changes)" />
    </div>
    <div class="log">
      {#each shown as e, i (i)}
        <button class="entry" onclick={() => navigate(`/chat/${id}?at=${e.seq}`)}>
          <span class="tiny faint seq">#{e.seq}</span>
          <span class="grow"><span class="small">{e.text}</span>{#if e.reason}<span class="tiny muted"> — {e.reason}</span>{/if}</span>
          <span class="chip tiny">{e.kind}</span>
        </button>
      {:else}
        <p class="muted small">No changes recorded yet. They appear as the trackers read the story.</p>
      {/each}
    </div>
  {:else if tab === "web"}
    <RelGraph chatId={id} bind:focus={webFocus} />
  {:else}
    <div class="row between">
      <p class="tiny muted">Everyone the story has met, plus anyone you add. Voice notes go into the prompt only when that person is in the scene; pinned people are always kept in mind.</p>
      <button class="btn small" onclick={() => openEdit(null)}>Add a person</button>
    </div>
    <div class="cast">
      {#each people as p (p.key)}
        <div class="person card" class:dead={p.dead}>
          <div class="row">
            <Avatar id={p.profile?.avatarId ?? null} name={p.name} size={44} />
            <div class="grow">
              <div class="row"><b>{p.name}</b>{#if p.present}<span class="chip mint tiny">here</span>{/if}{#if p.dead}<span class="chip tiny">†</span>{/if}{#if p.profile?.standing && p.profile.standing !== "here"}<span class="chip tiny">{p.profile.standing}</span>{/if}</div>
              <div class="tiny muted wraps">{p.profile?.role ?? p.profile?.description ?? p.wants ?? ""}</div>
              {#if p.aliases.length}<div class="tiny faint wraps">also {p.aliases.join(", ")}</div>{/if}
            </div>
            <button class="btn ghost icon small" class:on={p.profile?.pinned} onclick={() => togglePin(p)} aria-label="Pin" title="Always keep in mind"><Pin size={14} /></button>
          </div>
          <div class="tiny">
            {#if p.mood}<span class="muted">Mood</span> {p.mood} ·{/if}
            {#if p.place}<span class="muted">At</span> {p.place.split(" › ").at(-1)} ·{/if}
            {#if p.regard}<span class="muted">Toward you</span> {p.regard.label ?? Object.entries(p.regard.axes).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(", ")}{/if}
          </div>
          {#if p.traits.length}<div class="tiny"><span class="muted">Always</span> {p.traits.join(" · ")}</div>{/if}
          {#if p.profile?.voice}<div class="tiny"><span class="muted">Voice</span> {p.profile.voice}</div>{/if}
          {#if p.lastSeq}<a class="tiny" href="/chat/{id}?at={p.lastSeq}">Last seen at #{p.lastSeq}</a>{/if}
          {#if pressures[p.id]}<PressureCard chatId={id} person={pressures[p.id]!} onchange={loadPressures} />{/if}
          <button class="btn ghost small" onclick={() => openEdit(p)}>Edit</button>
        </div>
      {:else}
        <p class="muted small">Nobody yet. People appear as the trackers meet them.</p>
      {/each}
    </div>
  {/if}
</div>

<Modal bind:open={editOpen} title={editing ? `About ${editing.name}` : "Add a person"} size="md">
  <div class="stack">
    <div class="row">
      <Avatar id={form.avatarId ?? null} name={form.name || "?"} size={56} />
      <button class="btn small" onclick={() => fileInput?.click()}><Upload size={14} /> Portrait</button>
      <input type="file" accept="image/*" hidden bind:this={fileInput} onchange={(e) => upload(e.currentTarget.files)} />
    </div>
    <label class="field"><span class="label">Name</span><input class="input" bind:value={form.name} /></label>
    <label class="field"><span class="label">Who they are</span><input class="input" bind:value={form.role} placeholder="Harbourmaster, Mira's older sister…" /></label>
    <label class="field"><span class="label">Description</span><textarea class="textarea" rows="3" bind:value={form.description}></textarea></label>
    <label class="field"><span class="label">Voice notes</span><textarea class="textarea" rows="2" bind:value={form.voice} placeholder="Clipped sentences, calls everyone 'love', never swears"></textarea><span class="hint">Sent only when they're in the scene, so a big cast doesn't blur into one voice.</span></label>
    <div class="grid">
      <label class="field">
        <span class="label">Colour <span class="faint">their lines and dot</span></span>
        <span class="row"><input type="color" class="swatch" value={form.color || voiceColor(form.name)} oninput={(e) => (form.color = e.currentTarget.value)} />{#if form.color}<button class="btn ghost small" onclick={() => (form.color = "")}>Automatic</button>{/if}</span>
      </label>
      <label class="field">
        <span class="label">Body</span>
        <select class="select" bind:value={form.stamina}>{#each STAMINA as [v, l] (v)}<option value={v}>{l}</option>{/each}</select>
      </label>
      <label class="field">
        <span class="label">Standing</span>
        <select class="select" bind:value={form.standing}>
          <option value="here">Around</option><option value="away">Away</option><option value="captive">Held captive</option><option value="changed">Changed / can't act</option><option value="dead">Dead</option><option value="companion">Companion (pet, mount)</option><option value="construct">Construct</option>
        </select>
      </label>
      <label class="field"><span class="label">Where now</span><input class="input" bind:value={form.where} placeholder="Town › Place" /></label>
      <label class="field"><span class="label">Home or work</span><input class="input" bind:value={form.base} placeholder="Town › Place" /></label>
    </div>
    <label class="field"><span class="label">Routine</span><input class="input" bind:value={form.routine} placeholder="9-17 Port Ellis › Harbour office; 18-23 Port Ellis › The Anchor" /><span class="hint">Hours and places, for who is likely where.</span></label>
    {#if story && editing?.char}
      <h3 class="sub">In the story now</h3>
      <label class="field"><span class="label">Also called</span><TagInput bind:value={story.aliases} placeholder="A nickname, a title…" /><span class="hint">Any of these names finds them, so the story doesn't start a second entry.</span></label>
      <div class="grid">
        <label class="field">
          <span class="label">Presence</span>
          <select class="select" bind:value={story.tier}><option value="spot">In the scene</option><option value="peri">Nearby</option><option value="off">Not here</option></select>
        </label>
        <label class="field"><span class="label">Mood</span><input class="input" bind:value={story.mood} /></label>
        <label class="field"><span class="label">Doing</span><input class="input" bind:value={story.activity} /></label>
        <label class="field"><span class="label">At</span><input class="input" bind:value={story.place} placeholder="Town › Place" /></label>
      </div>
      <label class="field"><span class="label">Look right now</span><input class="input" bind:value={story.look} placeholder="What they wear, visible marks" /></label>
      <label class="field"><span class="label">Lasting traits <span class="faint">one per line</span></span><textarea class="textarea" rows="3" bind:value={story.traits}></textarea><span class="hint">Traits you write hold against the story (it can't quietly change eye colour).</span></label>
      <div class="grid">
        <label class="field"><span class="label">Wants</span><input class="input" bind:value={story.drives.want} /></label>
        <label class="field"><span class="label">Needs</span><input class="input" bind:value={story.drives.need} /></label>
        <label class="field"><span class="label">Fears</span><input class="input" bind:value={story.drives.fear} /></label>
        <label class="field"><span class="label">Copes by</span><input class="input" bind:value={story.drives.tactic} /></label>
        <label class="field"><span class="label">Shows</span><input class="input" bind:value={story.mask.shown} /></label>
        <label class="field"><span class="label">Feels</span><input class="input" bind:value={story.mask.felt} /></label>
        <label class="field"><span class="label">Tell</span><input class="input" bind:value={story.mask.tell} /></label>
      </div>
      <label class="switch"><input type="checkbox" bind:checked={story.dead} /> Dead</label>
      <button class="btn ghost small start" onclick={() => editing && seeWeb(editing)}>See their web</button>
      <h3 class="sub">Rooms and belongings</h3>
      <Belongings chatId={id} charId={editing.char.id} name={editing.name} people={[...people.filter((x) => x.char && !x.dead).map((x) => x.name), ...(userName ? [userName] : [])]} />
      <button class="btn ghost small start" onclick={() => editing && allFields(editing)}>Every field (meters, injuries, journal…)</button>
    {/if}
    <label class="switch"><input type="checkbox" bind:checked={form.pinned} /> Always keep in mind (described in every prompt)</label>
    <label class="switch"><input type="checkbox" bind:checked={form.out} /> Leave them out of the world off the page</label>
    {#if editing}
      <h3 class="sub">Duplicates</h3>
      <div class="row wrap merge">
        <select class="select grow" bind:value={mergeInto} aria-label="The same person as">
          <option value="">The same person as…</option>
          {#each people.filter((x) => x.key !== editing?.key) as x (x.key)}<option value={x.key}>{x.name}</option>{/each}
          {#if userName}<option value="__user">{userName} (you)</option>{/if}
        </select>
        <button class="btn small" disabled={!mergeInto} onclick={mergePerson}><Merge size={14} /> Merge</button>
        <button class="btn ghost small danger" onclick={forgetPerson}><Trash size={14} /> Forget</button>
        <button class="btn ghost small" onclick={() => editing && askMeusAbout(editing.name)}><MessagesSquare size={14} /> Ask Meus to sort these out</button>
      </div>
    {/if}
  </div>
  {#snippet footer()}
    <button class="btn ghost" onclick={() => (editOpen = false)}>Cancel</button>
    <button class="btn primary" onclick={saveProfile} disabled={!form.name.trim()}>Save</button>
  {/snippet}
</Modal>

<style>
  .page {
    max-width: 64rem;
    margin: 0 auto;
    padding: 1.2rem clamp(1rem, 3vw, 2rem) 5rem;
    display: grid;
    gap: 1rem;
  }
  .head {
    gap: 0.6rem;
    flex-wrap: wrap;
  }
  .sparks {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
    gap: 0.5rem;
  }
  .spark {
    padding: 0.5rem 0.6rem;
  }
  .spark svg {
    width: 100%;
    height: 2.2rem;
    display: block;
  }
  .spark path {
    fill: none;
    stroke: var(--accent);
    stroke-width: 1.5;
    vector-effect: non-scaling-stroke;
  }
  .filters {
    gap: 0.5rem;
  }
  .narrow {
    width: auto;
  }
  .log {
    display: grid;
  }
  .entry {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    border: 0;
    border-top: 1px solid var(--border);
    background: none;
    padding: 0.45rem 0.2rem;
    text-align: left;
    color: inherit;
    cursor: pointer;
  }
  .entry:hover {
    background: var(--surface-2);
  }
  .seq {
    width: 3rem;
    flex: none;
  }
  .cast {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr));
    gap: 0.6rem;
  }
  .person {
    padding: 0.7rem;
    display: grid;
    gap: 0.3rem;
  }
  .person.dead {
    opacity: 0.6;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
    gap: 0.7rem;
  }
  .btn.on {
    color: var(--accent-ink);
  }
  .sub {
    margin: 0.4rem 0 0;
    font-size: 0.95rem;
  }
  .start {
    justify-self: start;
  }
  .merge {
    gap: 0.4rem;
  }
  .swatch {
    width: 2.4rem;
    height: 2rem;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: none;
    cursor: pointer;
  }
</style>
