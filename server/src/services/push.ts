import webpush from "web-push";
import { all, newId, now, run } from "../db/db";
import { getSetting, setSetting } from "../lib/settings";

/** Web Push (MOB-06): VAPID keys are generated once and kept in settings. */
export function vapidKeys() {
  let keys = getSetting("push.vapid");
  if (!keys) {
    keys = webpush.generateVAPIDKeys();
    setSetting("push.vapid", keys);
  }
  return keys;
}

export function publicVapidKey() {
  return vapidKeys().publicKey;
}

export function saveSubscription(sub: { endpoint: string; keys: { p256dh: string; auth: string } }, deviceId: string | null) {
  run(
    `INSERT INTO push_subscriptions (id, device_id, endpoint, keys, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET keys = excluded.keys, device_id = excluded.device_id`,
    newId(),
    deviceId,
    sub.endpoint,
    JSON.stringify(sub.keys),
    now(),
  );
}

export function removeSubscription(endpoint: string) {
  run("DELETE FROM push_subscriptions WHERE endpoint = ?", endpoint);
}

export function subscriptionCount() {
  return all<{ n: number }>("SELECT COUNT(*) AS n FROM push_subscriptions")[0]?.n ?? 0;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

export async function sendPush(payload: PushPayload): Promise<number> {
  const subs = all<{ endpoint: string; keys: string }>("SELECT endpoint, keys FROM push_subscriptions");
  if (!subs.length) return 0;
  const keys = vapidKeys();
  webpush.setVapidDetails("mailto:mea@localhost.localdomain", keys.publicKey, keys.privateKey);
  let sent = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: JSON.parse(s.keys) }, JSON.stringify(payload), { TTL: 3600, urgency: "normal" });
        sent++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) removeSubscription(s.endpoint);
      }
    }),
  );
  return sent;
}
