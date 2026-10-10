import { config } from "../config";

export interface TunnelStatus {
  /** The tunnel's door on this computer; ngrok should forward here. 0 when it's turned off. */
  port: number;
  installed: boolean;
  /** The ngrok agent answers on its local API. */
  running: boolean;
  /** The https address the phone app uses, when a tunnel points at Mea's tunnel port. */
  url: string | null;
  /** A tunnel exists but points somewhere else (often the trusted port, which would be unsafe). */
  wrongPort: string | null;
  setupCommands: string[];
  error?: string;
}

interface NgrokTunnel {
  public_url?: string;
  proto?: string;
  config?: { addr?: string };
}

const AGENT_API = process.env.MEA_NGROK_API ?? "http://127.0.0.1:4040/api/tunnels";

function portOf(addr: string | undefined): number | null {
  const m = addr?.match(/:(\d+)\/?$/) ?? addr?.match(/^(\d+)$/);
  return m ? Number(m[1]) : null;
}

/** Finds the ngrok address that reaches Mea from anywhere (replaces Tailscale for the phone app). */
export async function tunnelStatus(): Promise<TunnelStatus> {
  const port = config.publicPort;
  const setupCommands = [
    "ngrok config add-authtoken <your token from dashboard.ngrok.com>",
    `ngrok http ${port} --url <your-name>.ngrok-free.dev`,
  ];
  const base: TunnelStatus = { port, installed: Boolean(Bun.which("ngrok")), running: false, url: process.env.MEA_PUBLIC_URL ?? null, wrongPort: null, setupCommands };
  if (base.url || !port) return base;
  try {
    const res = await fetch(AGENT_API, { signal: AbortSignal.timeout(1500) });
    const data = (await res.json()) as { tunnels?: NgrokTunnel[] };
    const https = (data.tunnels ?? []).filter((t) => t.public_url?.startsWith("https://"));
    const ours = https.find((t) => portOf(t.config?.addr) === port);
    return {
      ...base,
      installed: true,
      running: true,
      url: ours?.public_url?.replace(/\/$/, "") ?? null,
      wrongPort: ours ? null : (https.find((t) => portOf(t.config?.addr) === config.port)?.public_url ?? null),
    };
  } catch (e) {
    return { ...base, error: base.installed ? undefined : (e as Error).message };
  }
}
