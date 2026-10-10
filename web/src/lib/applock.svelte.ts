import { device } from "./device.svelte";

/**
 * MOB-11: app lock. A PIN (and, where the browser allows it, the phone's fingerprint or face via
 * WebAuthn) covers Mea after it has been in the background for a while. It's a privacy screen on
 * this device: pairing (SEC-02) is still what keeps other devices out, and encryption at rest
 * (SEC-05) is what protects the data on the computer.
 */

interface LockData {
  salt: string;
  hash: string;
  /** A platform credential's id, when biometrics were set up. */
  credId?: string;
}

const KEY = "mea.lock";
const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b instanceof Uint8Array ? b : new Uint8Array(b))));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function readData(): LockData | null {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return d && typeof d.hash === "string" ? d : null;
  } catch {
    return null;
  }
}

/** `covered`: the app is in the background, so a plain cover hides it (and the app switcher's snapshot). */
export const lock = $state({ enabled: Boolean(readData()), locked: Boolean(readData()), biometric: Boolean(readData()?.credId), covered: false });

async function derive(pin: string, salt: Uint8Array) {
  const keyMat = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  return b64(await crypto.subtle.deriveBits({ name: "PBKDF2", salt: salt as BufferSource, iterations: 150_000, hash: "SHA-256" }, keyMat, 256));
}

async function writePin(pin: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prev = readData();
  const data: LockData = { salt: b64(salt), hash: await derive(pin, salt), credId: prev?.credId };
  localStorage.setItem(KEY, JSON.stringify(data));
  lock.enabled = true;
  lock.locked = false;
}

/** Turns the lock on. M6: once it's on, changing the PIN needs the current one. */
export async function setPin(pin: string, current?: string) {
  if (readData() && !(await checkPin(current ?? ""))) return false;
  await writePin(pin);
  return true;
}

/** M6: turning the lock off needs the current PIN. */
export async function removeLock(current: string) {
  if (readData() && !(await checkPin(current))) return false;
  localStorage.removeItem(KEY);
  localStorage.removeItem(FAILS);
  lock.enabled = false;
  lock.locked = false;
  lock.biometric = false;
  return true;
}

// M6: wrong tries are counted on this device, so reloading the page doesn't reset the wait.
const FAILS = "mea.lock.failures";
function failures() {
  try {
    return Number(localStorage.getItem(FAILS)) || 0;
  } catch {
    return 0;
  }
}
function setFailures(n: number) {
  try {
    if (n) localStorage.setItem(FAILS, String(n));
    else localStorage.removeItem(FAILS);
  } catch {
    // storage unavailable
  }
}

/** Checks a PIN; a few wrong ones slow the next try down. */
async function checkPin(pin: string) {
  const d = readData();
  if (!d) return true;
  const n = failures();
  if (n >= 3) await new Promise((r) => setTimeout(r, Math.min(30_000, 1000 * 2 ** (n - 3))));
  const ok = (await derive(pin, unb64(d.salt))) === d.hash;
  setFailures(ok ? 0 : failures() + 1);
  return ok;
}

export async function unlockWithPin(pin: string) {
  const ok = await checkPin(pin);
  if (ok) lock.locked = false;
  return ok;
}

/** WebAuthn needs a secure page (https, or the computer Mea runs on). */
export const biometricsAvailable = () => typeof PublicKeyCredential !== "undefined" && window.isSecureContext;

export async function setupBiometrics() {
  const d = readData();
  if (!d) throw new Error("Set a PIN first");
  const cred = (await navigator.credentials.create({
    publicKey: {
      rp: { name: "Mea" },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: "mea", displayName: "Mea" },
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required" },
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("Cancelled");
  localStorage.setItem(KEY, JSON.stringify({ ...d, credId: b64(cred.rawId) }));
  lock.biometric = true;
}

export async function unlockWithBiometrics() {
  const d = readData();
  if (!d?.credId) return false;
  try {
    const got = await navigator.credentials.get({
      publicKey: { challenge: crypto.getRandomValues(new Uint8Array(32)), allowCredentials: [{ id: unb64(d.credId), type: "public-key" }], userVerification: "required", timeout: 60_000 },
    });
    if (got) {
      lock.locked = false;
      setFailures(0);
    }
    return Boolean(got);
  } catch {
    return false;
  }
}

/** Locks again after the app has been hidden for `device.lockAfter` minutes. */
export function watchLock() {
  let hiddenAt = 0;
  const onVis = () => {
    if (!lock.enabled) return;
    if (document.visibilityState === "hidden") {
      hiddenAt = Date.now();
      // M6: covered at once, so the app switcher's snapshot doesn't show the story; "right away" locks now.
      if (device.lockAfter <= 0) lock.locked = true;
      else lock.covered = true;
    } else {
      if (hiddenAt && Date.now() - hiddenAt >= device.lockAfter * 60_000) lock.locked = true;
      lock.covered = false;
    }
  };
  document.addEventListener("visibilitychange", onVis);
  return () => document.removeEventListener("visibilitychange", onVis);
}
