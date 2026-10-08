<script lang="ts">
  import { del, get, post } from "../../lib/api";
  import { confirm } from "../../lib/dialogs.svelte";
  import { timeAgo } from "../../lib/format";
  import { Copy, Laptop, QrCode, Smartphone, Trash } from "../../lib/icons";
  import { app, errorToast, toast } from "../../lib/state.svelte";

  interface TS {
    installed: boolean;
    running: boolean;
    dnsName: string | null;
    serveUrl: string | null;
    serving: boolean;
    enableCommand: string;
    error?: string;
  }
  let devices = $state<{ id: string; name: string; userAgent: string | null; createdAt: number; lastSeenAt: number | null }[]>([]);
  let ts = $state<TS | null>(null);
  let local = $state(false);
  let pairing = $state<{ code: string; url: string; expiresAt: number; qrSvg: string } | null>(null);
  let now = $state(Date.now());

  async function load() {
    try {
      const r = await get<{ devices: typeof devices; local: boolean; tailscale: TS }>("/api/devices");
      devices = r.devices;
      local = r.local;
      ts = r.tailscale;
    } catch (e) {
      errorToast(e);
    }
  }
  $effect(() => {
    void load();
    const t = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(t);
  });

  async function pair() {
    try {
      pairing = await post("/api/devices/pairing");
    } catch (e) {
      errorToast(e);
    }
  }

  async function revoke(d: (typeof devices)[number]) {
    if (!(await confirm({ title: `Unpair ${d.name}?`, message: "It will need a new code to connect again.", confirmLabel: "Unpair", danger: true }))) return;
    await del(`/api/devices/${d.id}`);
    await load();
  }

  function copy(text: string) {
    navigator.clipboard?.writeText(text);
    toast("Copied", { kind: "ok" });
  }

  const left = $derived(pairing ? Math.max(0, Math.round((pairing.expiresAt - now) / 1000)) : 0);
</script>

<div class="stack">
  <section class="panel stack">
    <h2>Reaching Mea from your phone</h2>
    {#if !ts}
      <p class="muted small">Checking Tailscale…</p>
    {:else if !ts.installed}
      <p class="small">Install <b>Tailscale</b> on this computer and your Android phone, signed in to the same account. Then come back here.</p>
    {:else if !ts.running}
      <p class="small">Tailscale is installed but not connected. Open it and sign in.</p>
    {:else}
      <div class="row wrap">
        <span class="chip mint">Tailscale connected</span>
        {#if ts.serving}<span class="chip mint">HTTPS address ready</span>{:else}<span class="chip butter">HTTPS not set up yet</span>{/if}
      </div>
      {#if ts.serveUrl}<p class="small">Your address: <a href={ts.serveUrl} target="_blank" rel="noreferrer"><b>{ts.serveUrl}</b></a></p>{/if}
      {#if !ts.serving}
        <p class="small">Run this once in a terminal on this computer to give Mea a secure address (it stays private to your Tailscale devices):</p>
        <div class="cmd"><code>{ts.enableCommand}</code><button class="btn ghost icon small" onclick={() => copy(ts!.enableCommand)} aria-label="Copy command"><Copy size={15} /></button></div>
      {/if}
    {/if}
    {#if ts?.error}<p class="tiny muted">{ts.error}</p>{/if}
  </section>

  <section class="panel stack">
    <div class="row between wrap">
      <h2>Pair a device</h2>
      {#if local}<button class="btn primary" onclick={pair}><QrCode size={16} /> New pairing code</button>{/if}
    </div>
    {#if !local}
      <p class="small muted">Pairing codes can only be made on the computer running Mea.</p>
    {:else if pairing && left > 0}
      <div class="pair">
        <div class="qr">{@html pairing.qrSvg}</div>
        <div class="stack tight">
          <p class="small">Scan with your phone's camera, or open the address and type the code:</p>
          <div class="code">{pairing.code}</div>
          <div class="cmd"><code class="truncate">{pairing.url}</code><button class="btn ghost icon small" onclick={() => copy(pairing!.url)} aria-label="Copy link"><Copy size={15} /></button></div>
          <span class="tiny muted">Expires in {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")} · works once</span>
        </div>
      </div>
    {:else}
      <p class="small muted">Make a code, then scan it with your phone. After pairing, install Mea from Chrome's menu (“Add to Home screen” / “Install app”).</p>
    {/if}
  </section>

  <section class="panel stack tight">
    <h2>Paired devices</h2>
    <div class="row small"><Laptop size={16} /> <span class="grow">This computer (host)</span><span class="tiny muted">{local ? "you're here" : ""}</span></div>
    {#each devices as d (d.id)}
      <div class="row small">
        <Smartphone size={16} />
        <span class="grow"><b>{d.name}</b> <span class="tiny muted">· paired {timeAgo(d.createdAt)} · seen {timeAgo(d.lastSeenAt)}</span></span>
        {#if app.local}<button class="btn ghost icon small" onclick={() => revoke(d)} aria-label="Unpair {d.name}"><Trash size={14} /></button>{/if}
      </div>
    {:else}
      <p class="tiny muted">No other devices yet.</p>
    {/each}
  </section>
</div>

<style>
  .cmd {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    background: var(--surface-2);
    border-radius: var(--r-sm);
    padding: 0.4rem 0.4rem 0.4rem 0.8rem;
    min-width: 0;
  }
  .cmd code {
    flex: 1;
    font-family: var(--font-mono);
    font-size: 0.85rem;
    min-width: 0;
  }
  .pair {
    display: grid;
    grid-template-columns: 12rem 1fr;
    gap: 1.2rem;
    align-items: center;
  }
  .qr :global(svg) {
    width: 100%;
    height: auto;
    border-radius: var(--r);
    display: block;
  }
  .code {
    font-family: var(--font-mono);
    font-size: 1.8rem;
    letter-spacing: 0.25em;
    font-weight: 700;
    color: var(--accent-ink);
  }
  @media (max-width: 600px) {
    .pair {
      grid-template-columns: 1fr;
      justify-items: center;
    }
    .qr {
      width: 12rem;
    }
  }
</style>
