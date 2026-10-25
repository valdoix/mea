<script lang="ts">
  import Modal from "../Modal.svelte";
  import { get, post, put } from "../../lib/api";
  import { confirm } from "../../lib/dialogs.svelte";
  import { compact, timeAgo } from "../../lib/format";
  import { KeyRound, RefreshCw } from "../../lib/icons";
  import { errorToast, toast } from "../../lib/state.svelte";
  import type { Connection, LinkApiBalance } from "../../lib/types";

  /** LinkAPI's key balance, wallet and per-model usage (CONN-25). */
  let { connection, onchange }: { connection: Connection; onchange: () => void } = $props();

  /** A read older than this is refreshed when the page opens. */
  const STALE_MS = 10 * 60_000;

  let balance = $state<LinkApiBalance | null>(null);
  let loading = $state(false);
  let days = $state<7 | 30>(30);
  let walletOpen = $state(false);
  let walletForm = $state({ token: "", userId: "" });
  let saving = $state(false);

  async function refresh() {
    loading = true;
    try {
      balance = (await post<{ balance: LinkApiBalance }>(`/api/connections/${connection.id}/balance/refresh?days=${days}`)).balance;
    } catch (e) {
      errorToast(e);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    const id = connection.id;
    void (async () => {
      try {
        const r = await get<{ balance: LinkApiBalance | null }>(`/api/connections/${id}/balance`);
        balance = r.balance;
        if (r.balance?.usage) days = r.balance.usage.days === 7 ? 7 : 30;
        if (!r.balance || Date.now() - r.balance.fetchedAt > STALE_MS) await refresh();
      } catch (e) {
        errorToast(e);
      }
    })();
  });

  /** Quota as the gateway's own dashboard shows it. */
  function money(q: number) {
    if (!balance) return "–";
    const c = balance.currency;
    if (c.tokens) return compact(q);
    const v = (q / c.perUnit) * c.rate;
    return `${v < 0 ? "-" : ""}${c.symbol}${Math.abs(v).toFixed(Math.abs(v) < 1000 ? 2 : 0)}`;
  }

  function openWallet() {
    walletForm = { token: "", userId: connection.wallet?.userId ?? "" };
    walletOpen = true;
  }

  async function saveWallet() {
    saving = true;
    try {
      await put(`/api/connections/${connection.id}`, { walletToken: walletForm.token.trim(), walletUserId: walletForm.userId.trim() });
      walletOpen = false;
      onchange();
      await refresh();
      if (balance?.walletError) toast(`Saved, but the wallet didn't load: ${balance.walletError}`, { kind: "error" });
      else toast("Wallet connected", { kind: "ok" });
    } catch (e) {
      errorToast(e);
    } finally {
      saving = false;
    }
  }

  async function removeWallet() {
    if (!(await confirm({ title: "Remove wallet access?", message: "The access token is deleted from this computer. The API key's own balance still shows.", confirmLabel: "Remove", danger: true }))) return;
    try {
      await put(`/api/connections/${connection.id}`, { walletToken: "" });
      onchange();
      await refresh();
    } catch (e) {
      errorToast(e);
    }
  }

  const totalSpend = $derived(balance?.usage?.models.reduce((s, m) => s + m.quota, 0) ?? 0);
</script>

