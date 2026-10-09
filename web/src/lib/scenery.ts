/**
 * The scene window: a painting of the story's sky, weather and place, drawn every frame on a
 * canvas from what the trackers know (time, wx, at). Free text is read into a few kinds of sky
 * and ground ("fog off the water" → fog; "Winterfell › the godswood" → castle). It pauses when
 * off screen and holds still for people who prefer less motion.
 */

export type Weather = "clear" | "cloudy" | "rain" | "storm" | "fog" | "snow" | "wind";
export type Place = "coast" | "harbor" | "forest" | "city" | "desert" | "castle" | "hills";

export const WEATHER_WORDS: Record<Weather, string> = { clear: "Clear", cloudy: "Overcast", rain: "Rain", storm: "Storm", fog: "Fog", snow: "Snow", wind: "Gale" };

export function readWeather(text: string | null | undefined): Weather {
  const t = (text ?? "").toLowerCase();
  if (/thunder|lightning|storm|tempest|squall|hurricane|typhoon/.test(t)) return "storm";
  if (/snow|sleet|blizzard|flurr|hail|frost(?!ed glass)|ice storm/.test(t)) return "snow";
  if (/rain|drizzl|shower|downpour|pour|wet|monsoon/.test(t)) return "rain";
  if (/fog|mist|haze|smog|murk/.test(t)) return "fog";
  if (/gale|wind|gust|blow|breez/.test(t)) return "wind";
  if (/overcast|cloud|grey|gray|dull|gloom/.test(t)) return "cloudy";
  return "clear";
}

export function readPlace(path: string[] | null | undefined): Place {
  const t = (path ?? []).join(" ").toLowerCase();
  if (/lighthouse|cliff|beach|shore|coast|cove|seaside|sea\b|ocean|island|shingle|bay\b/.test(t)) return "coast";
  if (/harbou?r|port\b|dock|pier|wharf|quay|marina|ship|boat|fishing/.test(t)) return "harbor";
  if (/castle|\bkeep\b|\bhold\b|fortress|citadel|palace|\btower\b(?! block)|winterfell|king's landing|red keep|riverrun|eyrie|storm's end|dragonstone|highgarden|casterly|the wall\b|castle black|throne|great hall|godswood|sept\b|manor/.test(t)) return "castle";
  if (/desert|dune|sand|waste|oasis|canyon|mesa|dorne|badlands/.test(t)) return "desert";
  if (/city|town|street|alley|apartment|flat\b|office|hospital|ward\b|club|bar\b|caf[eé]|station|subway|roof|tower block|downtown|mall|hotel|campus|school/.test(t)) return "city";
  if (/forest|wood|pine|grove|cabin|camp\b|glade|jungle|swamp|wolfswood/.test(t)) return "forest";
  return "hills";
}

