<script lang="ts">
  import { post } from "../../lib/api";
  import { Bell } from "../../lib/icons";
  import { currentSubscription, disablePush, enablePush, pushSupported } from "../../lib/push";
  import { errorToast, toast } from "../../lib/state.svelte";

  let enabled = $state(false);
  let busy = $state(false);
  const supported = pushSupported();

  $effect(() => {
    currentSubscription().then((s) => (enabled = Boolean(s)));
  });

  async function toggle() {
    busy = true;
    try {
      if (enabled) {
        await disablePush();
        enabled = false;
      } else {
        enabled = await enablePush();
        if (!enabled) toast("Notifications were blocked. Allow them in the browser's site settings.", { kind: "error" });
      }
    } catch (e) {
      errorToast(e);
    } finally {
      busy = false;
    }
  }

  async function test() {
    const r = await post<{ sent: number }>("/api/push/test");
    toast(r.sent ? "Test notification sent" : "No devices are subscribed yet");
  }
</script>

<section class="panel stack">
  <h2>Reply notifications</h2>
  <p class="small muted">Get a notification when a reply finishes while you're away from the chat, e.g. with your phone locked. Replies always finish on the server either way.</p>
  {#if !supported}
    <div class="notice warn small">This browser can't do push here. On your phone, open Mea through its Tailscale <b>https://</b> address and install it as an app first.</div>
  {:else}
    <div class="row wrap">
      <button class="btn {enabled ? '' : 'primary'}" onclick={toggle} disabled={busy}><Bell size={16} /> {enabled ? "Turn off on this device" : "Turn on for this device"}</button>
      {#if enabled}<button class="btn ghost" onclick={test}>Send a test</button>{/if}
    </div>
  {/if}
</section>