<div class="bal stack tight">
  <div class="row between wrap">
    <span class="tiny label-ish">Balance</span>
    <div class="row tiny muted">
      {#if balance}updated {timeAgo(balance.fetchedAt)}{/if}
      <button class="btn ghost icon small" onclick={refresh} disabled={loading} aria-label="Refresh balance"><RefreshCw size={14} class={loading ? "spin" : ""} /></button>
    </div>
  </div>

  {#if balance}
    <div class="lines">
      <div class="line">
        <span class="muted">API key</span>
        {#if balance.key}
          {#if balance.key.unlimited}
            <span><b>no limit</b> · {money(balance.key.used)} spent</span>
          {:else}
            <span><b>{money(balance.key.available)}</b> left of {money(balance.key.granted)} · {money(balance.key.used)} spent</span>
          {/if}
          {#if balance.key.expiresAt}<span class="tiny muted">expires {new Date(balance.key.expiresAt).toLocaleDateString()}</span>{/if}
        {:else}
          <span class="err">{balance.keyError ?? "unknown"}</span>
        {/if}
      </div>
      <div class="line">
        <span class="muted">Wallet</span>
        {#if balance.wallet}
          <span>
            <b>{money(balance.wallet.available)}</b> left · {money(balance.wallet.used)} spent{#if balance.wallet.requests != null} · {compact(balance.wallet.requests)} requests{/if}
            {#if balance.wallet.group}<span class="tiny muted"> · group {balance.wallet.group}</span>{/if}
          </span>
        {:else if balance.walletError}
          <span class="err">{balance.walletError}</span>
        {:else}
          <span class="muted">add an access token to see it</span>
        {/if}
      </div>
      {#if balance.key?.unlimited && !connection.wallet && !balance.wallet}
        <p class="tiny muted">This key has no limit of its own, so it spends straight from your wallet. Add wallet access to see what's left.</p>
      {/if}
    </div>

    {#if connection.wallet}
      <details class="usage">
        <summary class="tiny">
          Spend by model{#if balance.usage} · {money(totalSpend)} in {balance.usage.days} days{/if}
        </summary>
        <div class="row tiny muted range">
          Period
          <select class="select tiny" bind:value={days} onchange={refresh}>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
          </select>
          {#if balance.usage && balance.usage.days !== days}<span>LinkAPI allows {balance.usage.days} days at most.</span>{/if}
        </div>
        {#if balance.usage?.models.length}
          <table class="tiny">
            <thead><tr><th>Model</th><th>Requests</th><th>Tokens</th><th>Spent</th></tr></thead>
            <tbody>
              {#each balance.usage.models as m (m.model)}
                <tr><td class="mono">{m.model}</td><td>{compact(m.requests)}</td><td>{compact(m.tokens)}</td><td><b>{money(m.quota)}</b></td></tr>
              {/each}
            </tbody>
          </table>
          {#if balance.usage.partial}<p class="tiny muted">Only the latest 1,000 requests were counted.</p>{/if}
        {:else if balance.usageError}
          <p class="tiny err">{balance.usageError}</p>
        {:else}
          <p class="tiny muted">No spending in this period.</p>
        {/if}
      </details>
    {/if}
  {:else if loading}
    <span class="tiny muted">Reading LinkAPI…</span>
  {/if}

  <div class="row wrap tiny">
    {#if connection.wallet}
      <span class="muted">Wallet access: user {connection.wallet.userId} · token {connection.wallet.tokenMask}</span>
      <button class="btn ghost small" onclick={openWallet}><KeyRound size={13} /> Replace</button>
      <button class="btn ghost small" onclick={removeWallet}>Remove</button>
    {:else}
      <button class="btn ghost small" onclick={openWallet}><KeyRound size={13} /> Add wallet access</button>
    {/if}
  </div>
</div>

<Modal bind:open={walletOpen} title="LinkAPI wallet access" size="sm">
  <form class="stack" onsubmit={(e) => { e.preventDefault(); void saveWallet(); }}>
    <p class="tiny muted">
      Your API key only sees its own balance. To see your wallet and what each model spent, open LinkAPI's console → <b>Personal settings</b>, generate a
      <b>system access token</b>, and copy your <b>user ID</b> from the same page. Mea only reads with it.
    </p>
    <label class="field"><span class="label">Access token</span><input class="input" type="password" autocomplete="off" bind:value={walletForm.token} placeholder="Paste the access token" required /><span class="hint">Stored encrypted on this computer and never sent back to the browser.</span></label>
    <label class="field"><span class="label">User ID</span><input class="input" inputmode="numeric" bind:value={walletForm.userId} placeholder="e.g. 1234" required /></label>
  </form>
  {#snippet footer()}
    <button class="btn ghost" onclick={() => (walletOpen = false)}>Cancel</button>
    <button class="btn primary" onclick={saveWallet} disabled={saving || !walletForm.token.trim() || !/^\d+$/.test(walletForm.userId.trim())}>{saving ? "Saving…" : "Save"}</button>
  {/snippet}
</Modal>

<style>
  .bal {
    margin-top: 0.5rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--line, rgba(127, 127, 127, 0.2));
  }
  .label-ish {
    font-weight: 700;
  }
  .lines {
    display: grid;
    gap: 0.2rem;
  }
  .line {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: baseline;
    font-size: var(--fs-sm, 0.9rem);
  }
  .line > .muted:first-child {
    min-width: 4.5rem;
  }
  .err {
    color: var(--danger);
  }
  .usage summary {
    cursor: pointer;
  }
  .range {
    margin: 0.4rem 0;
    gap: 0.4rem;
  }
  .range .select {
    width: auto;
    padding: 0.15rem 0.4rem;
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  th,
  td {
    text-align: right;
    padding: 0.2rem 0.4rem;
  }
  th:first-child,
  td:first-child {
    text-align: left;
    overflow-wrap: anywhere;
  }
  th {
    font-weight: 600;
    color: var(--muted, inherit);
  }
</style>
