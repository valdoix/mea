<script lang="ts">
  import { device } from "../../lib/device.svelte";
  import { route } from "../../lib/router.svelte";

  // Prism Lab: a beam from the left through a glass prism you tip with the pointer (it swings the
  // spectrum across the room, with a little overshoot), soap bubbles with thin-film colour drifting
  // up, rainbow caustics and glints; by night, laser lines bounce off the walls. The character's
  // cards lean toward the pointer, the header reads each story's spectral signature, and sending
  // throws a burst of light from the button. Styled in room.css.
  const CAUSTICS = [
    { x: 52, y: 48, s: 300, d: 0 },
    { x: 80, y: 6, s: 230, d: -6 },
    { x: 24, y: 70, s: 200, d: -11 },
  ];
  const GLINTS = [
    { x: 62, y: 22, s: 16, d: 0 },
    { x: 84, y: 46, s: 12, d: -1.2 },
    { x: 72, y: 74, s: 18, d: -2.3 },
    { x: 93, y: 84, s: 10, d: -0.6 },
    { x: 46, y: 88, s: 11, d: -1.8 },
    { x: 34, y: 30, s: 9, d: -2.9 },
  ];
  const SOAP = Array.from({ length: 9 }, (_, i) => ({ x: 18 + ((i * 37) % 80), s: 28 + ((i * 23) % 58), d: 18 + ((i * 7) % 16), dl: -((i * 4.3) % 30), w: ((i * 41) % 90) - 45 }));
  const RAYS = ["#9b30ff", "#1f8bff", "#00d27a", "#ffe45c", "#ffb400", "#ff2a6d"];

  // The spectral signature: dark lines across a spectrum strip under the header, placed from the
  // story's id, so each story reads differently and always the same.
  const signature = (id: string) => {
    let h = 2166136261;
    for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    let s = Math.abs(h) || 1;
    const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    return Array.from({ length: 8 }, () => {
      const x = 3 + r() * 94;
      const w = 0.25 + r() * 0.6;
      return `linear-gradient(90deg, transparent ${x.toFixed(1)}%, rgb(11 9 22 / 85%) ${x.toFixed(1)}% ${(x + w).toFixed(1)}%, transparent ${(x + w).toFixed(1)}%)`;
    }).join(",");
  };
  $effect(() => {
    const d = document.documentElement.style;
    if (route.name === "chat" && route.params.id) d.setProperty("--pl-sig", signature(route.params.id));
    else d.removeProperty("--pl-sig");
    return () => d.removeProperty("--pl-sig");
  });

  $effect(() => {
    const root = document.documentElement;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    // tip the prism with the pointer, across the whole window
    const move = (e: PointerEvent) => {
      if (!device.fireflies || still) return;
      root.style.setProperty("--pl-tilt", `${(((e.clientX / innerWidth) - 0.5) * 30).toFixed(1)}deg`);
      // the character's foil cards lean toward the pointer
      const b = (e.target as Element | null)?.closest?.(".style-cards .msg:not(.user) .bubble") as HTMLElement | null;
      if (b !== lean) {
        lean?.style.removeProperty("--pl-rx");
        lean?.style.removeProperty("--pl-ry");
        lean = b;
      }
      if (b) {
        const r = b.getBoundingClientRect();
        b.style.setProperty("--pl-ry", `${(((e.clientX - r.left) / r.width - 0.5) * 6).toFixed(2)}deg`);
        b.style.setProperty("--pl-rx", `${(-((e.clientY - r.top) / r.height - 0.5) * 6).toFixed(2)}deg`);
      }
    };
    let lean: HTMLElement | null = null;
    // sending throws a burst of light from the button
    const click = (e: MouseEvent) => {
      const btn = (e.target as Element | null)?.closest?.(".send");
      if (!btn || still) return;
      const b = btn.getBoundingClientRect();
      const burst = document.createElement("div");
      burst.className = "pl-burst";
      burst.style.left = `${b.left + b.width / 2}px`;
      burst.style.top = `${b.top + b.height / 2}px`;
      for (let i = 0; i < 18; i++) {
        const a = -150 + i * 7 + Math.random() * 4;
        const ray = document.createElement("i");
        ray.style.setProperty("--a", `${a}deg`);
        ray.style.setProperty("--c", RAYS[i % RAYS.length]!);
        burst.appendChild(ray);
      }
      document.body.appendChild(burst);
      setTimeout(() => burst.remove(), 1000);
    };
    addEventListener("pointermove", move, { passive: true });
    addEventListener("click", click, true);
    return () => {
      removeEventListener("pointermove", move);
      removeEventListener("click", click, true);
      root.style.removeProperty("--pl-tilt");
      lean?.style.removeProperty("--pl-rx");
      lean?.style.removeProperty("--pl-ry");
    };
  });
