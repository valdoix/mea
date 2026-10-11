<script lang="ts" module>
  /** J1: the kinds of place a plate can draw. */
  export const PLACE_KINDS = [
    { id: "street", label: "Street or town" },
    { id: "forest", label: "Forest" },
    { id: "tavern", label: "Tavern or bar" },
    { id: "bedroom", label: "Bedroom or room" },
    { id: "castle", label: "Castle" },
    { id: "shore", label: "Shore" },
    { id: "harbor", label: "Harbour" },
    { id: "desert", label: "Desert" },
    { id: "hills", label: "Open country" },
  ] as const;
  export type PlaceKind = (typeof PLACE_KINDS)[number]["id"];
</script>

<script lang="ts">
  import { readPlace, readWeather, skyColors } from "../../lib/scenery";
  import { Ellipsis } from "../../lib/icons";
  import Menu, { type MenuItem } from "../Menu.svelte";

  /**
   * J1: a drawn header for a scene: the place as a silhouette, the sky at the scene's hour and its
   * weather, framed in the room's colours. Procedural (seeded by the place, so a place always looks
   * the same); the current scene's plate follows the clock. ⋯ › This place is… corrects the kind.
   */
  let { place, weather, hour, kind = null, title = "", onkind }: { place: string[]; weather: string | null; hour: number | null; kind?: PlaceKind | null; title?: string; onkind?: (name: string, kind: PlaceKind) => void } = $props();

  const name = $derived(place.at(-1) ?? "");
  const k = $derived<PlaceKind>(kind ?? kindOf(place));
  const h = $derived(hour ?? 20);
  const wx = $derived(readWeather(weather));
  const [top, bottom] = $derived(skyColors(h));
  const night = $derived(h < 5.5 || h > 20);
  const dusk = $derived(!night && (h < 7.5 || h > 18));
  const ink = $derived(night ? "#0a0814" : dusk ? "#1c1426" : "#2a2238");
  const ink2 = $derived(night ? "#151024" : dusk ? "#2c2038" : "#3d3250");
  const interior = $derived(k === "tavern" || k === "bedroom");

  function kindOf(path: string[]): PlaceKind {
    const t = path.join(" ").toLowerCase();
    if (/tavern|\binn\b|\bbar\b|\bpub\b|saloon|alehouse|club|bronze|caf[eé]|kitchen|hall\b/.test(t)) return "tavern";
    if (/bedroom|\bbed\b|chamber|quarters|\broom\b|bunk|cell\b|study|attic|lamp room|apartment|flat\b/.test(t)) return "bedroom";
    const p = readPlace(path);
    return p === "coast" ? "shore" : p === "city" ? "street" : p === "harbor" ? "harbor" : p;
  }

  // A seeded random, so the same place always draws the same.
  const seedOf = (s: string) => [...s].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const rnd = $derived.by(() => {
    let x = seedOf(`${k}:${name}`) || 1;
    return () => ((x = (x * 16807) % 2147483647) - 1) / 2147483646;
  });
  const shapes = $derived.by(() => {
    const r = rnd;
    const W = 600;
    const out: { d?: string; rect?: [number, number, number, number]; c?: [number, number, number]; fill: string; o?: number }[] = [];
    const hills = (base: number, amp: number, fill: string, o = 1) => {
      let d = `M0 150 L0 ${base}`;
      for (let x = 0; x <= W; x += 30) d += ` L${x} ${base - Math.sin(x / 90 + r() * 2) * amp - r() * amp * 0.4}`;
      out.push({ d: `${d} L${W} 150 Z`, fill, o });
    };
    if (k === "hills" || k === "forest" || k === "castle") hills(118, 14, ink2);
    if (k === "forest") {
      hills(128, 6, ink);
      for (let i = 0; i < 34; i++) {
        const x = r() * W;
        const th = 26 + r() * 34;
        out.push({ d: `M${x} ${136 - th} L${x - 9 - r() * 6} 136 L${x + 9 + r() * 6} 136 Z`, fill: ink });
      }
    }
    if (k === "castle") {
      hills(130, 8, ink);
      const cx = 250 + r() * 100;
      out.push({ rect: [cx - 60, 78, 120, 52], fill: ink });
      for (const dx of [-70, -20, 30, 60]) out.push({ rect: [cx + dx, 60 - r() * 12, 18, 70], fill: ink });
      for (let x = cx - 60; x < cx + 60; x += 12) out.push({ rect: [x, 72, 7, 7], fill: ink });
      out.push({ d: `M${cx - 4} 44 L${cx - 4} 60 L${cx + 14} 52 Z`, fill: ink });
    }
    if (k === "shore" || k === "harbor") {
      out.push({ rect: [0, 112, W, 38], fill: night ? "#0d1430" : "#1e3a5e", o: 0.95 });
      for (let i = 0; i < 8; i++) out.push({ rect: [r() * W, 116 + r() * 30, 30 + r() * 60, 1.5], fill: "#ffffff", o: night ? 0.08 : 0.18 });
      if (k === "shore") {
        const lx = 470 + r() * 60;
        out.push({ d: `M${lx - 40} 150 L${lx - 30} 112 L${lx + 50} 108 L${lx + 70} 150 Z`, fill: ink });
        out.push({ d: `M${lx} 112 L${lx + 4} 52 L${lx + 16} 52 L${lx + 20} 112 Z`, fill: ink });
        out.push({ rect: [lx + 1, 44, 18, 9], fill: ink });
        if (night || dusk) out.push({ c: [lx + 10, 48, 5], fill: "#ffd890", o: 0.95 });
      } else {
        out.push({ rect: [0, 106, 220, 8], fill: ink });
        for (let x = 10; x < 220; x += 26) out.push({ rect: [x, 106, 3, 28], fill: ink });
        for (let i = 0; i < 3; i++) {
          const bx = 260 + i * 90 + r() * 30;
          out.push({ d: `M${bx} 120 L${bx + 50} 120 L${bx + 42} 130 L${bx + 8} 130 Z`, fill: ink });
          out.push({ rect: [bx + 22, 70 + r() * 12, 2.5, 50], fill: ink });
        }
      }
    }
    if (k === "street") {
      for (let x = 0; x < W; ) {
        const w = 40 + r() * 60;
        const hh = 40 + r() * 70;
        out.push({ rect: [x, 150 - hh, w - 3, hh], fill: r() > 0.5 ? ink : ink2 });
        if (night || dusk) for (let wy = 150 - hh + 8; wy < 140; wy += 12) for (let wxp = x + 6; wxp < x + w - 10; wxp += 11) if (r() > 0.55) out.push({ rect: [wxp, wy, 5, 6], fill: "#ffd890", o: 0.55 + r() * 0.4 });
        x += w;
      }
    }
    if (k === "desert") {
      hills(122, 10, "#5a3a2a", night ? 0.6 : 0.9);
      hills(134, 6, ink);
    }
    return out;
  });
  const precip = $derived.by(() => {
    const r = rnd;
    if (wx !== "rain" && wx !== "storm" && wx !== "snow") return [];
    return Array.from({ length: wx === "snow" ? 70 : 90 }, () => ({ x: r() * 600, y: r() * 150, l: 6 + r() * 8 }));
  });
  const clouds = $derived.by(() => {
    const r = rnd;
    const n = wx === "clear" ? 2 : wx === "wind" ? 4 : 7;
    return Array.from({ length: n }, () => ({ x: r() * 600, y: 12 + r() * 40, w: 60 + r() * 90 }));
  });
  const sun = $derived.by(() => {
    const day = Math.max(0, Math.min(1, (h - 6) / 13));
    return { x: 60 + day * 480, y: 90 - Math.sin(day * Math.PI) * 70 };
  });

  let svg = $state<SVGSVGElement | null>(null);
  // Ids inside an inline SVG are page-wide: each plate gets its own.
  const uid = `pl${Math.random().toString(36).slice(2, 9)}`;
  let menuOpen = $state(false);
  let menuAt = $state<HTMLElement | null>(null);
  const items = $derived<MenuItem[]>([
    ...PLACE_KINDS.map((p) => ({ label: `This place is: ${p.label}`, onclick: () => onkind?.(name, p.id), disabled: !name || p.id === k })),
    { label: "Save as image", onclick: () => void saveImage() },
  ]);

  async function saveImage() {
    if (!svg) return;
    const xml = new XMLSerializer().serializeToString(svg);
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = 1200;
    c.height = 300;
    c.getContext("2d")!.drawImage(img, 0, 0, 1200, 300);
    const a = document.createElement("a");
    a.href = c.toDataURL("image/png");
    a.download = `${(title || name || "scene").replace(/[^\w\- ]+/g, "").trim() || "scene"}.png`;
    a.click();
  }
