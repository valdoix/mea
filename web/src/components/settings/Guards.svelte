<script lang="ts">
  import Segmented from "../Segmented.svelte";
  import { app, errorToast, saveSetting } from "../../lib/state.svelte";
  import type { GuardsConfig } from "../../lib/types";

  /** Phase 5 accuracy guards (CON-03…05, CON-10, CON-12): defaults for every chat. A chat can change them in its panel. */
  const g = $derived(app.settings?.["guards.config"]);

  async function set(patch: Partial<GuardsConfig>) {
    if (!g) return;
    try {
      await saveSetting("guards.config", { ...$state.snapshot(g), ...patch });
    } catch (e) {
      errorToast(e);
    }
  }
</script>

{#if g}
  <div class="stack">
    <p class="small muted">Guards keep long stories on track. They run on every reply, cost nothing (no model calls, apart from the drift detector's optional embeddings), and never change a reply unless you say so here. Each chat can override these in its panel.</p>

    <section class="panel stack">
      <h2>Re-anchor</h2>
      <p class="tiny muted">A short reminder of who the character is (from the card, or your own text in the character editor), placed near the end of the prompt where long sessions drift.</p>
      <div class="field">
        <span class="label">When</span>
        <Segmented
          value={g.anchor}
          small
          options={[
            { value: "auto", label: "Long chats and drift" },
            { value: "always", label: "Always" },
            { value: "off", label: "Off" },
          ]}
          onchange={(v) => set({ anchor: v })}
        />
      </div>
      <div class="grid">
        <label class="field">
          <span class="label">Starts at (messages)</span>
          <input class="input" type="number" min="0" max="5000" value={g.anchorAfter} onchange={(e) => set({ anchorAfter: Math.max(0, Number(e.currentTarget.value) || 0) })} disabled={g.anchor !== "auto"} />
        </label>
        <label class="field">
          <span class="label">Depth (messages from the end)</span>
          <input class="input" type="number" min="0" max="40" value={g.anchorDepth} onchange={(e) => set({ anchorDepth: Math.min(40, Math.max(0, Number(e.currentTarget.value) || 0)) })} />
        </label>
      </div>
    </section>

    <section class="panel stack">
      <h2>Point of view, tense and writing for you</h2>
      <p class="tiny muted">Checked against the story settings, or against the last few replies when the story doesn't say.</p>
      <label class="switch"><input type="checkbox" checked={g.pov} onchange={(e) => set({ pov: e.currentTarget.checked })} /> Point of view: who narrates, and whether you're "you" or named</label>
      <label class="switch"><input type="checkbox" checked={g.tense} onchange={(e) => set({ tense: e.currentTarget.checked })} /> Tense: past or present, and replies that wobble between them</label>
      <label class="switch"><input type="checkbox" checked={g.puppet} onchange={(e) => set({ puppet: e.currentTarget.checked })} /> Writing for you: your character's words or actions in the reply</label>
      <div class="field">
        <span class="label">When a reply writes for you</span>
        <Segmented
          value={g.puppetAction}
          small
          options={[
            { value: "flag", label: "Note it" },
            { value: "trim", label: "Cut the end" },
            { value: "regenerate", label: "Write it again (once)" },
          ]}
          onchange={(v) => set({ puppetAction: v })}
        />
        <span class="tiny faint">"Cut the end" only cuts when the slip is in the second half of the reply; you can undo it on the message.</span>
      </div>
    </section>

    <section class="panel stack">
      <h2>Names</h2>
      <p class="tiny muted">Canonical spellings come from the card, your persona, the people and places the story knows, and your lorebooks. A name one letter off ("Mria") is a slip; a name the chat has used before is left alone.</p>
      <Segmented
        value={g.names}
        small
        options={[
          { value: "flag", label: "Note it" },
          { value: "fix", label: "Correct it" },
          { value: "off", label: "Off" },
        ]}
        onchange={(v) => set({ names: v })}
      />
    </section>

    <section class="panel stack">
      <h2>Voice drift</h2>
      <p class="tiny muted">Every few replies, the character's lines are compared with their voice samples (lines you kept in the voice lab, then the card's example dialogue): sentence length, contractions, exclamations, formality, and meaning when embeddings are on. While the voice drifts, the re-anchor gets stronger.</p>
      <label class="switch"><input type="checkbox" checked={g.drift} onchange={(e) => set({ drift: e.currentTarget.checked })} /> Watch the voice</label>
      <div class="grid">
        <label class="field">
          <span class="label">Every (character replies)</span>
          <input class="input" type="number" min="1" max="100" value={g.driftEvery} onchange={(e) => set({ driftEvery: Math.min(100, Math.max(1, Number(e.currentTarget.value) || 6)) })} disabled={!g.drift} />
        </label>
        <label class="field">
          <span class="label">Sensitivity</span>
          <select class="select" value={String(g.driftThreshold)} onchange={(e) => set({ driftThreshold: Number(e.currentTarget.value) })} disabled={!g.drift}>
            <option value="0.35">High (warns early)</option>
            <option value="0.45">Normal</option>
            <option value="0.6">Low (only big drifts)</option>
          </select>
        </label>
      </div>
    </section>

    <section class="panel stack">
      <h2>Lessons from swipes</h2>
      <p class="tiny muted">When you swipe past takes and keep one, or edit a reply by hand, Mea suggests what to learn from it, under the reply. Lessons you keep go to the model every turn. The rules cost nothing; the helper model compares the takes when you choose it (and is skipped when the quota runs low).</p>
      <Segmented
        value={g.lessons ?? "rules"}
        small
        options={[
          { value: "off", label: "Off" },
          { value: "rules", label: "Rules only" },
          { value: "model", label: "Rules + model" },
        ]}
        onchange={(v) => set({ lessons: v })}
      />
    </section>

    <section class="panel stack">
      <h2>Timeline</h2>
      <p class="tiny muted">Once the trackers have read a reply, the story clock before and after is compared: time running backwards, a big jump nothing in the reply mentions, or a reply that moves to the next day while the clock barely moved.</p>
      <label class="switch"><input type="checkbox" checked={g.timeline} onchange={(e) => set({ timeline: e.currentTarget.checked })} /> Check the timeline</label>
      <label class="field" style="max-width:16rem">
        <span class="label">Flag silent jumps longer than (hours)</span>
        <input class="input" type="number" min="1" max="8760" value={g.maxJumpHours} onchange={(e) => set({ maxJumpHours: Math.max(1, Number(e.currentTarget.value) || 12) })} disabled={!g.timeline} />
      </label>
    </section>
  </div>
{/if}

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
    gap: 0.8rem;
  }
</style>