</script>

{#each CAUSTICS as c, i (i)}<i class="cau" style:left="{c.x}%" style:top="{c.y}%" style:width="{c.s}px" style:height="{c.s}px" style:animation-delay="{c.d}s"></i>{/each}
<svg class="lab" viewBox="0 0 1200 800" preserveAspectRatio="xMinYMin slice">
  <defs>
    <linearGradient id="pl-spec" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ff2a6d" />
      <stop offset=".22" stop-color="#ffb400" />
      <stop offset=".44" stop-color="#00d27a" />
      <stop offset=".66" stop-color="#1f8bff" />
      <stop offset="1" stop-color="#9b30ff" />
    </linearGradient>
    <linearGradient id="pl-fade" x1="0" x2="1">
      <stop offset="0" stop-color="#fff" stop-opacity=".95" />
      <stop offset=".6" stop-color="#fff" stop-opacity=".45" />
      <stop offset="1" stop-color="#fff" stop-opacity="0" />
    </linearGradient>
    <mask id="pl-mask" maskUnits="userSpaceOnUse" x="-400" y="-600" width="2000" height="2000"><rect x="-400" y="-600" width="2000" height="2000" fill="url(#pl-fade)" /></mask>
    <linearGradient id="pl-f1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".8" /><stop offset="1" stop-color="#bcd4ff" stop-opacity=".18" /></linearGradient>
    <linearGradient id="pl-f2" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f0e2ff" stop-opacity=".65" /><stop offset="1" stop-color="#9fc0ff" stop-opacity=".12" /></linearGradient>
    <filter id="pl-soft" x="-20%" y="-60%" width="140%" height="220%"><feGaussianBlur stdDeviation="18" /></filter>
    <filter id="pl-glow" x="-10%" y="-300%" width="120%" height="700%"><feGaussianBlur stdDeviation="4" /></filter>
  </defs>
  <g class="lasers">
    <polyline points="0,90 260,800 520,0 780,800 1040,0 1200,300" style:--c="#ff2a6d" />
    <polyline points="1200,40 900,800 600,0 300,800 0,420" style:--c="#00b7ff" />
    <polyline points="0,640 330,0 660,800 990,0 1200,380" style:--c="#00e07a" />
  </g>
  <line class="beam" x1="0" y1="230" x2="376" y2="200" stroke-width="12" opacity=".35" filter="url(#pl-glow)" />
  <line class="beam" x1="0" y1="230" x2="376" y2="200" stroke-width="2" />
  <g class="pr">
    <g class="spec" mask="url(#pl-mask)">
      <polygon points="406,194 1600,-200 1600,900 406,214" fill="url(#pl-spec)" filter="url(#pl-soft)" opacity=".75" />
      <polygon points="406,196 1600,-100 1600,800 406,212" fill="url(#pl-spec)" opacity=".8" />
    </g>
    <polygon points="390,140 334,236 390,208" fill="url(#pl-f1)" />
    <polygon points="390,140 446,236 390,208" fill="url(#pl-f2)" />
    <polygon points="334,236 446,236 390,208" fill="rgb(180 200 255 / 25%)" />
    <polygon class="edge" points="390,140 446,236 334,236" fill="none" stroke-width="1.2" stroke-linejoin="round" />
    <circle cx="386" cy="202" r="6" fill="#fff" opacity=".8" filter="url(#pl-glow)" />
  </g>
</svg>
{#each SOAP as b, i (i)}<i class="soap" style:left="{b.x}%" style:width="{b.s}px" style:height="{b.s}px" style:animation-duration="{b.d}s, 6s" style:animation-delay="{b.dl}s, {b.dl}s" style:--w="{b.w}px"></i>{/each}
{#each GLINTS as g, i (i)}<i class="gl" style:left="{g.x}%" style:top="{g.y}%" style:width="{g.s}px" style:height="{g.s}px" style:animation-delay="{g.d}s"></i>{/each}
