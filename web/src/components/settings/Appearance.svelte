<script lang="ts">
  import Segmented from "../Segmented.svelte";
  import { biometricsAvailable, lock, removeLock, setPin, setupBiometrics } from "../../lib/applock.svelte";
  import { confirm } from "../../lib/dialogs.svelte";
  import { device, setDevice } from "../../lib/device.svelte";
  import { app, errorToast, saveSetting, toast } from "../../lib/state.svelte";
  import { STORY_FONTS, UI_FONTS, loadAllFonts } from "../../lib/fonts";
  import { living } from "../../lib/living";
  import { onMount } from "svelte";
  import type { LivingPage, Typography } from "../../lib/types";

  const s = $derived(app.settings);
  const page = $derived(living(s));
  // The picker shows each font in its own face.
  onMount(loadAllFonts);
  function setPage(patch: Partial<LivingPage>) {
    void saveSetting("appearance.living", { ...page, ...patch });
  }

  // UI-16 / UI-19
  const typoDefaults: Typography = { uiFont: "nunito", lineHeight: 1.7, paragraphSpacing: 0.75, width: 46, dialogueColor: null, dyslexic: false };
  const typo = $derived({ ...typoDefaults, ...(s?.["appearance.typography"] ?? {}) });
  function setTypo(patch: Partial<Typography>) {
    void saveSetting("appearance.typography", { ...typo, ...patch });
  }

  // MOB-11
  let pin = $state("");
  let pin2 = $state("");
  async function savePin() {
    if (!/^\d{4,12}$/.test(pin)) return toast("Use 4 to 12 digits", { kind: "error" });
    if (pin !== pin2) return toast("The two PINs don't match", { kind: "error" });
    await setPin(pin);
    pin = pin2 = "";
    toast("App lock is on for this device", { kind: "ok" });
  }
  async function turnOffLock() {
    if (await confirm({ title: "Turn the app lock off?", message: "Mea opens on this device without a PIN again.", confirmLabel: "Turn off" })) removeLock();
  }
  async function addBiometrics() {
    try {
      await setupBiometrics();
      toast("Fingerprint or face unlock is set up", { kind: "ok" });
    } catch (e) {
      errorToast(e);
    }
  }
</script>

