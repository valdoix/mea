<script lang="ts">
  import Segmented from "../Segmented.svelte";
  import { DIALOGUE_RANGE, FULL_WIDTH, WIDTH_RANGE, device, dialogueSize, setDevice, stopWidth, widthStop } from "../../lib/device.svelte";
  import { living } from "../../lib/living";
  import { app } from "../../lib/state.svelte";

  // How wide the messages and the box you type in are, and how big the speaker cards are, on this
  // device. Shared by the chat's Display menu and Settings → Appearance so the two never disagree.
  let { full = false }: { full?: boolean } = $props();

  // "Comfortable" follows the reading width in Appearance; the slider starts from there.
  const measure = $derived(Number(app.settings?.["appearance.typography"]?.width) || 46);
  const chatStop = $derived(widthStop(device.chatWidth, measure));
  const chatRem = $derived(device.chatWidth > 0 && device.chatWidth < FULL_WIDTH ? device.chatWidth : measure);
  const composerStop = $derived(device.composerWidth > 0 ? widthStop(device.composerWidth, measure) : chatStop);
  const text = $derived(dialogueSize(device.dialogueText));
  const box = $derived(dialogueSize(device.dialogueBox));
  const voices = $derived(living(app.settings).voices);

  const chatPresets = [
    { value: "38", label: "Narrow" },
    { value: "0", label: "Comfortable" },
    { value: "60", label: "Wide" },
    { value: "100", label: "Full" },
  ];
  const composerPresets = [
    { value: "0", label: "Same" },
    { value: "34", label: "Narrow" },
    { value: "60", label: "Wide" },
    { value: "100", label: "Full" },
  ];

  function widthLabel(w: number, follow: string) {
    if (w >= FULL_WIDTH) return "the whole window";
    if (w > 0) return `${w} rem`;
    return follow;
  }
  const pct = (v: number) => `${Math.round(v * 100)}%`;
</script>

<div class="field">
  <span class="label">Message width <span class="faint">{widthLabel(device.chatWidth, `${measure} rem, the reading width`)}</span></span>
  <Segmented value={String(device.chatWidth)} options={chatPresets} onchange={(v) => setDevice("chatWidth", Number(v))} />
  <input type="range" min={WIDTH_RANGE.min} max={WIDTH_RANGE.max + 1} step="1" value={chatStop} oninput={(e) => setDevice("chatWidth", stopWidth(Number(e.currentTarget.value)))} aria-label="Message width" aria-valuetext={widthLabel(device.chatWidth, `${measure} rem`)} />
  {#if full}<span class="hint">How wide the bubbles and cards run. Comfortable follows the text width under Reading; the last stop is the whole window.</span>{/if}
</div>
<div class="field">
  <span class="label">Typing box width <span class="faint">{widthLabel(device.composerWidth, device.chatWidth >= FULL_WIDTH ? "as the messages: the whole window" : `as the messages: ${chatRem} rem`)}</span></span>
  <Segmented value={String(device.composerWidth)} options={composerPresets} onchange={(v) => setDevice("composerWidth", Number(v))} />
  <input type="range" min={WIDTH_RANGE.min} max={WIDTH_RANGE.max + 1} step="1" value={composerStop} oninput={(e) => setDevice("composerWidth", stopWidth(Number(e.currentTarget.value)))} aria-label="Typing box width" aria-valuetext={widthLabel(device.composerWidth, "as wide as the messages")} />
  {#if full}<span class="hint">Same keeps it as wide as the messages above it.</span>{/if}
</div>
<label class="field">
  <span class="label">Dialogue text <span class="faint">{pct(text)}</span></span>
  <input type="range" min={DIALOGUE_RANGE.min} max={DIALOGUE_RANGE.max} step="0.05" value={text} oninput={(e) => setDevice("dialogueText", Number(e.currentTarget.value))} />
</label>
<label class="field">
  <span class="label">Dialogue boxes <span class="faint">{voices === "off" ? "speaker colours are off" : pct(box)}</span></span>
  <input type="range" min={DIALOGUE_RANGE.min} max={DIALOGUE_RANGE.max} step="0.05" value={box} disabled={voices === "off"} oninput={(e) => setDevice("dialogueBox", Number(e.currentTarget.value))} />
  {#if full}<span class="hint">Text sizes the spoken words wherever they are; boxes size each speaker's card (its padding, medallion and nameplate) without changing the words.</span>{/if}
</label>
{#if text !== 1 || box !== 1}
  <button
    type="button"
    class="btn ghost tiny reset"
    onclick={() => {
      setDevice("dialogueText", 1);
      setDevice("dialogueBox", 1);
    }}>Dialogue back to 100%</button
  >
{/if}

<style>
  .reset {
    justify-self: start;
    margin-top: -0.4rem;
  }
</style>
