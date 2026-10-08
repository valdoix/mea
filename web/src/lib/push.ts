import { get, post } from "./api";

/** Web Push on this device (MOB-06). Needs HTTPS (Tailscale Serve) or localhost. */
export const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && window.isSecureContext;

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

export async function enablePush(): Promise<boolean> {
  if (!pushSupported()) throw new Error("Notifications need the installed app over HTTPS (Tailscale), or localhost.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return false;
  const reg = await navigator.serviceWorker.ready;
  const { publicKey } = await get<{ publicKey: string }>("/api/push/key");
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }));
  await post("/api/push/subscribe", sub.toJSON());
  return true;
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  await post("/api/push/unsubscribe", { endpoint: sub.endpoint });
  await sub.unsubscribe();
}

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || import.meta.env.DEV) return;
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
