<script lang="ts">
  import { get, patch } from "../../lib/api";
  import { Cpu, Check, Star } from "../../lib/icons";
  import { errorToast, toast } from "../../lib/state.svelte";
  import type { ChatDetail, Connection, ModelInfo, Profile } from "../../lib/types";

  /** CONN-07: switch models from the header. Profiles first, then starred models (kept with the chat's profile settings). */
  let { detail, onchange }: { detail: ChatDetail; onchange: () => void } = $props();

  let open = $state(false);
  let profiles = $state<Profile[]>([]);
  let storyId = $state<string | null>(null);
  let models = $state<ModelInfo[]>([]);
  let connections = $state<Connection[]>([]);
  let btn = $state<HTMLButtonElement | null>(null);

  async function load() {
    try {
      const [p, m, c] = await Promise.all([
        get<{ profiles: Profile[]; storyProfileId: string | null }>("/api/profiles"),
        get<{ models: ModelInfo[] }>("/api/models"),
        get<{ connections: Connection[] }>("/api/connections"),
      ]);
      profiles = p.profiles;
      storyId = p.storyProfileId;
      models = m.models.filter((x) => x.starred);
      connections = c.connections;
    } catch (e) {
      errorToast(e);
    }
  }
  $effect(() => {
    if (open) void load();
  });
  $effect(() => {
    void load();
  });

  const s = $derived(detail.chat.settings);
  const activeProfile = $derived(profiles.find((p) => p.id === (s.profileId ?? storyId)));
  const label = $derived(s.modelOverride ? s.modelOverride.modelId.split("/").at(-1) : (activeProfile?.modelId?.split("/").at(-1) ?? "Model"));
  const billing = (connId: string | null | undefined) => connections.find((c) => c.id === connId)?.billing ?? "unknown";
  const badge = (b: string, kind?: string) => (b === "subscription" ? "subscription" : kind === "nanogpt" ? "NanoGPT pay-as-you-go" : b === "paygo" ? "pay-as-you-go" : "");

  async function pickProfile(id: string | null) {
    open = false;
    try {
      await patch(`/api/chats/${detail.chat.id}`, { settings: { profileId: id, modelOverride: null } });
      onchange();
    } catch (e) {
      errorToast(e);
    }
  }
  async function pickModel(m: ModelInfo) {
    open = false;
    try {
      await patch(`/api/chats/${detail.chat.id}`, { settings: { modelOverride: { connectionId: m.connectionId, modelId: m.id } } });
      toast(`${m.name} for this chat, with ${activeProfile?.name ?? "the story"} profile's settings`, { kind: "ok" });
      onchange();
    } catch (e) {
      errorToast(e);
    }
  }
</script>

<div class="ms">
  <button class="btn ghost small trigger" bind:this={btn} onclick={() => (open = !open)} title="Switch model for this chat" aria-haspopup="menu" aria-expanded={open}>
    <Cpu size={15} /> <span class="truncate lbl hide-sm">{label}</span>
  </button>
  {#if open}
    <div class="pop card" role="menu">
      <div class="tiny muted h">Profiles</div>
      <button class="it" role="menuitem" onclick={() => pickProfile(null)}>
        <span class="grow">Story default</span>{#if !s.profileId && !s.modelOverride}<Check size={14} />{/if}
      </button>
      {#each profiles as p (p.id)}
        {@const b = billing(p.connectionId)}
        <button class="it" role="menuitem" onclick={() => pickProfile(p.id)}>
          <span class="grow"><span class="small">{p.name}</span><span class="tiny faint block mono truncate">{p.modelId ?? "no model"}</span></span>
          {#if badge(b, connections.find((c) => c.id === p.connectionId)?.kind)}<span class="chip {b === 'subscription' ? 'mint' : 'peach'} tiny">{badge(b, connections.find((c) => c.id === p.connectionId)?.kind)}</span>{/if}
          {#if s.profileId === p.id && !s.modelOverride}<Check size={14} />{/if}
        </button>
      {/each}
      {#if models.length}
        <div class="tiny muted h">Starred models</div>
        {#each models as m (`${m.connectionId}:${m.id}`)}
          {@const b = billing(m.connectionId)}
          <button class="it" role="menuitem" onclick={() => pickModel(m)}>
            <Star size={13} />
            <span class="grow"><span class="small">{m.name}</span><span class="tiny faint block">{connections.find((c) => c.id === m.connectionId)?.name}</span></span>
            <span class="chip {b === 'subscription' ? 'mint' : 'peach'} tiny">{badge(b, connections.find((c) => c.id === m.connectionId)?.kind) || b}</span>
            {#if s.modelOverride?.modelId === m.id && s.modelOverride.connectionId === m.connectionId}<Check size={14} />{/if}
          </button>
        {/each}
      {:else}
        <div class="tiny faint pad">Star models in Settings → Models to switch to them here.</div>
      {/if}
    </div>
    <button class="scrim" aria-label="Close" onclick={() => (open = false)}></button>
  {/if}
</div>

<style>
  .ms {
    position: relative;
  }
  .trigger {
    max-width: 11rem;
  }
  .lbl {
    max-width: 8rem;
  }
  .pop {
    position: absolute;
    right: 0;
    top: calc(100% + 0.3rem);
    width: min(22rem, 90vw);
    max-height: 70vh;
    overflow: auto;
    z-index: 30;
    padding: 0.3rem;
    box-shadow: var(--shadow-2, var(--shadow-1));
  }
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 29;
    background: transparent;
    border: 0;
  }
  .h {
    padding: 0.4rem 0.5rem 0.2rem;
    font-weight: 700;
  }
  .it {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    width: 100%;
    border: 0;
    background: none;
    padding: 0.45rem 0.5rem;
    border-radius: var(--r-sm);
    cursor: pointer;
    color: inherit;
    text-align: left;
  }
  .it:hover {
    background: var(--surface-2);
  }
  .block {
    display: block;
  }
  .pad {
    padding: 0.4rem 0.5rem;
  }
</style>
