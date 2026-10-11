<script lang="ts">
  import Modal from "../Modal.svelte";
  import { del, post, put } from "../../lib/api";
  import { confirm } from "../../lib/dialogs.svelte";
  import { Plus, Trash, X } from "../../lib/icons";
  import { blankCalendar, type CustomCalendar, customDate, customDay, loadCalendars, monthLength } from "../../lib/customcal.svelte";
  import { errorToast, toast } from "../../lib/state.svelte";

  /**
   * G1: build a calendar with buttons, no mini-language. Months (name and days), festival days
   * between months, weekdays (or none), the era and its first year, a leap rule, moons and holidays,
   * and story seasons. A live month grid previews it as you build. Calendars are shared by every
   * story (pick it in any chat's setup).
   */
  let { open = $bindable(false), initial = null, onsaved }: { open?: boolean; initial?: (CustomCalendar & { id?: string }) | null; onsaved?: (c: CustomCalendar & { id: string }) => void } = $props();

  let c = $state<CustomCalendar & { id?: string }>(blankCalendar());
  let previewYear = $state(1);
  let previewMonth = $state(1);
  let weekText = $state("");
  let saving = $state(false);

  $effect(() => {
    if (open) {
      c = initial ? JSON.parse(JSON.stringify(initial)) : blankCalendar();
      previewYear = c.era.firstYear;
      previewMonth = 1;
      weekText = c.weekdays.join(", ");
    }
  });

  const grid = $derived.by(() => {
    const m = Math.min(previewMonth, c.months.length) || 1;
    const n = monthLength(c, previewYear, m);
    const first = customDay(c, previewYear, m, 1);
    const lead = c.weekdays.length ? ((first % c.weekdays.length) + c.weekdays.length) % c.weekdays.length : 0;
    const cells: ({ day: number; holiday: string | null; moon: string | null } | null)[] = Array.from({ length: lead }, () => null);
    for (let day = 1; day <= n; day++) {
      const d = customDate(c, first + day - 1);
      const full = d.moons.find((x) => x.phase === "full");
      cells.push({ day, holiday: c.holidays.find((h) => h.month === m && h.day === day)?.name ?? null, moon: full ? full.name : null });
    }
    return { name: c.months[m - 1]?.name ?? "", cells, festivals: c.festivals.filter((f) => f.after === m).map((f) => f.name) };
  });
  const yearDays = $derived(c.months.reduce((n, m) => n + m.days, 0) + c.festivals.reduce((n, f) => n + f.days, 0));

  function setWeek(text: string) {
    weekText = text;
    c.weekdays = text
      .split(/\s*,\s*/)
      .map((w) => w.trim())
      .filter(Boolean)
      .slice(0, 14);
  }
  async function save() {
    if (!c.name.trim()) return errorToast(new Error("Give the calendar a name"));
    saving = true;
    try {
      const body = $state.snapshot(c);
      delete (body as { id?: string }).id;
      const r = c.id ? await put<{ calendar: CustomCalendar & { id: string } }>(`/api/calendars/${c.id}`, body) : await post<{ calendar: CustomCalendar & { id: string } }>("/api/calendars", body);
      await loadCalendars(true);
      toast(`${r.calendar.name} saved`, { kind: "ok" });
      open = false;
      onsaved?.(r.calendar);
    } catch (e) {
      errorToast(e);
    } finally {
      saving = false;
    }
  }
  async function remove() {
    if (!c.id || !(await confirm({ title: `Delete ${c.name}?`, message: "Stories using it go back to our calendar. The story clock itself doesn't change.", confirmLabel: "Delete", danger: true }))) return;
    try {
      await del(`/api/calendars/${c.id}`);
      await loadCalendars(true);
      open = false;
    } catch (e) {
      errorToast(e);
    }
  }
</script>

