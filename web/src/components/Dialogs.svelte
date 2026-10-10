<script lang="ts">
  import { dialogs } from "../lib/dialogs.svelte";
  import Modal from "./Modal.svelte";

  let confirmOpen = $state(false);
  let promptOpen = $state(false);
  let value = $state("");

  $effect(() => {
    confirmOpen = Boolean(dialogs.confirm);
  });
  $effect(() => {
    if (dialogs.prompt) value = dialogs.prompt.value;
    promptOpen = Boolean(dialogs.prompt);
  });

  function answer(ok: boolean) {
    dialogs.confirm?.resolve(ok);
    dialogs.confirm = null;
  }
  function submit(v: string | null) {
    dialogs.prompt?.resolve(v);
    dialogs.prompt = null;
  }
</script>

{#if dialogs.confirm}
  <Modal bind:open={confirmOpen} title={dialogs.confirm.title} size="sm" onclose={() => answer(false)}>
    {#if dialogs.confirm.message}<p class="muted">{dialogs.confirm.message}</p>{/if}
    {#snippet footer()}
      <!-- M41: a destructive confirm starts on Cancel, so a stray Enter doesn't delete. -->
      <!-- svelte-ignore a11y_autofocus -->
      <button class="btn ghost" onclick={() => answer(false)} autofocus={Boolean(dialogs.confirm?.danger)}>Cancel</button>
      <!-- svelte-ignore a11y_autofocus -->
      <button class="btn {dialogs.confirm?.danger ? 'danger solid' : 'primary'}" onclick={() => answer(true)} autofocus={!dialogs.confirm?.danger}>{dialogs.confirm?.confirmLabel}</button>
    {/snippet}
  </Modal>
{/if}

{#if dialogs.prompt}
  <Modal bind:open={promptOpen} title={dialogs.prompt.title} size="sm" onclose={() => submit(null)}>
    <form
      class="field"
      onsubmit={(e) => {
        e.preventDefault();
        submit(value);
      }}
    >
      {#if dialogs.prompt.label}<span class="label">{dialogs.prompt.label}</span>{/if}
      {#if dialogs.prompt.multiline}
        <textarea class="textarea" bind:value placeholder={dialogs.prompt.placeholder} rows="4"></textarea>
      {:else}
        <input class="input" bind:value placeholder={dialogs.prompt.placeholder} />
      {/if}
    </form>
    {#snippet footer()}
      <button class="btn ghost" onclick={() => submit(null)}>Cancel</button>
      <button class="btn primary" onclick={() => submit(value)}>{dialogs.prompt?.confirmLabel}</button>
    {/snippet}
  </Modal>
{/if}
