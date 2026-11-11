<script lang="ts">
  import Module from "../desk/Module.svelte";
  import { get, post } from "../../lib/api";
  import { onEvent } from "../../lib/events";
  import { errorToast, toast } from "../../lib/state.svelte";

  /**
   * docs/33 1.5: the card's standing instructions as they stand in this story. A card's last word is
   * written for its opening ("show her tells… no more than one crack per exchange"); once a chapter
   * the story reads each line and keeps, rewords or retires it. The card itself is never changed.
   * Here you see each change with its reason, and can keep a line as the card wrote it.
   */
  let { chatId }: { chatId: string } = $props();

  interface Line {
    orig: string;
    status: "kept" | "revised" | "retired";
    now?: string;
    why?: string;
    pinned?: boolean;
  }
  interface Brief {
    lines: Line[];
    seq: number;
    drive?: { want?: string; fear?: string; tell?: string };
    traitsGone?: string[];
  }
  let brief = $state<Brief | null>(null);
  let reading = $state(false);

  async function load() {
    try {
      brief = (await get<{ brief: Brief | null }>(`/api/chats/${chatId}/brief`)).brief;
    } catch {
      brief = null;
    }
  }
  $effect(() => {
    void chatId;
    void load();
  });
  $effect(() =>
    onEvent((e) => {
      if ((e.type === "chat.changed" && e.chatId === chatId) || e.type === "reconnected") void load();
    }),
  );

  async function pin(l: Line) {
    try {
      brief = (await post<{ brief: Brief | null }>(`/api/chats/${chatId}/brief/pin`, { line: l.orig, pinned: !l.pinned })).brief;
      toast(l.pinned ? "The story may reword it again" : "Kept as the card wrote it", { kind: "ok" });
    } catch (e) {
      errorToast(e);
    }
  }
  async function read() {
    reading = true;
    try {
      await post(`/api/chats/${chatId}/brief/read`);
      toast("Reading the card's instructions against the story (one helper call)", { kind: "ok" });
    } catch (e) {
      errorToast(e);
    } finally {
      reading = false;
    }
  }
  const changed = $derived((brief?.lines ?? []).filter((l) => l.status !== "kept" && !l.pinned).length);
  const also = $derived([brief?.drive?.want && `wants: ${brief.drive.want}`, brief?.drive?.fear && `fears: ${brief.drive.fear}`, brief?.drive?.tell && `tell: ${brief.drive.tell}`, brief?.traitsGone?.length && `no longer: ${brief.traitsGone.join(", ")}`].filter(Boolean) as string[]);
</script>

<Module title="The card's instructions now" fold peek={brief ? (changed ? `${changed} changed` : "as written") : "not read yet"}>
  <p class="tiny muted">What the card tells the writer after every message, as it stands in this story. The card isn't changed; a line you keep stays as the card wrote it.</p>
  {#if brief}
    {#each brief.lines as l (l.orig)}
      <div class="bline" class:off={l.status === "retired" && !l.pinned}>
        <div class="row between">
          <span class="chip small" class:warm={l.status === "revised" && !l.pinned} class:mute={l.status === "retired" && !l.pinned}>{l.pinned ? "kept by you" : l.status === "kept" ? "kept" : l.status === "revised" ? "reworded" : "retired"}</span>
          {#if l.status !== "kept" || l.pinned}<button class="btn ghost small" type="button" onclick={() => pin(l)}>{l.pinned ? "Let it change" : "Keep as written"}</button>{/if}
        </div>
        <p class="orig" class:struck={l.status !== "kept" && !l.pinned}>{l.orig}</p>
        {#if l.status === "revised" && !l.pinned && l.now}<p class="now">{l.now}</p>{/if}
        {#if l.why && l.status !== "kept" && !l.pinned}<p class="tiny muted">{l.why}</p>{/if}
      </div>
    {/each}
    {#if also.length}<p class="tiny muted">Also changed on the trackers: {also.join(" · ")}</p>{/if}
    <p class="tiny muted">Read up to #{brief.seq}.</p>
  {:else}
    <p class="tiny muted">Not read yet. It is read by itself when a chapter closes.</p>
  {/if}
  <button class="btn ghost small" type="button" onclick={read} disabled={reading}>Read again now</button>
</Module>

<style>
  .bline {
    padding: 6px 0;
    border-top: 1px solid var(--border);
  }
  .bline.off {
    opacity: 0.75;
  }
  .orig {
    margin: 4px 0 0;
    font-size: 0.85rem;
  }
  .orig.struck {
    text-decoration: line-through;
    opacity: 0.7;
  }
  .now {
    margin: 4px 0 0;
    font-size: 0.85rem;
  }
</style>
