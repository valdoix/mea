<script lang="ts">
  import Avatar from "../Avatar.svelte";
  import OriginChanges from "./OriginChanges.svelte";
  import VersionCompare from "./VersionCompare.svelte";
  import { get, post, put } from "../../lib/api";
  import { confirm } from "../../lib/dialogs.svelte";
  import { Columns2, Copy, GitBranch, Globe2, MessageHeart, Plus, Unlink, WandSparkles, X } from "../../lib/icons";
  import { navigate } from "../../lib/router.svelte";
  import { errorToast, toast } from "../../lib/state.svelte";
  import { type LinkInfo, type UniverseSummary, VERSION_KINDS, type VersionKind } from "../../lib/types";

  /**
   * Linked versions (docs/14, part 1): a whole card or persona of its own (an AU, an era, a time skip,
   * a what-if) that remembers the original it came from. Looks (the overlays below this panel) stay
   * the light tool for an outfit or a mood.
   */
  let {
    kind,
    id,
    name,
    link,
    beforeLeave,
    onchanged,
  }: {
    kind: "character" | "persona";
    id: string;
    name: string;
    link: LinkInfo | null | undefined;
    /** Saves unsaved edits before the panel navigates away. */
    beforeLeave?: () => Promise<void>;
    onchanged: () => void;
  } = $props();

  const path = $derived(kind === "persona" ? "personas" : "characters");
  const pageOf = (vid: string) => (kind === "persona" ? `/personas/${vid}` : `/character/${vid}`);
  const kindLabel = (k: VersionKind | null) => VERSION_KINDS.find((x) => x.id === k)?.label ?? "";

  let label = $state("");
  let vkind = $state<VersionKind>("au");
  let busy = $state(false);
  let compareOpen = $state(false);
  let universes = $state<UniverseSummary[]>([]);
  $effect(() => {
    if (!link?.origin || link.universe) return;
    get<{ universes: UniverseSummary[] }>("/api/universes").then((r) => (universes = r.universes), () => {});
  });

  async function joinUniverse(universeId: string) {
    if (!universeId) return;
    try {
      await post(`/api/universes/${universeId}/join`, { kind, id });
      onchanged();
    } catch (e) {
      errorToast(e);
    }
  }

  async function leaveUniverse() {
    if (!link?.universe) return;
    if (!(await confirm({ title: `Leave ${link.universe.name}?`, message: `${name} keeps a copy of the world book as it is now, in a lorebook of their own.`, confirmLabel: "Leave" }))) return;
    try {
      await post(`/api/${path}/${id}/leave-universe`);
      onchanged();
    } catch (e) {
      errorToast(e);
    }
  }

  // Editing this card's own link (when it is a version).
  let myLabel = $state("");
  let myKind = $state<VersionKind | "">("");
  let anchors = $state<string[]>([]);
  let anchorDraft = $state("");
  $effect(() => {
    myLabel = link?.label ?? "";
    myKind = link?.kind ?? "";
    anchors = [...(link?.anchors ?? [])];
  });
  const linkDirty = $derived(Boolean(link?.origin) && (myLabel !== (link?.label ?? "") || myKind !== (link?.kind ?? "") || JSON.stringify(anchors) !== JSON.stringify(link?.anchors ?? [])));

  async function copyNow() {
    busy = true;
    try {
      await beforeLeave?.();
      const r = await post<{ id: string }>(`/api/${path}/${id}/family`, { label: label.trim(), kind: vkind });
      toast(`Made ${label.trim() || "a version"} of ${name}`, { kind: "ok" });
      label = "";
      navigate(pageOf(r.id));
    } catch (e) {
      errorToast(e);
    } finally {
      busy = false;
    }
  }

  async function inStudio() {
    busy = true;
    try {
      await beforeLeave?.();
      const r = await post<{ draft: { id: string } }>("/api/creator", { kind, baseId: id, asVersion: { kind: vkind, label: label.trim() }, idea: label.trim() });
      navigate(`/creator/${r.draft.id}`);
    } catch (e) {
      errorToast(e);
    } finally {
      busy = false;
    }
  }

  async function saveLink() {
    try {
      await put(`/api/${path}/${id}/link`, { label: myLabel.trim(), kind: myKind || null, anchors: $state.snapshot(anchors) });
      toast("Version saved", { kind: "ok" });
      onchanged();
    } catch (e) {
      errorToast(e);
    }
  }

  async function detach() {
    if (!link?.origin) return;
    if (!(await confirm({ title: `Detach from ${link.origin.name}?`, message: `${name} stays exactly as it is, but becomes an ordinary ${kind === "persona" ? "persona" : "card"} that no longer knows its original.`, confirmLabel: "Detach" }))) return;
    try {
      const originId = link.origin.id;
      await post(`/api/${path}/${id}/detach`);
      onchanged();
      toast(`${name} is on its own now`, {
        action: { label: "Undo", run: async () => (await post(`/api/${path}/${id}/link`, { originId, label: link?.label ?? "", kind: link?.kind ?? null, anchors: link?.anchors ?? [] }), onchanged()) },
      });
    } catch (e) {
      errorToast(e);
    }
  }

  async function chat(vid: string) {
    try {
      const c = await post<{ id: string }>("/api/chats", { characterId: vid });
      navigate(`/chat/${c.id}`);
    } catch (e) {
      errorToast(e);
    }
  }

  function addAnchor() {
    const a = anchorDraft.trim();
    if (a && !anchors.includes(a)) anchors = [...anchors, a];
    anchorDraft = "";
  }
