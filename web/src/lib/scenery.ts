/**
 * The scene window: a painting of the story's sky, weather and place, drawn every frame on a
 * canvas from what the trackers know (time, wx, at). Free text is read into a kind of sky and a
 * kind of place ("fog off the water" → fog; "Winterfell › the godswood" → forest); the places
 * themselves live in scenes.ts. It pauses when off screen and holds still for people who prefer
 * less motion.
 */
import { clamp, DARK, hex, lerp, mix, type Env, type Home, type Place, type RGB, type Wx, rand, rgb } from "./places";

import { buildScene } from "./morescenes";
import type { Scene } from "./scenes";

export { HOME_STYLES, PLACE_GROUPS, PLACES, isPlace, readHome, readPlace, type Home, type HomeStyle, type Place } from "./places";

export type Weather = "clear" | "cloudy" | "rain" | "storm" | "fog" | "snow" | "wind";

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

/** J1: the sky's top and horizon colours at an hour (0–24), for the scene plates. */
export function skyColors(hour: number): [string, string] {
  const [a, b] = skyAt(((hour % 24) + 24) % 24);
  return [rgb(a), rgb(b)];
}

const WX: Record<Weather, Wx> = {
  clear: { cloud: 0.08, rain: 0, snow: 0, fog: 0, storm: 0, wind: 0.1 },
  cloudy: { cloud: 0.85, rain: 0, snow: 0, fog: 0.1, storm: 0, wind: 0.25 },
  rain: { cloud: 0.92, rain: 0.6, snow: 0, fog: 0.1, storm: 0, wind: 0.3 },
  storm: { cloud: 1, rain: 1, snow: 0, fog: 0.05, storm: 1, wind: 0.85 },
  fog: { cloud: 0.55, rain: 0, snow: 0, fog: 1, storm: 0, wind: 0.05 },
  snow: { cloud: 0.78, rain: 0, snow: 0.85, fog: 0.15, storm: 0, wind: 0.2 },
  wind: { cloud: 0.45, rain: 0, snow: 0, fog: 0, storm: 0, wind: 1 },
};

export interface PainterOptions {
  /** Fewer particles, for small windows. */
  mini?: boolean;
  /** Where across the width the place's subject sits (0–1). */
  focus?: number;
  /** Paint one frame and hold it (thumbnails). */
  still?: boolean;
}

/** What a single still frame shows. */
export interface StillScene {
  hour: number;
  weather: Weather;
  place: Place;
  seed: string;
  home?: Home | null;
  focus?: number;
  mini?: boolean;
}

export class ScenePainter {
  private g: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private t = 21;
  private wx: Weather = "clear";
  private place: Place = "hills";
  private seed = "";
  private home: Home | null = null;
  private scene: Scene | null = null;
  private snap: HTMLCanvasElement | null = null;
  private pm = 1;
  private cur = { ...WX.clear };
  private flash = 0;
  private again = false;
  private bolt: number[][] | null = null;
  private time = 0;
  private visible = true;
  private still: boolean;
  private mini: boolean;
  private focus: number;
  private light: Env["light"] = null;
  private raf = 0;
  private last = performance.now();
  private ro: ResizeObserver;
  private io: IntersectionObserver;
  private drops: { x: number; y: number; v: number; l: number }[];
  private flakes: { x: number; y: number; v: number; s: number; p: number }[];
  private stars: { x: number; y: number; s: number; p: number }[];
  private clouds: { x: number; y: number; s: number; v: number; b: number[][] }[];
  private leaves: { x: number; y: number; v: number; p: number }[];
  private glass: { x: number; y: number; s: number; v: number }[];

