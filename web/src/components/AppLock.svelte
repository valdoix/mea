<script lang="ts">
  import { onMount } from "svelte";
  import { lock, unlockWithBiometrics, unlockWithPin } from "../lib/applock.svelte";
  import { Lock } from "../lib/icons";

  // MOB-11: covers everything until the PIN (or the phone's biometrics) is given.
  let pin = $state("");
  let error = $state("");
  let busy = $state(false);
  let field = $state<HTMLInputElement | null>(null);

  onMount(() => {
    if (lock.biometric) void unlockWithBiometrics();
    else field?.focus();
  });

  async function submit(e: Event) {
    e.preventDefault();
    busy = true;
    error = "";
    const ok = await unlockWithPin(pin);
    busy = false;
    pin = "";
    if (!ok) {
      error = "That isn't the PIN.";
      field?.focus();
    }
  }
</script>

<div class="applock" role="dialog" aria-modal="true" aria-label="Mea is locked">
  <form class="stack box" onsubmit={submit}>
    <div class="logo">Mea<span>✿</span></div>
    <p class="row muted small"><Lock size={15} /> Enter your PIN</p>
    <input bind:this={field} class="input pin" type="password" inputmode="numeric" autocomplete="off" bind:value={pin} aria-label="PIN" />
    {#if error}<div class="notice error small" role="alert">{error}</div>{/if}
    <button class="btn primary" disabled={busy || pin.length < 4}>{busy ? "Checking…" : "Unlock"}</button>
    {#if lock.biometric}<button type="button" class="btn ghost small" onclick={() => unlockWithBiometrics()}>Use fingerprint or face</button>{/if}
  </form>
</div>

<style>
  .applock {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: grid;
    place-items: center;
    padding: 1.5rem;
    background: var(--bg);
  }
  .box {
    width: min(100%, 18rem);
    text-align: center;
    justify-items: center;
  }
  .box > * {
    width: 100%;
  }
  .row {
    justify-content: center;
    gap: 0.35rem;
  }
  .pin {
    text-align: center;
    font-size: 1.5rem;
    letter-spacing: 0.4em;
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
</style>
