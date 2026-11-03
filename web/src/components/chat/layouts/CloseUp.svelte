<script lang="ts">
  import Avatar from "../../Avatar.svelte";
  import { ArrowLeft, Check, EyeOff, Heart, History, Eye, ScrollText, Users } from "../../../lib/icons";
  import { trk } from "../../../lib/trackers.svelte";
  import type { ChatDetail } from "../../../lib/types";

  /** Stage: one person up close: how they are now, your bond over time, what they know and carry. */
  let { detail, id, onclose, onjump }: { detail: ChatDetail; id: string; onclose: () => void; onjump: (seq: number) => void } = $props();

  const st = $derived(trk.data?.state ?? null);
  const c = $derived(st?.chars[id] ?? null);
  const profile = $derived(c ? trk.data?.profiles[c.name.toLowerCase()] : undefined);
  const avatar = $derived(!c ? null : c.isUser ? (detail.persona?.avatarId ?? null) : c.isMain ? (detail.character?.avatarId ?? null) : (profile?.avatarId ?? null));
  const you = $derived(trk.data?.userName || "you");
  const bond = $derived(st?.bonds[`${id}>user`] ?? null);
  const axis = $derived(bond ? (["trust", "affection", "respect", "comfort"].find((a) => bond.axes[a]) ?? Object.keys(bond.axes).find((a) => bond.axes[a]) ?? null) : null);

  const body = $derived(
    !c
      ? ""
      : [c.look, ...c.flags, ...c.injuries.map((i) => `${i.where} hurt`), ...c.conditions.map((x) => x.text)]
          .filter(Boolean)
          .slice(0, 3)
          .join("; "),
  );
  const facts = $derived(st ? Object.values(st.facts).filter((f) => !f.secret || f.stances[id] || f.secret.keepers.includes(id)) : []);
  const knows = $derived(facts.filter((f) => ["knows", "known", "believes", "suspects"].includes(f.stances[id]?.status ?? "")).slice(-5));
  const unaware = $derived(facts.filter((f) => !f.stances[id] || f.stances[id]?.status === "unaware").slice(-5));
  const carrying = $derived(st ? Object.values(st.items).filter((i) => i.holder === id && !i.gone) : []);
  const changes = $derived(bond ? [...bond.history].reverse().slice(0, 5) : []);

  // The bond's line across the story, on one axis, -5 to 5.
  const W = 300;
  const H = 86;
  const line = $derived.by(() => {
    if (!bond || !axis) return null;
    const h = bond.history.filter((x) => x.axis === axis);
    if (!h.length) return null;
    const last = Math.max(1, trk.data?.maxSeq ?? 0, h.at(-1)!.seq);
    const first = Math.min(c?.firstSeq ?? 0, h[0]!.seq);
    const x = (s: number) => ((s - first) / Math.max(1, last - first)) * W;
    const y = (v: number) => H - 6 - ((v + 5) / 10) * (H - 12);
    const pts = [[x(first), y(h[0]!.from)], ...h.map((p) => [x(p.seq), y(p.to)]), [W, y(h.at(-1)!.to)]] as [number, number][];
    const d = pts.map(([a, b], i) => `${i ? "L" : "M"}${a.toFixed(1)} ${b.toFixed(1)}`).join(" ");
    return { d, area: `${d} L${W} ${H} L0 ${H}Z`, end: pts.at(-1)! };
  });
</script>

{#if c}
  <div class="sheet" role="region" aria-label="{c.name}, up close">
    <div class="card who-card">
      <span class="who-pic"><Avatar id={avatar} name={c.name} size={230} portrait shape="squircle" palette={c.isMain ? (detail.character?.palette ?? []) : []} /></span>
      <h3>{c.name}</h3>
      {#if profile?.role || profile?.description}<p>{profile.role ?? profile.description}</p>{/if}
      {#if c.traits.length}<div class="tags">{#each c.traits.slice(0, 6) as t, i (i)}<span class="tag2">{t.text}</span>{/each}</div>{/if}
      <button class="btn small back" onclick={onclose}><ArrowLeft size={14} /> Back to the scene</button>
    </div>
    <div class="card">
      <h4><Heart size={12} /> Right now</h4>
      <div class="now-grid">
        <div><span>Mood</span>{c.mood?.name ?? "Unread so far"}</div>
        <div><span>Body</span>{body || "Nothing of note"}</div>
        <div><span>Wants</span>{c.drives.want ?? "Hasn't shown it yet"}</div>
        <div><span>Fears</span>{c.drives.fear ?? "Hasn't shown it yet"}</div>
      </div>
    </div>
    {#if !c.isUser}
      <div class="card">
        <h4><Users size={12} /> With {you}</h4>
        {#if bond && axis}
          <div class="bondnum"><b>{(bond.axes[axis] ?? 0) > 0 ? "+" : ""}{bond.axes[axis] ?? 0}</b><span>{axis}{bond.label ? ` · “${bond.label}”` : ""}</span></div>
          {#if line}
            <svg class="spark" viewBox="0 0 {W} {H}" preserveAspectRatio="none" role="img" aria-label="{axis} across the story, now {bond.axes[axis] ?? 0} out of 5">
              <path d={line.area} class="sp-area" />
              <path d={line.d} class="sp-line" />
            </svg>
          {/if}
        {:else}
          <p class="tiny muted">No bond to read yet.</p>
        {/if}
      </div>
    {/if}
    <div class="card">
      <h4><Eye size={12} /> What {c.name.split(/\s+/)[0]} knows</h4>
      <div class="know">
        <div><h5>Knows</h5>
          <ul>{#each knows as f (f.key)}<li><Check size={14} class="yes" /><button class="linkish" onclick={() => onjump(f.lastSeq)}>{f.statement}</button></li>{:else}<li class="tiny muted">Nothing on record.</li>{/each}</ul>
        </div>
        <div><h5>Doesn't know</h5>
          <ul>{#each unaware as f (f.key)}<li><EyeOff size={14} class="no" /><button class="linkish" onclick={() => onjump(f.firstSeq)}>{f.statement}</button></li>{:else}<li class="tiny muted">Nothing on record.</li>{/each}</ul>
        </div>
      </div>
    </div>
    {#if changes.length}
      <div class="card">
        <h4><History size={12} /> Recent changes</h4>
        {#each changes as h, i (i)}
          <button class="chg" onclick={() => onjump(h.seq)}><span class="v" class:up={h.delta > 0} class:dn={h.delta < 0}>{h.delta > 0 ? "+" : "−"}{Math.abs(h.delta)}</span><span>{h.cause ?? h.axis}</span><span class="s">#{h.seq}</span></button>
        {/each}
      </div>
    {/if}
    <div class="card wide">
      <h4><ScrollText size={12} /> Carrying</h4>
      <div class="carry">{#each carrying as it (it.id)}<span>{it.name}{#if it.condition} <i>· {it.condition}</i>{/if}</span>{:else}<span class="tiny muted none">Nothing on record.</span>{/each}</div>
    </div>
  </div>
{/if}
