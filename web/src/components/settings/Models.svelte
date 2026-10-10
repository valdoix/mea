<script lang="ts">
  import Modal from "../Modal.svelte";
  import QuotaRing from "../QuotaRing.svelte";
  import ModelPicker from "./ModelPicker.svelte";
  import Routing from "./Routing.svelte";
  import { del, get, post, put } from "../../lib/api";
  import { confirm, promptText } from "../../lib/dialogs.svelte";
  import { refreshQuota } from "../../lib/events";
  import { compact, timeAgo } from "../../lib/format";
  import { KeyRound, Plus, RefreshCw, Trash } from "../../lib/icons";
  import { app, errorToast, toast } from "../../lib/state.svelte";
  import type { CacheProbe, Connection, ModelInfo, Profile, ProfileParams } from "../../lib/types";

  let connections = $state<Connection[]>([]);
  let models = $state<ModelInfo[]>([]);
  let profiles = $state<Profile[]>([]);
  let storyId = $state<string | null>(null);
  let addOpen = $state(false);
  let addKind = $state<"nano-sub" | "nano-paygo" | "openai" | "mock">("nano-sub");
  let form = $state({ name: "", baseUrl: "", apiKey: "", billing: "paygo" as Connection["billing"], format: "openai" as NonNullable<Connection["format"]> });
  let probing = $state<Record<string, boolean>>({});
  let busy = $state(false);
  let syncing = $state<Record<string, boolean>>({});
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  async function load() {
    try {
      const [c, m, p] = await Promise.all([
        get<{ connections: Connection[]; devMode: boolean }>("/api/connections"),
        get<{ models: ModelInfo[] }>("/api/models"),
        get<{ profiles: Profile[]; storyProfileId: string | null }>("/api/profiles"),
      ]);
      connections = c.connections;
      app.devMode = c.devMode;
      models = m.models;
      profiles = p.profiles;
      storyId = p.storyProfileId;
    } catch (e) {
      errorToast(e);
    }
  }
  $effect(() => {
    void load();
  });

  function openAdd(kind: typeof addKind) {
    addKind = kind;
    form = {
      name: kind === "nano-sub" ? "NanoGPT · Subscription" : kind === "nano-paygo" ? "NanoGPT · Pay-as-you-go" : kind === "mock" ? "Mock (dev)" : "LinkAPI",
      baseUrl: kind === "openai" ? "https://" : "",
      apiKey: "",
      billing: kind === "nano-sub" ? "subscription" : "paygo",
      format: "openai",
    };
    addOpen = true;
  }

  async function addConnection() {
    busy = true;
    try {
      const kind = addKind === "openai" ? "openai" : addKind === "mock" ? "mock" : "nanogpt";
      const r = await post<{ connection: Connection; syncError: string | null }>("/api/connections", {
        name: form.name,
        kind,
        baseUrl: kind === "openai" ? form.baseUrl : undefined,
        apiKey: form.apiKey || undefined,
        billing: form.billing,
        format: kind === "openai" ? form.format : undefined,
      });
      addOpen = false;
      if (r.syncError) toast(`Saved, but loading models failed: ${r.syncError}`, { kind: "error" });
      else toast(`Connected · ${r.connection.modelCount} models`, { kind: "ok" });
      await load();
      if (!profiles.length) await autoProfile(r.connection.id);
      void refreshQuota();
    } catch (e) {
      errorToast(e);
    } finally {
      busy = false;
    }
  }

  /** First connection: make a story profile right away, preferring GLM 5.3 on the subscription. */
  async function autoProfile(connectionId: string) {
    const list = models.filter((m) => m.connectionId === connectionId);
    const pick = list.find((m) => m.id === "z-ai/glm-5.3") ?? list.find((m) => /glm-5/.test(m.id) && !/flash|cyber|uncensored|abliterated/.test(m.id)) ?? list[0];
    if (!pick) return;
    await post("/api/profiles", { name: "Story", connectionId, modelId: pick.id, params: { context_target: 48000, max_tokens: 1200 } });
    await load();
    toast(`Story model set to ${pick.name}`, { kind: "ok" });
  }

  async function sync(c: Connection) {
    syncing[c.id] = true;
    try {
      const r = await post<{ count: number }>(`/api/connections/${c.id}/sync`);
      toast(`${r.count} models loaded`, { kind: "ok" });
      await load();
    } catch (e) {
      errorToast(e);
    } finally {
      syncing[c.id] = false;
    }
  }

  async function replaceKey(c: Connection) {
    const key = await promptText({ title: `New key for ${c.name}`, placeholder: "Paste the API key", confirmLabel: "Save key" });
    if (!key?.trim()) return;
    await put(`/api/connections/${c.id}`, { apiKey: key.trim() });
    await sync(c);
  }

  async function setFormat(c: Connection, format: NonNullable<Connection["format"]>) {
    try {
      await put(`/api/connections/${c.id}`, { format });
      await load();
    } catch (e) {
      errorToast(e);
    }
  }

  /** Sends two small identical requests to see whether the provider caches the prefix (CONN-24). */
  async function probe(p: Profile) {
    if (!p.connectionId || !p.modelId) return;
    probing[p.id] = true;
    try {
      const r = await post<CacheProbe>(`/api/connections/${p.connectionId}/probe`, { modelId: p.modelId });
      toast(r.error ? `Cache check failed: ${r.error}` : r.verified ? `Caching works · ${Math.round(r.hitRate * 100)}% of the repeat was cached` : "No cache hits seen on this route", { kind: r.verified ? "ok" : "error" });
      await load();
    } catch (e) {
      errorToast(e);
    } finally {
      probing[p.id] = false;
    }
  }

  async function removeConnection(c: Connection) {
    if (!(await confirm({ title: `Remove ${c.name}?`, message: "Its key is deleted. Profiles using it stop working until you pick another model.", confirmLabel: "Remove", danger: true }))) return;
    try {
      await del(`/api/connections/${c.id}`);
    } catch (err) {
      errorToast(err);
      return;
    }
    await load();
  }

  async function addProfile() {
    const conn = connections.find((c) => c.billing === "subscription") ?? connections[0];
    await post("/api/profiles", { name: `Profile ${profiles.length + 1}`, connectionId: conn?.id ?? null, modelId: null, params: { context_target: 48000, max_tokens: 1200 } });
    await load();
  }

  function saveProfile(p: Profile) {
    clearTimeout(timers.get(p.id));
    timers.set(
      p.id,
      setTimeout(async () => {
        try {
          await put(`/api/profiles/${p.id}`, { name: p.name, connectionId: p.connectionId, modelId: p.modelId, params: $state.snapshot(p.params) });
        } catch (e) {
          errorToast(e);
        }
      }, 400),
    );
  }

  async function setStory(id: string) {
    storyId = id;
    await put("/api/routing", { story: id });
  }

  async function removeProfile(p: Profile) {
    if (!(await confirm({ title: `Delete profile “${p.name}”?`, confirmLabel: "Delete", danger: true }))) return;
    try {
      await del(`/api/profiles/${p.id}`);
    } catch (err) {
      errorToast(err);
      return;
    }
    await load();
  }

  function setParam<K extends keyof ProfileParams>(p: Profile, k: K, v: string, int = false) {
    const n = v === "" ? undefined : int ? Math.round(Number(v)) : Number(v);
    (p.params as Record<string, unknown>)[k] = n;
    saveProfile(p);
  }

  const weekly = $derived(app.quota?.weekly?.limit ?? null);
  const quotaPct = $derived(app.quota?.weekly?.limit ? Math.round(((app.quota.weekly.used ?? 0) / app.quota.weekly.limit) * 100) : null);
  function turnsPerDay(target: number | undefined) {
    if (!weekly) return null;
    const perTurn = (target ?? 48000) + 1200;
    return { now: Math.round(weekly / 7 / perTurn), full: Math.round(weekly / 7 / (perTurn + 13000)) };
  }
  const modelsFor = (connId: string | null) => models.filter((m) => m.connectionId === connId);
  const modelOf = (p: Profile) => models.find((m) => m.connectionId === p.connectionId && m.id === p.modelId);
  const billingLabel = { subscription: "subscription", paygo: "pay-as-you-go", unknown: "unknown billing" };
