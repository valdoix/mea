<script lang="ts">
  import Appearance from "../components/settings/Appearance.svelte";
  import Data from "../components/settings/Data.svelte";
  import Devices from "../components/settings/Devices.svelte";
  import Memory from "../components/settings/Memory.svelte";
  import Models from "../components/settings/Models.svelte";
  import Notifications from "../components/settings/Notifications.svelte";
  import Status from "../components/settings/Status.svelte";
  import Usage from "../components/settings/Usage.svelte";
  import { Activity, Bell, Brain, Cpu, Database, Gauge, Palette, Smartphone } from "../lib/icons";
  import { navigate } from "../lib/router.svelte";

  let { tab = "models" }: { tab?: string } = $props();

  const tabs = [
    { id: "models", label: "Models", icon: Cpu },
    { id: "memory", label: "Memory", icon: Brain },
    { id: "appearance", label: "Appearance", icon: Palette },
    { id: "devices", label: "Devices", icon: Smartphone },
    { id: "notifications", label: "Notifications", icon: Bell },
    { id: "data", label: "Backups & data", icon: Database },
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
    {:else if tab === "appearance"}<Appearance />
    {:else if tab === "devices"}<Devices />
    {:else if tab === "notifications"}<Notifications />
    {:else if tab === "data"}<Data />
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
    gap: 0.25rem;
    overflow-x: auto;
    margin: 1rem 0 1.4rem;
    scrollbar-width: none;
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
</style>
