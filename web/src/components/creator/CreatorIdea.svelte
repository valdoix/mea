<script lang="ts">
  import Segmented from "../Segmented.svelte";
  import ExpandPanel from "../studio/ExpandPanel.svelte";
  import type { CreatorSession } from "../../lib/creator.svelte";
  import { autosize } from "../../lib/gestures";
  import { MessageQuestion, NotebookPen, SlidersHorizontal } from "../../lib/icons";
  import type { CreatorOptions } from "../../lib/types";
  import WorldPicker from "./WorldPicker.svelte";

  let { session }: { session: CreatorSession } = $props();
  const draft = $derived(session.draft!);
  const o = $derived(draft.options);
  const isChar = $derived(draft.kind === "character");

  function set<K extends keyof CreatorOptions>(k: K, v: CreatorOptions[K], delay = 0) {
    session.draft!.options[k] = v;
    session.save({ options: { ...$state.snapshot(session.draft!.options) } }, "options", delay);
  }
  const hasMaterial = $derived(Boolean(draft.idea.trim() || draft.expansion?.sections.length));
</script>

<section class="stack">
  <label class="field">
    <span class="label">{isChar ? "Your character" : "Who you want to be"}, in your own words <span class="faint">a line, a paragraph, messy notes, or a card to rework: all fine</span></span>
    <textarea
      class="textarea story"
      use:autosize={{ max: 520, value: draft.idea }}
      bind:value={draft.idea}
      oninput={() => session.save({ idea: draft.idea }, "idea")}
      placeholder={isChar ? "The lighthouse keeper above Port Ellis. Dry, tired, kind in ways she hides. Owes the Salt Guild money and won't say why." : "A cartographer's apprentice who can't read her own maps anymore."}
    ></textarea>
  </label>

  <WorldPicker {session} />

  <ExpandPanel
    expansion={draft.expansion}
    busy={session.busy === "expand" || session.busy.startsWith("deepen:") ? session.busy : session.busy ? "other" : ""}
    what="idea"
    disabled={!draft.idea.trim()}
    onexpand={(steer) => session.act("expand", "/expand", { steer })}
    ondeepen={(id, steer) => session.act(`deepen:${id}`, `/expand/${id}`, { steer })}
    onpatch={(patch, key, delay) => {
      if (!draft.expansion && patch.sections) draft.expansion = { sections: [], use: true, steer: "" };
      session.save({ expansion: patch }, key, delay);
    }}
  />

  <details class="panel">
    <summary class="small"><SlidersHorizontal size={15} /> <b>Shape of the {isChar ? "card" : "persona"}</b> <span class="muted">{isChar ? `${o.mode} · ${o.pov} person · ${o.tense} · ` : ""}{o.length}{isChar ? ` · ${o.greetings} alternate greeting${o.greetings === 1 ? "" : "s"}` : ""}{o.tone ? ` · ${o.tone}` : ""}</span></summary>
    <div class="grid">
      {#if isChar}
        <div class="field"><span class="label">Card type</span><Segmented value={o.mode} options={[{ value: "companion", label: "One character" }, { value: "narrator", label: "Narrator" }]} onchange={(v) => set("mode", v)} small /></div>
        <div class="field"><span class="label">Greeting point of view</span><Segmented value={o.pov} options={[{ value: "first", label: "I" }, { value: "second", label: "You" }, { value: "third", label: "She / he / they" }]} onchange={(v) => set("pov", v)} small /></div>
        <div class="field"><span class="label">Tense</span><Segmented value={o.tense} options={[{ value: "present", label: "Present" }, { value: "past", label: "Past" }]} onchange={(v) => set("tense", v)} small /></div>
        <label class="field"><span class="label">Alternate greetings</span><input class="input" type="number" min="0" max="5" value={o.greetings} onchange={(e) => set("greetings", Math.max(0, Math.min(5, Number(e.currentTarget.value) || 0)))} /></label>
      {/if}
      <div class="field"><span class="label">Length</span><Segmented value={o.length} options={[{ value: "lean", label: "Lean" }, { value: "standard", label: "Standard" }, { value: "rich", label: "Rich" }]} onchange={(v) => set("length", v)} small /></div>
      <label class="field"><span class="label">Tone and genre</span><input class="input" value={o.tone} oninput={(e) => set("tone", e.currentTarget.value, 600)} placeholder="quiet gothic, slow-burn romance, noir…" /></label>
      <label class="field"><span class="label">Style notes</span><input class="input" value={o.style} oninput={(e) => set("style", e.currentTarget.value, 600)} placeholder="British spelling; actions in *asterisks*" /></label>
    </div>
  </details>

  <div class="row wrap actions">
    <button class="btn" onclick={() => session.act("readback", "/readback")} disabled={Boolean(session.busy) || !hasMaterial}><MessageQuestion size={16} /> {session.busy === "readback" ? "Reading…" : "Ask me questions first"}</button>
    <button class="btn primary" onclick={() => session.act("bible", "/bible")} disabled={Boolean(session.busy) || !hasMaterial}><NotebookPen size={16} /> {session.busy === "bible" ? "Writing the bible…" : "Write the bible"}</button>
  </div>
  <p class="tiny muted">The bible is the single source of truth (look, voice, past, wants, flaws, secrets{isChar ? ", what they want from you" : ""}) and every field of the {isChar ? "card" : "persona"} is written from it. You review it before anything is written.</p>
</section>

<style>
  summary {
    cursor: pointer;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
    gap: 0.8rem;
    margin-top: 0.8rem;
  }
  .actions {
    justify-content: flex-end;
  }
</style>