</script>

<figure class="plate" aria-label="The scene: {name || 'somewhere'}{weather ? `, ${weather}` : ''}">
  <svg bind:this={svg} viewBox="0 0 600 150" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true">
    <defs>
      <linearGradient id="{uid}-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color={top} /><stop offset="1" stop-color={bottom} /></linearGradient>
      <linearGradient id="{uid}-fog" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0" /><stop offset="1" stop-color="#e8e4f0" stop-opacity="0.75" /></linearGradient>
      <clipPath id="{uid}-win"><rect x="200" y="22" width="200" height="86" rx="4" /></clipPath>
    </defs>
    <g clip-path={interior ? `url(#${uid}-win)` : undefined}>
      <rect width="600" height="150" fill="url(#{uid}-sky)" />
      {#if night}
        {#each Array.from({ length: wx === "clear" ? 40 : 10 }, (_, i) => i) as i (i)}<circle cx={(i * 137.5) % 600} cy={(i * 53.3) % 90} r={i % 5 === 0 ? 1.3 : 0.7} fill="#fff" opacity={0.4 + (i % 3) * 0.2} />{/each}
        <circle cx="470" cy="34" r="12" fill="#f4efd8" opacity="0.92" /><circle cx="476" cy="30" r="11" fill={top} opacity="0.85" />
      {:else}
        <circle cx={sun.x} cy={sun.y} r={dusk ? 16 : 13} fill={dusk ? "#ffb070" : "#fff6d0"} opacity={wx === "clear" || wx === "wind" ? 0.95 : 0.35} />
      {/if}
      {#each clouds as c, i (i)}<ellipse cx={c.x} cy={c.y} rx={c.w / 2} ry={c.w / 6} fill={night ? "#2a2640" : wx === "storm" ? "#4a4658" : "#f2eef8"} opacity={wx === "clear" ? 0.25 : 0.7} />{/each}
      {#if !interior}{#each shapes as s, i (i)}{#if s.d}<path d={s.d} fill={s.fill} opacity={s.o ?? 1} />{:else if s.rect}<rect x={s.rect[0]} y={s.rect[1]} width={s.rect[2]} height={s.rect[3]} fill={s.fill} opacity={s.o ?? 1} />{:else if s.c}<circle cx={s.c[0]} cy={s.c[1]} r={s.c[2]} fill={s.fill} opacity={s.o ?? 1} />{/if}{/each}{/if}
      {#each precip as p, i (i)}{#if wx === "snow"}<circle cx={p.x} cy={p.y} r="1.4" fill="#fff" opacity="0.85" />{:else}<line x1={p.x} y1={p.y} x2={p.x - 3} y2={p.y + p.l} stroke="#cfd8ff" stroke-width="0.8" opacity="0.55" />{/if}{/each}
      {#if wx === "fog"}<rect y="60" width="600" height="90" fill="url(#{uid}-fog)" />{/if}
      {#if wx === "storm"}<path d="M380 20 L366 58 L378 58 L360 100" stroke="#fff8c8" stroke-width="2" fill="none" opacity="0.8" />{/if}
    </g>
    {#if interior}
      <!-- An interior: the wall, the window onto the sky, and the room's furniture. -->
      <path d="M0 0 H600 V150 H0 Z M200 22 V108 H400 V22 Z" fill-rule="evenodd" fill={night ? "#1e1420" : "#3a2a30"} />
      <rect x="196" y="18" width="208" height="94" rx="6" fill="none" stroke={night ? "#4a3640" : "#6a4a48"} stroke-width="6" />
      <rect x="298" y="22" width="4" height="86" fill={night ? "#4a3640" : "#6a4a48"} />
      {#if k === "tavern"}
        <rect x="0" y="118" width="600" height="32" fill={night ? "#120c12" : "#24181c"} />
        <rect x="0" y="112" width="600" height="8" fill={night ? "#2a1c1c" : "#4a3028"} />
        {#each [40, 70, 95, 470, 500, 530, 560] as bx, i (bx)}<rect x={bx} y={86 - (i % 3) * 6} width="10" height={26 + (i % 3) * 6} rx="3" fill={night ? "#1a2a22" : "#2a4a3a"} />{/each}
        {#each [130, 300, 470] as lx (lx)}<line x1={lx} y1="0" x2={lx} y2="10" stroke="#1a1214" stroke-width="2" /><circle cx={lx} cy="16" r="7" fill="#ffd890" opacity={night || dusk ? 0.95 : 0.6} /><circle cx={lx} cy="16" r="22" fill="#ffd890" opacity={night || dusk ? 0.15 : 0.06} />{/each}
      {:else}
        <path d="M40 150 V112 Q40 104 48 104 H210 Q218 104 218 112 V150 Z" fill={night ? "#120c14" : "#2a1c24"} />
        <rect x="46" y="96" width="60" height="14" rx="6" fill={night ? "#2a2234" : "#d8ccd8"} opacity="0.9" />
        <rect x="470" y="104" width="60" height="46" fill={night ? "#120c14" : "#2a1c24"} />
        <rect x="492" y="80" width="4" height="24" fill="#1a1214" /><path d="M480 80 L508 80 L500 66 L488 66 Z" fill="#ffd890" opacity={night || dusk ? 0.95 : 0.6} />
        <circle cx="494" cy="76" r="26" fill="#ffd890" opacity={night || dusk ? 0.14 : 0.05} />
      {/if}
    {/if}
  </svg>
  {#if onkind}
    <button class="more" bind:this={menuAt} onclick={() => (menuOpen = !menuOpen)} aria-label="Scene plate options" title="This place is… · Save as image"><Ellipsis size={14} /></button>
    <Menu bind:open={menuOpen} {items} anchor={menuAt} title="Scene plate" />
  {/if}
</figure>

<style>
  .plate {
    position: relative;
    margin: 0.4rem 0 0.2rem;
    border-radius: var(--r-md, 14px);
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border));
    box-shadow: 0 6px 24px -14px color-mix(in srgb, var(--accent) 60%, transparent);
    aspect-ratio: 4 / 1;
    max-height: 9rem;
    width: 100%;
  }
  svg {
    display: block;
    width: 100%;
    height: 100%;
  }
  svg :global(stop),
  svg :global(rect),
  svg :global(circle) {
    transition:
      stop-color 2s ease,
      fill 2s ease;
  }
  .more {
    position: absolute;
    right: 0.4rem;
    top: 0.4rem;
    border: 0;
    border-radius: 999px;
    padding: 0.2rem 0.35rem;
    background: rgba(0, 0, 0, 0.35);
    color: #fff;
    cursor: pointer;
    opacity: 0.7;
  }
  .more:hover,
  .more:focus-visible {
    opacity: 1;
  }
  @media (prefers-reduced-motion: reduce) {
    svg :global(stop),
    svg :global(rect),
    svg :global(circle) {
      transition: none;
    }
  }
</style>
