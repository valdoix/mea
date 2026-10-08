import { config } from "../config";

export interface TailscaleStatus {
  installed: boolean;
  running: boolean;
  dnsName: string | null;
  serveUrl: string | null;
  serving: boolean;
  enableCommand: string;
  error?: string;
}

async function runJson(args: string[]): Promise<unknown> {
  const proc = Bun.spawn(["tailscale", ...args], { stdout: "pipe", stderr: "pipe" });
  const timeout = setTimeout(() => proc.kill(), 4000);
  const out = await new Response(proc.stdout).text();
  clearTimeout(timeout);
  await proc.exited;
  if (proc.exitCode !== 0) throw new Error((await new Response(proc.stderr).text()).trim() || `tailscale exited with ${proc.exitCode}`);
  return JSON.parse(out);
}

/** Detects the Tailscale Serve HTTPS address phones use to reach Mea (ARCH-08). */
export async function tailscaleStatus(): Promise<TailscaleStatus> {
  const enableCommand = `tailscale serve --bg ${config.port}`;
  const base: TailscaleStatus = { installed: false, running: false, dnsName: null, serveUrl: null, serving: false, enableCommand };
  if (!Bun.which("tailscale")) return base;
  try {
    const status = (await runJson(["status", "--json"])) as { BackendState?: string; Self?: { DNSName?: string } };
    const dnsName = status.Self?.DNSName?.replace(/\.$/, "") || null;
    const result: TailscaleStatus = { ...base, installed: true, running: status.BackendState === "Running", dnsName, serveUrl: dnsName ? `https://${dnsName}` : null };
    try {
      const serve = JSON.stringify(await runJson(["serve", "status", "--json"]));
      result.serving = serve.includes(`:${config.port}`);
    } catch {
      result.serving = false;
    }
    return result;
  } catch (e) {
    return { ...base, installed: true, error: (e as Error).message };
  }
}
