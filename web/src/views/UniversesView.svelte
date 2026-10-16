<script lang="ts">
  import Avatar from "../components/Avatar.svelte";
  import EmptyState from "../components/EmptyState.svelte";
  import { del, get, post, put } from "../lib/api";
  import { confirm } from "../lib/dialogs.svelte";
  import { autosize } from "../lib/gestures";
  import { ArrowDown, ArrowLeft, BookOpen, Globe2, Plus, Trash, UserPen, Users, X } from "../lib/icons";
  import { navigate } from "../lib/router.svelte";
  import { app, errorToast, toast } from "../lib/state.svelte";
  import { type CharacterSummary, type MapRow, type MapRowState, type Persona, type Universe, type UniverseSummary, VERSION_KINDS, type VersionKind } from "../lib/types";

  /**
   * Universes (docs/14, part 4): shared settings for versions. A universe has one premise, one map
   * from the originals' worlds to this one, and one world book, linked to everyone who joined.
   */
  let { id }: { id?: string } = $props();

  let list = $state<UniverseSummary[]>([]);
  let u = $state<Universe | null>(null);
  let missing = $state(false);
  let loaded = $state(false);
  let characters = $state<CharacterSummary[]>([]);
  let personas = $state<Persona[]>([]);
  let newName = $state("");
  let addKind = $state<"character" | "persona">("character");
  let addId = $state("");
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  async function load() {
    try {
      if (id) u = await get<Universe>(`/api/universes/${id}`);
      else list = (await get<{ universes: UniverseSummary[] }>("/api/universes")).universes;
    } catch (e) {
      if ((e as { status?: number }).status === 404) missing = true;
      else errorToast(e);
    }
    loaded = true;
  }
  $effect(() => {
    void app.libraryVersion;
    void id;
    void load();
  });
  $effect(() => {
    if (!id) return;
    Promise.all([get<{ characters: CharacterSummary[] }>("/api/characters?sort=name"), get<{ personas: Persona[] }>("/api/personas")]).then(([c, p]) => {
      characters = c.characters;
      personas = p.personas;
    }, errorToast);
  });

  async function create() {
    try {
      const made = await post<Universe>("/api/universes", { name: newName.trim() || "A new universe", kind: "au" });
      newName = "";
      navigate(`/universes/${made.id}`);
    } catch (e) {
      errorToast(e);
    }
  }

  /** Name, premise and kind save as you type. */
  function edit(patch: { name?: string; premise?: string; kind?: VersionKind | null }) {
    if (!u) return;
    Object.assign(u, patch);
    clearTimeout(saveTimer);
    const cur = u.id;
    saveTimer = setTimeout(() => void put(`/api/universes/${cur}`, patch).catch(errorToast), 500);
  }

  async function editRow(row: MapRow, patch: Partial<MapRow>) {
    if (!u) return;
    Object.assign(row, patch);
    if (patch.state && patch.state !== "changed" && patch.state !== "new") row.to = "";
    try {
      await put(`/api/universes/${u.id}`, { map: [{ id: row.id, state: row.state, to: row.to }] });
    } catch (e) {
      errorToast(e);
    }
  }

  async function removeRow(row: MapRow) {
    if (!u) return;
    u.map = u.map.filter((r) => r.id !== row.id);
    await put(`/api/universes/${u.id}`, { map: [{ id: row.id, remove: true }] }).catch(errorToast);
  }

  /** "Add a character" / "Add my persona": the variant studio, already joined to this universe. */
  async function addMember() {
    if (!u || !addId) return;
    try {
      const r = await post<{ draft: { id: string } }>("/api/creator", { kind: addKind, baseId: addId, asVersion: { kind: u.kind ?? "au", label: u.name, universeId: u.id } });
      navigate(`/creator/${r.draft.id}`);
    } catch (e) {
      errorToast(e);
    }
  }

  async function leave(m: Universe["members"][number]) {
    if (!u) return;
    if (!(await confirm({ title: `Take ${m.name} out of ${u.name}?`, message: u.book ? `${m.name} keeps a copy of the world book as it is now, in a lorebook of their own.` : undefined, confirmLabel: "Take them out" }))) return;
    try {
      await post(`/api/${m.kind === "persona" ? "personas" : "characters"}/${m.id}/leave-universe`);
      await load();
    } catch (e) {
      errorToast(e);
    }
  }

  async function remove() {
    if (!u) return;
    if (!(await confirm({ title: `Delete ${u.name}?`, message: "Everyone in it stays a version, and keeps the world book linked. Only the universe itself (its premise and shared map) goes.", confirmLabel: "Delete", danger: true }))) return;
    try {
      await del(`/api/universes/${u.id}`);
      toast(`${u.name} deleted`, { kind: "ok" });
      navigate("/universes");
    } catch (e) {
      errorToast(e);
    }
  }

  const STATES: { id: MapRowState; label: string }[] = [
    { id: "open", label: "Not decided" },
    { id: "kept", label: "The same" },
    { id: "changed", label: "Becomes…" },
    { id: "dropped", label: "Not here" },
    { id: "new", label: "New here" },
  ];
  const pageOf = (m: { kind: string; id: string }) => (m.kind === "persona" ? `/personas/${m.id}` : `/character/${m.id}`);
  const kindLabel = (k: VersionKind | null) => VERSION_KINDS.find((x) => x.id === k)?.label ?? "";
  const originals = $derived(addKind === "character" ? characters.filter((c) => !c.version) : personas.filter((p) => !p.version));
