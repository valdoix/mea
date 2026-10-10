<script lang="ts">
  /**
   * A rotary knob: drag up or down, use the arrow keys, or scroll on it once it has focus.
   * `onchange` fires on every step; callers debounce their saves.
   */
  let {
    label,
    value,
    min,
    max,
    step = 1,
    format = (v: number) => String(v),
    disabled = false,
    onchange,
  }: { label: string; value: number; min: number; max: number; step?: number; format?: (v: number) => string; disabled?: boolean; onchange: (v: number) => void } = $props();

  let svg = $state<SVGSVGElement | null>(null);
  const steps = $derived(Math.max(1, Math.round((max - min) / step)));
  const clamp = (v: number) => Math.max(min, Math.min(max, Math.round((v - min) / step) * step + min));
  const t = $derived((clamp(value) - min) / (max - min || 1));
  const ticks = $derived(
    Array.from({ length: 21 }, (_, k) => {
      const a = ((-135 + (k / 20) * 270 - 90) * Math.PI) / 180;
      const r2 = k % 5 ? 26.5 : 25;
      return { on: k / 20 <= t + 0.001, x1: 32 + 29 * Math.cos(a), y1: 32 + 29 * Math.sin(a), x2: 32 + r2 * Math.cos(a), y2: 32 + r2 * Math.sin(a) };
    }),
  );

  function set(v: number) {
    const next = Number(clamp(v).toFixed(4));
    if (next !== value) onchange(next);
  }
  let startY = 0;
  let startV = 0;
  /** Fine enough to hit every step, never slower than ~3px per step. */
  const perStep = $derived(Math.max(3, Math.min(12, 160 / steps)));
  function down(e: PointerEvent) {
    if (disabled || e.button) return;
    svg!.setPointerCapture(e.pointerId);
    svg!.focus();
    startY = e.clientY;
    startV = value;
  }
  function move(e: PointerEvent) {
    if (!svg!.hasPointerCapture(e.pointerId)) return;
    set(startV + Math.round((startY - e.clientY) / perStep) * step);
  }
  function key(e: KeyboardEvent) {
    if (disabled) return;
    const big = Math.max(step, Math.round(steps / 10) * step);
    if (e.key === "ArrowUp" || e.key === "ArrowRight") set(value + step);
    else if (e.key === "ArrowDown" || e.key === "ArrowLeft") set(value - step);
    else if (e.key === "PageUp") set(value + big);
    else if (e.key === "PageDown") set(value - big);
    else if (e.key === "Home") set(min);
    else if (e.key === "End") set(max);
    else return;
    e.preventDefault();
  }
  $effect(() => {
    const el = svg;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (disabled || document.activeElement !== el) return;
      e.preventDefault();
      set(value + (e.deltaY < 0 ? step : -step));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  });
</script>

<div class="st-knob">
  <svg
    bind:this={svg}
    viewBox="0 0 64 64"
    role="slider"
    tabindex={disabled ? -1 : 0}
    aria-label={label}
    aria-valuemin={min}
    aria-valuemax={max}
    aria-valuenow={value}
    aria-valuetext={format(value)}
    aria-disabled={disabled}
    onpointerdown={down}
    onpointermove={move}
    onkeydown={key}
  >
    <g class="st-ring">{#each ticks as k, i (i)}<line class:on={k.on} x1={k.x1} y1={k.y1} x2={k.x2} y2={k.y2} />{/each}</g>
    <circle class="st-kcap" cx="32" cy="32" r="20" />
    <circle class="st-kin" cx="32" cy="32" r="15" />
    <line class="st-ptr" x1="32" y1="32" x2="32" y2="17" transform="rotate({-135 + t * 270} 32 32)" />
  </svg>
  <output>{format(value)}</output>
  <small>{label}</small>
</div>
