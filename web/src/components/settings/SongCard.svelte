<script lang="ts" module>
  /** Mirrors `server/src/music/cards.ts`. */
  export const BONDS = ["romantic", "family", "friends", "self", "a crowd", "anyone"] as const;
  export const STANCES = ["happy in it", "wanting", "losing", "mourning", "angry", "mocking", "free", "afraid"] as const;
  export const HEATS = ["none", "flirting", "sexual"] as const;
  const DARKS = ["death", "drugs", "violence", "self-harm"] as const;
  const PACES = ["slow", "mid", "fast"] as const;
  /** Mirrors `server/src/music/situations.ts`. */
  const SITUATIONS = ["leaving", "goodbye", "reunion", "homecoming", "the road", "first love", "desire", "devotion", "longing", "heartbreak", "betrayal", "jealousy", "temptation", "confession", "secrets", "guilt", "grief", "fear", "the fight", "aftermath", "defiance", "revenge", "sacrifice", "freedom", "hope", "wonder", "nostalgia", "celebration", "peace", "alone"];
  export interface Card {
    about: string;
    bond: (typeof BONDS)[number];
    stance: (typeof STANCES)[number];
    heat: (typeof HEATS)[number];
    dark: (typeof DARKS)[number][];
    main: string[];
    passing: string[];
    opening: string[];
    energy: number;
    pace: (typeof PACES)[number];
    moods: string[];
    edited: string[];
    /** Fields still a guess: energy and pace until you confirm them, moods until you set them. */
    guessed: string[];
    /** The library's moods before this card's guess replaced them. */
    oldMoods: string[] | null;
  }
</script>

<script lang="ts">
  import { post, put } from "../../lib/api";
  import { errorToast, toast } from "../../lib/state.svelte";

  /**
   * docs/34 2.5: what Mea thinks a song is, under its words. Every field can be changed, and a change
   * is kept through a re-read. The sound (energy, pace, moods) is a guess until you confirm it.
   */
  let { videoId, card, moodsGuessed, onsaved }: { videoId: string; card: Card; moodsGuessed: boolean; onsaved: (r: { card: Card | null; view: unknown }) => void } = $props();
  let busy = $state(false);

  async function send(req: Promise<{ card: Card | null; view: unknown }>, done?: string) {
    busy = true;
    try {
      onsaved(await req);
      if (done) toast(done, { kind: "ok" });
    } catch (e) {
      errorToast(e);
    } finally {
      busy = false;
    }
  }
  const save = (patch: Record<string, unknown>) => send(put(`/api/music/cards/${videoId}`, patch));
  const toggle = <T,>(xs: T[], x: T) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]);
  /** Situations typed as a list: known ones only, so a typo doesn't fail the whole edit. */
  function situations(field: "main" | "passing" | "opening", text: string, max: number) {
    const typed = text.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    const known = [...new Set(typed.filter((s) => SITUATIONS.includes(s)))].slice(0, max);
    if (known.length < typed.length) toast(`Kept ${known.join(", ") || "none"}: use up to ${max} from the list`, { kind: "info" });
    void save({ [field]: known });
  }
  const guess = (f: string) => card.guessed.includes(f);
  const soundGuessed = $derived(guess("energy") || guess("pace"));
</script>

<div class="stack song-card">
  <p class="small"><b>{card.bond} · {card.stance} · {card.heat === "none" ? "no heat" : card.heat} · energy {card.energy}</b>{#if card.about}{` · ${card.about}`}{/if}</p>
  <div class="row wrap fields">
    <label class="tiny">Bond <select class="select small" value={card.bond} disabled={busy} onchange={(e) => save({ bond: e.currentTarget.value })}>{#each BONDS as b (b)}<option value={b}>{b}</option>{/each}</select></label>
    <label class="tiny">Stance <select class="select small" value={card.stance} disabled={busy} onchange={(e) => save({ stance: e.currentTarget.value })}>{#each STANCES as s (s)}<option value={s}>{s}</option>{/each}</select></label>
    <label class="tiny">Heat <select class="select small" value={card.heat} disabled={busy} onchange={(e) => save({ heat: e.currentTarget.value })}>{#each HEATS as h (h)}<option value={h}>{h}</option>{/each}</select></label>
    <label class="tiny">Energy{guess("energy") ? " (guess)" : ""} <select class="select small" value={String(card.energy)} disabled={busy} onchange={(e) => save({ energy: Number(e.currentTarget.value) })}>{#each [1, 2, 3, 4, 5] as n (n)}<option value={String(n)}>{n}</option>{/each}</select></label>
    <label class="tiny">Pace{guess("pace") ? " (guess)" : ""} <select class="select small" value={card.pace} disabled={busy} onchange={(e) => save({ pace: e.currentTarget.value })}>{#each PACES as p (p)}<option value={p}>{p}</option>{/each}</select></label>
    {#if soundGuessed}<button type="button" class="btn ghost small" disabled={busy} onclick={() => send(put(`/api/music/cards/${videoId}`, { confirm: ["energy", "pace"] }), "Sound confirmed")}>Sound is right</button>{/if}
  </div>
  <div class="row wrap fields">
    <span class="tiny muted">Dark:</span>
    {#each DARKS as d (d)}<button type="button" class="chip tiny" class:on={card.dark.includes(d)} aria-pressed={card.dark.includes(d)} disabled={busy} onclick={() => save({ dark: toggle(card.dark, d) })}>{d}</button>{/each}
  </div>
  <label class="tiny field">About <input class="input small" value={card.about} maxlength="160" disabled={busy} onchange={(e) => save({ about: e.currentTarget.value })} /></label>
  <div class="row wrap fields">
    <label class="tiny grow">Mainly <input class="input small" value={card.main.join(", ")} disabled={busy} onchange={(e) => situations("main", e.currentTarget.value, 2)} /></label>
    <label class="tiny grow">Touches <input class="input small" value={card.passing.join(", ")} disabled={busy} onchange={(e) => situations("passing", e.currentTarget.value, 3)} /></label>
    <label class="tiny grow">First minute <input class="input small" value={card.opening.join(", ")} disabled={busy} onchange={(e) => situations("opening", e.currentTarget.value, 3)} /></label>
  </div>
  {#if moodsGuessed}<p class="tiny muted">Its moods above are a guess from its name and words; tap one to make them yours.</p>{/if}
  {#if card.oldMoods}
    <p class="tiny muted">Before this guess its moods were {card.oldMoods.join(", ") || "none"}. <button type="button" class="btn ghost small" disabled={busy} onclick={() => send(post(`/api/music/cards/${videoId}/old-moods`, {}), "Moods put back")}>Put them back</button></p>
  {/if}
</div>

<style>
  .song-card {
    gap: 0.35rem;
  }
  .fields {
    gap: 0.4rem 0.6rem;
    align-items: center;
  }
  .grow {
    flex: 1;
    min-width: 9rem;
  }
  .grow .input {
    width: 100%;
  }
  .chip {
    cursor: pointer;
  }
  .chip.on {
    background: var(--accent);
    color: var(--on-accent, #fff);
  }
</style>
