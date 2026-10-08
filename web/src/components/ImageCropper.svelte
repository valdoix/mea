<script lang="ts">
  import { loadImage, renderCrop } from "../lib/images";
  import { ZoomIn, ZoomOut } from "../lib/icons";

  let {
    file,
    aspect = 2 / 3,
    outWidth = 768,
    onconfirm,
    oncancel,
  }: { file: Blob; aspect?: number; outWidth?: number; onconfirm: (blob: Blob, img: HTMLImageElement) => void; oncancel: () => void } = $props();

  let img = $state<HTMLImageElement | null>(null);
  let frame = $state<HTMLDivElement | null>(null);
  let frameW = $state(300);
  let scale = $state(1);
  let minScale = $state(1);
  let x = $state(0);
  let y = $state(0);
  let busy = $state(false);
  const frameH = $derived(frameW / aspect);
  const url = $derived(URL.createObjectURL(file));

  $effect(() => {
    let cancelled = false;
    loadImage(file).then((i) => {
      if (cancelled) return;
      img = i;
      fit();
    });
    return () => {
      cancelled = true;
      URL.revokeObjectURL(url);
    };
  });

  function fit() {
    if (!img || !frame) return;
    frameW = frame.clientWidth;
    minScale = Math.max(frameW / img.naturalWidth, frameW / aspect / img.naturalHeight);
    scale = minScale;
    x = (frameW - img.naturalWidth * scale) / 2;
    y = (frameW / aspect - img.naturalHeight * scale) / 2;
  }

  function clamp() {
    if (!img) return;
    const w = img.naturalWidth * scale;
    const h = img.naturalHeight * scale;
    x = Math.min(0, Math.max(frameW - w, x));
    y = Math.min(0, Math.max(frameH - h, y));
  }

  function zoomTo(next: number, cx = frameW / 2, cy = frameH / 2) {
    const s = Math.max(minScale, Math.min(minScale * 6, next));
    x = cx - ((cx - x) * s) / scale;
    y = cy - ((cy - y) * s) / scale;
    scale = s;
    clamp();
  }

  const pointers = new Map<number, { x: number; y: number }>();
  let pinchDist = 0;
  function down(e: PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchDist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
    }
  }
  function move(e: PointerEvent) {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      if (pinchDist) zoomTo((scale * d) / pinchDist);
      pinchDist = d;
    } else {
      x += e.clientX - prev.x;
      y += e.clientY - prev.y;
      clamp();
    }
  }
  function up(e: PointerEvent) {
    pointers.delete(e.pointerId);
    pinchDist = 0;
  }
  function wheel(e: WheelEvent) {
    e.preventDefault();
    const r = frame!.getBoundingClientRect();
    zoomTo(scale * (e.deltaY < 0 ? 1.08 : 0.93), e.clientX - r.left, e.clientY - r.top);
  }

  async function confirm() {
    if (!img) return;
    busy = true;
    const crop = { x: -x / scale, y: -y / scale, w: frameW / scale, h: frameH / scale };
    const outW = Math.min(outWidth, Math.round(crop.w));
    const blob = await renderCrop(img, crop, outW, Math.round(outW / aspect));
    busy = false;
    onconfirm(blob, await loadImage(blob));
  }
</script>

<div class="cropper">
  <div
    class="frame"
    bind:this={frame}
    style:aspect-ratio={aspect}
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
    onwheel={wheel}
    role="presentation"
  >
    {#if img}
      <img src={url} alt="" draggable="false" style:width="{img.naturalWidth * scale}px" style:transform="translate({x}px, {y}px)" />
    {/if}
    <div class="grid" aria-hidden="true"></div>
  </div>
  <div class="row">
    <ZoomOut size={18} class="muted" />
    <input type="range" min={minScale} max={minScale * 6} step="0.001" value={scale} oninput={(e) => zoomTo(Number(e.currentTarget.value))} aria-label="Zoom" />
    <ZoomIn size={18} class="muted" />
  </div>
  <div class="row" style="justify-content:flex-end">
    <button class="btn ghost" onclick={oncancel}>Cancel</button>
    <button class="btn primary" onclick={confirm} disabled={!img || busy}>{busy ? "Saving…" : "Use this crop"}</button>
  </div>
</div>

<style>
  .cropper {
    display: grid;
    gap: 0.9rem;
  }
  .frame {
    position: relative;
    width: min(100%, 22rem);
    margin: 0 auto;
    overflow: hidden;
    border-radius: var(--r);
    background: var(--surface-2);
    touch-action: none;
    cursor: grab;
    user-select: none;
  }
  .frame:active {
    cursor: grabbing;
  }
  img {
    position: absolute;
    top: 0;
    left: 0;
    max-width: none;
    transform-origin: 0 0;
    pointer-events: none;
  }
  .grid {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background:
      linear-gradient(to right, transparent calc(33.33% - 0.5px), rgb(255 255 255 / 45%) calc(33.33% - 0.5px), rgb(255 255 255 / 45%) calc(33.33% + 0.5px), transparent calc(33.33% + 0.5px)),
      linear-gradient(to right, transparent calc(66.66% - 0.5px), rgb(255 255 255 / 45%) calc(66.66% - 0.5px), rgb(255 255 255 / 45%) calc(66.66% + 0.5px), transparent calc(66.66% + 0.5px)),
      linear-gradient(to bottom, transparent calc(33.33% - 0.5px), rgb(255 255 255 / 45%) calc(33.33% - 0.5px), rgb(255 255 255 / 45%) calc(33.33% + 0.5px), transparent calc(33.33% + 0.5px)),
      linear-gradient(to bottom, transparent calc(66.66% - 0.5px), rgb(255 255 255 / 45%) calc(66.66% - 0.5px), rgb(255 255 255 / 45%) calc(66.66% + 0.5px), transparent calc(66.66% + 0.5px));
    box-shadow: inset 0 0 0 2px rgb(255 255 255 / 60%);
    border-radius: var(--r);
  }
</style>