type RGB = [number, number, number];
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
const mix = (a: RGB, b: RGB, t: number): RGB => a.map((v, i) => v + (b[i]! - v) * t) as RGB;
const rgb = (c: RGB, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
function rand(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}

const SKY = (
  [
    [0, "#060a1c", "#16133a"],
    [4.4, "#0b1030", "#2a1f4e"],
    [5.6, "#2a2c66", "#b0607a"],
    [6.6, "#4f78b8", "#ffb27a"],
    [8, "#4f93dc", "#bfe0f5"],
    [12, "#3a84d6", "#a9d6f7"],
    [16.4, "#4a83cf", "#f2d4a0"],
    [18.2, "#4a4a8c", "#ff9a6a"],
    [19.3, "#2a2560", "#a8506e"],
    [20.6, "#121540", "#3a2a5e"],
    [22, "#080c24", "#1e1840"],
    [24, "#060a1c", "#16133a"],
  ] as const
).map(([t, a, b]) => [t, hex(a), hex(b)] as const);

function skyAt(t: number): [RGB, RGB] {
  for (let i = 0; i < SKY.length - 1; i++) {
    const [t0, a0, b0] = SKY[i]!;
    const [t1, a1, b1] = SKY[i + 1]!;
    if (t >= t0 && t <= t1) {
      const k = (t - t0) / (t1 - t0);
      return [mix(a0, a1, k), mix(b0, b1, k)];
    }
  }
  return [SKY[0]![1], SKY[0]![2]];
}

const WX: Record<Weather, Record<"cloud" | "rain" | "snow" | "fog" | "storm" | "wind", number>> = {
  clear: { cloud: 0.08, rain: 0, snow: 0, fog: 0, storm: 0, wind: 0.1 },
  cloudy: { cloud: 0.85, rain: 0, snow: 0, fog: 0.1, storm: 0, wind: 0.25 },
  rain: { cloud: 0.92, rain: 0.6, snow: 0, fog: 0.1, storm: 0, wind: 0.3 },
  storm: { cloud: 1, rain: 1, snow: 0, fog: 0.05, storm: 1, wind: 0.85 },
  fog: { cloud: 0.55, rain: 0, snow: 0, fog: 1, storm: 0, wind: 0.05 },
  snow: { cloud: 0.78, rain: 0, snow: 0.85, fog: 0.15, storm: 0, wind: 0.2 },
  wind: { cloud: 0.45, rain: 0, snow: 0, fog: 0, storm: 0, wind: 1 },
};
const DARK: RGB = [12, 9, 24];
const WARM: RGB = [255, 196, 120];

interface Env {
  t: number;
  day: number;
  night: number;
  sunAlt: number;
  moonT: number;
  moonAlt: number;
  sky: { top: RGB; bot: RGB };
  far: RGB;
  mid: RGB;
  near: RGB;
  glow: number;
}
interface Light {
  x: number;
  y: number;
  c: RGB;
  a: number;
}

export class ScenePainter {
  private g: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private t = 21;
  private wx: Weather = "clear";
  private place: Place = "hills";
  private prev: Place | null = null;
  private pm = 1;
  private cur = { ...WX.clear };
  private flash = 0;
  private again = false;
  private bolt: number[][] | null = null;
  private time = 0;
  private visible = true;
  private still: boolean;
  private light: Light | null = null;
  private raf = 0;
  private last = performance.now();
  private ro: ResizeObserver;
  private io: IntersectionObserver;
  private drops: { x: number; y: number; v: number; l: number }[];
  private flakes: { x: number; y: number; v: number; s: number; p: number }[];
  private stars: { x: number; y: number; s: number; p: number }[];
  private clouds: { x: number; y: number; s: number; v: number; b: number[][] }[];
  private leaves: { x: number; y: number; v: number; p: number }[];
  private flies: { x: number; y: number; p: number; s: number }[];
  private glass: { x: number; y: number; s: number; v: number }[];
  private shim: { x: number; y: number; w: number; p: number }[];
  private hills: number[];
  private houses: { x: number; w: number; h: number; lit: number; roof: number }[];
  private pines: { x: number; h: number; p: number }[][];
  private towers: { x: number; w: number; h: number; win: number[] }[][];

  constructor(
    private canvas: HTMLCanvasElement,
    private mini = false,
  ) {
    this.g = canvas.getContext("2d")!;
    this.still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const r = rand(mini ? 7 : 3);
    this.stars = Array.from({ length: 170 }, () => ({ x: r(), y: r() * 0.62, s: r() * 1.4 + 0.3, p: r() * 6.28 }));
    this.clouds = Array.from({ length: 9 }, () => ({ x: r() * 1.4 - 0.2, y: 0.05 + r() * 0.3, s: 0.6 + r() * 0.9, v: 0.004 + r() * 0.008, b: Array.from({ length: 6 }, () => [r() * 0.16 - 0.08, r() * 0.04 - 0.02, 0.03 + r() * 0.05]) }));
    this.drops = Array.from({ length: mini ? 160 : 480 }, () => ({ x: r(), y: r(), v: 0.9 + r() * 0.8, l: 0.02 + r() * 0.03 }));
    this.flakes = Array.from({ length: mini ? 110 : 300 }, () => ({ x: r(), y: r(), v: 0.03 + r() * 0.06, s: 0.6 + r() * 2.2, p: r() * 6.28 }));
    this.leaves = Array.from({ length: 40 }, () => ({ x: r(), y: 0.2 + r() * 0.75, v: 0.25 + r() * 0.35, p: r() * 6.28 }));
    this.flies = Array.from({ length: 30 }, () => ({ x: r(), y: 0.6 + r() * 0.35, p: r() * 6.28, s: 0.5 + r() }));
    this.glass = Array.from({ length: mini ? 0 : 40 }, () => ({ x: r(), y: r(), s: 1.5 + r() * 4, v: r() < 0.25 ? 0.01 + r() * 0.04 : 0 }));
    this.shim = Array.from({ length: 90 }, () => ({ x: r(), y: r(), w: 0.01 + r() * 0.04, p: r() * 6.28 }));
    this.hills = Array.from({ length: 4 }, () => r() * 6.28);
    this.houses = Array.from({ length: 22 }, (_, i) => ({ x: 0.01 + i * 0.021 + r() * 0.01, w: 0.016 + r() * 0.012, h: 0.03 + r() * 0.035, lit: r(), roof: r() }));
    this.pines = [0, 1, 2].map((L) => Array.from({ length: 26 + L * 6 }, () => ({ x: r() * 1.1 - 0.05, h: (0.12 + r() * 0.12) * (1 + L * 0.45), p: r() * 6.28 })).sort((a, b) => a.h - b.h));
    this.towers = [0, 1].map((L) => {
      const a: { x: number; w: number; h: number; win: number[] }[] = [];
      let x = -0.02;
      while (x < 1.02) {
        const w = 0.03 + r() * 0.06;
        a.push({ x, w, h: (0.12 + r() * 0.22) * (L ? 1.35 : 1), win: Array.from({ length: 60 }, () => r()) });
        x += w + r() * 0.012;
      }
      return a;
    });
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.io = new IntersectionObserver(([e]) => (this.visible = Boolean(e?.isIntersecting)));
    this.io.observe(canvas);
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      if (this.visible && !document.hidden) this.frame(this.still ? 0 : dt);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.io.disconnect();
  }

  set(o: { hour?: number; weather?: Weather; place?: Place }) {
    if (o.hour != null) this.t = ((o.hour % 24) + 24) % 24;
    if (o.weather) this.wx = o.weather;
    if (o.place && o.place !== this.place) {
      this.prev = this.place;
      this.place = o.place;
      this.pm = this.w ? 0 : 1;
    }
    if (this.still) {
      this.cur = { ...WX[this.wx] };
      this.pm = 1;
    }
  }

  private resize() {
    const r = this.canvas.getBoundingClientRect();
    const d = Math.min(2, devicePixelRatio || 1);
    this.w = r.width;
    this.h = r.height;
    this.canvas.width = Math.round(r.width * d);
    this.canvas.height = Math.round(r.height * d);
    this.g.setTransform(d, 0, 0, d, 0, 0);
    if (this.still) this.frame(0);
  }

  private frame(dt: number) {
    if (!this.w) return;
    this.time += dt;
    const k = this.still ? 1 : 1 - Math.exp(-dt * 1.6);
    const tgt = WX[this.wx];
    for (const key of Object.keys(tgt) as (keyof typeof tgt)[]) this.cur[key] = lerp(this.cur[key], tgt[key], k);
    this.pm = Math.min(1, this.pm + dt * 0.9);
    this.draw(dt);
  }

  private env(): Env {
    const t = this.t;
    const c = this.cur;
    const sunAlt = Math.sin((Math.PI * (t - 6.1)) / 12.8);
    const day = clamp(sunAlt * 2.2 + 0.25);
    const night = 1 - day;
    let [top, bot] = skyAt(t);
    const grey = mix([20, 22, 32], [128, 134, 148], day);
    top = mix(top, grey, c.cloud * 0.6);
    bot = mix(bot, mix(grey, [170, 176, 188], day * 0.4), c.cloud * 0.5);
    bot = mix(bot, mix([200, 205, 215], bot, 0.5), c.fog * 0.35 * (0.3 + day));
    const moonT = (t - 18.6 + 24) % 24;
    return {
      t,
      day,
      night,
      sunAlt,
      moonT,
      moonAlt: moonT < 12.4 ? Math.sin((Math.PI * moonT) / 12.4) : -1,
      sky: { top, bot },
      far: mix(bot, DARK, 0.32),
      mid: mix(bot, DARK, 0.6),
      near: mix(bot, DARK, 0.86),
      glow: clamp(Math.max(night, c.cloud * 0.55 + c.fog * 0.3)),
    };
  }

  private draw(dt: number) {
    const g = this.g;
    const W = this.w;
    const H = this.h;
    const E = this.env();
    const c = this.cur;
    const T = this.time;
    const sg = g.createLinearGradient(0, 0, 0, H * 0.72);
    sg.addColorStop(0, rgb(E.sky.top));
    sg.addColorStop(1, rgb(E.sky.bot));
    g.fillStyle = sg;
    g.fillRect(0, 0, W, H);
    // stars
    const sa = E.night * (1 - c.cloud) * (1 - c.fog * 0.8);
    if (sa > 0.01)
      for (const s of this.stars) {
        g.fillStyle = `rgba(255,255,255,${sa * (0.45 + 0.55 * Math.sin(T * 1.6 + s.p)) ** 2})`;
        g.fillRect(s.x * W, s.y * H, s.s, s.s);
      }
    // sun
    this.light = null;
    if (E.sunAlt > -0.15) {
      const sx = W * clamp((E.t - 6.1) / 12.8);
      const sy = H * 0.66 - E.sunAlt * H * 0.55;
      const a = clamp((E.sunAlt + 0.15) * 3) * (1 - c.cloud * 0.75);
      const warm = mix([255, 150, 90], [255, 246, 220], clamp(E.sunAlt * 2));
      const gl = g.createRadialGradient(sx, sy, 0, sx, sy, H * 0.55);
      gl.addColorStop(0, rgb(warm, 0.55 * a));
      gl.addColorStop(1, rgb(warm, 0));
      g.fillStyle = gl;
      g.fillRect(0, 0, W, H);
      g.fillStyle = rgb(warm, a);
      g.beginPath();
      g.arc(sx, sy, H * 0.045, 0, 7);
      g.fill();
      this.light = { x: sx, y: sy, c: warm, a };
    }
    // moon
    if (E.moonAlt > 0) {
      const mx = W * (0.08 + 0.84 * (E.moonT / 12.4));
      const my = H * 0.62 - E.moonAlt * H * 0.5;
      const a = clamp(E.night * 1.3) * (1 - c.cloud * 0.8);
      const r = H * 0.035;
      const mg = g.createRadialGradient(mx, my, 0, mx, my, r * 7);
      mg.addColorStop(0, `rgba(220,225,255,${0.25 * a})`);
      mg.addColorStop(1, "rgba(220,225,255,0)");
      g.fillStyle = mg;
      g.fillRect(mx - r * 7, my - r * 7, r * 14, r * 14);
      g.fillStyle = `rgba(240,238,255,${a})`;
      g.beginPath();
      g.arc(mx, my, r, 0, 7);
      g.fill();
      g.fillStyle = rgb(E.sky.top, a * 0.92);
      g.beginPath();
      g.arc(mx - r * 0.55, my - r * 0.1, r * 0.92, 0, 7);
      g.fill();
      if (!this.light || this.light.a < a * 0.6) this.light = { x: mx, y: my, c: [220, 228, 255], a: a * 0.6 };
    }
    // clouds
    if (c.cloud > 0.04) {
      const cc = mix(mix([60, 62, 80], [250, 246, 250], E.day), E.sky.bot, 0.25);
      const under = mix(cc, DARK, 0.35);
      for (const cl of this.clouds) {
        cl.x += cl.v * dt * (1 + c.wind * 3);
        if (cl.x > 1.3) cl.x = -0.3;
        for (const [bx, by, br] of cl.b) {
          const x = (cl.x + bx! * cl.s) * W;
          const y = (cl.y + by! * cl.s) * H;
          const rr = br! * cl.s * W * 0.9;
          const cg = g.createRadialGradient(x, y - rr * 0.3, 0, x, y, rr);
          cg.addColorStop(0, rgb(cc, 0.75 * c.cloud));
          cg.addColorStop(0.7, rgb(under, 0.5 * c.cloud));
          cg.addColorStop(1, rgb(under, 0));
          g.fillStyle = cg;
          g.beginPath();
          g.arc(x, y, rr, 0, 7);
          g.fill();
        }
      }
    }
    // far hills
    g.fillStyle = rgb(E.far);
    g.beginPath();
    g.moveTo(0, H);
    for (let x = 0; x <= W; x += 6) {
      const u = x / W;
      g.lineTo(x, H * (0.6 - 0.05 * Math.sin(u * 5 + this.hills[0]!) - 0.03 * Math.sin(u * 13 + this.hills[1]!)));
    }
    g.lineTo(W, H);
    g.fill();
    // the place, crossfading when it changes
    if (this.prev && this.pm < 1) {
      g.globalAlpha = 1 - this.pm;
      this.drawPlace(this.prev, E);
    }
    g.globalAlpha = this.prev && this.pm < 1 ? this.pm : 1;
    this.drawPlace(this.place, E);
    g.globalAlpha = 1;
    // fog
    if (c.fog > 0.02) {
      const fc = mix(E.sky.bot, [210, 214, 224], 0.35 + E.day * 0.3);
      for (let i = 0; i < 6; i++) {
        const y = H * (0.48 + i * 0.09);
        const off = ((T * (0.012 + i * 0.006) + i * 0.3) % 1) * W;
        for (const dx of [-W, 0]) {
          g.save();
          g.translate(off + dx + W * 0.5, y);
          g.scale(3.2, 1);
          const fg = g.createRadialGradient(0, 0, 0, 0, 0, W * 0.2);
          fg.addColorStop(0, rgb(fc, 0.42 * c.fog));
          fg.addColorStop(1, rgb(fc, 0));
          g.fillStyle = fg;
          g.beginPath();
          g.arc(0, 0, W * 0.2, 0, 7);
          g.fill();
          g.restore();
        }
      }
      g.fillStyle = rgb(fc, 0.22 * c.fog);
      g.fillRect(0, 0, W, H);
    }
    g.fillStyle = `rgba(14,16,30,${0.22 * c.rain + 0.2 * c.storm})`;
    g.fillRect(0, 0, W, H);
    // rain
    const nr = Math.floor(this.drops.length * c.rain);
    if (nr) {
      g.strokeStyle = rgb(mix([150, 170, 210], [210, 225, 250], E.day), 0.35 + 0.2 * c.storm);
      g.lineWidth = this.mini ? 0.8 : 1.1;
      g.beginPath();
      const sl = 0.15 + c.wind * 0.5;
      for (let i = 0; i < nr; i++) {
        const d = this.drops[i]!;
        d.y += d.v * dt * (1.4 + c.storm * 0.6);
        d.x += d.v * dt * sl * 0.6;
        if (d.y > 1) {
          d.y -= 1.05;
          d.x = Math.random();
        }
        if (d.x > 1) d.x -= 1;
        const x = d.x * W;
        const y = d.y * H;
        g.moveTo(x, y);
        g.lineTo(x - sl * d.l * H, y - d.l * H);
      }
      g.stroke();
    }
    // snow
    const ns = Math.floor(this.flakes.length * c.snow);
    for (let i = 0; i < ns; i++) {
      const f = this.flakes[i]!;
      f.y += f.v * dt * 1.4;
      f.x += (Math.sin(T + f.p) * 0.012 + c.wind * 0.08) * dt;
      if (f.y > 1) {
        f.y = -0.02;
        f.x = Math.random();
      }
      if (f.x > 1) f.x -= 1;
      g.fillStyle = `rgba(255,255,255,${0.55 + 0.4 * (f.s / 2.8)})`;
      g.beginPath();
      g.arc(f.x * W, f.y * H, f.s * (this.mini ? 0.7 : 1), 0, 7);
      g.fill();
    }
    // gale
    if (c.wind > 0.55) {
      const a = (c.wind - 0.55) * 2;
      for (const l of this.leaves) {
        l.x += l.v * dt * (1 + c.wind);
        l.y += Math.sin(T * 3 + l.p) * dt * 0.05;
        if (l.x > 1.05) {
          l.x = -0.05;
          l.y = 0.2 + Math.random() * 0.75;
        }
        const x = l.x * W;
        const y = l.y * H;
        g.strokeStyle = `rgba(255,255,255,${0.12 * a})`;
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x - W * 0.06, y + Math.sin(T * 2 + l.p) * 3);
        g.stroke();
        g.save();
        g.translate(x, y);
        g.rotate(T * 6 + l.p);
        g.fillStyle = rgb(mix([200, 120, 60], E.near, 0.4), a);
        g.beginPath();
        g.ellipse(0, 0, 3.4, 1.6, 0, 0, 7);
        g.fill();
        g.restore();
      }
    }
    // lightning
    if (!this.still && c.storm > 0.6 && Math.random() < dt * 0.35) this.strike();
    if (this.flash > 0) {
      g.fillStyle = `rgba(225,230,255,${this.flash * 0.5})`;
      g.fillRect(0, 0, W, H);
      if (this.bolt && this.flash > 0.25) {
        g.save();
        g.strokeStyle = `rgba(255,255,255,${this.flash})`;
        g.shadowColor = "#b9c8ff";
        g.shadowBlur = 18;
        g.lineWidth = 2.2;
        g.beginPath();
        for (const s of this.bolt) {
          g.moveTo(s[0]! * W, s[1]! * H);
          g.lineTo(s[2]! * W, s[3]! * H);
        }
        g.stroke();
        g.restore();
      }
      this.flash -= dt * 2.6;
      if (this.flash <= 0 && this.again) {
        this.again = false;
        this.flash = 0.8;
      }
    }
    // drops on the glass
    if (c.rain > 0.25 && this.glass.length) {
      const a = (c.rain - 0.25) * 1.3;
      for (const d of this.glass) {
        d.y += d.v * dt;
        if (d.y > 1.02) {
          d.y = -0.02;
          d.x = Math.random();
        }
        const x = d.x * W;
        const y = d.y * H;
        const s = d.s;
        if (d.v) {
          g.strokeStyle = `rgba(255,255,255,${0.06 * a})`;
          g.lineWidth = s * 0.7;
          g.beginPath();
          g.moveTo(x, y - s * 6);
          g.lineTo(x, y);
          g.stroke();
        }
        const dg = g.createRadialGradient(x - s * 0.3, y - s * 0.3, 0, x, y, s);
        dg.addColorStop(0, `rgba(255,255,255,${0.5 * a})`);
        dg.addColorStop(0.6, `rgba(200,210,240,${0.12 * a})`);
        dg.addColorStop(1, `rgba(0,0,10,${0.25 * a})`);
        g.fillStyle = dg;
        g.beginPath();
        g.arc(x, y, s, 0, 7);
        g.fill();
      }
    }
    const vg = g.createRadialGradient(W / 2, H * 0.55, H * 0.3, W / 2, H * 0.55, H * 1.05);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(5,3,12,.55)");
    g.fillStyle = vg;
    g.fillRect(0, 0, W, H);
  }

  private strike() {
    const segs: number[][] = [];
    let x = 0.15 + Math.random() * 0.7;
    let y = 0;
    while (y < 0.6) {
      const nx = x + (Math.random() - 0.5) * 0.06;
      const ny = y + 0.03 + Math.random() * 0.05;
      segs.push([x, y, nx, ny]);
      if (Math.random() < 0.18) {
        let bx = nx;
        let by = ny;
        for (let j = 0; j < 4; j++) {
          const ex = bx + (Math.random() - 0.3) * 0.05;
          const ey = by + 0.03;
          segs.push([bx, by, ex, ey]);
          bx = ex;
          by = ey;
        }
      }
      x = nx;
      y = ny;
    }
    this.bolt = segs;
    this.flash = 1;
    this.again = Math.random() < 0.5;
  }

  private windows(E: Env, x: number, y: number, w: number, h: number, lit: number, flick = 0) {
    if (lit >= E.glow * 0.95) return;
    const g = this.g;
    const fl = flick ? 0.85 + 0.15 * Math.sin(this.time * 9 + flick) : 1;
    g.fillStyle = rgb(WARM, 0.9 * fl * clamp(E.glow * 1.4));
    g.fillRect(x, y, w, h);
    g.fillStyle = rgb(WARM, 0.12 * fl);
    g.fillRect(x - w, y - h, w * 3, h * 3);
  }

  private glowAt(x: number, y: number, r: number, color: RGB, a: number) {
    const g = this.g;
    const lg = g.createRadialGradient(x, y, 0, x, y, r);
    lg.addColorStop(0, rgb(color, a));
    lg.addColorStop(1, rgb(color, 0));
    g.fillStyle = lg;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }

  private sea(E: Env, top: number) {
    const g = this.g;
    const W = this.w;
    const H = this.h;
    const T = this.time;
    const sg = g.createLinearGradient(0, H * top, 0, H);
    sg.addColorStop(0, rgb(mix(E.sky.bot, DARK, 0.25)));
    sg.addColorStop(1, rgb(mix(E.sky.bot, DARK, 0.85)));
    g.fillStyle = sg;
    g.fillRect(0, H * top, W, H * (1 - top));
    const L = this.light;
    for (const s of this.shim) {
      const y = H * (top + s.y * (1 - top));
      const dx = L ? Math.abs(s.x * W - L.x) / W : 1;
      const a = (0.06 + (L ? L.a * Math.max(0, 0.5 - dx * 2.2) : 0)) * (0.5 + 0.5 * Math.sin(T * 2 + s.p)) * (1 - this.cur.fog * 0.5);
      g.fillStyle = rgb(L ? L.c : [200, 210, 255], a);
      g.fillRect(s.x * W + Math.sin(T * 0.8 + s.p) * 6, y, s.w * W * (0.4 + s.y), 1.2);
    }
  }

  private ground(color: RGB, y0: number, amp: number, freq: number, phase: number) {
    const g = this.g;
    const W = this.w;
    const H = this.h;
    g.fillStyle = rgb(color);
    g.beginPath();
    g.moveTo(0, H);
    for (let x = 0; x <= W; x += 6) g.lineTo(x, H * (y0 - amp * Math.sin((x / W) * freq + phase)));
    g.lineTo(W, H);
    g.fill();
  }

  private drawPlace(p: Place, E: Env) {
    const g = this.g;
    const W = this.w;
    const H = this.h;
    const T = this.time;
    const c = this.cur;
    if (p === "coast") {
      this.sea(E, 0.6);
      g.fillStyle = rgb(E.mid);
      g.beginPath();
      g.moveTo(0, H);
      g.lineTo(0, H * 0.72);
      g.quadraticCurveTo(W * 0.12, H * 0.66, W * 0.22, H * 0.74);
      g.lineTo(W * 0.3, H);
      g.fill();
      g.fillStyle = rgb(E.near);
      g.beginPath();
      g.moveTo(W * 0.55, H);
      g.lineTo(W * 0.62, H * 0.66);
      g.lineTo(W * 0.7, H * 0.58);
      g.lineTo(W * 0.78, H * 0.535);
      g.lineTo(W * 0.95, H * 0.52);
      g.lineTo(W, H * 0.54);
      g.lineTo(W, H);
      g.fill();
      const lx = W * 0.84;
      const base = H * 0.53;
      const top = H * 0.25;
      const bw = W * 0.026;
      const tw = W * 0.018;
      const tower = mix(E.near, [232, 226, 222], E.day * 0.75);
      const stripe = mix(E.near, [196, 70, 84], E.day * 0.75);
      g.fillStyle = rgb(tower);
      g.beginPath();
      g.moveTo(lx - bw, base);
      g.lineTo(lx - tw, top);
      g.lineTo(lx + tw, top);
      g.lineTo(lx + bw, base);
      g.fill();
      g.fillStyle = rgb(stripe);
      for (const [a, b] of [
        [0.2, 0.34],
        [0.55, 0.69],
      ] as const) {
        const y1 = lerp(base, top, a);
        const y2 = lerp(base, top, b);
        const w1 = lerp(bw, tw, a);
        const w2 = lerp(bw, tw, b);
        g.beginPath();
        g.moveTo(lx - w1, y1);
        g.lineTo(lx - w2, y2);
        g.lineTo(lx + w2, y2);
        g.lineTo(lx + w1, y1);
        g.fill();
      }
      g.fillStyle = rgb(E.near);
      g.fillRect(lx - tw * 1.5, top - 2, tw * 3, 3);
      g.beginPath();
      g.moveTo(lx - tw * 1.1, top - H * 0.05);
      g.lineTo(lx, top - H * 0.075);
      g.lineTo(lx + tw * 1.1, top - H * 0.05);
      g.fill();
      const ly = top - H * 0.028;
      const gl = E.glow;
      g.fillStyle = rgb(mix(E.near, [255, 240, 200], gl));
      g.fillRect(lx - tw, top - H * 0.05, tw * 2, H * 0.048);
      if (gl > 0.05) {
        this.glowAt(lx, ly, H * 0.16, [255, 236, 190], 0.75 * gl);
        const ang = T * 0.75;
        const L = Math.cos(ang) * W * 0.95;
        const spread = H * (0.035 + 0.05 * Math.abs(Math.sin(ang)));
        const a = gl * (0.25 + 0.45 * Math.abs(Math.cos(ang))) * (1 + c.fog * 0.9) * 0.6;
        const bg = g.createLinearGradient(lx, ly, lx + L, ly);
        bg.addColorStop(0, `rgba(255,240,200,${a})`);
        bg.addColorStop(1, "rgba(255,240,200,0)");
        g.fillStyle = bg;
        g.beginPath();
        g.moveTo(lx, ly - 2);
        g.lineTo(lx + L, ly - spread);
        g.lineTo(lx + L, ly + spread * 0.8);
        g.lineTo(lx, ly + 2);
        g.fill();
      }
      g.fillStyle = rgb(E.near);
      g.fillRect(W * 0.9, H * 0.47, W * 0.06, H * 0.06);
      g.beginPath();
      g.moveTo(W * 0.895, H * 0.475);
      g.lineTo(W * 0.93, H * 0.44);
      g.lineTo(W * 0.965, H * 0.475);
      g.fill();
      this.windows(E, W * 0.92, H * 0.49, W * 0.012, H * 0.018, 0.2, 3);
    } else if (p === "harbor") {
      this.sea(E, 0.66);
      g.fillStyle = rgb(E.mid);
      g.beginPath();
      g.moveTo(0, H);
      g.lineTo(0, H * 0.58);
      g.quadraticCurveTo(W * 0.25, H * 0.52, W * 0.5, H * 0.7);
      g.lineTo(W * 0.5, H);
      g.fill();
      for (const hs of this.houses) {
        const x = hs.x * W;
        const gy = H * (0.58 + Math.pow(hs.x / 0.5, 2) * 0.1) + 6;
        const w = hs.w * W;
        const h = hs.h * H;
        g.fillStyle = rgb(mix(E.mid, E.near, 0.5 + hs.roof * 0.3));
        g.fillRect(x, gy - h, w, h);
        g.beginPath();
        g.moveTo(x - 2, gy - h);
        g.lineTo(x + w / 2, gy - h - w * 0.55);
        g.lineTo(x + w + 2, gy - h);
        g.fill();
        this.windows(E, x + w * 0.3, gy - h * 0.7, Math.max(2, w * 0.25), Math.max(2, h * 0.22), hs.lit, hs.lit * 50);
      }
      g.fillStyle = rgb(E.near);
      g.fillRect(W * 0.38, H * 0.705, W * 0.4, H * 0.016);
      for (let i = 0; i < 9; i++) g.fillRect(W * (0.39 + i * 0.045), H * 0.72, 2.5, H * 0.07);
      for (const px of [0.48, 0.7]) {
        g.fillStyle = rgb(E.near);
        g.fillRect(W * px, H * 0.62, 2, H * 0.085);
        if (E.glow > 0.2) this.glowAt(W * px, H * 0.62, H * 0.06, WARM, 0.8 * E.glow);
      }
      [0.56, 0.68, 0.82, 0.93].forEach((bx, i) => {
        const bob = Math.sin(T * 1.4 + i * 1.7) * (1.5 + c.wind * 4);
        const tilt = Math.sin(T * 1.1 + i) * 0.03 * (1 + c.wind * 3);
        g.save();
        g.translate(W * bx, H * (0.8 + (i % 2) * 0.07) + bob);
        g.rotate(tilt);
        const s = W * (0.05 + (i % 2) * 0.012);
        g.fillStyle = rgb(E.near);
        g.beginPath();
        g.moveTo(-s, 0);
        g.lineTo(s, 0);
        g.lineTo(s * 0.75, s * 0.28);
        g.lineTo(-s * 0.7, s * 0.28);
        g.fill();
        g.fillRect(-1, -s * 1.5, 2, s * 1.5);
        g.beginPath();
        g.moveTo(2, -s * 1.4);
        g.lineTo(s * 0.7, -s * 0.15);
        g.lineTo(2, -s * 0.15);
        g.fillStyle = rgb(mix(E.near, E.far, 0.35));
        g.fill();
        if (E.glow > 0.3) {
          g.fillStyle = rgb(WARM, E.glow);
          g.beginPath();
          g.arc(0, -s * 1.5, 1.8, 0, 7);
          g.fill();
        }
        g.restore();
      });
    } else if (p === "forest") {
      this.pines.forEach((layer, L) => {
        const col = [E.far, E.mid, E.near][L]!;
        const gy = H * (0.66 + L * 0.1);
        g.fillStyle = rgb(mix(col, E.sky.bot, L === 0 ? 0.25 : 0));
        g.beginPath();
        g.moveTo(0, H);
        for (let x = 0; x <= W; x += 8) g.lineTo(x, gy + Math.sin((x / W) * 6 + L) * H * 0.02);
        g.lineTo(W, H);
        g.fill();
        for (const pn of layer) {
          const x = pn.x * W;
          const h = pn.h * H;
          const sway = Math.sin(T * 1.8 + pn.p) * c.wind * 4;
          const by = gy + Math.sin(pn.x * 6 + L) * H * 0.02 + 4;
          for (let tier = 0; tier < 4; tier++) {
            const ty = by - h * (tier * 0.24);
            const tw = h * (0.26 - tier * 0.05);
            g.beginPath();
            g.moveTo(x - tw, ty);
            g.lineTo(x + sway * (tier + 1) * 0.3, ty - h * 0.42);
            g.lineTo(x + tw, ty);
            g.fill();
          }
        }
      });
      this.cabin(E, W * 0.58, H * 0.87);
      const fa = E.night * (1 - c.rain) * (1 - c.snow) * (1 - c.wind * 0.8);
      if (fa > 0.05)
        for (const f of this.flies) {
          const x = (f.x + Math.sin(T * 0.3 * f.s + f.p) * 0.03) * W;
          const y = (f.y + Math.cos(T * 0.4 * f.s + f.p) * 0.02) * H;
          this.glowAt(x, y, 7, [230, 255, 150], fa * (0.5 + 0.5 * Math.sin(T * 3 * f.s + f.p)));
        }
    } else if (p === "city") {
      this.towers.forEach((row, L) => {
        const col = L ? E.near : E.mid;
        const gy = H * (L ? 1 : 0.84);
        for (const b of row) {
          const x = b.x * W;
          const w = b.w * W;
          const h = b.h * H;
          g.fillStyle = rgb(col);
          g.fillRect(x, gy - h, w, h);
          const cols = Math.max(2, Math.floor(w / 9));
          const rows = Math.floor(h / 12);
          const cw = w / cols;
          let n = 0;
          for (let r2 = 1; r2 < rows; r2++)
            for (let k = 0; k < cols; k++) {
              const lit = b.win[n++ % 60]!;
              if (lit < E.glow * (L ? 0.55 : 0.4)) {
                const flicker = (lit * 997) % 1 < 0.03 ? 0.4 + 0.6 * Math.abs(Math.sin(T * 7 + lit * 40)) : 1;
                g.fillStyle = rgb(lit < 0.08 ? [170, 210, 255] : WARM, (L ? 0.85 : 0.55) * clamp(E.glow * 1.5) * flicker);
                g.fillRect(x + k * cw + cw * 0.3, gy - h + r2 * 12, cw * 0.4, 5);
              }
            }
        }
        if (L) {
          const tb = row.reduce((a, b) => (b.h > a.h ? b : a));
          const ax = (tb.x + tb.w / 2) * W;
          const ay = H - tb.h * H;
          g.fillStyle = rgb(col);
          g.fillRect(ax - 1, ay - H * 0.07, 2, H * 0.07);
          if (Math.sin(T * 3) > 0) this.glowAt(ax, ay - H * 0.07, 10, [255, 70, 80], 0.95);
        }
      });
      const st = g.createLinearGradient(0, H, 0, H * 0.75);
      st.addColorStop(0, rgb(WARM, 0.22 * E.glow));
      st.addColorStop(1, rgb(WARM, 0));
      g.fillStyle = st;
      g.fillRect(0, H * 0.75, W, H * 0.25);
    } else if (p === "desert") {
      const sand = mix([60, 40, 50], [222, 160, 104], E.day);
      (
        [
          [0.62, 0.35, E.far],
          [0.74, 0.55, E.mid],
          [0.86, 0.8, E.near],
        ] as const
      ).forEach(([y0, k, base], i) => {
        const col = mix(base, sand, (1 - k) * 0.4 + E.day * 0.35 * (1 - i * 0.25));
        g.fillStyle = rgb(col);
        g.beginPath();
        g.moveTo(0, H);
        for (let x = 0; x <= W; x += 6) {
          const u = x / W;
          g.lineTo(x, H * (y0 - 0.05 * Math.sin(u * (3 + i) + i * 2 + this.hills[2]!) - 0.02 * Math.sin(u * 11 + i)));
        }
        g.lineTo(W, H);
        g.fill();
      });
      const ax = W * 0.68;
      const ay = H * 0.76;
      const aw = W * 0.14;
      const ah = H * 0.2;
      const x0 = ax + aw * 0.09;
      const x1 = ax + aw * 0.91;
      g.strokeStyle = rgb(E.near);
      g.lineWidth = aw * 0.18;
      g.lineCap = "butt";
      g.beginPath();
      g.moveTo(x0, ay);
      g.lineTo(x0, ay - ah);
      g.arc((x0 + x1) / 2, ay - ah, (x1 - x0) / 2, Math.PI, Math.PI * 1.72);
      g.stroke();
      g.beginPath();
      g.moveTo(x1, ay);
      g.lineTo(x1, ay - ah * 0.72);
      g.stroke();
      if (E.glow > 0.15) this.fire(E, W * 0.3, H * 0.9);
    } else if (p === "castle") {
      this.ground(E.mid, 0.74, 0.03, 4, this.hills[3]!);
      // A keep on its hill: curtain wall, towers with crenellations, a great hall and banners.
      const gx = W * 0.58;
      const gy = H * 0.66;
      const wall = H * 0.09;
      const col = E.near;
      g.fillStyle = rgb(col);
      g.beginPath();
      g.moveTo(W * 0.3, H);
      g.quadraticCurveTo(W * 0.42, gy - H * 0.02, gx, gy);
      g.quadraticCurveTo(W * 0.78, gy - H * 0.01, W * 0.92, H);
      g.fill();
      g.fillRect(W * 0.4, gy - wall, W * 0.38, wall + 4);
      for (let x = W * 0.4; x < W * 0.78; x += W * 0.016) g.fillRect(x, gy - wall - H * 0.014, W * 0.009, H * 0.014);
      const towers: [number, number, number][] = [
        [0.4, 0.2, 0.04],
        [0.52, 0.29, 0.05],
        [0.66, 0.24, 0.045],
        [0.78, 0.18, 0.04],
      ];
      for (const [tx, th, tw] of towers) {
        const x = W * tx - (W * tw) / 2;
        const top = gy - H * th;
        g.fillStyle = rgb(col);
        g.fillRect(x, top, W * tw, H * th);
        for (let k = 0; k < 4; k++) g.fillRect(x + (k * W * tw) / 3.5 - 1, top - H * 0.016, (W * tw) / 6, H * 0.016);
        this.windows(E, x + W * tw * 0.4, top + H * th * 0.3, W * tw * 0.2, H * 0.022, tx * 0.6, tx * 30);
        // banner
        const bx = W * tx;
        const by = top - H * 0.016;
        g.fillRect(bx - 0.75, by - H * 0.07, 1.5, H * 0.07);
        const flap = Math.sin(T * (2 + c.wind * 4) + tx * 10) * (2 + c.wind * 5);
        g.fillStyle = rgb(mix(E.near, [150, 40, 50], 0.35 + E.day * 0.4));
        g.beginPath();
        g.moveTo(bx + 1, by - H * 0.07);
        g.quadraticCurveTo(bx + W * 0.02, by - H * 0.065 + flap * 0.3, bx + W * 0.035, by - H * 0.06 + flap);
        g.lineTo(bx + 1, by - H * 0.045);
        g.fill();
      }
      g.fillStyle = rgb(col);
      g.fillRect(W * 0.55, gy - wall - H * 0.05, W * 0.09, H * 0.05);
      g.beginPath();
      g.moveTo(W * 0.545, gy - wall - H * 0.05);
      g.lineTo(W * 0.595, gy - wall - H * 0.1);
      g.lineTo(W * 0.645, gy - wall - H * 0.05);
      g.fill();
      for (let k = 0; k < 3; k++) this.windows(E, W * (0.56 + k * 0.026), gy - wall - H * 0.036, W * 0.01, H * 0.024, 0.05 + k * 0.1, k * 7);
      this.ground(E.near, 0.95, 0.025, 3, 1.2);
      if (E.glow > 0.2) this.fire(E, W * 0.2, H * 0.93);
    } else {
      // hills: farmland and a lone tree, a village light or two.
      this.ground(mix(E.mid, [70, 110, 70], E.day * 0.35), 0.72, 0.04, 3, this.hills[3]!);
      const r = rand(11);
      for (let i = 0; i < 5; i++) {
        const x = W * (0.12 + i * 0.07 + r() * 0.03);
        const y = H * (0.71 - 0.04 * Math.sin((x / W) * 3 + this.hills[3]!));
        g.fillStyle = rgb(mix(E.mid, E.near, 0.5));
        g.fillRect(x, y - H * 0.03, W * 0.025, H * 0.03);
        g.beginPath();
        g.moveTo(x - 2, y - H * 0.03);
        g.lineTo(x + W * 0.0125, y - H * 0.05);
        g.lineTo(x + W * 0.027, y - H * 0.03);
        g.fill();
        this.windows(E, x + W * 0.008, y - H * 0.022, W * 0.007, H * 0.012, r(), i * 5);
      }
      this.ground(mix(E.near, [50, 80, 50], E.day * 0.3), 0.88, 0.035, 2.4, 0.4);
      const tx = W * 0.74;
      const ty = H * 0.82;
      const sway = Math.sin(T * 1.6) * c.wind * 3;
      g.fillStyle = rgb(E.near);
      g.fillRect(tx - 2, ty - H * 0.12, 4, H * 0.12);
      for (const [dx, dy, rr] of [
        [0, -0.16, 0.06],
        [-0.035, -0.13, 0.045],
        [0.035, -0.13, 0.045],
      ] as const) {
        g.beginPath();
        g.arc(tx + W * dx + sway, ty + H * dy, H * rr, 0, 7);
        g.fill();
      }
    }
  }

  private cabin(E: Env, cx: number, cy: number) {
    const g = this.g;
    const W = this.w;
    const H = this.h;
    const T = this.time;
    g.fillStyle = rgb(E.near);
    g.fillRect(cx, cy - H * 0.06, W * 0.07, H * 0.06);
    g.beginPath();
    g.moveTo(cx - 4, cy - H * 0.06);
    g.lineTo(cx + W * 0.035, cy - H * 0.1);
    g.lineTo(cx + W * 0.074, cy - H * 0.06);
    g.fill();
    this.windows(E, cx + W * 0.012, cy - H * 0.042, W * 0.014, H * 0.02, 0.1, 7);
    this.windows(E, cx + W * 0.044, cy - H * 0.042, W * 0.014, H * 0.02, 0.1, 9);
    if (E.glow > 0.3)
      for (let i = 0; i < 6; i++) {
        const k = (T * 0.15 + i / 6) % 1;
        g.fillStyle = `rgba(200,200,215,${0.18 * (1 - k)})`;
        g.beginPath();
        g.arc(cx + W * 0.06 + k * 30 * (1 + this.cur.wind * 3), cy - H * 0.11 - k * H * 0.18, 4 + k * 14, 0, 7);
        g.fill();
      }
  }

  private fire(E: Env, fx: number, fy: number) {
    const g = this.g;
    const H = this.h;
    const T = this.time;
    const fl = 0.85 + 0.15 * Math.sin(T * 13) * Math.sin(T * 7);
    this.glowAt(fx, fy, H * 0.16 * fl, [255, 170, 90], 0.85 * E.glow);
    g.fillStyle = `rgba(255,220,150,${E.glow})`;
    g.beginPath();
    g.moveTo(fx - 5, fy);
    g.quadraticCurveTo(fx, fy - 14 * fl, fx + 5, fy);
    g.fill();
  }
}
