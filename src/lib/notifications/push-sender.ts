/**
 * Delivers one push message to one browser subscription: encrypts the payload,
 * signs the request with VAPID, POSTs to the push service. Never throws; a
 * 404/410 is reported as `gone` so the store can prune the subscription.
 */

import { createVapidAuthHeader, encryptPushPayload } from "@/domain/notifications/web-push";

export interface PushSubscriptionKeys {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushPayload {
  title: string;
  body: string;
  link: string;
}

export type PushSendResult = { ok: true } | { ok: false; gone: boolean; status: number; error: string };
export type PushSender = (subscription: PushSubscriptionKeys, payload: PushPayload) => Promise<PushSendResult>;

export interface PushSenderConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

const PUSH_TTL_SECONDS = 24 * 60 * 60;

export function createPushSender(config: PushSenderConfig, fetchImpl: typeof fetch = fetch): PushSender {
  return async (subscription, payload) => {
    try {
      const audience = new URL(subscription.endpoint).origin;
      const { body, headers } = encryptPushPayload({
        p256dh: subscription.p256dh,
        auth: subscription.auth,
        payload: JSON.stringify(payload),
      });
      const response = await fetchImpl(subscription.endpoint, {
        method: "POST",
        headers: {
          ...headers,
          Authorization: createVapidAuthHeader({ ...config, audience, now: new Date() }),
          TTL: String(PUSH_TTL_SECONDS),
          Urgency: "normal",
        },
        // A plain Uint8Array over its own ArrayBuffer satisfies BodyInit in every runtime typing.
        body: new Uint8Array(body),
      });
      if (response.ok) return { ok: true };
      const error = await response.text().catch(() => "");
      return {
        ok: false,
        gone: response.status === 404 || response.status === 410,
        status: response.status,
        error: error.slice(0, 500),
      };
    } catch (error: unknown) {
      return { ok: false, gone: false, status: 0, error: error instanceof Error ? error.message : "Push failed" };
    }
  };
}
