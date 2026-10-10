<script lang="ts">
  import { post } from "../lib/api";
  import { route } from "../lib/router.svelte";

  let code = $state(route.query.code ?? "");
  let name = $state(/Android/i.test(navigator.userAgent) ? "Android phone" : /Windows/i.test(navigator.userAgent) ? "Windows PC" : "My device");
  let error = $state("");
  let busy = $state(false);

  async function pair(e: Event) {
    e.preventDefault();
    busy = true;
    error = "";
    try {
      await post("/api/pair", { code: code.trim().toUpperCase(), name });
      location.replace("/");
    } catch (err) {
      error = (err as Error).message;
      busy = false;
    }
  }
</script>

<div class="pairpage">
  <form class="card box stack" onsubmit={pair}>
    <div class="logo">Mea<span>✿</span></div>
    <h1>Pair this device</h1>
    <p class="muted small">On the computer running Mea, open <b>Settings → Devices</b> and make a pairing code. Scan it, or type it here.</p>
    <label class="field"><span class="label">Code</span><input class="input code" bind:value={code} placeholder="ABCD2345" autocapitalize="characters" autocomplete="off" required /></label>
    <label class="field"><span class="label">Name this device</span><input class="input" bind:value={name} required /></label>
    {#if error}<div class="notice error small">{error}</div>{/if}
    <button class="btn primary" disabled={busy || code.trim().length < 4}>{busy ? "Pairing…" : "Pair"}</button>
  </form>
</div>

<style>
  .pairpage {
    min-height: 100dvh;
    display: grid;
    place-items: center;
    padding: 1.5rem;
    background: radial-gradient(circle at 20% 10%, color-mix(in srgb, var(--peach) 40%, transparent), transparent 50%), radial-gradient(circle at 85% 90%, color-mix(in srgb, var(--lavender) 40%, transparent), transparent 50%);
  }
  .box {
    width: min(100%, 24rem);
    padding: 1.8rem;
  }
  .logo {
    font-family: var(--font-display);
    font-variation-settings: "SOFT" 100;
    font-size: 1.8rem;
    font-weight: 600;
  }
  .logo span {
    color: var(--accent-ink);
    font-size: 0.75em;
  }
  .code {
    font-family: var(--font-mono);
    font-size: 1.4rem;
    letter-spacing: 0.2em;
    text-transform: uppercase;
  }
</style>
