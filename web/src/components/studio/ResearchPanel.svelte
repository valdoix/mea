<script lang="ts">
  import { ExternalLink, Globe, Loader } from "../../lib/icons";
  import type { Research } from "../../lib/types";

  /**
   * Canon from the web, in either studio: what was read (the work's wiki, Wikipedia, your links), the
   * brief every step now writes from, and a way to read more.
   */
  let { research, basedOn, busy, onresearch }: { research: Research | null; basedOn: string; busy: boolean; onresearch: (urls: string[]) => Promise<unknown> } = $props();

  let links = $state("");
  let adding = $state(false);
  const urls = $derived(links.split(/\s+/).map((s) => s.trim()).filter((s) => /^https?:\/\//i.test(s)));

  async function go() {
    await onresearch(urls);
    links = "";
    adding = false;
  }
</script>

<div class="panel stack tight research">
  <div class="row between wrap">
    <span class="small"><Globe size={14} /> <b>Canon research</b>
      <span class="muted">
        {#if research?.brief}
          · read {research.sources.length} page{research.sources.length === 1 ? "" : "s"}{research.names.length ? `, ${research.names.length} character pages on the wiki` : ""}
        {:else if basedOn}
          · not read yet: Mea reads up on {basedOn} before planning
        {:else}
          · for a world from an existing show, book or game, say what it's based on (or paste links)
        {/if}
      </span>
    </span>
    <div class="row">
      <button class="btn ghost small" onclick={() => (adding = !adding)} disabled={busy}>Add links</button>
      <button class="btn small" onclick={() => onresearch([])} disabled={busy || !basedOn}>
        {#if busy}<span class="spin"><Loader size={13} /></span> Reading…{:else}{research?.brief ? "Read again" : "Read up on canon"}{/if}
      </button>
    </div>
  </div>
  {#if adding}
    <textarea class="textarea" rows="2" bind:value={links} placeholder="Paste links, one per line: a Fandom page, Wikipedia, a fan wiki, a meta post…"></textarea>
    <div class="row end"><button class="btn small primary" onclick={go} disabled={busy || !urls.length}>Read {urls.length || ""} link{urls.length === 1 ? "" : "s"}</button></div>
  {/if}
  {#if research?.brief}
    <div class="row wrap srcs">
      {#each research.sources as s (s.url)}<a class="chip tiny src" href={s.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={10} /> {s.title}</a>{/each}
    </div>
    <details>
      <summary class="tiny muted">The canon brief every step writes from</summary>
      <p class="small brief">{research.brief}</p>
    </details>
  {/if}
</div>

<style>
  .srcs {
    gap: 0.3rem;
  }
  .src {
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    max-width: 100%;
    overflow-wrap: anywhere;
  }
  .brief {
    white-space: pre-wrap;
    max-height: 26rem;
    overflow: auto;
    margin: 0.4rem 0 0;
  }
  .end {
    justify-content: flex-end;
  }
  summary {
    cursor: pointer;
  }
</style>