</script>

<div class="stack">
  {#if link?.origin}
    <section class="panel stack tight">
      <span class="label"><GitBranch size={14} /> A version of <a href={pageOf(link.origin.id)}>{link.origin.name}</a>{#if link.origin.inTrash} <span class="faint">(in the Trash)</span>{/if}</span>
      <div class="row wrap">
        <label class="field grow"><span class="label">Called</span><input class="input" bind:value={myLabel} placeholder="College AU · Ten years later · The war never ended" maxlength="80" /></label>
        <label class="field"><span class="label">Kind</span>
          <select class="select" bind:value={myKind}>
            <option value="">—</option>
            {#each VERSION_KINDS as k (k.id)}<option value={k.id}>{k.label}</option>{/each}
          </select>
        </label>
      </div>
      <div class="field">
        <span class="label">What stays true</span>
        <span class="tiny faint">Who they are in every version: their voice, a wound, what they want.</span>
        <div class="row wrap">
          {#each anchors as a, i (a)}<span class="chip lavender">{a}<button class="x" onclick={() => (anchors = anchors.filter((_, j) => j !== i))} aria-label="Remove"><X size={11} /></button></span>{/each}
        </div>
        <div class="row">
          <input class="input grow" bind:value={anchorDraft} placeholder="Dry humour that hides fear" maxlength="300" onkeydown={(e) => e.key === "Enter" && (e.preventDefault(), addAnchor())} aria-label="Add something that stays true" />
          <button class="btn small" onclick={addAnchor} disabled={!anchorDraft.trim()}><Plus size={13} /> Add</button>
        </div>
      </div>
      <div class="field">
        <span class="label"><span><Globe2 size={13} /> Universe</span></span>
        {#if link.universe}
          <div class="row wrap"><a href="/universes/{link.universe.id}">{link.universe.name}</a><button class="btn ghost small" onclick={leaveUniverse}>Leave</button></div>
        {:else}
          <select class="select" onchange={(e) => joinUniverse(e.currentTarget.value)} aria-label="Join a universe">
            <option value="">Not in one. Join…</option>
            {#each universes as u (u.id)}<option value={u.id}>{u.name}</option>{/each}
          </select>
        {/if}
      </div>
      {#if !link.origin.inTrash}<OriginChanges {kind} {id} {onchanged} />{/if}
      <div class="row wrap">
        {#if linkDirty}<button class="btn primary small" onclick={saveLink}>Save</button>{/if}
        {#if !link.origin.inTrash}<button class="btn small" onclick={() => (compareOpen = true)}><Columns2 size={14} /> Compare with {link.origin.name}</button>{/if}
        <button class="btn ghost small" onclick={detach}><Unlink size={14} /> Detach</button>
      </div>
    </section>
    <VersionCompare bind:open={compareOpen} {kind} {id} originName={link.origin.name} />
  {/if}

  <section class="panel stack tight">
    <span class="label"><Copy size={14} /> New version of {name}</span>
    <p class="small muted">A version is a {kind === "persona" ? "persona" : "card"} of its own, linked back to {name}: an alternate universe, another era, a time skip, or a what-if. Use a Look below for something lighter, like an outfit.</p>
    <div class="row wrap">
      <input class="input grow" bind:value={label} placeholder="College AU · Ten years later · Never left the city" maxlength="80" aria-label="What the version is called" />
      <select class="select kind" bind:value={vkind} aria-label="Kind of version">
        {#each VERSION_KINDS as k (k.id)}<option value={k.id}>{k.label}</option>{/each}
      </select>
    </div>
    <div class="row wrap">
      <button class="btn primary" onclick={inStudio} disabled={busy}><WandSparkles size={14} /> Rebuild in the studio</button>
      <button class="btn" onclick={copyNow} disabled={busy}><Copy size={14} /> Copy now, change by hand</button>
    </div>
  </section>

  {#if link?.versions.length}
    <span class="label">Versions of {name}</span>
    {#each link.versions as v (v.id)}
      <div class="ver card">
        <a class="pick" href={pageOf(v.id)}>
          <Avatar id={v.avatarId} name={v.name} size={40} />
          <span class="grow"><b class="wraps">{v.label || v.name}</b><span class="tiny muted">{[v.label ? v.name : "", kindLabel(v.kind)].filter(Boolean).join(" · ")}</span></span>
        </a>
        {#if kind === "character"}<button class="btn ghost small" onclick={() => chat(v.id)}><MessageHeart size={13} /> Chat</button>{/if}
      </div>
    {/each}
  {:else if !link?.origin}
    <p class="small muted">No versions yet.</p>
  {/if}
</div>

<style>
  .grow {
    flex: 1 1 12rem;
    min-width: 0;
  }
  .kind {
    width: auto;
  }
  .ver {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.3rem 0.6rem 0.3rem 0.3rem;
  }
  .pick {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    color: var(--text);
    text-decoration: none;
    padding: 0.3rem;
  }
  .pick .grow {
    display: grid;
  }
  .x {
    border: 0;
    background: none;
    color: inherit;
    cursor: pointer;
    padding: 0 0 0 0.25rem;
    display: inline-grid;
  }
</style>
