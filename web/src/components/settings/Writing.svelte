<script lang="ts">
  import Segmented from "../Segmented.svelte";
  import { Plus, Trash } from "../../lib/icons";
  import { app, errorToast, saveSetting } from "../../lib/state.svelte";
  import type { GuidanceChip, Settings } from "../../lib/types";

  const s = $derived(app.settings);
  let newPhrase = $state("");
  let newReplace = $state("");

  async function save<K extends keyof Settings>(k: K, v: Settings[K]) {
    try {
      await saveSetting(k, v);
    } catch (e) {
      errorToast(e);
    }
  }
  function chips(): GuidanceChip[] {
    return structuredClone($state.snapshot(s?.["chat.guidance"] ?? []));
  }
  function setChip(i: number, patch: Partial<GuidanceChip>) {
    const list = chips();
    list[i] = { ...list[i]!, ...patch };
    void save("chat.guidance", list);
  }
  function addChip() {
    void save("chat.guidance", [...chips(), { id: `g-${crypto.randomUUID().slice(0, 6)}`, name: "New chip", text: "", mode: "once" }]);
  }
  function addPhrase() {
    if (!s || !newPhrase.trim()) return;
    const b = s["chat.banned"];
    void save("chat.banned", { ...b, list: [...b.list, { phrase: newPhrase.trim(), ...(newReplace.trim() ? { replace: newReplace.trim() } : {}) }] });
    newPhrase = "";
    newReplace = "";
  }
</script>

