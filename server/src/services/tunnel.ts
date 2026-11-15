import { existsSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config";
import { getSetting, setSetting } from "../lib/settings";

/**
 * The tunnel that lets the phone app reach Mea from anywhere (replaces Tailscale for the app).
 *
 * Two kinds are understood:
 * - Pangolin (or any tunnel with your own address): you enter the address once; Mea checks it by
 *   calling its own /api/ping through it, which says which of Mea's doors the call arrived at.
 * - ngrok: found through the ngrok agent's local API, as before.
 */
export type TunnelProvider = "pangolin" | "ngrok";
/** Why a saved address isn't working: nothing answered, the tunnel's own login page is in the way, it isn't Mea. */
export type TunnelProblem = "unreachable" | "login" | "not-mea";

export interface TunnelStatus {
  /** The tunnel's door on this computer; the tunnel should forward here. 0 when it's turned off. */
  port: number;
  provider: TunnelProvider | null;
  /** The https address the phone app uses (pairing links start with it). */
  url: string | null;
  /** The address you entered in Settings → Devices (or MEA_PUBLIC_URL), whether or not it works yet. */
  address: string | null;
  /** The address answered as Mea's tunnel door just now. Null when there's no address to check. */
  reachable: boolean | null;
  problem: TunnelProblem | null;
  /** A tunnel exists but reaches Mea's main port, which trusts everything as this computer. */
  wrongPort: string | null;
  /** Whether the tunnel program for `provider` (or either, when none) is on this computer and running. */
  installed: boolean;
  running: boolean;
  newt: { installed: boolean; running: boolean };
  ngrok: { installed: boolean; running: boolean };
  /** Starts Newt at every boot (scripts/install-pangolin.ps1). */
  pangolinCommand: string;
  setupCommands: string[];
  error?: string;
}

interface NgrokTunnel {
  public_url?: string;
  proto?: string;
  config?: { addr?: string };
}

const NGROK_API = process.env.MEA_NGROK_API ?? "http://127.0.0.1:4040/api/tunnels";
/** Newt's Prometheus page; scripts/install-pangolin.ps1 starts Newt with --metrics on this address. */
const NEWT_METRICS = process.env.MEA_NEWT_METRICS ?? "http://127.0.0.1:2112/metrics";

function portOf(addr: string | undefined): number | null {
  const m = addr?.match(/:(\d+)\/?$/) ?? addr?.match(/^(\d+)$/);
  return m ? Number(m[1]) : null;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * "mea.example.com", "https://mea.example.com/", or a whole pairing link → "https://mea.example.com".
 * Only https, except on this computer (which the tests use). Null when it isn't an address.
 */
export function normalizeTunnelAddress(input: string | null | undefined): string | null {
  const raw = input?.trim();
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const local = LOCAL_HOSTS.has(u.hostname);
  if (u.protocol !== "https:" && !(local && u.protocol === "http:")) return null;
  if (!local && !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(u.hostname)) return null;
  return u.origin;
}

function isNgrokAddress(url: string): boolean {
  return /\.ngrok(-free)?\.(app|dev|io)$/i.test(new URL(url).hostname);
}

interface Probe {
  ok: boolean;
  door: "tunnel" | "main" | null;
  problem: TunnelProblem | null;
}
const probes = new Map<string, { at: number; probe: Probe }>();

/** Calls Mea's own /api/ping through the address. Cached briefly: the Devices page asks often. */
async function probe(address: string): Promise<Probe> {
  const hit = probes.get(address);
  if (hit && Date.now() - hit.at < (hit.probe.ok ? 30_000 : 8_000)) return hit.probe;
  let result: Probe;
  try {
    const res = await fetch(`${address}/api/ping`, {
      redirect: "manual",
      headers: { "user-agent": "MeaTunnelCheck/1", "ngrok-skip-browser-warning": "1" },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status >= 300 && res.status < 400) {
      // Pangolin (and most tunnels' own logins) send you to a sign-in page first.
      result = { ok: false, door: null, problem: "login" };
    } else {
      const data = (await res.json().catch(() => null)) as { app?: string; door?: string } | null;
      if (res.ok && data?.app === "mea") {
        const door = data.door === "main" ? "main" : "tunnel";
        result = { ok: door === "tunnel", door, problem: null };
      } else if (res.status === 401 || res.status === 403) {
        result = { ok: false, door: null, problem: "login" };
      } else {
        result = { ok: false, door: null, problem: res.status >= 500 ? "unreachable" : "not-mea" };
      }
    }
  } catch {
    result = { ok: false, door: null, problem: "unreachable" };
  }
  probes.set(address, { at: Date.now(), probe: result });
  return result;
}

async function ngrokAgent(): Promise<{ running: boolean; tunnels: NgrokTunnel[] }> {
  try {
    const res = await fetch(NGROK_API, { signal: AbortSignal.timeout(1500) });
    const data = (await res.json()) as { tunnels?: NgrokTunnel[] };
    return { running: true, tunnels: (data.tunnels ?? []).filter((t) => t.public_url?.startsWith("https://")) };
  } catch {
    return { running: false, tunnels: [] };
  }
}

async function newtRunning(): Promise<boolean> {
  try {
    const res = await fetch(NEWT_METRICS, { signal: AbortSignal.timeout(1500) });
    return res.ok && (await res.text()).includes("newt_");
  } catch {
    return false;
  }
}

function newtInstalled(): boolean {
  if (Bun.which("newt") || Bun.which("newt_windows_amd64")) return true;
  const local = process.env.LOCALAPPDATA;
  return Boolean(local && existsSync(join(local, "Mea", "newt", "newt.exe")));
}

/** The address to check: MEA_PUBLIC_URL wins over the one saved in Settings → Devices. */
export function savedTunnelAddress(): string | null {
  return normalizeTunnelAddress(process.env.MEA_PUBLIC_URL) ?? normalizeTunnelAddress(getSetting("tunnel.address"));
}

/**
 * The address pairing links start with, without waiting on the tunnel: the saved address unless a check
 * already found it reaching the trusted main port; otherwise the full status (ngrok's agent answers locally).
 */
export async function pairingTunnelUrl(): Promise<string | null> {
  const address = savedTunnelAddress();
  if (address && probes.get(address)?.probe.door !== "main") return address;
  return (await tunnelStatus()).url;
}

export function saveTunnelAddress(address: string | null) {
  setSetting("tunnel.address", address);
  probes.clear();
}

export async function tunnelStatus(): Promise<TunnelStatus> {
  const port = config.publicPort;
  const address = savedTunnelAddress();
  const host = address ? new URL(address).host : "mea.your-domain.com";
  const pangolinCommand = `powershell -ExecutionPolicy Bypass -File scripts\\install-pangolin.ps1 -Id <site id> -Address ${host}`;
  const [ngrok, newtUp] = await Promise.all([ngrokAgent(), newtRunning()]);
  const newt = { installed: newtUp || newtInstalled(), running: newtUp };
  const ngrokState = { installed: ngrok.running || Boolean(Bun.which("ngrok")), running: ngrok.running };
  const base: TunnelStatus = {
    port,
    provider: null,
    url: null,
    address,
    reachable: null,
    problem: null,
    wrongPort: null,
    installed: newt.installed || ngrokState.installed,
    running: newt.running || ngrokState.running,
    newt,
    ngrok: ngrokState,
    pangolinCommand,
    setupCommands: [pangolinCommand],
  };
  if (!port) return base;

  if (address) {
    const provider: TunnelProvider = isNgrokAddress(address) ? "ngrok" : "pangolin";
    const own = provider === "ngrok" ? ngrokState : newt;
    const p = await probe(address);
    return {
      ...base,
      provider,
      installed: own.installed,
      // Newt started by hand (without --metrics) can't be seen locally; an address that works is proof enough.
      running: own.running || p.ok,
      // The address stays the pairing link's base while it's merely down (the phone pairs once it's back);
      // never when it reaches the trusted port.
      url: p.door === "main" ? null : address,
      reachable: p.ok,
      problem: p.problem,
      wrongPort: p.door === "main" ? address : null,
      setupCommands: provider === "ngrok" ? [`ngrok http ${port} --url ${address}`] : [pangolinCommand],
    };
  }

  if (ngrok.running) {
    const ours = ngrok.tunnels.find((t) => portOf(t.config?.addr) === port);
    const wrong = ngrok.tunnels.find((t) => portOf(t.config?.addr) === config.port);
    return {
      ...base,
      provider: "ngrok",
      installed: true,
      running: true,
      url: ours?.public_url?.replace(/\/$/, "") ?? null,
      reachable: ours ? true : null,
      wrongPort: ours ? null : (wrong?.public_url ?? null),
      setupCommands: [`ngrok http ${port} --url <your-name>.ngrok-free.dev`],
    };
  }
  return base;
}
