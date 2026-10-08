<script lang="ts">
  import Segmented from "../Segmented.svelte";
  import { app, saveSetting } from "../../lib/state.svelte";

  const s = $derived(app.settings);
</script>

{#if s}
  <div class="stack">
    <section class="panel stack">
      <h2>Theme</h2>
      <Segmented
        value={s["appearance.theme"]}
        options={[
          { value: "system", label: "Match my device" },
          { value: "light", label: "Mea Cozy" },
          { value: "dark", label: "Cozy Night" },
        ]}
        onchange={(v) => saveSetting("appearance.theme", v)}
      />
      <div class="swatches" aria-hidden="true">
        {#each ["var(--bg)", "var(--surface)", "var(--accent)", "var(--lavender)", "var(--mint)", "var(--peach)", "var(--butter)", "var(--sky)"] as c (c)}<span style:background={c}></span>{/each}
      </div>
    </section>

    <section class="panel stack">
      <h2>Chat style</h2>
      <Segmented
        value={s["appearance.chatStyle"]}
        options={[
          { value: "cards", label: "Cards" },
          { value: "book", label: "Book" },
          { value: "bubbles", label: "Bubbles" },
        ]}
        onchange={(v) => saveSetting("appearance.chatStyle", v)}
      />
      <p class="tiny muted">Cards: soft tinted blocks. Book: flowing prose without bubbles. Bubbles: a messenger look.</p>
    </section>

    <section class="panel stack">
      <h2>Reading</h2>
      <label class="field">
        <span class="label">Story font</span>
        <Segmented
          value={s["appearance.storyFont"]}
          options={[
            { value: "lora", label: "Lora" },
            { value: "literata", label: "Literata" },
            { value: "nunito", label: "Nunito" },
          ]}
          onchange={(v) => saveSetting("appearance.storyFont", v)}
        />
      </label>
      <label class="field">
        <span class="label">Text size <span class="faint">{Math.round(s["appearance.fontScale"] * 100)}%</span></span>
        <input type="range" min="0.85" max="1.3" step="0.05" value={s["appearance.fontScale"]} onchange={(e) => saveSetting("appearance.fontScale", Number(e.currentTarget.value))} />
      </label>
      <div class="sample prose">
        <p>The lamp flickers as the wind presses against the old glass. <span class="dl">“You came back,”</span> she says softly. <em>Outside, the sea keeps its patient rhythm.</em></p>
      </div>
    </section>

    <section class="panel stack">
      <h2>Lore in messages</h2>
      <label class="switch">
        <input type="checkbox" checked={s["appearance.glossary"] !== false} onchange={(e) => saveSetting("appearance.glossary", e.currentTarget.checked)} />
        Underline lorebook terms in messages; tap one to read its entry
      </label>
    </section>

    <section class="panel stack">
      <h2>Typing</h2>
      <label class="switch">
        <input type="checkbox" checked={s["chat.enterToSend"]} onchange={(e) => saveSetting("chat.enterToSend", e.currentTarget.checked)} />
        Enter sends the message (on a computer)
      </label>
      <p class="tiny muted">Off: Enter makes a new line and <kbd>Ctrl</kbd>+<kbd>Enter</kbd> sends. On the phone, Enter always makes a new line.</p>
    </section>
  </div>
{/if}

<style>
  .swatches {
    display: flex;
    gap: 0.4rem;
  }
  .swatches span {
    width: 1.6rem;
    height: 1.6rem;
    border-radius: 50%;
    border: 1px solid var(--border);
  }
  .sample {
    padding: 0.9rem 1rem;
    border-radius: var(--r);
    background: var(--tint-char);
  }
</style>
