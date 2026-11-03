<script lang="ts">
  import type { Snippet } from "svelte";
  import Avatar from "../../Avatar.svelte";
  import ScenePlate, { type PlaceKind } from "../ScenePlate.svelte";
  import { ArrowLeft, ChevronDown, ChevronUp, Clock, CloudRain, MapPin, Milestone } from "../../../lib/icons";
  import { app } from "../../../lib/state.svelte";
  import { trk } from "../../../lib/trackers.svelte";
  import type { Boundary, ChatDetail, TrackerCharacter } from "../../../lib/types";

  /**
   * Stage: the scene as a band above the story. The place, the hour, the weather and who's in the
   * room, over the same procedural scenery the scene plates draw. Everyone in it opens up close.
   */
  let {
    detail,
    plate,
    plateKind = null,
    chapters,
    selected = null,
    slim = false,
    title = null,
    tools,
    onback,
    oncast,
    ontoggle,
    onshowriver = null,
  }: {
    detail: ChatDetail;
    plate: { place: string[]; weather: string | null; hour: number | null } | null;
    plateKind?: PlaceKind | null;
    chapters: Boundary[];
    selected?: string | null;
    slim?: boolean;
    /** A heading of its own (the river), in place of the place's name. */
    title?: string | null;
    tools: Snippet;
    onback: () => void;
    oncast: (id: string) => void;
    ontoggle: () => void;
    /** The way back to the chapter river, while it's put away. */
    onshowriver?: (() => void) | null;
  } = $props();

  const st = $derived(trk.data?.state ?? null);
  const place = $derived(st?.place.length ? st.place : (plate?.place ?? []));
  const weather = $derived(st?.weather?.now ?? plate?.weather ?? null);
  const time = $derived(trk.data?.time ?? null);
  const scene = $derived(st?.sceneNo ?? 0);

  const avatarOf = (c: TrackerCharacter) => (c.isUser ? (detail.persona?.avatarId ?? null) : c.isMain ? (detail.character?.avatarId ?? null) : (trk.data?.profiles[c.name.toLowerCase()]?.avatarId ?? null));
  // You're always in the scene.
  const onStage = (c: TrackerCharacter) => c.isUser || c.tier === "spot" || c.tier === "peri";
  const people = $derived(st ? Object.values(st.chars) : []);
  const present = $derived(people.filter((c) => onStage(c) && !c.dead).sort((a, b) => Number(b.tier === "spot") - Number(a.tier === "spot") || Number(a.isUser) - Number(b.isUser)));
  const away = $derived(people.filter((c) => !onStage(c) && !c.isUser).sort((a, b) => b.lastSeq - a.lastSeq).slice(0, 2));
  const speaking = $derived(present.find((c) => !c.isUser)?.id);

  /** The bond you read first: a person's regard for you, -5 to 5. */
  function bondOf(c: TrackerCharacter) {
    const b = st?.bonds[`${c.id}>user`];
    if (!b) return null;
    const axis = ["trust", "affection", "respect", "comfort"].find((a) => b.axes[a]) ?? Object.keys(b.axes).find((a) => b.axes[a]);
    return axis ? { axis, label: b.label, value: b.axes[axis] ?? 0 } : null;
  }
  const say = (c: TrackerCharacter) => c.mood?.name ?? c.activity ?? (c.dead ? "Remembered" : "");
</script>

<header class="s-band" class:slim aria-label="The scene">
  <div class="scenery" aria-hidden="true"><ScenePlate place={place.length ? place : [detail.chat.title]} {weather} hour={plate?.hour ?? null} kind={plateKind} /></div>
  <div class="s-band-in">
    <div class="s-where">
      {#if app.isMobile}<button class="btn ghost icon s-back" onclick={onback} aria-label="Back"><ArrowLeft size={20} /></button>{/if}
      <div class="s-tag">{detail.character?.name ?? "Story"}{chapters.length ? ` · Chapter ${chapters.length}` : ""}{scene ? ` · Scene ${scene}` : ""}</div>
      <h2 class="s-h">
        {#if title}{title}
        {:else if place.length > 1}{place[0]}, <i>{place.at(-1)}</i>
        {:else}{place[0] ?? detail.chat.title}{/if}
      </h2>
      {#if !slim}
        <div class="s-facts">
          {#if time}<span><Clock size={14} />{time}</span>{/if}
          {#if weather}<span><CloudRain size={14} />{weather}</span>{/if}
          {#if place.length > 2}<span><MapPin size={14} />{place.slice(1, -1).join(", ")}</span>{/if}
        </div>
      {/if}
    </div>
    <div class="s-tools">
      {@render tools()}
      {#if onshowriver}<button class="btn ghost icon" onclick={onshowriver} aria-label="Show the chapters" title="Show the chapters"><Milestone size={18} /></button>{/if}
      {#if !app.isMobile}<button class="btn ghost icon" onclick={ontoggle} aria-label={slim ? "Show the whole scene" : "Fold the scene away"} title={slim ? "Show the whole scene" : "Fold the scene away"}>{#if slim}<ChevronDown size={18} />{:else}<ChevronUp size={18} />{/if}</button>{/if}
    </div>
    {#if !slim && people.length}
      <div class="s-cast" aria-label="Cast">
        {#each present as c (c.id)}
          {@const b = bondOf(c)}
          <button class="actor" class:on={selected === c.id} aria-pressed={selected === c.id} onclick={() => oncast(c.id)}>
            <span class="a-pic"><Avatar id={avatarOf(c)} name={c.name} size={app.isMobile ? 38 : 54} shape="squircle" palette={c.isMain ? (detail.character?.palette ?? []) : []} />{#if c.id === speaking}<span class="live" title="Speaking"></span>{/if}</span>
            <span class="a-text">
              <b>{c.name}{#if c.isUser} <span class="you">· you</span>{/if}</b>
              {#if say(c)}<span class="mood">{say(c)}</span>{/if}
              {#if b}<span class="bond">{b.label ?? b.axis}<span class="track"><span class="fill" style:width="{((b.value + 5) / 10) * 100}%"></span></span>{b.value > 0 ? "+" : ""}{b.value}</span>{/if}
            </span>
          </button>
        {/each}
        {#each away as c (c.id)}
          <button class="actor off" class:on={selected === c.id} aria-pressed={selected === c.id} onclick={() => oncast(c.id)}>
            <span class="a-pic"><Avatar id={avatarOf(c)} name={c.name} size={app.isMobile ? 38 : 40} shape="squircle" /></span>
            <span class="a-text"><b>{c.name}</b><span class="mood">{c.dead ? "Remembered" : "Off stage"} · last at #{c.lastSeq}</span></span>
          </button>
        {/each}
      </div>
    {/if}
  </div>
</header>
