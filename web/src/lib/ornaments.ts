/**
 * Drawn ornaments for the rooms, as SVG markup: Wildflower's flowers, corner sprays and chapter
 * wreath, and a butterfly. Colours come from classes the room's CSS fills (.stem, .lf, .p1…).
 */

const f1 = (n: number) => n.toFixed(1);

export function flower(cx: number, cy: number, r: number, n: number, cls: string, rot = 0) {
  let s = "";
  for (let i = 0; i < n; i++) s += `<ellipse cx="${cx}" cy="${f1(cy - r * 0.52)}" rx="${f1(r * 0.36)}" ry="${f1(r * 0.54)}" class="${cls}" transform="rotate(${f1(rot + (i * 360) / n)} ${cx} ${cy})"/>`;
  return s + `<circle cx="${cx}" cy="${cy}" r="${f1(r * 0.24)}" class="fc"/>`;
}

const leaf = (x: number, y: number, len: number, ang: number, cls = "lf") =>
  `<path class="${cls}" d="M0 0C${f1(len * 0.35)} ${f1(-len * 0.3)} ${f1(len * 0.75)} ${f1(-len * 0.22)} ${len} 0C${f1(len * 0.75)} ${f1(len * 0.22)} ${f1(len * 0.35)} ${f1(len * 0.3)} 0 0Z" transform="translate(${f1(x)} ${f1(y)}) rotate(${f1(ang)})"/>`;

/** A corner spray: stems fan out from the bottom-left corner, leaves along them, blooms at the tips. */
export function spray() {
  const stems: [number, number, string, number, number][] = [
    [150, 46, "p1", 24, 5],
    [206, 118, "p2", 19, 6],
    [92, 28, "p3", 15, 5],
    [226, 190, "p4", 13, 5],
    [58, 84, "p1", 12, 6],
    [180, 168, "p2", 9, 5],
  ];
  let s = "";
  stems.forEach(([x, y], i) => {
    const qx = x * 0.28;
    const qy = y + (250 - y) * 0.36;
    s += `<path class="stem" d="M0 250Q${qx.toFixed(0)} ${qy.toFixed(0)} ${x} ${y}"/>`;
    for (const t of [0.42, 0.68]) {
      const px = 2 * (1 - t) * t * qx + t * t * x;
      const py = (1 - t) * (1 - t) * 250 + 2 * (1 - t) * t * qy + t * t * y;
      const dir = (Math.atan2(y - qy, x - qx) * 180) / Math.PI;
      s += leaf(px, py, 22 - i, dir + (t < 0.5 ? -55 : 50), t < 0.5 ? "lf" : "lf2");
    }
  });
  stems.forEach(([x, y, c, r, n], i) => {
    s += `<g class="sway" style="transform-origin:${x}px ${y}px;animation-delay:${-i * 1.3}s">${flower(x, y, r, n, c, i * 17)}</g>`;
  });
  for (const [x, y] of [
    [120, 96],
    [34, 150],
    [196, 80],
  ])
    s += `<circle class="bud" cx="${x}" cy="${y}" r="4.5"/><circle class="fc" cx="${x}" cy="${y}" r="1.6"/>`;
  return `<svg viewBox="0 0 250 250" aria-hidden="true">${s}</svg>`;
}

/** An arch of leaves with three blooms, over a chapter title. */
export function wreath() {
  let s = `<path class="stem" d="M12 60Q115 -6 218 60"/>`;
  for (let i = 1; i < 18; i++) {
    const t = i / 18;
    const x = (1 - t) * (1 - t) * 12 + 2 * (1 - t) * t * 115 + t * t * 218;
    const y = (1 - t) * (1 - t) * 60 + 2 * (1 - t) * t * -6 + t * t * 60;
    const tan = (Math.atan2(2 * (1 - t) * -66 + 2 * t * 66, 2 * (1 - t) * 103 + 2 * t * 103) * 180) / Math.PI;
    if (Math.abs(t - 0.5) < 0.06 || Math.abs(t - 0.22) < 0.03 || Math.abs(t - 0.78) < 0.03) continue;
    s += `<g class="grow" style="animation-delay:${(Math.abs(t - 0.5) * 1.4).toFixed(2)}s">${leaf(x, y, 15, tan + (i % 2 ? -40 : 40) + (t > 0.5 ? 180 : 0), i % 3 ? "lf" : "lf2")}</g>`;
  }
  s += `<g class="bloom" style="transform-origin:115px 27px">${flower(115, 27, 17, 6, "p1")}</g>`;
  s += `<g class="bloom" style="transform-origin:64px 39px;animation-delay:.35s">${flower(64, 39, 11, 5, "p3", 20)}</g>`;
  s += `<g class="bloom" style="transform-origin:166px 39px;animation-delay:.5s">${flower(166, 39, 11, 5, "p4", 40)}</g>`;
  s += `<circle class="bud" cx="38" cy="50" r="3.5"/><circle class="bud" cx="192" cy="50" r="3.5"/>`;
  return `<svg class="w-wreath w-orn" viewBox="0 0 230 64" aria-hidden="true">${s}</svg>`;
}

/** Wildflower's logo: one five-petal bloom and a bud. */
export const BLOOM = `<svg class="w-orn" viewBox="0 0 40 40" aria-hidden="true">${flower(20, 21, 17, 5, "p1")}<circle class="bud" cx="34" cy="7" r="2.6"/></svg>`;

/** A butterfly whose wings beat (the room's CSS animates .wing). */
export const BUTTERFLY = `<svg viewBox="0 0 40 32" aria-hidden="true"><g class="wing l"><path class="p1" d="M20 16C14 2 2 2 3 10s9 7 17 6z"/><path class="p3" d="M20 17C12 18 6 24 9 29s10-5 11-12z"/></g><g class="wing r"><path class="p1" d="M20 16C26 2 38 2 37 10s-9 7-17 6z"/><path class="p3" d="M20 17C28 18 34 24 31 29s-10-5-11-12z"/></g><path class="body" d="M20 9v16" stroke-width="1.6" stroke-linecap="round"/></svg>`;