{#if s}
  <div class="stack">
    <section class="panel stack">
      <h2>Theme</h2>
      <Segmented
        value={s["appearance.theme"]}
        options={[
          { value: "lantern", label: "Lantern" },
          { value: "system", label: "Cozy, matching my device" },
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
      <p class="tiny muted">Cards: glowing boxes with a portrait beside each. Book: flowing prose without boxes. Bubbles: a messenger look.</p>
      <div class="field">
        <span class="label">Chat box width <span class="faint">on this device</span></span>
        <Segmented
          value={String(device.chatWidth)}
          options={[
            { value: "38", label: "Narrow" },
            { value: "0", label: "Comfortable" },
            { value: "60", label: "Wide" },
            { value: "100", label: "Full" },
          ]}
          onchange={(v) => setDevice("chatWidth", Number(v))}
        />
        <span class="hint">Comfortable follows the text width below.</span>
      </div>
      <div class="grid">
        <div class="field">
          <span class="label">Portraits</span>
          <Segmented
            value={device.portrait}
            options={[
              { value: "small", label: "Small" },
              { value: "large", label: "Large" },
              { value: "grand", label: "Grand" },
            ]}
            onchange={(v) => setDevice("portrait", v)}
          />
        </div>
        <div class="field">
          <span class="label">Room inside each box</span>
          <Segmented
            value={device.boxPadding}
            options={[
              { value: "snug", label: "Snug" },
              { value: "cozy", label: "Cozy" },
              { value: "airy", label: "Airy" },
            ]}
            onchange={(v) => setDevice("boxPadding", v)}
          />
        </div>
      </div>
    </section>

    {#if app.theme === "lantern"}
      <section class="panel stack">
        <h2>Atmosphere</h2>
        <label class="switch"><input type="checkbox" checked={device.fireflies} onchange={(e) => setDevice("fireflies", e.currentTarget.checked)} /> Fireflies drifting in the night sky</label>
        <label class="switch"><input type="checkbox" checked={device.grain} onchange={(e) => setDevice("grain", e.currentTarget.checked)} /> A whisper of film grain</label>
        <p class="tiny muted">Both stay on this device. If your system asks for less motion, Mea keeps everything still.</p>
      </section>
    {/if}

    <section class="panel stack">
      <h2>Reading</h2>
      <div class="field">
        <span class="label">Story font</span>
        <div class="fonts" role="radiogroup" aria-label="Story font">
          {#each STORY_FONTS as f (f.id)}
            <button class="font" class:on={s["appearance.storyFont"] === f.id} role="radio" aria-checked={s["appearance.storyFont"] === f.id} onclick={() => saveSetting("appearance.storyFont", f.id)}>
              <span class="face" style:font-family={f.family}>“Stay,” she said. <i>Aa</i></span>
              <b>{f.label}</b><span class="note">{f.note}</span>
            </button>
          {/each}
        </div>
      </div>
      <label class="field">
        <span class="label">Text size <span class="faint">{Math.round(s["appearance.fontScale"] * 100)}%</span></span>
        <input type="range" min="0.85" max="1.3" step="0.05" value={s["appearance.fontScale"]} onchange={(e) => saveSetting("appearance.fontScale", Number(e.currentTarget.value))} />
      </label>
      <div class="grid">
        <label class="field">
          <span class="label">Line height <span class="faint">{typo.lineHeight.toFixed(2)}</span></span>
          <input type="range" min="1.3" max="2.2" step="0.05" value={typo.lineHeight} onchange={(e) => setTypo({ lineHeight: Number(e.currentTarget.value) })} />
        </label>
        <label class="field">
          <span class="label">Paragraph spacing <span class="faint">{typo.paragraphSpacing.toFixed(2)}</span></span>
          <input type="range" min="0" max="1.6" step="0.05" value={typo.paragraphSpacing} onchange={(e) => setTypo({ paragraphSpacing: Number(e.currentTarget.value) })} />
        </label>
        <label class="field">
          <span class="label">Text width <span class="faint">{typo.width} rem</span></span>
          <input type="range" min="30" max="70" step="1" value={typo.width} onchange={(e) => setTypo({ width: Number(e.currentTarget.value) })} />
        </label>
        <div class="field">
          <span class="label">Dialogue color</span>
          <div class="row">
            <input type="color" value={typo.dialogueColor ?? "#9c3f63"} onchange={(e) => setTypo({ dialogueColor: e.currentTarget.value })} aria-label="Dialogue color" />
            {#if typo.dialogueColor}<button class="btn ghost small" onclick={() => setTypo({ dialogueColor: null })}>Theme's own</button>{:else}<span class="tiny muted">The theme's own</span>{/if}
          </div>
        </div>
      </div>
      <div class="field">
        <span class="label">Interface font</span>
        <div class="fonts ui" role="radiogroup" aria-label="Interface font">
          {#each UI_FONTS as f (f.id)}
            <button class="font" class:on={typo.uiFont === f.id} role="radio" aria-checked={typo.uiFont === f.id} onclick={() => setTypo({ uiFont: f.id })}>
              <span class="face" style:font-family={f.family || undefined}>Settings · Aa</span>
              <b>{f.id === "nunito" && app.theme !== "lantern" ? "Nunito" : f.label}</b><span class="note">{f.note}</span>
            </button>
          {/each}
        </div>
      </div>
      <label class="switch"><input type="checkbox" checked={typo.dyslexic} onchange={(e) => setTypo({ dyslexic: e.currentTarget.checked })} /> Dyslexia-friendly font (OpenDyslexic) everywhere</label>
      <div class="sample prose">
        <p>The lamp flickers as the wind presses against the old glass. <span class="dl">“You came back,”</span> she says softly. <em>Outside, the sea keeps its patient rhythm.</em></p>
      </div>
    </section>

    <section class="panel stack">
      <h2>The living page</h2>
      <p class="tiny muted">Drawn by Mea from the story itself; nothing here is sent to the model.</p>
      <label class="field">
        <span class="label">Speaker colours <span class="faint">each character's lines in their own colour</span></span>
        <Segmented
          value={page.voices}
          small
          options={[
            { value: "ink" as const, label: "Ink" },
            { value: "ribbon" as const, label: "Ribbon" },
            { value: "halo" as const, label: "Halo" },
            { value: "off" as const, label: "Off" },
          ]}
          onchange={(v) => setPage({ voices: v })}
        />
        <span class="hint">{page.voices === "ink" ? "Dialogue is written in the speaker's ink." : page.voices === "ribbon" ? "A coloured ribbon marks who leads each paragraph." : page.voices === "halo" ? "Dialogue is underlined in the speaker's light." : "One dialogue colour for everyone."} Change someone's colour in the story's Cast.</span>
      </label>
      <label class="switch"><input type="checkbox" checked={page.artifacts} onchange={(e) => setPage({ artifacts: e.currentTarget.checked })} /> Show letters, texts, clippings and other in-story objects as the real thing</label>
      <p class="tiny muted indent">Replies write them when the preset's Artifacts control is on (it is in Mea's own preset).</p>
      <label class="switch"><input type="checkbox" checked={page.window} onchange={(e) => setPage({ window: e.currentTarget.checked })} /> A painted window of the story's time, weather and place in the story panel</label>
      <label class="field narrow">
        <span class="label">Private thoughts under replies</span>
        <select class="select" value={page.thoughts} onchange={(e) => setPage({ thoughts: e.currentTarget.value as LivingPage["thoughts"] })}>
          <option value="drawer">In a folded drawer</option>
          <option value="always">Always open</option>
          <option value="never">Never show</option>
        </select>
      </label>
    </section>

    <section class="panel stack">
      <h2>Lore in messages</h2>
      <label class="switch">
        <input type="checkbox" checked={s["appearance.glossary"] !== false} onchange={(e) => saveSetting("appearance.glossary", e.currentTarget.checked)} />
        Underline lorebook terms and the people and places of the story; tap one to see who or what it is
      </label>
    </section>

    <section class="panel stack">
      <h2>On this device</h2>
      <p class="tiny muted">These stay with this browser, so your phone and your computer can differ.</p>
      <label class="switch"><input type="checkbox" checked={device.spellcheck} onchange={(e) => setDevice("spellcheck", e.currentTarget.checked)} /> Spelling and grammar check in the composer</label>
      <p class="tiny muted indent">Runs on this device (Harper); nothing is sent anywhere. Names from your story count as correct. The checker is about 8 MB and downloads once, the first time.</p>
      <label class="switch"><input type="checkbox" checked={device.discreet} onchange={(e) => setDevice("discreet", e.currentTarget.checked)} /> Discreet mode: blur avatars and previews, and keep notifications vague</label>
      <label class="field narrow">
        <span class="label">Data-light mode</span>
        <select class="select" value={device.dataLight} onchange={(e) => setDevice("dataLight", e.currentTarget.value as "auto" | "on" | "off")}>
          <option value="auto">Auto (data saver or cellular)</option>
          <option value="on">Always</option>
          <option value="off">Never</option>
        </select>
        <span class="hint">Smaller images, loaded as they come into view.</span>
      </label>
      <label class="switch"><input type="checkbox" checked={device.offline} onchange={(e) => setDevice("offline", e.currentTarget.checked)} /> Keep recent chats on this device to read offline</label>
      <p class="tiny muted indent">Messages you write while Mea can't be reached wait here and are sent when it's back. Turning this off also deletes the copies kept so far.</p>
      <label class="switch"><input type="checkbox" checked={device.haptics} onchange={(e) => setDevice("haptics", e.currentTarget.checked)} /> Vibrate a little on send and swipe (Android)</label>
      <label class="switch"><input type="checkbox" checked={device.delights} onchange={(e) => setDevice("delights", e.currentTarget.checked)} /> Small delights: a sparkle when a memory is saved, a heart on bookmarks</label>
    </section>

    <section class="panel stack">
      <h2>App lock</h2>
      {#if lock.enabled}
        <p class="tiny muted">Mea asks for your PIN on this device after it has been in the background for a while.</p>
        <label class="field narrow">
          <span class="label">Lock after</span>
          <select class="select" value={String(device.lockAfter)} onchange={(e) => setDevice("lockAfter", Number(e.currentTarget.value))}>
            <option value="0">Right away</option>
            <option value="1">1 minute</option>
            <option value="5">5 minutes</option>
            <option value="15">15 minutes</option>
            <option value="60">An hour</option>
          </select>
        </label>
        <div class="row wrap">
          {#if biometricsAvailable() && !lock.biometric}<button class="btn small" onclick={addBiometrics}>Use fingerprint or face too</button>{/if}
          {#if lock.biometric}<span class="chip mint">Fingerprint or face on</span>{/if}
          <button class="btn small danger" onclick={turnOffLock}>Turn off</button>
        </div>
      {:else}
        <p class="tiny muted">A PIN for this device, so someone picking up your phone doesn't land in your stories. It's a privacy screen: pairing still decides which devices can reach Mea at all.</p>
        <div class="grid">
          <label class="field"><span class="label">PIN</span><input class="input" type="password" inputmode="numeric" autocomplete="new-password" bind:value={pin} placeholder="4 to 12 digits" /></label>
          <label class="field"><span class="label">Again</span><input class="input" type="password" inputmode="numeric" autocomplete="new-password" bind:value={pin2} /></label>
        </div>
        <div><button class="btn small" onclick={savePin} disabled={pin.length < 4}>Turn on</button></div>
      {/if}
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
  .fonts {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(10.5rem, 1fr));
    gap: 0.5rem;
  }
  .font {
    display: grid;
    gap: 0.15rem;
    text-align: left;
    padding: 0.65rem 0.75rem;
    border-radius: var(--r-md, 14px);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    cursor: pointer;
    font: inherit;
    transition: border-color 0.2s, background 0.2s;
  }
  .font:hover {
    background: var(--surface-2);
  }
  .font.on {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }
  .font .face {
    font-size: 1.15rem;
    line-height: 1.3;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .font b {
    font-size: var(--fs-sm);
  }
  .font .note {
    font-size: var(--fs-xs);
    color: var(--text-muted);
  }
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
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
    gap: 0.8rem;
  }
  .narrow {
    max-width: 12rem;
  }
  .indent {
    margin-top: -0.4rem;
    padding-left: 2.6rem;
  }
  .sample {
    padding: 0.9rem 1rem;
    border-radius: var(--r);
    background: var(--tint-char);
  }
</style>
