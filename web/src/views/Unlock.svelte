<script lang="ts">
  import { post } from "../lib/api";
  import { Lock } from "../lib/icons";

  // SEC-05: the encrypted database stays closed until the passphrase is typed.
  let pass = $state("");
  let error = $state("");
  let busy = $state(false);

  async function unlock(e: Event) {
    e.preventDefault();
    busy = true;
    error = "";
    try {
      await post("/api/vault/unlock", { passphrase: pass });
      location.reload();
    } catch (err) {
      error = (err as Error).message;
      busy = false;
      pass = "";
    }
  }
</script>

<div class="lockpage">
  <form class="card box stack" onsubmit={unlock}>
    <div class="logo">Mea<span>✿</span></div>
    <h1><Lock size={20} /> Locked</h1>
    <p class="muted small">Your stories are encrypted on this computer. Type the passphrase to open them.</p>
    <!-- svelte-ignore a11y_autofocus -->
    <label class="field"><span class="label">Passphrase</span><input class="input" type="password" autocomplete="current-password" bind:value={pass} autofocus required /></label>
    {#if error}<div class="notice error small" role="alert">{error}</div>{/if}
    <button class="btn primary" disabled={busy || !pass}>{busy ? "Opening…" : "Unlock"}</button>
  </form>
</div>

<style>
  .lockpage {
    min-height: 100dvh;
    display: grid;
    place-items: center;
    padding: 1.5rem;
    background: radial-gradient(circle at 20% 10%, color-mix(in srgb, var(--lavender) 40%, transparent), transparent 50%), radial-gradient(circle at 85% 90%, color-mix(in srgb, var(--peach) 40%, transparent), transparent 50%);
  }
  .box {
    width: min(100%, 24rem);
    padding: 1.8rem;
  }
  h1 {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .logo {
    font-family: var(--font-display);
    font-variation-settings: "SOFT" 100;
    font-size: 1.8rem;
    font-weight: 600;
  }
  .logo span {
    color: var(--accent-strong);
    font-size: 0.75em;
  }
</style>
