<script lang="ts">
  import { api, get, post } from "../lib/api";
  import { Check, Import, Plus } from "../lib/icons";
  import { navigate } from "../lib/router.svelte";
  import { app, errorToast, saveSetting, toast } from "../lib/state.svelte";
  import type { Connection, ModelInfo } from "../lib/types";

  let step = $state(1);
  let subKey = $state("");
  let paygoKey = $state("");
  let busy = $state(false);
  let connected = $state<string | null>(null);
  let personaName = $state("");
  let pronouns = $state("");
  let fileInput = $state<HTMLInputElement | null>(null);

  async function connect(kind: "nanogpt" | "mock") {
    busy = true;
    try {
      const sub = await post<{ connection: Connection; syncError: string | null }>("/api/connections", kind === "mock" ? { name: "Mock (dev)", kind: "mock", billing: "subscription" } : { name: "NanoGPT · Subscription", kind: "nanogpt", apiKey: subKey.trim(), billing: "subscription" });
      if (sub.syncError) throw new Error(sub.syncError);
      if (paygoKey.trim()) await post("/api/connections", { name: "NanoGPT · Pay-as-you-go", kind: "nanogpt", apiKey: paygoKey.trim(), billing: "paygo" });
      const models = (await get<{ models: ModelInfo[] }>(`/api/models?connectionId=${sub.connection.id}`)).models;
      const pick = models.find((m) => m.id === "z-ai/glm-5.3") ?? models.find((m) => /glm-5/.test(m.id) && !/flash|cyber|uncensored|abliterated/.test(m.id)) ?? models[0];
      if (pick) await post("/api/profiles", { name: "Story", connectionId: sub.connection.id, modelId: pick.id, params: { context_target: 48000, max_tokens: 1200 } });
      connected = pick?.name ?? "a model";
      step = 2;
    } catch (e) {
      errorToast(e);
    } finally {
      busy = false;
    }
  }

  async function savePersona() {
    busy = true;
    try {
      await post("/api/personas", { name: personaName.trim() || "You", data: { pronouns }, isDefault: true });
      step = 3;
    } catch (e) {
      errorToast(e);
    } finally {
      busy = false;
    }
  }

  async function finish(to = "/") {
    await saveSetting("onboarding.done", true);
    navigate(to, { replace: true });
  }

  async function importCards(files: FileList) {
    const form = new FormData();
    for (const f of files) form.append("file", f);
    try {
      const r = await api<{ results: { ok: boolean; id?: string; name?: string; kind?: string; error?: string }[] }>("POST", "/api/import", form);
      const first = r.results.find((x) => x.ok && x.kind === "character");
      for (const x of r.results) if (!x.ok) toast(x.error ?? "Import failed", { kind: "error" });
      if (first) await finish(`/character/${first.id}`);
    } catch (e) {
      errorToast(e);
    }
  }

  async function createCharacter() {
    const c = await post<{ id: string }>("/api/characters", { name: "New character" });
    await finish(`/character/${c.id}?tab=card`);
  }
</script>

<div class="welcome">
  <div class="card box">
    <div class="logo">Mea<span>✿</span></div>
    <div class="steps">
      {#each [1, 2, 3] as s (s)}<span class="step" class:on={step >= s}>{#if step > s}<Check size={12} />{:else}{s}{/if}</span>{/each}
    </div>

    {#if step === 1}
      <div class="stack">
        <h1>Welcome ✿</h1>
        <p class="muted">Mea is your cozy place for long stories. First, connect a model.</p>
        <label class="field">
          <span class="label">NanoGPT subscription key</span>
          <input class="input" type="password" autocomplete="off" bind:value={subKey} placeholder="Paste your API key" />
          <span class="hint">Tip: set this key's billing to “Subscription only” in NanoGPT, so it can never spend your balance.</span>
        </label>
        <label class="field">
          <span class="label">Pay-as-you-go key <span class="faint">optional, for Claude</span></span>
          <input class="input" type="password" autocomplete="off" bind:value={paygoKey} placeholder="You can add this later" />
        </label>
        <div class="row wrap">
          <button class="btn primary" onclick={() => connect("nanogpt")} disabled={busy || !subKey.trim()}>{busy ? "Connecting…" : "Connect"}</button>
          {#if app.devMode}<button class="btn ghost" onclick={() => connect("mock")} disabled={busy}>Use the mock provider (dev)</button>{/if}
          <button class="btn ghost" onclick={() => finish("/settings/models")}>Other provider (e.g. LinkAPI)…</button>
        </div>
      </div>
    {:else if step === 2}
      <div class="stack">
        <h1>Who are you?</h1>
        <p class="muted">Connected · stories will use <b>{connected}</b>. Now, how should characters know you? You can change this anytime and make more personas.</p>
        <label class="field"><span class="label">Name</span><input class="input" bind:value={personaName} placeholder="Your character's name" /></label>
        <label class="field"><span class="label">Pronouns <span class="faint">optional</span></span><input class="input" bind:value={pronouns} placeholder="she/her, he/him, they/them…" /></label>
        <div class="row"><button class="btn primary" onclick={savePersona} disabled={busy}>Continue</button></div>
      </div>
    {:else}
      <div class="stack">
        <h1>Meet someone</h1>
        <p class="muted">Bring in a character card (PNG, JSON or CHARX from SillyTavern, Chub and others), or write your own.</p>
        <div class="row wrap">
          <button class="btn primary" onclick={() => fileInput?.click()}><Import size={16} /> Import a card</button>
          <button class="btn" onclick={createCharacter}><Plus size={16} /> Create a character</button>
          <button class="btn ghost" onclick={() => finish()}>Skip for now</button>
        </div>
        <input bind:this={fileInput} type="file" accept=".png,.json,.charx" multiple hidden onchange={(e) => e.currentTarget.files && importCards(e.currentTarget.files)} />
      </div>
    {/if}
  </div>
</div>

<style>
  .welcome {
    min-height: 100dvh;
    display: grid;
    place-items: center;
    padding: 1.5rem;
    background: radial-gradient(circle at 15% 15%, color-mix(in srgb, var(--peach) 45%, transparent), transparent 50%), radial-gradient(circle at 85% 85%, color-mix(in srgb, var(--lavender) 45%, transparent), transparent 50%), var(--bg);
  }
  .box {
    width: min(100%, 32rem);
    padding: 2rem;
    display: grid;
    gap: 1.2rem;
  }
  .logo {
    font-family: var(--font-display);
    font-variation-settings: "SOFT" 100;
    font-size: 2rem;
    font-weight: 600;
  }
  .logo span {
    color: var(--accent-ink);
    font-size: 0.75em;
  }
  .steps {
    display: flex;
    gap: 0.5rem;
  }
  .step {
    width: 1.7rem;
    height: 1.7rem;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-size: var(--fs-xs);
    font-weight: 800;
    background: var(--surface-2);
    color: var(--text-muted);
  }
  .step.on {
    background: var(--accent);
    color: var(--on-accent);
  }
</style>
