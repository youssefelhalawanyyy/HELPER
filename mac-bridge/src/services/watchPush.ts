import * as push from 'web-push';
import { loadLocal, saveLocal } from './localStore.js';

type Keys = ReturnType<typeof push.generateVAPIDKeys>;
let keys = loadLocal<Keys | null>('push-keys.json', null);
let subscribers = loadLocal<push.PushSubscription[]>('subscribers.json', []);
export function publicPushKey() {
  if (!keys) {
    keys = push.generateVAPIDKeys();
    saveLocal('push-keys.json', keys);
  }
  return keys.publicKey;
}
export function subscribeDevice(sub: push.PushSubscription, remove: boolean) {
  const url = new URL(sub.endpoint);
  if (
    url.protocol !== 'https:' ||
    !/(^|\.)(push\.apple\.com|fcm\.googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com)$/.test(
      url.hostname,
    )
  )
    throw Error('Unsupported push provider');
  if (!remove && (!sub.keys?.p256dh || !sub.keys?.auth)) throw Error('Invalid subscription');
  subscribers = subscribers.filter((s) => s.endpoint !== sub.endpoint);
  if (!remove) subscribers.push(sub);
  saveLocal('subscribers.json', subscribers);
}
export async function pushWatch(message: string) {
  if (!keys || !subscribers.length) return;
  const vapidDetails = { ...keys, subject: process.env.DEVDECK_VAPID_SUBJECT || 'https://github.com/youssefelhalawanyyy/HELPER' };
  await Promise.all(
    subscribers.map(async (sub) => {
      try {
        await push.sendNotification(sub, JSON.stringify({ message }), {
          vapidDetails,
          TTL: 120,
          timeout: 8000,
        });
      } catch (err) {
        if ([404, 410].includes((err as { statusCode: number }).statusCode)) subscribeDevice(sub, true);
      }
    }),
  );
}
