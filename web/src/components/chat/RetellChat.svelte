<script lang="ts">
  import Modal from "../Modal.svelte";
  import { get, post } from "../../lib/api";
  import { GitBranch } from "../../lib/icons";
  import { navigate } from "../../lib/router.svelte";
  import { errorToast } from "../../lib/state.svelte";

  /**
   * Retell in another universe (docs/14, part 6): this story, or one arc of it, told again with
   * another version of the character. A new chat opens on the retold recap; this one stays as it is.
   */
  let { open = $bindable(false), chatId }: { open?: boolean; chatId: string } = $props();

  type Option = { id: string; name: string; label: string; original: boolean; universe: { id: string; name: string } | null };
  type Arc = { id: string; level: string; title: string; from: number; to: number | null };
  let versions = $state<Option[] | null>(null);
  let arcs = $state<Arc[]>([]);
  let versionId = $state("");
  let arcId = $state("");
  let steer = $state("");
  let busy = $state(false);

  $effect(() => {
    if (!open) return;
    versions = null;
    get<{ versions: Option[]; arcs: Arc[] }>(`/api/chats/${chatId}/retell`).then(
      (r) => {
        versions = r.versions;
        arcs = r.arcs;
        versionId = r.versions[0]?.id ?? "";
        arcId = r.arcs[0]?.id ?? "";
      },
      (e) => (errorToast(e), (versions = [])),
    );
  });

  const LEVEL: Record<string, string> = { story: "The whole story so far", arc: "Arc", chapter: "Chapter", scene: "Scene" };
  const arcLabel = (a: Arc) => (a.level === "story" ? LEVEL.story : `${LEVEL[a.level] ?? a.level}: ${a.title} (#${a.from}–${a.to ?? "…"})`);
  const versionLabel = (v: Option) => (v.original ? `${v.name} (the original)` : `${v.name}${v.label ? ` · ${v.label}` : ""}${v.universe && v.universe.name !== v.label ? ` · ${v.universe.name}` : ""}`);

  async function go() {
    busy = true;
    try {
      const r = await post<{ chatId: string }>(`/api/chats/${chatId}/retell`, { versionId, arcId: arcId || null, steer: steer.trim() || undefined });
      open = false;
      navigate(`/chat/${r.chatId}`);
    } catch (e) {
      errorToast(e);
    } finally {
      busy = false;
    }
  }
</script>

<Modal bind:open title="Retell in another version" size="sm">
  <div class="stack">
    <p class="small muted">The same story with another version of this character: what happened, moved into their world through its map. A new chat opens on it, and this one stays as it is.</p>
    {#if versions === null}
      <p class="small muted">Loading…</p>
    {:else if !versions.length}
      <p class="small muted">This character has no versions yet. Make one on its Versions tab.</p>
    {:else if !arcs.length}
      <p class="small muted">Nothing to retell yet: once this chat's memory has summarized a scene, it can be retold.</p>
    {:else}
      <label class="field"><span class="label">With</span>
        <select class="select" bind:value={versionId}>{#each versions as v (v.id)}<option value={v.id}>{versionLabel(v)}</option>{/each}</select>
      </label>
      <label class="field"><span class="label">Retell</span>
        <select class="select" bind:value={arcId}>{#each arcs as a (a.id)}<option value={a.id}>{arcLabel(a)}</option>{/each}</select>
      </label>
      <label class="field"><span class="label">Anything to change <span class="faint">optional</span></span>
        <input class="input" bind:value={steer} maxlength="500" placeholder="Replay our first meeting, but at the campus radio station" />
      </label>
      <div class="row"><span class="grow"></span><button class="btn primary" onclick={go} disabled={busy || !versionId}><GitBranch size={15} /> {busy ? "Retelling…" : "Retell"}</button></div>
    {/if}
  </div>
</Modal>
