<script lang="ts">
  import Appearance from "../components/settings/Appearance.svelte";
  import Data from "../components/settings/Data.svelte";
  import Devices from "../components/settings/Devices.svelte";
  import Memory from "../components/settings/Memory.svelte";
  import Trackers from "../components/settings/Trackers.svelte";
  import Writing from "../components/settings/Writing.svelte";
  import Models from "../components/settings/Models.svelte";
  import Notifications from "../components/settings/Notifications.svelte";
  import Status from "../components/settings/Status.svelte";
  import Usage from "../components/settings/Usage.svelte";
  import Prompts from "../components/settings/Prompts.svelte";
  import Regex from "../components/settings/Regex.svelte";
  import Guards from "../components/settings/Guards.svelte";
  import Privacy from "../components/settings/Privacy.svelte";
  import { Activity, Bell, Brain, Cpu, Database, Feather, Gauge, HardDrive, ListChecks, Palette, ScrollText, ShieldCheck, Slash, Smartphone } from "../lib/icons";
  import { navigate } from "../lib/router.svelte";

  let { tab = "models" }: { tab?: string } = $props();

  const tabs = [
    { id: "models", label: "Models", icon: Cpu },
    { id: "memory", label: "Memory", icon: Brain },
    { id: "trackers", label: "Trackers", icon: ListChecks },
    { id: "guards", label: "Guards", icon: ShieldCheck },
    { id: "writing", label: "Writing", icon: Feather },
    { id: "prompts", label: "Helper prompts", icon: ScrollText },
    { id: "regex", label: "Regex", icon: Slash },
    { id: "appearance", label: "Appearance", icon: Palette },
    { id: "devices", label: "Devices", icon: Smartphone },
    { id: "notifications", label: "Notifications", icon: Bell },
    { id: "data", label: "Backups & data", icon: Database },
    { id: "storage", label: "Storage & privacy", icon: HardDrive },
    { id: "usage", label: "Usage", icon: Gauge },
    { id: "status", label: "Status", icon: Activity },
  ];
</script>

<div class="page">
  <h1>Settings</h1>
  <nav class="tabs">
    {#each tabs as t (t.id)}
      <button class:on={tab === t.id} onclick={() => navigate(`/settings/${t.id}`, { replace: true })}><t.icon size={16} /> {t.label}</button>
    {/each}
  </nav>
  <div class="content">
    {#if tab === "memory"}<Memory />
    {:else if tab === "trackers"}<Trackers />
    {:else if tab === "guards"}<Guards />
    {:else if tab === "writing"}<Writing />
    {:else if tab === "prompts"}<Prompts />
    {:else if tab === "regex"}<Regex />
    {:else if tab === "appearance"}<Appearance />
    {:else if tab === "devices"}<Devices />
    {:else if tab === "notifications"}<Notifications />
    {:else if tab === "data"}<Data />
    {:else if tab === "storage"}<Privacy />
    {:else if tab === "usage"}<Usage />
    {:else if tab === "status"}<Status />
    {:else}<Models />{/if}
  </div>
</div>

<style>
  .page {
    max-width: 56rem;
    margin: 0 auto;
    padding: 1.5rem clamp(1rem, 3vw, 2rem) 5rem;
  }
  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    margin: 1rem 0 1.4rem;
  }
  .tabs button {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    border: 0;
    background: none;
    padding: 0.55rem 0.9rem;
    border-radius: var(--r-pill);
    font: 700 var(--fs-sm) / 1 var(--font-ui);
    color: var(--text-muted);
    cursor: pointer;
    white-space: nowrap;
  }
  .tabs button.on {
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow-1);
  }
  :global([data-theme="lantern"]) .tabs button.on {
    background: rgb(255 255 255 / 12%);
    box-shadow:
      inset 0 0 0 1px rgb(255 255 255 / 14%),
      0 0 18px rgb(199 180 255 / 22%);
  }
  :global([data-theme="lantern"]) .tabs button:hover:not(.on) {
    background: rgb(255 255 255 / 6%);
    color: var(--text);
  }
</style>
