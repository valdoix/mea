<script lang="ts">
  // Prism Lab: a beam from the left through a slowly tilting glass prism, fanning out into a
  // soft-edged spectrum. Blurred rainbow caustics drift on the walls and small glints twinkle.
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
  ];
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
    <mask id="pl-mask" maskUnits="userSpaceOnUse" x="0" y="-200" width="1200" height="1200"><rect y="-200" width="1200" height="1200" fill="url(#pl-fade)" /></mask>
    <linearGradient id="pl-f1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".8" /><stop offset="1" stop-color="#bcd4ff" stop-opacity=".18" /></linearGradient>
    <linearGradient id="pl-f2" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f0e2ff" stop-opacity=".65" /><stop offset="1" stop-color="#9fc0ff" stop-opacity=".12" /></linearGradient>
    <filter id="pl-soft" x="-20%" y="-60%" width="140%" height="220%"><feGaussianBlur stdDeviation="18" /></filter>
    <filter id="pl-glow" x="-10%" y="-300%" width="120%" height="700%"><feGaussianBlur stdDeviation="4" /></filter>
  </defs>
  <line class="beam" x1="0" y1="230" x2="376" y2="200" stroke-width="12" opacity=".35" filter="url(#pl-glow)" />
  <line class="beam" x1="0" y1="230" x2="376" y2="200" stroke-width="2" />
  <g class="pr">
    <g class="spec" mask="url(#pl-mask)">
      <polygon points="406,194 1200,-60 1200,760 406,214" fill="url(#pl-spec)" filter="url(#pl-soft)" opacity=".75" />
      <polygon points="406,196 1200,20 1200,680 406,212" fill="url(#pl-spec)" opacity=".8" />
    </g>
    <polygon points="390,140 334,236 390,208" fill="url(#pl-f1)" />
    <polygon points="390,140 446,236 390,208" fill="url(#pl-f2)" />
    <polygon points="334,236 446,236 390,208" fill="rgb(180 200 255 / 25%)" />
    <polygon class="edge" points="390,140 446,236 334,236" fill="none" stroke-width="1.2" stroke-linejoin="round" />
    <circle cx="386" cy="202" r="6" fill="#fff" opacity=".8" filter="url(#pl-glow)" />
  </g>
</svg>
{#each GLINTS as g, i (i)}<i class="gl" style:left="{g.x}%" style:top="{g.y}%" style:width="{g.s}px" style:height="{g.s}px" style:animation-delay="{g.d}s"></i>{/each}
