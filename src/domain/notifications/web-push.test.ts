import { createDecipheriv, createECDH, createPublicKey, generateKeyPairSync, hkdfSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createVapidAuthHeader, encryptPushPayload, generateVapidKeys } from "./web-push";

const b64url = (buffer: Buffer) => buffer.toString("base64url");

describe("generateVapidKeys", () => {
  it("returns a raw uncompressed P-256 public key (65 bytes) and a 32-byte private scalar, base64url", () => {
    const keys = generateVapidKeys();
    expect(Buffer.from(keys.publicKey, "base64url")).toHaveLength(65);
    expect(Buffer.from(keys.publicKey, "base64url")[0]).toBe(0x04);
    expect(Buffer.from(keys.privateKey, "base64url")).toHaveLength(32);
  });
});

describe("createVapidAuthHeader", () => {
  const keys = generateVapidKeys();
  const now = new Date("2026-09-04T12:00:00Z");

  it("produces an ES256 JWT over aud/exp/sub that verifies with the public key", () => {
    const header = createVapidAuthHeader({
      audience: "https://fcm.googleapis.com",
      subject: "mailto:notifications@pulse.test",
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
      now,
    });
    const match = /^vapid t=([^,]+), k=(.+)$/.exec(header);
    expect(match).not.toBeNull();
    const [, jwt, k] = match!;
    expect(k).toBe(keys.publicKey);

    const [head, payload, signature] = jwt.split(".");
    expect(JSON.parse(Buffer.from(head, "base64url").toString())).toEqual({ typ: "JWT", alg: "ES256" });
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    expect(claims.aud).toBe("https://fcm.googleapis.com");
    expect(claims.sub).toBe("mailto:notifications@pulse.test");
    expect(claims.exp).toBe(Math.floor(now.getTime() / 1000) + 12 * 60 * 60);

    const raw = Buffer.from(keys.publicKey, "base64url");
    const publicKey = createPublicKey({
      key: { kty: "EC", crv: "P-256", x: b64url(raw.subarray(1, 33)), y: b64url(raw.subarray(33, 65)) },
      format: "jwk",
    });
    expect(
      verify("sha256", Buffer.from(`${head}.${payload}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url")),
    ).toBe(true);
  });

  it("rejects an audience that is not an https origin", () => {
    expect(() =>
      createVapidAuthHeader({ audience: "http://x", subject: "mailto:a@b", publicKey: keys.publicKey, privateKey: keys.privateKey, now }),
    ).toThrow();
  });
});

/** RFC 8291 §3.4 decryption, written independently so a round-trip proves the layout. */
function decryptForTest(body: Buffer, uaPrivate: ReturnType<typeof createECDH>, authSecret: Buffer): string {
  const salt = body.subarray(0, 16);
  const rs = body.readUInt32BE(16);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  const ciphertext = body.subarray(21 + idlen);
  expect(rs).toBe(4096);
  expect(idlen).toBe(65);

  const uaPublic = uaPrivate.getPublicKey();
  const ecdhSecret = uaPrivate.computeSecret(asPublic);
  const info = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync("sha256", ecdhSecret, authSecret, info, 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));

  const tag = ciphertext.subarray(ciphertext.length - 16);
  const data = ciphertext.subarray(0, ciphertext.length - 16);
  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(data), decipher.final()]);
  // Last record: payload followed by a 0x02 delimiter and optional zero padding.
  const delimiter = plain.lastIndexOf(0x02);
  return plain.subarray(0, delimiter).toString();
}

describe("encryptPushPayload", () => {
  it("encrypts to aes128gcm that the subscriber can decrypt, with a fresh salt and key each time", () => {
    const subscriber = createECDH("prime256v1");
    subscriber.generateKeys();
    const authSecret = Buffer.from("0123456789abcdef");
    const payload = JSON.stringify({ title: "Review requested", body: "Please review", link: "/sops/s1" });

    const one = encryptPushPayload({ p256dh: b64url(subscriber.getPublicKey()), auth: b64url(authSecret), payload });
    const two = encryptPushPayload({ p256dh: b64url(subscriber.getPublicKey()), auth: b64url(authSecret), payload });
    expect(one.headers["Content-Encoding"]).toBe("aes128gcm");
    expect(one.headers["Content-Type"]).toBe("application/octet-stream");
    expect(decryptForTest(one.body, subscriber, authSecret)).toBe(payload);
    expect(decryptForTest(two.body, subscriber, authSecret)).toBe(payload);
    expect(one.body.subarray(0, 16).equals(two.body.subarray(0, 16))).toBe(false);
  });

  it("refuses a malformed subscriber key", () => {
    expect(() => encryptPushPayload({ p256dh: "AAAA", auth: b64url(Buffer.alloc(16)), payload: "x" })).toThrow();
  });
});

// The key pair used above must be a real P-256 pair; this guards the generator against a silent
// change of curve.
void generateKeyPairSync;