  constructor(
    private canvas: HTMLCanvasElement,
    opts: PainterOptions = {},
  ) {
    this.g = canvas.getContext("2d")!;
    this.mini = Boolean(opts.mini);
    this.focus = opts.focus ?? 0.62;
    this.still = Boolean(opts.still) || matchMedia("(prefers-reduced-motion: reduce)").matches;
    const mini = this.mini;
    const r = rand(mini ? 7 : 3);
    this.stars = Array.from({ length: 170 }, () => ({ x: r(), y: r() * 0.62, s: r() * 1.4 + 0.3, p: r() * 6.28 }));
    this.clouds = Array.from({ length: 9 }, () => ({ x: r() * 1.4 - 0.2, y: 0.05 + r() * 0.3, s: 0.6 + r() * 0.9, v: 0.004 + r() * 0.008, b: Array.from({ length: 6 }, () => [r() * 0.16 - 0.08, r() * 0.04 - 0.02, 0.03 + r() * 0.05]) }));
    this.drops = Array.from({ length: mini ? 160 : 480 }, () => ({ x: r(), y: r(), v: 0.9 + r() * 0.8, l: 0.02 + r() * 0.03 }));
    this.flakes = Array.from({ length: mini ? 110 : 300 }, () => ({ x: r(), y: r(), v: 0.03 + r() * 0.06, s: 0.6 + r() * 2.2, p: r() * 6.28 }));
    this.leaves = Array.from({ length: 40 }, () => ({ x: r(), y: 0.2 + r() * 0.75, v: 0.25 + r() * 0.35, p: r() * 6.28 }));
    this.glass = Array.from({ length: mini ? 0 : 40 }, () => ({ x: r(), y: r(), s: 1.5 + r() * 4, v: r() < 0.25 ? 0.01 + r() * 0.04 : 0 }));
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.io = new IntersectionObserver(([e]) => (this.visible = Boolean(e?.isIntersecting)));
    this.io.observe(canvas);
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      if (this.visible && !document.hidden) this.frame(dt);
      this.raf = requestAnimationFrame(loop);
    };
    // L15: with reduced motion the scene is drawn once (on resize and on each change), not 60 times a second.
    if (!this.still) this.raf = requestAnimationFrame(loop);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.io.disconnect();
  }

  set(o: { hour?: number; weather?: Weather; place?: Place; seed?: string; home?: Home | null }) {
    if (o.hour != null) this.t = ((o.hour % 24) + 24) % 24;
    if (o.weather) this.wx = o.weather;
    const seed = o.seed ?? this.seed;
    const home = o.home === undefined ? this.home : o.home;
    if ((o.place && o.place !== this.place) || seed !== this.seed || home?.house !== this.home?.house || home?.style !== this.home?.style) {
      this.home = home;
      // Crossfade from what's on screen now to the new place.
      if (this.w && !this.still) {
        this.snap ??= document.createElement("canvas");
        this.snap.width = this.canvas.width;
        this.snap.height = this.canvas.height;
        this.snap.getContext("2d")!.drawImage(this.canvas, 0, 0);
        this.pm = 0;
      }
      this.place = o.place ?? this.place;
      this.seed = seed;
      this.build();
    }
    if (this.still) {
      this.cur = { ...WX[this.wx] };
      this.pm = 1;
      this.frame(0);
    }
  }

  private build() {
    this.scene = this.w ? buildScene(this.place, this.seed, this.w, this.h, this.focus, this.mini, this.home) : null;
  }

  private resize() {
    const r = this.canvas.getBoundingClientRect();
    this.fit(r.width, r.height, Math.min(2, devicePixelRatio || 1));
  }

  private fit(w: number, h: number, d: number) {
    if (Math.abs(w - this.w) < 0.5 && Math.abs(h - this.h) < 0.5) return;
    this.w = w;
    this.h = h;
    this.canvas.width = Math.round(w * d);
    this.canvas.height = Math.round(h * d);
    this.g.setTransform(d, 0, 0, d, 0, 0);
    this.build();
    if (this.still) this.frame(0);
  }

  /** One finished frame now, at the canvas's size on screen or at `size`. Holds nothing afterwards. */
  static paintOnce(canvas: HTMLCanvasElement, scene: StillScene, size?: { w: number; h: number }) {
    const p = new ScenePainter(canvas, { still: true, mini: scene.mini, focus: scene.focus });
    p.set(scene);
    if (size) p.fit(size.w, size.h, 1);
    else p.resize();
    p.destroy();
  }

  private frame(dt: number) {
    if (!this.w) return;
    this.time += dt;
    const k = this.still ? 1 : 1 - Math.exp(-dt * 1.6);
    const tgt = WX[this.wx];
    for (const key of Object.keys(tgt) as (keyof Wx)[]) this.cur[key] = lerp(this.cur[key], tgt[key], k);
    this.pm = Math.min(1, this.pm + dt * 0.9);
    this.draw(dt);
  }

  private env(): Env {
    const t = this.t;
    const c = this.cur;
    const sunAlt = Math.sin((Math.PI * (t - 6.1)) / 12.8);
    const day = clamp(sunAlt * 2.2 + 0.25);
    let [top, bot] = skyAt(t);
    const grey: RGB = mix([20, 22, 32], [128, 134, 148], day);
    top = mix(top, grey, c.cloud * 0.6);
    bot = mix(bot, mix(grey, [170, 176, 188], day * 0.4), c.cloud * 0.5);
    bot = mix(bot, mix([200, 205, 215], bot, 0.5), c.fog * 0.35 * (0.3 + day));
    return {
      t,
      day,
      night: 1 - day,
      sunAlt,
      golden: sunAlt > -0.2 ? clamp(1 - Math.abs(sunAlt - 0.08) * 4.5) * (1 - c.cloud * 0.6) : 0,
      sky: { top, bot },
      glow: clamp(Math.max(1 - day, c.cloud * 0.55 + c.fog * 0.3)),
      c,
      light: this.light,
      T: this.time,
      still: this.still,
    };
  }

  private draw(dt: number) {
    const g = this.g;
    const W = this.w;
    const H = this.h;
    const E = this.env();
    const c = this.cur;
    const S = this.scene;
    if (!S?.space) this.sky(E, dt);
    E.light = this.light;
    S?.draw(g, E);
    if (S?.room) {
      if (!S.space) {
        g.save();
        g.clip(S.room.win);
        this.weather(E, dt);
        g.restore();
      }
      S.room.draw(g, E);
    } else if (!S?.space) this.weather(E, dt);
    // lightning lights the room too
    if (!this.still && !S?.space && c.storm > 0.6 && Math.random() < dt * 0.35) this.strike();
    if (this.flash > 0) {
      g.fillStyle = `rgba(225,230,255,${this.flash * (S?.room ? 0.25 : 0.5)})`;
      g.fillRect(0, 0, W, H);
      if (this.bolt && this.flash > 0.25 && !S?.room) {
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
    const vg = g.createRadialGradient(W / 2, H * 0.55, H * 0.3, W / 2, H * 0.55, Math.max(H * 1.05, W * 0.6));
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(5,3,12,.5)");
    g.fillStyle = vg;
    g.fillRect(0, 0, W, H);
    if (this.snap && this.pm < 1) {
      g.globalAlpha = 1 - this.pm;
      g.drawImage(this.snap, 0, 0, W, H);
      g.globalAlpha = 1;
    }
  }

  /** The sky: its colour at the hour, stars, sun or moon, and clouds. */
  private sky(E: Env, dt: number) {
    const g = this.g;
    const W = this.w;
    const H = this.h;
    const c = this.cur;
    const T = this.time;
    const sg = g.createLinearGradient(0, 0, 0, H * 0.72);
    sg.addColorStop(0, rgb(E.sky.top));
    sg.addColorStop(1, rgb(E.sky.bot));
    g.fillStyle = sg;
    g.fillRect(0, 0, W, H);
    const sa = E.night * (1 - c.cloud) * (1 - c.fog * 0.8);
    if (sa > 0.01)
      for (const s of this.stars) {
        g.fillStyle = `rgba(255,255,255,${sa * (0.45 + 0.55 * Math.sin(T * 1.6 + s.p)) ** 2})`;
        g.fillRect(s.x * W, s.y * H, s.s, s.s);
      }
    this.light = null;
    if (E.sunAlt > -0.15) {
      const sx = W * clamp((E.t - 6.1) / 12.8);
      const sy = H * 0.66 - E.sunAlt * H * 0.55;
      const a = clamp((E.sunAlt + 0.15) * 3) * (1 - c.cloud * 0.75);
      const warm = mix([255, 150, 90], [255, 246, 220], clamp(E.sunAlt * 2));
      const gl = g.createRadialGradient(sx, sy, 0, sx, sy, Math.max(H * 0.55, W * 0.25));
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
    const moonT = (E.t - 18.6 + 24) % 24;
    const moonAlt = moonT < 12.4 ? Math.sin((Math.PI * moonT) / 12.4) : -1;
    if (moonAlt > 0) {
      const mx = W * (0.08 + 0.84 * (moonT / 12.4));
      const my = H * 0.62 - moonAlt * H * 0.5;
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
    if (c.cloud > 0.04) {
      const cc = mix(mix(mix([60, 62, 80], [250, 246, 250], E.day), E.sky.bot, 0.25), [255, 190, 160], E.golden * 0.4);
      const under = mix(cc, DARK, 0.35);
      for (const cl of this.clouds) {
        cl.x += cl.v * dt * (1 + c.wind * 3);
        if (cl.x > 1.3) cl.x = -0.3;
        for (const [bx, by, br] of cl.b) {
          const x = (cl.x + bx! * cl.s) * W;
          const y = (cl.y + by! * cl.s) * H;
          const rr = br! * cl.s * Math.min(W, H * 2.4) * 0.9;
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
  }

  /** Fog, rain, snow, gale and drops on the glass. */
  private weather(E: Env, dt: number) {
    const g = this.g;
    const W = this.w;
    const H = this.h;
    const c = this.cur;
    const T = this.time;
    if (c.fog > 0.02) {
      const fc = mix(E.sky.bot, [210, 214, 224], 0.35 + E.day * 0.3);
      for (let i = 0; i < 6; i++) {
        const y = H * (0.48 + i * 0.09);
        const off = ((T * (0.012 + i * 0.006) + i * 0.3) % 1) * W;
        for (const dx of [-W, 0]) {
          g.save();
          g.translate(off + dx + W * 0.5, y);
          g.scale(3.2, 1);
          const fr = Math.max(W * 0.2, H * 0.4);
          const fg = g.createRadialGradient(0, 0, 0, 0, 0, fr);
          fg.addColorStop(0, rgb(fc, 0.42 * c.fog));
          fg.addColorStop(1, rgb(fc, 0));
          g.fillStyle = fg;
          g.beginPath();
          g.arc(0, 0, fr, 0, 7);
          g.fill();
          g.restore();
        }
      }
      g.fillStyle = rgb(fc, 0.22 * c.fog);
      g.fillRect(0, 0, W, H);
    }
    g.fillStyle = `rgba(14,16,30,${0.22 * c.rain + 0.2 * c.storm})`;
    g.fillRect(0, 0, W, H);
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
        g.lineTo(x - Math.min(W * 0.06, H * 0.2), y + Math.sin(T * 2 + l.p) * 3);
        g.stroke();
        g.save();
        g.translate(x, y);
        g.rotate(T * 6 + l.p);
        g.fillStyle = rgb(mix([200, 120, 60], mix(E.sky.bot, DARK, 0.86), 0.4), a);
        g.beginPath();
        g.ellipse(0, 0, 3.4, 1.6, 0, 0, 7);
        g.fill();
        g.restore();
      }
    }
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
}
