import { createECDH } from "node:crypto";
import { describe, expect, it } from "vitest";
import { generateVapidKeys } from "@/domain/notifications/web-push";
import { createPushSender } from "./push-sender";

const keys = generateVapidKeys();
const subscriber = createECDH("prime256v1");
subscriber.generateKeys();
const subscription = {
  endpoint: "https://fcm.googleapis.com/fcm/send/abc",
  p256dh: subscriber.getPublicKey().toString("base64url"),
  auth: Buffer.from("0123456789abcdef").toString("base64url"),
};
const payload = { title: "Review requested", body: "Please review", link: "/sops/s1" };

describe("createPushSender", () => {
  it("POSTs an encrypted aes128gcm body with VAPID auth, TTL, and urgency to the endpoint", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const send = createPushSender(
      { publicKey: keys.publicKey, privateKey: keys.privateKey, subject: "mailto:n@pulse.test" },
      async (url, init) => {
        seen.push({ url: String(url), init: init ?? {} });
        return new Response(null, { status: 201 });
      },
    );
    expect(await send(subscription, payload)).toEqual({ ok: true });
    expect(seen[0].url).toBe(subscription.endpoint);
    const headers = seen[0].init.headers as Record<string, string>;
    expect(headers["Content-Encoding"]).toBe("aes128gcm");
    expect(headers.TTL).toBe("86400");
    expect(headers.Urgency).toBe("normal");
    expect(headers.Authorization.startsWith("vapid t=")).toBe(true);
    expect(headers.Authorization.endsWith(`, k=${keys.publicKey}`)).toBe(true);
    expect(Buffer.isBuffer(seen[0].init.body) || seen[0].init.body instanceof Uint8Array).toBe(true);
  });

  it("reports a gone subscription (404/410) so the store can prune it", async () => {
    const send = createPushSender(
      { publicKey: keys.publicKey, privateKey: keys.privateKey, subject: "mailto:n@pulse.test" },
      async () => new Response(null, { status: 410 }),
    );
    expect(await send(subscription, payload)).toEqual({ ok: false, gone: true, status: 410, error: "" });
  });

  it("reports other failures without throwing", async () => {
    const send = createPushSender(
      { publicKey: keys.publicKey, privateKey: keys.privateKey, subject: "mailto:n@pulse.test" },
      async () => {
        throw new Error("ECONNRESET");
      },
    );
    expect(await send(subscription, payload)).toEqual({ ok: false, gone: false, status: 0, error: "ECONNRESET" });
  });
});
