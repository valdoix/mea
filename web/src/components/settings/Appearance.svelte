<script lang="ts">
  import RoomColors from "./RoomColors.svelte";
  import Segmented from "../Segmented.svelte";
  import { biometricsAvailable, lock, removeLock, setPin, setupBiometrics } from "../../lib/applock.svelte";
  import { confirm } from "../../lib/dialogs.svelte";
  import { PORTRAIT_RANGE, device, portraitWidth, setDevice } from "../../lib/device.svelte";
  import { app, errorToast, saveSetting, setLayout, toast } from "../../lib/state.svelte";
  import FontPicker from "./FontPicker.svelte";
  import { DISPLAY_FONTS, STORY_FONTS, UI_FONTS } from "../../lib/fontcatalog";
  import { LAYOUTS } from "../../lib/layouts";
  import { living } from "../../lib/living";
  import { THEMES, isRoom, loadThemeFonts, loadThemeStyles, themeInfo } from "../../lib/themes";
  import { onMount } from "svelte";
  import type { LivingPage, Typography } from "../../lib/types";

  const s = $derived(app.settings);
  // The picker shows each room in its own type, and a room you pick is dressed the moment you pick it.
  onMount(() => THEMES.forEach((t) => isRoom(t.id) && (loadThemeFonts(t.id), void loadThemeStyles(t.id))));
  const drifting = $derived(
    ({ lantern: "Fireflies drifting in the night sky", wildflower: "Petals falling and a butterfly passing through", overprint: "Ink circles drifting slowly out of register", citadel: app.night ? "Snow falling past the window, and rising embers" : "Candlelight flickering on the vellum", marquee: "Searchlights sweeping and signs flickering", sugarrush: "Sprinkles falling and gumdrops bobbing", arcade: app.night ? "A vector grid rolling in, and pixel invaders" : "Pixel sprites drifting past the cabinet", noir: app.night ? "Smoke drifting and champagne rising" : "A gilt sunburst turning, and champagne rising", rosewater: "Folds of silk drifting through soft light", meringue: app.night ? "Fairy lights twinkling and soft lights floating up" : "Clouds drifting and soft lights floating up", menagerie: app.night ? "Candles flickering and gold dust in the lamplight" : "Gold dust turning in the lamplight", nighttrain: "The country sliding past the window", weatherglass: "Rain, snow, fog and storm moving across the sky", deepend: app.night ? "Plankton drifting and scattering from your cursor" : "Sunlight rippling and bubbles rising", floatingworld: "Rain, waves and a crane crossing the print", vesper: "Coloured light breathing across the stone", caravanserai: app.night ? "The stars turning and a tent glowing" : "Heat shimmering over the dunes", aphelion: "A planet drifting and stars twinkling", form: "Shapes changing places" } as Record<string, string>)[app.theme] ?? "Drifting lights",
  );
  const texture = $derived(
    ({ lantern: "A whisper of film grain", wildflower: "A little watercolour paper", overprint: "Print grain and halftone dots", citadel: "Mottled vellum", marquee: "A brick wall behind the signs", sugarrush: "A candy-striped awning and sugar dust", arcade: app.night ? "Scanlines on the glass" : "Woodgrain cabinet sides", noir: "Gold pinstripes and Deco fans", rosewater: "Gold-leaf flecks", meringue: "A faint gingham at the edges", menagerie: "Chintz on the walls", nighttrain: "A little paper grain on the walls", floatingworld: "Washi paper fibres", vesper: "Grain in the stone", caravanserai: "A little sand in the air" } as Record<string, string>)[app.theme] ?? "A whisper of film grain",
  );
  const LAYOUT_NOTES = {
    classic: "A slim rail, a floating chat and a side panel for memory, story and world.",
    folio: "Mea's notes sit beside the line they came from. Pull one out and it becomes a column; save an arrangement as a workspace.",
    stage: "The place, hour, weather, music and cast in a band above the story, a director's desk beside it, and a river of the whole story below.",
  };
  const page = $derived(living(s));
  const VOICE_HINTS: Record<LivingPage["voices"], string> = {
    blocks: "A paragraph that opens on someone's line becomes their voice card: a medallion, a nameplate and a bubble that shows how it was said. A line mid-narration is a chip.",
    chips: "Each line is a pill with its speaker's initial; the prose flows on untouched.",
    tint: "Dialogue is coloured and underlined in the speaker's colour.",
    script: "A screenplay: the speaker's name beside the line, and how it was said under it.",
    ink: "Dialogue is written in the speaker's ink.",
    ribbon: "A coloured ribbon marks who leads each paragraph.",
    halo: "Dialogue is underlined in the speaker's light.",
    off: "One dialogue colour for everyone, and replies aren't asked to mark speakers.",
  };
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
  // M6: changing or turning off the lock asks for the PIN in use.
  let currentPin = $state("");
  let changing = $state(false);
  async function savePin() {
    if (!/^\d{4,12}$/.test(pin)) return toast("Use 4 to 12 digits", { kind: "error" });
    if (pin !== pin2) return toast("The two PINs don't match", { kind: "error" });
    const wasOn = lock.enabled;
    if (!(await setPin(pin, currentPin))) return toast("That isn't the current PIN", { kind: "error" });
    pin = pin2 = currentPin = "";
    changing = false;
    toast(wasOn ? "PIN changed" : "App lock is on for this device", { kind: "ok" });
  }
  async function turnOffLock() {
    if (!currentPin) return toast("Enter the current PIN first", { kind: "error" });
    if (!(await confirm({ title: "Turn the app lock off?", message: "Mea opens on this device without a PIN again.", confirmLabel: "Turn off" }))) return;
    if (!(await removeLock(currentPin))) return toast("That isn't the current PIN", { kind: "error" });
    currentPin = "";
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
      <div class="themes" role="radiogroup" aria-label="Theme">
        {#each THEMES as t (t.id)}
          {@const on = s["appearance.theme"] === t.id}
          <button class="theme t-{t.id}" class:on role="radio" aria-checked={on} onclick={() => saveSetting("appearance.theme", t.id)}>
            <span class="preview" aria-hidden="true">
              <span class="half day" style:background={t.swatch.day[0]}>{#each t.swatch.day.slice(1) as c, i (i)}<i style:background={c}></i>{/each}</span>
              <span class="half night" style:background={t.swatch.night[0]}>{#each t.swatch.night.slice(1) as c, i (i)}<i style:background={c}></i>{/each}</span>
              <span class="tname">{t.name}</span>
            </span>
            <b>{t.name}</b>
            <span class="note">{t.motto}</span>
            {#if t.day}<span class="note faint">{t.day} by day · {t.night} by night</span>{:else}<span class="note faint">Always night</span>{/if}
          </button>
        {/each}
      </div>
      {#if isRoom(app.theme)}
        {@const info = themeInfo(app.theme)}
        <div class="field">
          <span class="label">Day or night</span>
          <Segmented
            value={s["appearance.themeMode"] ?? "system"}
            options={[
              { value: "system", label: "Match my device" },
              { value: "day", label: info?.day ?? "Day" },
              { value: "night", label: info?.night ?? "Night" },
            ]}
            onchange={(v) => saveSetting("appearance.themeMode", v)}
          />
        </div>
      {/if}
      <details class="colors">
        <summary class="small"><b>Customise colours</b> <span class="muted">for this room, by day and by night</span></summary>
        <RoomColors />
      </details>
    </section>

    <section class="panel stack">
      <h2>Layout</h2>
      <div class="layouts" role="radiogroup" aria-label="Layout">
        {#each LAYOUTS as l (l.id)}
          {@const on = app.layout === l.id}
          <button class="layout" class:on role="radio" aria-checked={on} onclick={() => setLayout(l.id)}>
            <span class="lay-pic {l.id}" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
            <b>{l.name}</b>
            <span class="note">{l.motto}</span>
            <span class="note faint">{LAYOUT_NOTES[l.id]}</span>
          </button>
        {/each}
      </div>
      <p class="tiny muted">Every theme fits every layout. Folio and Stage start you on the Book chat style; you can change it below, and Classic gets its own style back.</p>
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
      <div class="field">
        <span class="label">Portraits <span class="faint">{portraitWidth()} px wide, on this device</span></span>
        <Segmented
          value={device.portrait}
          options={[
            { value: "small", label: "Small" },
            { value: "large", label: "Large" },
            { value: "grand", label: "Grand" },
            { value: "towering", label: "Towering" },
            { value: "custom", label: "Custom" },
          ]}
          onchange={(v) => setDevice("portrait", v)}
        />
        {#if device.portrait === "custom"}
          <input type="range" min={PORTRAIT_RANGE.min} max={PORTRAIT_RANGE.max} step="4" value={portraitWidth()} oninput={(e) => setDevice("portraitPx", Number(e.currentTarget.value))} aria-label="Portrait width" />
        {/if}
        <span class="hint">On a phone they stay small beside each message.</span>
      </div>
      <div class="field">
        <span class="label">Portrait frame <span class="faint">on cards, on this device</span></span>
        <Segmented
          value={device.portraitFrame}
          options={[
            { value: "room", label: "The room's" },
            { value: "holo", label: "Holo card" },
            { value: "polaroid", label: "Polaroid" },
            { value: "cameo", label: "Cameo" },
          ]}
          onchange={(v) => setDevice("portraitFrame", v)}
        />
        <span class="hint">A holographic trading card, a taped polaroid with the name written under it, or a gilded cameo with a ribbon.</span>
      </div>
      <div class="grid">
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

    <section class="panel stack">
      <h2>Atmosphere</h2>
      <label class="switch"><input type="checkbox" checked={device.fireflies} onchange={(e) => setDevice("fireflies", e.currentTarget.checked)} /> {drifting}</label>
      <label class="switch"><input type="checkbox" checked={device.grain} onchange={(e) => setDevice("grain", e.currentTarget.checked)} /> {texture}</label>
      {#if app.theme === "weatherglass"}
        <div class="field">
          <span class="label">The sky</span>
          <Segmented value={device.roomWeather} options={[{ value: "scene", label: "From the story" }, { value: "fair", label: "Fair" }, { value: "cloudy", label: "Cloud" }, { value: "rain", label: "Rain" }, { value: "fog", label: "Fog" }, { value: "snow", label: "Snow" }, { value: "storm", label: "Storm" }]} onchange={(v) => setDevice("roomWeather", v as typeof device.roomWeather)} />
        </div>
      {/if}
      <p class="tiny muted">Both stay on this device. If your system asks for less motion, Mea keeps everything still.</p>
    </section>

    <section class="panel stack">
      <h2>Reading</h2>
      <FontPicker label="Story font" fonts={STORY_FONTS} value={s["appearance.storyFont"]} sample="“Stay,” she said. Aa" onpick={(id) => saveSetting("appearance.storyFont", id)} />
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
      <FontPicker label="Heading font" fonts={DISPLAY_FONTS} value={typo.displayFont ?? "theme"} sample="Chapter One" onpick={(id) => setTypo({ displayFont: id })} />
      <FontPicker label="Interface font" fonts={UI_FONTS} value={typo.uiFont} sample="Settings · Aa" onpick={(id) => setTypo({ uiFont: id })} />
      <label class="switch"><input type="checkbox" checked={typo.dyslexic} onchange={(e) => setTypo({ dyslexic: e.currentTarget.checked })} /> Dyslexia-friendly font (OpenDyslexic) everywhere</label>
      <div class="sample prose">
        <p>The lamp flickers as the wind presses against the old glass. <span class="dl">“You came back,”</span> she says softly. <em>Outside, the sea keeps its patient rhythm.</em></p>
      </div>
    </section>

    <section class="panel stack">
      <h2>The living page</h2>
      <p class="tiny muted">Drawn by Mea from the story itself. Only speaker colours reach the model: replies are asked to mark who says each line, and the marks never show.</p>
      <label class="field narrow">
        <span class="label">Speaker colours <span class="faint">each character's lines in their own colour</span></span>
        <select class="select" value={page.voices} onchange={(e) => setPage({ voices: e.currentTarget.value as LivingPage["voices"] })}>
          <option value="blocks">Blocks: voice cards</option>
          <option value="chips">Chips</option>
          <option value="tint">Tint</option>
          <option value="script">Script</option>
          <option value="ink">Ink</option>
          <option value="ribbon">Ribbon</option>
          <option value="halo">Halo</option>
          <option value="off">Off</option>
        </select>
        <span class="hint">{VOICE_HINTS[page.voices]} Change someone's colour in the story's Cast.</span>
      </label>
      <label class="field narrow">
        <span class="label">The visual toolkit <span class="faint">letters, screens, minds, spells…</span></span>
        <select
          class="select"
          value={!page.artifacts ? "off" : page.freeform === false ? "mea" : "all"}
          onchange={(e) => {
            const v = e.currentTarget.value;
            setPage({ artifacts: v !== "off", freeform: v === "all" });
          }}
        >
          <option value="all">Everything</option>
          <option value="mea">Mea's pieces only</option>
          <option value="off">Off: plain words</option>
        </select>
        <span class="hint">{page.artifacts === false ? "Shown as plain words." : page.freeform === false ? "Visuals the model designs itself show as their words." : "Mea's pieces and the model's own designs."} How often they come is the chat's Toolkit rhythm; the model designs its own on Wild.</span>
      </label>
      <label class="switch"><input type="checkbox" checked={page.window} onchange={(e) => setPage({ window: e.currentTarget.checked })} /> A painted window of the story's time, weather and place in the story panel</label>
      <label class="field narrow">
        <span class="label">Private thoughts under replies</span>
        <select class="select" value={page.thoughts} onchange={(e) => setPage({ thoughts: e.currentTarget.value as LivingPage["thoughts"] })}>
          <option value="drawer">In a folded drawer</option>
          <option value="always">Always open</option>
          <option value="never">Never show</option>
        </select>
      </label>
      <label class="field narrow">
        <span class="label">The plan above each reply</span>
        <select class="select" value={page.plan ?? "drawer"} onchange={(e) => setPage({ plan: e.currentTarget.value as NonNullable<LivingPage["plan"]> })}>
          <option value="drawer">In a folded drawer</option>
          <option value="always">Always open</option>
        </select>
        <span class="hint">Every reply is planned first; this only changes how the plan shows.</span>
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
        <label class="field narrow"><span class="label">Current PIN</span><input class="input" type="password" inputmode="numeric" autocomplete="current-password" bind:value={currentPin} placeholder="Needed to change or turn off" /></label>
        {#if changing}
          <div class="grid">
            <label class="field"><span class="label">New PIN</span><input class="input" type="password" inputmode="numeric" autocomplete="new-password" bind:value={pin} placeholder="4 to 12 digits" /></label>
            <label class="field"><span class="label">Again</span><input class="input" type="password" inputmode="numeric" autocomplete="new-password" bind:value={pin2} /></label>
          </div>
        {/if}
        <div class="row wrap">
          {#if biometricsAvailable() && !lock.biometric}<button class="btn small" onclick={addBiometrics}>Use fingerprint or face too</button>{/if}
          {#if lock.biometric}<span class="chip mint">Fingerprint or face on</span>{/if}
          {#if changing}
            <button class="btn small" onclick={savePin} disabled={pin.length < 4 || currentPin.length < 4}>Save new PIN</button>
            <button class="btn small ghost" onclick={() => ((changing = false), (pin = pin2 = ""))}>Cancel</button>
          {:else}
            <button class="btn small" onclick={() => (changing = true)}>Change PIN</button>
          {/if}
          <button class="btn small danger" onclick={turnOffLock} disabled={currentPin.length < 4}>Turn off</button>
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
  .layouts {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
    gap: 0.7rem;
  }
  .layout {
    display: grid;
    gap: 0.2rem;
    align-content: start;
    text-align: left;
    padding: 0.6rem 0.6rem 0.8rem;
    border-radius: calc(var(--r) + 2px);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    cursor: pointer;
    font: inherit;
  }
  .layout.on {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent), 0 10px 26px -14px var(--accent);
  }
  .layout b {
    margin-top: 0.4rem;
    font-size: var(--fs-sm);
  }
  .layout .note {
    font-size: var(--fs-xs);
    color: var(--text-muted);
  }
  .layout .note.faint {
    color: var(--text-faint);
  }
  /* A small drawing of each arrangement, in the theme's own colours. */
  .lay-pic {
    display: grid;
    gap: 3px;
    height: 5.2rem;
    padding: 5px;
    border-radius: var(--r);
    background: var(--surface-2);
  }
  .lay-pic i {
    border-radius: 3px;
    background: color-mix(in srgb, var(--text) 14%, transparent);
  }
  .lay-pic.classic {
    grid-template-columns: 8% 1fr 28%;
    grid-template-rows: 1fr 18%;
  }
  .lay-pic.classic i:nth-child(1) {
    grid-row: 1 / -1;
  }
  .lay-pic.classic i:nth-child(2) {
    grid-column: 2;
    background: color-mix(in srgb, var(--accent) 35%, transparent);
  }
  .lay-pic.classic i:nth-child(3) {
    grid-column: 3;
    grid-row: 1 / -1;
  }
  .lay-pic.classic i:nth-child(4) {
    grid-column: 2;
    grid-row: 2;
  }
  .lay-pic.folio {
    grid-template-columns: 8% 1fr 22% 22%;
    grid-template-rows: 1fr;
  }
  .lay-pic.folio i:nth-child(2) {
    background: color-mix(in srgb, var(--accent) 35%, transparent);
  }
  .lay-pic.stage {
    grid-template-columns: 8% 1fr 24%;
    grid-template-rows: 38% 1fr 12%;
  }
  .lay-pic.stage i:nth-child(1) {
    grid-row: 1 / -1;
    background: color-mix(in srgb, var(--text) 45%, transparent);
  }
  .lay-pic.stage i:nth-child(2) {
    grid-column: 2 / -1;
    background: color-mix(in srgb, var(--text) 45%, transparent);
  }
  .lay-pic.stage i:nth-child(3) {
    grid-column: 2;
    grid-row: 2;
    background: color-mix(in srgb, var(--accent) 35%, transparent);
  }
  .lay-pic.stage i:nth-child(4) {
    grid-column: 3;
    grid-row: 2;
  }
  .themes {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(11.5rem, 1fr));
    gap: 0.7rem;
  }
  .theme {
    display: grid;
    gap: 0.2rem;
    align-content: start;
    text-align: left;
    padding: 0.5rem 0.5rem 0.75rem;
    border-radius: calc(var(--r) + 2px);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    cursor: pointer;
    font: inherit;
    transition:
      border-color 0.2s,
      transform 0.3s var(--spring),
      box-shadow 0.3s;
  }
  .theme:hover {
    transform: translateY(-2px);
  }
  .theme.on {
    border-color: var(--accent);
    box-shadow:
      0 0 0 1px var(--accent),
      0 10px 26px -14px var(--accent);
  }
  .theme b,
  .theme .note {
    padding: 0 0.3rem;
  }
  .theme b {
    margin-top: 0.35rem;
    font-size: var(--fs-sm);
  }
  .theme .note {
    font-size: var(--fs-xs);
    color: var(--text-muted);
  }
  .theme .note.faint {
    color: var(--text-faint);
  }
  .preview {
    position: relative;
    display: grid;
    grid-template-columns: 1fr 1fr;
    height: 5.2rem;
    border-radius: var(--r);
    overflow: hidden;
    box-shadow: inset 0 0 0 1px rgb(0 0 0 / 8%);
  }
  .half {
    display: flex;
    align-items: flex-end;
    gap: 3px;
    padding: 0.5rem;
  }
  .half i {
    width: 0.8rem;
    height: 0.8rem;
    border-radius: 50%;
    box-shadow: 0 0 0 1.5px rgb(255 255 255 / 25%);
  }
  .tname {
    position: absolute;
    left: 50%;
    top: 50%;
    translate: -50% -62%;
    padding: 0.15rem 0.6rem 0.2rem;
    border-radius: 9px;
    white-space: nowrap;
    background: #1c1530;
    box-shadow: 0 4px 14px -6px rgb(0 0 0 / 50%);
    text-align: center;
    font-size: 1.35rem;
    line-height: 1.1;
    color: #fff;
    text-shadow: 0 1px 8px rgb(0 0 0 / 45%);
  }
  .t-lantern .tname {
    font-family: "Instrument Serif", Georgia, serif;
    font-style: italic;
    color: #ffd08f;
  }
  .t-wildflower .tname {
    font: italic 600 1.4rem "Cormorant Garamond Variable", Georgia, serif;
    color: #a8305f;
    text-shadow: none;
    background: #fffbfa;
    box-shadow: 0 0 0 1.5px #f7b9cf, 0 4px 14px -6px rgb(176 52 106 / 40%);
  }
  .t-overprint .tname {
    font: 800 1.25rem "Bricolage Grotesque Variable", sans-serif;
    letter-spacing: -0.03em;
    color: #1d2763;
    text-shadow: 2px 1.5px 0 #ff4fb3;
    background: #fbf8ef;
    border-radius: 6px;
    box-shadow: 0 0 0 2px #1d2763, 3px 3px 0 2px #3a5bd9;
  }
  .t-citadel .tname {
    font: 700 1.1rem "Cinzel Decorative", Georgia, serif;
    color: #d9b765;
    text-shadow: none;
    background: #2e2b29;
    border-radius: 2px;
    box-shadow: inset 0 0 0 2px #2e2b29, inset 0 0 0 3px #b08a3a;
  }
  .t-sugarrush .tname {
    font: 400 1.6rem/1 "Chewy", cursive;
    color: #ff4f93;
    text-shadow: 2px 2px 0 #fff8ef, 3px 3px 0 #ffb3cd;
    background: #fff4f8;
    border-radius: 999px;
    box-shadow: 0 0 0 2px #9fe8cf, 0 4px 0 #ffb3cd;
  }
  .t-arcade .tname {
    font: 700 0.78rem/1.15 "Silkscreen", monospace;
    white-space: normal;
    width: 86%;
    color: #ffb000;
    text-shadow: 0 0 8px #ffb000;
    background: #0c0805;
    border-radius: 2px;
    box-shadow: 0 0 0 2px #d9531e, 4px 4px 0 2px #5f8a1f;
  }
  .t-nighttrain .tname {
    font: 700 0.95rem/1.1 "B612 Mono", monospace;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #f7e6bc;
    text-shadow: none;
    background: #1c1714;
    border-radius: 3px;
    box-shadow: 0 0 0 2px #b98a35;
  }
  .t-weatherglass .tname {
    font: 600 1.25rem/1.1 "Newsreader Variable", serif;
    color: #ecd08a;
    text-shadow: none;
    background: #2c4150;
    border-radius: 99px;
    box-shadow: inset 0 0 0 1.5px #c49a4a;
  }
  .t-deepend .tname {
    font: 700 1.25rem/1.1 "Outfit Variable", sans-serif;
    letter-spacing: -0.02em;
    color: #03303c;
    text-shadow: none;
    background: radial-gradient(circle at 32% 26%, #fff, #7ff5e0 70%);
    border-radius: 99px;
  }
  .t-floatingworld .tname {
    font: 800 1.2rem/1.1 "Shippori Mincho", serif;
    color: #fff4e0;
    text-shadow: none;
    background: #1e3a68;
    border-radius: 0;
    box-shadow: 3px 3px 0 #b83227;
  }
  .t-vesper .tname {
    font: 700 1.3rem/1.1 "Cormorant Unicase", serif;
    color: #fff8e6;
    text-shadow: none;
    background: #a51c30;
    border-radius: 12px 12px 2px 2px;
    box-shadow: 0 0 0 2.5px #17120e;
  }
  .t-caravanserai .tname {
    font: 700 1.25rem/1.1 "El Messiri", serif;
    color: #fff8e7;
    text-shadow: none;
    background: #a84720;
    border-radius: 22px 22px 3px 3px;
    box-shadow: 0 0 0 2px #d99a2b;
  }
  .t-aphelion .tname {
    font: 700 1.2rem/1.1 "Saira Condensed", sans-serif;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: #5fe6ff;
    text-shadow: none;
    background: #02050a;
    border-radius: 0;
    box-shadow: inset 2px 0 0 #5fe6ff;
  }
  .t-form .tname {
    font: 900 1.5rem/1 "Jost Variable", sans-serif;
    letter-spacing: -0.04em;
    text-transform: lowercase;
    color: #fff;
    text-shadow: none;
    background: #d2271c;
    border-radius: 0;
  }
  .t-noir .tname {
    font: 400 1.3rem/1.1 "Limelight", serif;
    letter-spacing: 0.04em;
    color: #f2d896;
    text-shadow: none;
    background: #0e0d0b;
    border-radius: 0;
    box-shadow: inset 0 0 0 1px #c9a45a, inset 0 0 0 3px #0e0d0b, inset 0 0 0 4px #c9a45a;
  }
  .t-rosewater .tname {
    font: italic 400 1.45rem/1.1 "Playfair Display Variable", serif;
    color: #b07a3a;
    text-shadow: none;
    background: linear-gradient(135deg, #fffaf6, #fbe3e6);
    border-radius: 999px;
    box-shadow: 0 0 0 1px #d8b27a, 0 6px 16px -6px rgb(160 60 90 / 45%);
  }
  .t-meringue .tname {
    font: 400 1.35rem/1.1 "Young Serif", serif;
    color: #b8507a;
    text-shadow: none;
    background: #fffaf5;
    border-radius: 999px;
    box-shadow: 0 0 0 2px #f2a7c0, 0 0 0 4px #fffaf5, 0 0 0 5.5px #9fd6bd;
  }
  .t-menagerie .tname {
    font: italic 900 1.4rem/1.1 "Playfair Display Variable", serif;
    color: #f7e6ad;
    text-shadow: none;
    background: #6a1c22;
    border-radius: 2px;
    box-shadow: inset 0 0 0 1px #c99a3e, inset 0 0 0 3px #6a1c22, inset 0 0 0 4px #c99a3e, 0 0 0 2px #1f5a45;
  }
  .t-marquee .tname {
    font: 400 1.9rem/1 "Neonderthaw", cursive;
    color: #ffe0f2;
    text-shadow: 0 0 4px #ff4fb0, 0 0 12px #ff4fb0, 0 0 24px #ff4fb0;
    background: #0f0d1a;
    box-shadow: 0 0 0 1.5px #3ee8ff, 0 0 14px #3ee8ff;
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