<Modal bind:open title={c.id ? `Edit ${c.name || "calendar"}` : "Build a calendar"} size="lg">
  <div class="builder">
    <div class="form stack">
      <label class="field"><span class="label">Name</span><input class="input" bind:value={c.name} placeholder="The Reach Reckoning" maxlength="60" /></label>

      <div class="row between"><span class="label">Months <span class="faint">{c.months.length} · {yearDays} days a year</span></span><button class="btn ghost small" onclick={() => c.months.push({ name: `Month ${c.months.length + 1}`, days: 30 })} disabled={c.months.length >= 30}><Plus size={13} /> Add a month</button></div>
      {#each c.months as m, i (i)}
        <div class="row">
          <span class="tiny faint n">{i + 1}</span>
          <input class="input grow" bind:value={m.name} aria-label="Month {i + 1} name" maxlength="40" />
          <input class="input num" type="number" min="1" max="100" bind:value={m.days} aria-label="Days in {m.name}" />
          <button class="btn ghost icon small" onclick={() => c.months.splice(i, 1)} disabled={c.months.length <= 1} aria-label="Remove {m.name}"><X size={13} /></button>
        </div>
      {/each}

      <div class="row between"><span class="label">Festival days <span class="faint">between months, in none</span></span><button class="btn ghost small" onclick={() => c.festivals.push({ name: "Midwinter", after: 1, days: 1 })}><Plus size={13} /> Add a festival day</button></div>
      {#each c.festivals as f, i (i)}
        <div class="row">
          <input class="input grow" bind:value={f.name} aria-label="Festival name" maxlength="40" />
          <select class="select" bind:value={f.after} aria-label="When">
            <option value={0}>Before {c.months[0]?.name}</option>
            {#each c.months as m, j (j)}<option value={j + 1}>After {m.name}</option>{/each}
          </select>
          <input class="input num" type="number" min="1" max="10" bind:value={f.days} aria-label="Days" />
          <button class="btn ghost icon small" onclick={() => c.festivals.splice(i, 1)} aria-label="Remove {f.name}"><X size={13} /></button>
        </div>
      {/each}

      <label class="field"><span class="label">Weekdays <span class="faint">comma-separated; empty for none</span></span><input class="input" value={weekText} oninput={(e) => setWeek(e.currentTarget.value)} placeholder="Moonday, Fireday, …" /></label>

      <div class="row">
        <label class="field grow"><span class="label">Era</span><input class="input" bind:value={c.era.name} placeholder="DR, AC, of the Reckoning" maxlength="20" /></label>
        <label class="field"><span class="label">First year</span><input class="input num" type="number" bind:value={c.era.firstYear} /></label>
      </div>

      <label class="switch"><input type="checkbox" checked={Boolean(c.leap)} onchange={(e) => (c.leap = e.currentTarget.checked ? { every: 4, month: 1, days: 1 } : null)} /> Leap years</label>
      {#if c.leap}
        <div class="row tiny">
          Every <input class="input num" type="number" min="2" max="1000" bind:value={c.leap.every} aria-label="Every how many years" /> years,
          <select class="select" bind:value={c.leap.month} aria-label="Which month">{#each c.months as m, j (j)}<option value={j + 1}>{m.name}</option>{/each}</select>
          gets <input class="input num" type="number" min="1" max="10" bind:value={c.leap.days} aria-label="Extra days" /> more
        </div>
      {/if}

      <div class="row between"><span class="label">Moons</span><button class="btn ghost small" onclick={() => c.moons.push({ name: c.moons.length ? "Second moon" : "The moon", cycle: 29.5, offset: 0 })} disabled={c.moons.length >= 6}><Plus size={13} /> Add a moon</button></div>
      {#each c.moons as m, i (i)}
        <div class="row">
          <input class="input grow" bind:value={m.name} aria-label="Moon name" maxlength="40" />
          <span class="tiny faint">cycle</span><input class="input num" type="number" min="1" step="0.5" bind:value={m.cycle} aria-label="Days from full to full" />
          <span class="tiny faint">offset</span><input class="input num" type="number" min="0" bind:value={m.offset} aria-label="Offset in days" />
          <button class="btn ghost icon small" onclick={() => c.moons.splice(i, 1)} aria-label="Remove {m.name}"><X size={13} /></button>
        </div>
      {/each}

      <div class="row between"><span class="label">Holidays</span><button class="btn ghost small" onclick={() => c.holidays.push({ name: "A holiday", month: 1, day: 1 })}><Plus size={13} /> Add a holiday</button></div>
      {#each c.holidays as h, i (i)}
        <div class="row">
          <input class="input grow" bind:value={h.name} aria-label="Holiday name" maxlength="40" />
          <input class="input num" type="number" min="1" max="100" bind:value={h.day} aria-label="Day" />
          <select class="select" bind:value={h.month} aria-label="Month">{#each c.months as m, j (j)}<option value={j + 1}>{m.name}</option>{/each}</select>
          <button class="btn ghost icon small" onclick={() => c.holidays.splice(i, 1)} aria-label="Remove {h.name}"><X size={13} /></button>
        </div>
      {/each}

      <label class="switch"><input type="checkbox" bind:checked={c.storySeasons} /> Story seasons <span class="tiny muted">the season changes when the story says so; weather and day length follow</span></label>
    </div>

    <aside class="preview card">
      <div class="row between">
        <button class="btn ghost small" onclick={() => (previewMonth > 1 ? previewMonth-- : ((previewYear -= 1), (previewMonth = c.months.length)))} aria-label="Previous month">‹</button>
        <b class="small">{grid.name} {previewYear}{c.era.name ? ` ${c.era.name}` : ""}</b>
        <button class="btn ghost small" onclick={() => (previewMonth < c.months.length ? previewMonth++ : ((previewYear += 1), (previewMonth = 1)))} aria-label="Next month">›</button>
      </div>
      <div class="grid" style:--cols={Math.max(1, Math.min(c.weekdays.length || 7, 10))}>
        {#each c.weekdays.slice(0, 10) as w (w)}<div class="dow">{w.slice(0, 2)}</div>{/each}
        {#each grid.cells as cell, i (i)}
          {#if cell}<div class="d" class:hol={cell.holiday} title={[cell.holiday, cell.moon && `${cell.moon} full`].filter(Boolean).join(" · ") || undefined}>{cell.day}{#if cell.moon}<span class="mn">●</span>{/if}</div>{:else}<div></div>{/if}
        {/each}
      </div>
      {#if grid.festivals.length}<p class="tiny muted">Then: {grid.festivals.join(", ")}</p>{/if}
      <p class="tiny faint">Shared by every story: pick it in any chat's Story setup.</p>
    </aside>
  </div>
  {#snippet footer()}
    {#if c.id}<button class="btn ghost danger" onclick={remove}><Trash size={14} /> Delete</button>{/if}
    <span class="grow"></span>
    <button class="btn ghost" onclick={() => (open = false)}>Cancel</button>
    <button class="btn primary" onclick={save} disabled={saving || !c.name.trim()}>Save</button>
  {/snippet}
</Modal>

<style>
  .builder {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 15rem;
    gap: 1rem;
    align-items: start;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    flex-wrap: wrap;
  }
  .between {
    justify-content: space-between;
  }
  .grow {
    flex: 1;
    min-width: 6rem;
  }
  .num {
    width: 4.5rem;
  }
  .n {
    width: 1.2rem;
    text-align: right;
  }
  .preview {
    position: sticky;
    top: 0;
    display: grid;
    gap: 0.4rem;
    padding: 0.7rem;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
    gap: 2px;
  }
  .dow {
    font-size: 0.65rem;
    text-align: center;
    color: var(--text-faint);
  }
  .d {
    position: relative;
    text-align: center;
    font-size: 0.72rem;
    padding: 0.2rem 0;
    border-radius: 4px;
    background: var(--surface-2);
  }
  .d.hol {
    background: color-mix(in srgb, var(--accent) 30%, var(--surface-2));
  }
  .mn {
    position: absolute;
    top: 0;
    right: 2px;
    font-size: 0.45rem;
  }
  @media (max-width: 640px) {
    .builder {
      grid-template-columns: 1fr;
    }
    .preview {
      position: static;
    }
  }
</style>