</script>

<div class="page">
  {#if id}
    <button class="btn ghost small" onclick={() => navigate("/universes")}><ArrowLeft size={15} /> Universes</button>
    {#if missing}
      <EmptyState icon="🌌" title="This universe is gone" text="It was deleted, maybe on another device."><a class="btn primary" href="/universes">All universes</a></EmptyState>
    {:else if u}
      <header class="stack tight">
        <input class="title" value={u.name} oninput={(e) => edit({ name: e.currentTarget.value })} aria-label="Name" />
        <div class="row wrap">
          <select class="select mini" value={u.kind ?? ""} onchange={(e) => edit({ kind: (e.currentTarget.value || null) as VersionKind | null })} aria-label="Kind">
            <option value="">—</option>
            {#each VERSION_KINDS as k (k.id)}<option value={k.id}>{k.label}</option>{/each}
          </select>
          {#if u.book}<a class="chip sky" href="/lorebooks/{u.book.id}"><BookOpen size={12} /> {u.book.name} · {u.book.entries} entries</a>{:else}<span class="tiny muted">No world book yet: it's made the first time someone in it writes their version's lorebook.</span>{/if}
        </div>
      </header>

      <section class="panel stack tight">
        <span class="label">The premise</span>
        <textarea class="textarea story" use:autosize={{ max: 320, value: u.premise }} value={u.premise} oninput={(e) => edit({ premise: e.currentTarget.value })} placeholder="Where and when everyone in it lives, and the one change everything follows from."></textarea>
      </section>

      <section class="panel stack tight">
        <span class="label"><Users size={14} /> Who's in it</span>
        {#each u.members as m (m.kind + m.id)}
          <div class="member">
            <a class="grow who" href={pageOf(m)}>
              <Avatar id={m.avatarId} name={m.name} size={36} />
              <span class="grow"><b class="wraps">{m.name}</b><span class="tiny muted">{m.kind === "persona" ? "Persona" : "Character"}{m.originName ? ` · version of ${m.originName}` : ""}{m.label ? ` · ${m.label}` : ""}</span></span>
            </a>
            <button class="btn ghost small" onclick={() => leave(m)}>Take out</button>
          </div>
        {:else}
          <span class="tiny muted">Nobody yet.</span>
        {/each}
        <div class="row wrap add">
          <select class="select mini" bind:value={addKind} onchange={() => (addId = "")} aria-label="Character or persona">
            <option value="character">A character</option>
            <option value="persona">A persona</option>
          </select>
          <select class="select grow" bind:value={addId} aria-label="Who to bring in">
            <option value="">Pick one…</option>
            {#each originals as o (o.id)}<option value={o.id}>{o.name}</option>{/each}
          </select>
          <button class="btn small primary" onclick={addMember} disabled={!addId}>{#if addKind === "persona"}<UserPen size={14} /> Add my persona{:else}<Plus size={14} /> Add a character{/if}</button>
        </div>
        <span class="tiny muted">Opens the variant studio already in {u.name}: its premise and map come along, and only their own card and lore are written.</span>
      </section>

      <section class="stack tight">
        <span class="label">The map <span class="faint">{u.map.length} rows, shared by everyone in it</span></span>
        {#each u.map as r (r.id)}
          <div class="row-card card">
            <div class="top">
              <span class="chip tiny">{r.type}</span>
              <b class="grow from">{r.from || r.to}</b>
              <select class="select mini" value={r.state} onchange={(e) => editRow(r, { state: e.currentTarget.value as MapRowState })} aria-label="What happens to {r.from || r.to}">
                {#each STATES.filter((s) => (r.from ? s.id !== "new" : s.id === "new")) as s (s.id)}<option value={s.id}>{s.label}</option>{/each}
              </select>
              <button class="btn ghost icon small" onclick={() => removeRow(r)} aria-label="Remove row"><X size={13} /></button>
            </div>
            {#if r.state === "changed"}
              <div class="to"><ArrowDown size={13} /><input class="input" value={r.to} onchange={(e) => editRow(r, { to: e.currentTarget.value })} placeholder="What it becomes" aria-label="What {r.from} becomes" /></div>
            {/if}
          </div>
        {:else}
          <p class="small muted">No rows yet: the first version made in this universe brings its map.</p>
        {/each}
      </section>

      <div class="row"><span class="grow"></span><button class="btn ghost small danger" onclick={remove}><Trash size={14} /> Delete the universe</button></div>
    {/if}
  {:else}
    <header>
      <h1>Universes</h1>
      <p class="muted small">Shared settings for versions. An alternate universe, an era or a what-if that a whole cast can move into, your personas too: one premise, one map from the original worlds to this one, and one world book. Every version made in the studio lives in one; others can join it.</p>
    </header>
    <div class="row wrap">
      <input class="input grow" bind:value={newName} placeholder="Neon city · The war never ended · 1920s Chicago" maxlength="120" onkeydown={(e) => e.key === "Enter" && create()} aria-label="New universe name" />
      <button class="btn primary" onclick={create}><Plus size={16} /> New universe</button>
    </div>
    {#each list as x (x.id)}
      <a class="uni card" href="/universes/{x.id}">
        <span class="icon"><Globe2 size={18} /></span>
        <span class="grow">
          <b class="wraps">{x.name}</b>
          <span class="tiny muted wraps">{[kindLabel(x.kind), `${x.members.length} ${x.members.length === 1 ? "member" : "members"}`, `${x.rows} map rows`].filter(Boolean).join(" · ")}</span>
          {#if x.premise}<span class="small wraps premise">{x.premise}</span>{/if}
        </span>
        <span class="faces">{#each x.members.slice(0, 5) as m (m.kind + m.id)}<Avatar id={m.avatarId} name={m.name} size={28} />{/each}</span>
      </a>
    {:else}
      {#if loaded}<EmptyState icon="🌌" title="No universes yet" text="Make a version of a character in the Creator Studio, or start an empty universe here and bring people into it." />{/if}
    {/each}
  {/if}
</div>

<style>
  .page {
    max-width: 52rem;
    margin: 0 auto;
    padding: 1.2rem clamp(1rem, 3vw, 2rem) 5rem;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 1rem;
  }
  .grow {
    flex: 1 1 10rem;
    min-width: 0;
  }
  .title {
    border: 0;
    background: none;
    color: var(--text);
    font: 600 1.8rem/1.2 var(--font-display);
    padding: 0.2rem 0;
    outline: none;
    border-bottom: 2px solid transparent;
    width: 100%;
  }
  .title:focus {
    border-bottom-color: var(--accent);
  }
  .mini {
    width: auto;
    padding-top: 0.3rem;
    padding-bottom: 0.3rem;
    font-size: var(--fs-xs);
  }
  .member {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .who {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    color: var(--text);
    text-decoration: none;
  }
  .who .grow {
    display: grid;
  }
  .add {
    border-top: 1px solid var(--border);
    padding-top: 0.6rem;
    align-items: center;
  }
  .row-card {
    padding: 0.5rem 0.7rem;
    display: grid;
    gap: 0.4rem;
  }
  .top {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    flex-wrap: wrap;
  }
  .from {
    overflow-wrap: anywhere;
  }
  .to {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--text-muted);
  }
  .to .input {
    flex: 1;
    min-width: 0;
  }
  .uni {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    padding: 0.8rem 1rem;
    color: var(--text);
    text-decoration: none;
  }
  .uni .grow {
    display: grid;
    gap: 0.15rem;
  }
  .premise {
    color: var(--text-muted);
  }
  .icon {
    width: 2.2rem;
    height: 2.2rem;
    border-radius: 12px;
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--sky) 45%, var(--surface));
    flex: none;
  }
  .faces {
    display: flex;
    gap: 0.15rem;
    flex: none;
  }
</style>
