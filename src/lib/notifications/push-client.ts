/**
 * Browser side of Web Push: service-worker registration, permission, and the
 * subscribe/unsubscribe calls. Browser-only by construction; every function
 * degrades to "unsupported" on the server. The VAPID public key is public by
 * design (NEXT_PUBLIC_VAPID_PUBLIC_KEY).
 */

import type { PushSubscriptionKeys } from "./push-sender";

export const PUSH_SERVICE_WORKER_PATH = "/pulse-push-sw.js";

export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window &&
    Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY)
  );
}

function applicationServerKey(): Uint8Array {
  const encoded = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
  const padded = encoded.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (encoded.length % 4)) % 4);
  const binary = window.atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!isPushSupported()) return null;
  return (await navigator.serviceWorker.getRegistration(PUSH_SERVICE_WORKER_PATH)) ?? null;
}

export async function currentPushEndpoint(): Promise<string | null> {
  const reg = await registration();
  const subscription = await reg?.pushManager.getSubscription();
  return subscription?.endpoint ?? null;
}

export async function subscribeToPush(): Promise<PushSubscriptionKeys> {
  if (!isPushSupported()) throw new Error("This browser does not support push notifications.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notifications were not allowed in this browser.");
  const reg = await navigator.serviceWorker.register(PUSH_SERVICE_WORKER_PATH);
  await navigator.serviceWorker.ready;
  const subscription =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey() as BufferSource }));
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!p256dh || !auth) throw new Error("The browser returned an incomplete push subscription.");
  return { endpoint: subscription.endpoint, p256dh, auth };
}

export async function unsubscribeFromPush(): Promise<string | null> {
  const reg = await registration();
  const subscription = await reg?.pushManager.getSubscription();
  if (!subscription) return null;
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  return endpoint;
}