</script>

<div class="stack">
  {#if app.quota?.weekly || app.quota?.daily}
    <section class="panel row between wrap">
      <div class="row"><QuotaRing size={44} /><div><b>NanoGPT subscription</b>{#if quotaPct != null}<div class="tiny muted">{quotaPct}% of this week's input tokens used</div>{/if}</div></div>
      <div class="tiny muted">
        {#if app.quota?.weekly?.limit}{compact(app.quota.weekly.used)} / {compact(app.quota.weekly.limit)} this week{/if}
        {#if app.quota?.daily?.limit} · {compact(app.quota.daily.used)} / {compact(app.quota.daily.limit)} today{/if}
        · updated {timeAgo(app.quota?.fetchedAt)}
      </div>
    </section>
  {/if}

  <section class="stack tight">
    <div class="row between wrap">
      <h2>Connections</h2>
      <div class="row wrap">
        <button class="btn small" onclick={() => openAdd("nano-sub")}><Plus size={14} /> NanoGPT subscription key</button>
        <button class="btn small" onclick={() => openAdd("nano-paygo")}><Plus size={14} /> NanoGPT pay-as-you-go key</button>
        <button class="btn small" onclick={() => openAdd("openai")}><Plus size={14} /> OpenAI-compatible</button>
        {#if app.devMode}<button class="btn small ghost" onclick={() => openAdd("mock")}><Plus size={14} /> Mock</button>{/if}
      </div>
    </div>
    <p class="tiny muted">
      Tip: in NanoGPT's dashboard, set your subscription key's billing to <b>Subscription only</b>; then it can never spend your balance. Use a separate pay-as-you-go key for
      Claude and (later) embeddings.
    </p>
    {#each connections as c (c.id)}
      <div class="conn card">
        <div class="grow">
          <div class="row wrap"><b>{c.name}</b><span class="chip {c.billing === 'subscription' ? 'mint' : c.billing === 'paygo' ? 'peach' : ''}">{billingLabel[c.billing]}</span></div>
          <div class="tiny muted">
            {c.kind === "openai" ? c.baseUrl : c.kind === "nanogpt" ? "NanoGPT" : "Mock provider"} · {c.hasKey ? `key ${c.keyMask}` : "no key"} · {c.modelCount} models{c.lastSyncAt ? ` · synced ${timeAgo(c.lastSyncAt)}` : ""}
          </div>
          {#if c.kind === "openai"}
            <label class="row tiny muted fmt">
              Request format
              <select class="select tiny" value={c.format ?? "openai"} onchange={(e) => setFormat(c, e.currentTarget.value as "openai" | "anthropic")}>
                <option value="openai">OpenAI chat completions</option>
                <option value="anthropic">Anthropic Messages</option>
              </select>
            </label>
          {/if}
          {#if c.lastError}<div class="tiny" style="color:var(--danger)">{c.lastError}</div>{/if}
        </div>
        <div class="row">
          <button class="btn ghost icon small" onclick={() => sync(c)} disabled={syncing[c.id]} aria-label="Reload models"><RefreshCw size={15} class={syncing[c.id] ? "spin" : ""} /></button>
          {#if c.kind !== "mock"}<button class="btn ghost icon small" onclick={() => replaceKey(c)} aria-label="Replace key"><KeyRound size={15} /></button>{/if}
          <button class="btn ghost icon small" onclick={() => removeConnection(c)} aria-label="Remove connection"><Trash size={15} /></button>
        </div>
      </div>
    {:else}
      <div class="panel muted small">No connections yet. Start with your NanoGPT subscription key.</div>
    {/each}
  </section>

  <section class="stack tight">
    <div class="row between"><h2>Model profiles</h2><button class="btn small" onclick={addProfile} disabled={!connections.length}><Plus size={14} /> Profile</button></div>
    <p class="tiny muted">A profile is a model plus its settings. The <b>story</b> profile writes replies; each chat can pick a different one in its panel.</p>
    {#each profiles as p (p.id)}
      {@const est = turnsPerDay(p.params.context_target)}
      {@const conn = connections.find((c) => c.id === p.connectionId)}
      {@const mi = modelOf(p)}
      <div class="profile card stack tight">
        <div class="row between wrap">
          <input class="pname" bind:value={p.name} oninput={() => saveProfile(p)} aria-label="Profile name" />
          <div class="row">
            <label class="switch"><input type="radio" name="story" checked={storyId === p.id} onchange={() => setStory(p.id)} /> Story default</label>
            <button class="btn ghost icon small" onclick={() => removeProfile(p)} aria-label="Delete profile"><Trash size={15} /></button>
          </div>
        </div>
        <label class="field">
          <span class="label">Connection</span>
          <select class="select" bind:value={p.connectionId} onchange={() => ((p.modelId = null), saveProfile(p))}>
            {#each connections as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
          </select>
        </label>
        <div class="field">
          <span class="label">Model {#if p.modelId}<span class="faint mono">{p.modelId}</span>{/if}</span>
          <ModelPicker models={modelsFor(p.connectionId)} bind:value={p.modelId} onpick={() => saveProfile(p)} />
          {#if conn?.billing === "subscription" && p.modelId && !modelsFor(p.connectionId).find((m) => m.id === p.modelId)?.subscription}
            <span class="notice warn tiny">This model isn't in your subscription; a "Subscription only" key will refuse it.</span>
          {/if}
        </div>
        <div class="grid">
          <label class="field">
            <span class="label">Prompt size target</span>
            <input class="input" type="number" min="4000" step="1000" value={p.params.context_target ?? 48000} oninput={(e) => setParam(p, "context_target", e.currentTarget.value, true)} />
            {#if est}<span class="hint">≈ {est.now} replies/day now · ≈ {est.full} with all memory helpers (later phases)</span>{/if}
          </label>
          <label class="field"><span class="label">Max reply tokens</span><input class="input" type="number" min="64" step="50" value={p.params.max_tokens ?? ""} placeholder="preset" oninput={(e) => setParam(p, "max_tokens", e.currentTarget.value, true)} /></label>
          <label class="field"><span class="label">Temperature</span><input class="input" type="number" min="0" max="2" step="0.05" value={p.params.temperature ?? ""} placeholder="preset" oninput={(e) => setParam(p, "temperature", e.currentTarget.value)} /></label>
          <label class="field">
            <span class="label">Reasoning effort</span>
            <select class="select" value={p.params.reasoning_effort ?? ""} onchange={(e) => ((p.params.reasoning_effort = e.currentTarget.value || undefined), saveProfile(p))}>
              <option value="">Model default</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="max">Max</option>
            </select>
          </label>
        </div>
        <label class="switch"><input type="checkbox" checked={Boolean(p.params.hide_reasoning)} onchange={(e) => ((p.params.hide_reasoning = e.currentTarget.checked || undefined), saveProfile(p))} /> Ask the provider not to return reasoning</label>
        <div class="field">
          <label class="switch"><input type="checkbox" checked={p.params.prefill !== undefined} onchange={(e) => ((p.params.prefill = e.currentTarget.checked ? "" : undefined), saveProfile(p))} /> Its own prefill <span class="tiny muted">(the start of every reply; replaces the preset's, even when empty)</span></label>
          {#if p.params.prefill !== undefined}
            <textarea class="textarea" rows="2" value={p.params.prefill} onchange={(e) => ((p.params.prefill = e.currentTarget.value), saveProfile(p))} placeholder="Leave empty for no prefill with this model (some models refuse prefills)"></textarea>
          {/if}
        </div>
        {#if mi?.learnedContext}<span class="tiny muted">Learned limit: this model refused prompts over ≈ {compact(mi.learnedContext)} tokens, so Mea stays under that.</span>{/if}
        {#if conn && conn.billing !== "subscription" && p.modelId}
          <div class="row wrap cache">
            <label class="switch"><input type="checkbox" checked={p.params.cache !== "off"} onchange={(e) => ((p.params.cache = e.currentTarget.checked ? undefined : "off"), saveProfile(p))} /> Prompt caching</label>
            {#if mi?.cacheProbe}
              <span class="chip {mi.cacheProbe.verified ? 'mint' : mi.cacheProbe.error ? 'rose' : 'butter'}" title={mi.cacheProbe.error ?? `Checked ${timeAgo(mi.cacheProbe.at)}`}>
                {mi.cacheProbe.verified ? `cache verified · ${Math.round(mi.cacheProbe.hitRate * 100)}%` : mi.cacheProbe.error ? "cache check failed" : "no cache hits"}
              </span>
            {/if}
            <button class="btn ghost small" onclick={() => probe(p)} disabled={probing[p.id]}>{probing[p.id] ? "Checking…" : mi?.cacheProbe ? "Check again" : "Check caching"}</button>
          </div>
        {/if}
      </div>
    {:else}
      <p class="muted small">Add a connection first; Mea makes a story profile for you.</p>
    {/each}
  </section>

  {#if profiles.length}<Routing {profiles} {connections} />{/if}
</div>

<Modal bind:open={addOpen} title={addKind === "nano-sub" ? "NanoGPT subscription key" : addKind === "nano-paygo" ? "NanoGPT pay-as-you-go key" : addKind === "mock" ? "Mock provider" : "OpenAI-compatible connection"} size="sm">
  <form class="stack" onsubmit={(e) => { e.preventDefault(); void addConnection(); }}>
    <label class="field"><span class="label">Name</span><input class="input" bind:value={form.name} required /></label>
    {#if addKind === "openai"}
      <label class="field"><span class="label">Base URL</span><input class="input" bind:value={form.baseUrl} placeholder="https://…/v1" required /><span class="hint">The address that ends in /v1 (Mea adds /chat/completions).</span></label>
      <label class="field">
        <span class="label">Billing</span>
        <select class="select" bind:value={form.billing}><option value="paygo">Pay-as-you-go</option><option value="subscription">Subscription</option><option value="unknown">Not sure</option></select>
      </label>
      <label class="field">
        <span class="label">Request format</span>
        <select class="select" bind:value={form.format}><option value="openai">OpenAI chat completions</option><option value="anthropic">Anthropic Messages (/v1/messages)</option></select>
        <span class="hint">Pick Anthropic for Claude proxies that speak the Messages API; caching then uses cache_control.</span>
      </label>
    {/if}
    {#if addKind !== "mock"}
      <label class="field"><span class="label">API key</span><input class="input" type="password" autocomplete="off" bind:value={form.apiKey} placeholder="Paste your key" required={addKind !== "openai"} /><span class="hint">Stored encrypted on this computer and never sent back to the browser.</span></label>
    {/if}
  </form>
  {#snippet footer()}
    <button class="btn ghost" onclick={() => (addOpen = false)}>Cancel</button>
    <button class="btn primary" onclick={addConnection} disabled={busy || !form.name || (addKind === "openai" && !/^https?:\/\/.+/.test(form.baseUrl))}>{busy ? "Connecting…" : "Connect"}</button>
  {/snippet}
</Modal>

<style>
  .conn {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    padding: 0.8rem 1rem;
  }
  .profile {
    padding: 1rem;
  }
  .fmt .select {
    width: auto;
    padding: 0.15rem 0.4rem;
  }
  .cache {
    gap: 0.6rem;
  }
  .pname {
    border: 0;
    background: none;
    font: 700 var(--fs-md) var(--font-ui);
    color: var(--text);
    outline: none;
    border-bottom: 2px solid transparent;
    min-width: 8rem;
  }
  .pname:focus {
    border-bottom-color: var(--accent);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
    gap: 0.8rem;
  }
  :global(.spin) {
    animation: spin 1s linear infinite;
  }
</style>
