<script lang="ts">
  import { del, get, post } from "../../lib/api";
  import { confirm } from "../../lib/dialogs.svelte";
  import { timeAgo } from "../../lib/format";
  import { Copy, Laptop, QrCode, Smartphone, Trash } from "../../lib/icons";
  import { appSetupUrl, inApp } from "../../lib/device.svelte";
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
  interface Tunnel {
    port: number;
    installed: boolean;
    running: boolean;
    url: string | null;
    wrongPort: string | null;
    setupCommands: string[];
  }
  let tunnel = $state<Tunnel | null>(null);
  let devices = $state<{ id: string; name: string; userAgent: string | null; createdAt: number; lastSeenAt: number | null }[]>([]);
  let ts = $state<TS | null>(null);
  let local = $state(false);
  let pairing = $state<{ code: string; url: string; expiresAt: number; qrSvg: string } | null>(null);
  let now = $state(Date.now());

  async function load() {
    try {
      const r = await get<{ devices: typeof devices; local: boolean; tailscale: TS; tunnel: Tunnel }>("/api/devices");
      devices = r.devices;
      tunnel = r.tunnel;
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
    try {
      await del(`/api/devices/${d.id}`);
    } catch (err) {
      errorToast(err);
      return;
    }
    await load();
  }

  function copy(text: string) {
    navigator.clipboard?.writeText(text);
    toast("Copied", { kind: "ok" });
  }

  const left = $derived(pairing ? Math.max(0, Math.round((pairing.expiresAt - now) / 1000)) : 0);
</script>

<div class="stack">
  {#if inApp}
    <section class="panel row between wrap">
      <div class="stack tight">
        <h2>This app</h2>
        <p class="small muted">Connected to <b>{location.origin}</b></p>
      </div>
      <a class="btn" href={appSetupUrl}>Change address</a>
    </section>
  {/if}
  <section class="panel stack">
    <h2>Reaching Mea from your phone</h2>
    {#if !tunnel}
      <p class="muted small">Checking the tunnel…</p>
    {:else if tunnel.url}
      <div class="row wrap"><span class="chip mint">Tunnel open</span><span class="chip mint">Works from anywhere</span></div>
      <p class="small">Your address: <b>{tunnel.url}</b></p>
      <p class="tiny muted">Put it in the Mea app on your phone once. Everything that comes through it needs a paired device.</p>
    {:else}
      {#if tunnel.wrongPort}
        <p class="small"><span class="chip butter">Wrong port</span> ngrok is forwarding to Mea's main port ({tunnel.wrongPort}). That port trusts everything as this computer. Point it at <b>{tunnel.port}</b> instead.</p>
      {:else if !tunnel.installed}
        <p class="small">Install <b>ngrok</b> on this computer and make a free account at ngrok.com. It gives Mea a permanent https address your phone can reach from anywhere.</p>
      {:else}
        <p class="small">ngrok isn't running. Open a terminal on this computer and run (the first line only once):</p>
      {/if}
      {#each tunnel.setupCommands as cmd}
        <div class="cmd"><code>{cmd}</code><button class="btn ghost icon small" onclick={() => copy(cmd)} aria-label="Copy command"><Copy size={15} /></button></div>
      {/each}
      <p class="tiny muted">Your free domain is under Universal Gateway → Domains on the ngrok dashboard. To keep it running at every boot, see “Anywhere access” in the README.</p>
    {/if}
    {#if ts?.running && ts.serveUrl}
      <p class="tiny muted">Tailscale also works: {ts.serveUrl}{ts.serving ? "" : ` (run ${ts.enableCommand})`}</p>
    {/if}
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
          <p class="small">In the Mea app on your phone, paste this link, or enter the address and type the code:</p>
          <div class="code">{pairing.code}</div>
          <div class="cmd"><code class="truncate">{pairing.url}</code><button class="btn ghost icon small" onclick={() => copy(pairing!.url)} aria-label="Copy link"><Copy size={15} /></button></div>
          <span class="tiny muted">Expires in {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")} · works once</span>
        </div>
      </div>
    {:else}
      <p class="small muted">Make a code, then enter it in the Mea app on your phone (or scan it to pair a browser).</p>
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