{#if s}
  <div class="stack">
    <section class="panel stack">
      <h2>Guidance chips</h2>
      <p class="tiny muted">Reusable instructions you switch on from the composer's steering button. "Once" is for the next reply; "Stays on" until you switch it off. A chip can switch itself on when a tracker condition holds, like <span class="mono">time_of_day = night</span> or <span class="mono">bond Mira&gt;You trust &gt;= 3</span>.</p>
      {#each s["chat.guidance"] as g, i (g.id)}
        <div class="chip-edit card">
          <div class="row">
            <input class="input mini name" value={g.name} onchange={(e) => setChip(i, { name: e.currentTarget.value })} aria-label="Chip name" />
            <Segmented value={g.mode} small options={[{ value: "once", label: "Once" }, { value: "persistent", label: "Stays on" }]} onchange={(v) => setChip(i, { mode: v })} />
            <button class="btn ghost icon small" onclick={() => save("chat.guidance", chips().filter((_, j) => j !== i))} aria-label="Remove"><Trash size={14} /></button>
          </div>
          <textarea class="textarea" rows="2" value={g.text} onchange={(e) => setChip(i, { text: e.currentTarget.value })} placeholder="What the model should do"></textarea>
          <input class="input mini" value={g.auto?.when ?? ""} onchange={(e) => setChip(i, { auto: { ...(g.auto ?? {}), when: e.currentTarget.value.trim() || undefined } })} placeholder="Switch on by itself when… (optional tracker condition)" />
        </div>
      {/each}
      <button class="btn small" onclick={addChip}><Plus size={14} /> Chip</button>
    </section>

    <section class="panel stack">
      <h2>Banned phrases</h2>
      <p class="tiny muted">Phrases you never want to read. With a replacement, it's swapped in; without one, the reply is flagged or written again.</p>
      <div class="field">
        <span class="label">When a phrase without a replacement shows up</span>
        <Segmented
          value={s["chat.banned"].action}
          small
          options={[
            { value: "flag", label: "Flag it" },
            { value: "regenerate", label: "Write it again (once)" },
            { value: "replace", label: "Use replacements" },
          ]}
          onchange={(v) => save("chat.banned", { ...s["chat.banned"], action: v })}
        />
      </div>
      <label class="switch"><input type="checkbox" checked={s["chat.banned"].remind} onchange={(e) => save("chat.banned", { ...s["chat.banned"], remind: e.currentTarget.checked })} /> Also tell the model to avoid them (costs a few tokens each reply)</label>
      <div class="phrases">
        {#each s["chat.banned"].list as b, i (b.phrase)}
          <span class="chip">{b.phrase}{b.replace ? ` → ${b.replace}` : ""} <button class="x" onclick={() => save("chat.banned", { ...s["chat.banned"], list: s["chat.banned"].list.filter((_, j) => j !== i) })} aria-label="Remove">×</button></span>
        {/each}
      </div>
      <div class="row wrap">
        <input class="input grow" bind:value={newPhrase} placeholder="Phrase" onkeydown={(e) => e.key === "Enter" && addPhrase()} />
        <input class="input grow" bind:value={newReplace} placeholder="Replacement (optional)" onkeydown={(e) => e.key === "Enter" && addPhrase()} />
        <button class="btn small" onclick={addPhrase} disabled={!newPhrase.trim()}><Plus size={14} /> Add</button>
      </div>
    </section>

    <section class="panel stack">
      <h2>Replies</h2>
      <div class="field">
        <span class="label">A reply cut off by the length limit</span>
        <Segmented
          value={s["chat.cutoff"]}
          small
          options={[
            { value: "continue", label: "Continue it" },
            { value: "trim", label: "Trim the last sentence" },
            { value: "off", label: "Leave it" },
          ]}
          onchange={(v) => save("chat.cutoff", v)}
        />
      </div>
      <label class="switch"><input type="checkbox" checked={s["chat.retry"].empty} onchange={(e) => save("chat.retry", { ...s["chat.retry"], empty: e.currentTarget.checked })} /> Try again once after an empty reply</label>
      <label class="switch"><input type="checkbox" checked={s["chat.retry"].refusal} onchange={(e) => save("chat.retry", { ...s["chat.retry"], refusal: e.currentTarget.checked })} /> Try again once after a refusal (with the next model in the chain, if any)</label>
      <label class="switch"><input type="checkbox" checked={s["chat.retry"].serverErrors} onchange={(e) => save("chat.retry", { ...s["chat.retry"], serverErrors: e.currentTarget.checked })} /> Retry a server error on the same model before falling back</label>
    </section>

    <section class="panel stack">
      <h2>The world off the page</h2>
      <p class="tiny muted">Defaults for new chats; each chat can change them on its World page.</p>
      <div class="grid">
        <label class="field">
          <span class="label">How lively</span>
          <select class="select" value={s["world.defaults"].mode} onchange={(e) => save("world.defaults", { ...s["world.defaults"], mode: e.currentTarget.value as Settings["world.defaults"]["mode"] })}>
            <option value="off">Off</option><option value="quiet">Quiet</option><option value="living">Living</option><option value="restless">Restless</option>
          </select>
        </label>
        <label class="field">
          <span class="label">Director</span>
          <select class="select" value={s["world.defaults"].director} onchange={(e) => save("world.defaults", { ...s["world.defaults"], director: e.currentTarget.value as Settings["world.defaults"]["director"] })}>
            <option value="steady">Steady</option><option value="rising">Rising action</option><option value="chaotic">Chaotic</option><option value="gentle">Gentle</option>
          </select>
        </label>
        <label class="field">
          <span class="label">New subplots</span>
          <select class="select" value={s["world.defaults"].seeding} onchange={(e) => save("world.defaults", { ...s["world.defaults"], seeding: e.currentTarget.value as Settings["world.defaults"]["seeding"] })}>
            <option value="ask">Ask me first</option><option value="auto">Let them start</option><option value="off">Only mine</option>
          </select>
        </label>
        <label class="field">
          <span class="label">Irreversible endings</span>
          <select class="select" value={s["world.defaults"].fates} onchange={(e) => save("world.defaults", { ...s["world.defaults"], fates: e.currentTarget.value as Settings["world.defaults"]["fates"] })}>
            <option value="ask">Ask me</option><option value="page">Only on the page</option><option value="allow">Let them happen</option>
          </select>
        </label>
        <label class="field">
          <span class="label">Telling</span>
          <select class="select" value={s["world.defaults"].telling} onchange={(e) => save("world.defaults", { ...s["world.defaults"], telling: e.currentTarget.value as Settings["world.defaults"]["telling"] })}>
            <option value="model">A model writes the words</option><option value="engine">The engine's words (no requests)</option>
          </select>
        </label>
        <label class="field"><span class="label">Step</span><input class="input" type="number" min="30" max="1440" step="30" value={s["world.defaults"].step} onchange={(e) => save("world.defaults", { ...s["world.defaults"], step: Number(e.currentTarget.value) || 120 })} /><span class="hint">story minutes between moves</span></label>
      </div>
    </section>
  </div>
{/if}

<style>
  .chip-edit {
    padding: 0.6rem 0.7rem;
    display: grid;
    gap: 0.4rem;
  }
  .name {
    flex: 1;
  }
  .mini {
    padding: 0.25rem 0.5rem;
    font-size: var(--fs-sm);
  }
  .phrases {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }
  .x {
    border: 0;
    background: none;
    cursor: pointer;
    color: inherit;
    padding: 0 0.1rem;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
    gap: 0.8rem;
  }
</style>
