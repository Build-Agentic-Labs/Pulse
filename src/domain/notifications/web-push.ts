/**
 * Web Push without a dependency: VAPID (RFC 8292) request signing and the
 * aes128gcm payload encryption (RFC 8291 / RFC 8188) a push service demands.
 * Node crypto only; pure apart from the random salt and ephemeral key each
 * encryption draws. Keys are base64url: the public key is the raw uncompressed
 * P-256 point (65 bytes), the private key the 32-byte scalar — the same shapes
 * browsers and push services exchange.
 */

import { createCipheriv, createECDH, createPrivateKey, hkdfSync, randomBytes, sign } from "node:crypto";

const CURVE = "prime256v1";
const RECORD_SIZE = 4096;
/** VAPID tokens may live up to 24h; half of that leaves room for clock skew. */
export const VAPID_TOKEN_TTL_SECONDS = 12 * 60 * 60;

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

function b64url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

function leftPad(buffer: Buffer, length: number): Buffer {
  return buffer.length >= length ? buffer : Buffer.concat([Buffer.alloc(length - buffer.length), buffer]);
}

function decodePublicPoint(encoded: string, label: string): Buffer {
  const raw = Buffer.from(encoded, "base64url");
  if (raw.length !== 65 || raw[0] !== 0x04) {
    throw new Error(`${label} must be an uncompressed P-256 point (65 bytes).`);
  }
  return raw;
}

export function generateVapidKeys(): VapidKeys {
  const ecdh = createECDH(CURVE);
  ecdh.generateKeys();
  return { publicKey: b64url(ecdh.getPublicKey()), privateKey: b64url(leftPad(ecdh.getPrivateKey(), 32)) };
}

export interface VapidAuthInput {
  /** The push service origin (scheme + host) the request goes to. */
  audience: string;
  /** `mailto:` address or https URL the push service may contact about abuse. */
  subject: string;
  publicKey: string;
  privateKey: string;
  now: Date;
}

/** `Authorization: vapid t=<ES256 JWT>, k=<public key>` (RFC 8292 §3). */
export function createVapidAuthHeader(input: VapidAuthInput): string {
  const audience = new URL(input.audience);
  if (audience.protocol !== "https:") throw new Error("VAPID audience must be an https origin.");
  const raw = decodePublicPoint(input.publicKey, "VAPID public key");
  const key = createPrivateKey({
    key: { kty: "EC", crv: "P-256", x: b64url(raw.subarray(1, 33)), y: b64url(raw.subarray(33, 65)), d: input.privateKey },
    format: "jwk",
  });
  const header = b64url(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = b64url(
    Buffer.from(
      JSON.stringify({
        aud: audience.origin,
        exp: Math.floor(input.now.getTime() / 1000) + VAPID_TOKEN_TTL_SECONDS,
        sub: input.subject,
      }),
    ),
  );
  const signature = sign("sha256", Buffer.from(`${header}.${payload}`), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${header}.${payload}.${b64url(signature)}, k=${input.publicKey}`;
}

export interface EncryptPushInput {
  /** Subscriber public key (`keys.p256dh`). */
  p256dh: string;
  /** Subscriber auth secret (`keys.auth`, 16 bytes). */
  auth: string;
  payload: string;
}

export interface EncryptedPush {
  body: Buffer;
  headers: Record<string, string>;
}

/** RFC 8291 §3: one aes128gcm record carrying the whole payload. */
export function encryptPushPayload(input: EncryptPushInput): EncryptedPush {
  const uaPublic = decodePublicPoint(input.p256dh, "Subscriber key");
  const authSecret = Buffer.from(input.auth, "base64url");
  if (authSecret.length !== 16) throw new Error("Subscriber auth secret must be 16 bytes.");

  const local = createECDH(CURVE);
  local.generateKeys();
  const asPublic = local.getPublicKey();
  const ecdhSecret = local.computeSecret(uaPublic);
  const salt = randomBytes(16);

  const info = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync("sha256", ecdhSecret, authSecret, info, 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));

  const plaintext = Buffer.from(input.payload);
  if (plaintext.length + 1 + 16 > RECORD_SIZE) throw new Error("Push payload too large for one record.");
  // Last (only) record: payload, then the 0x02 delimiter (RFC 8188 §2).
  const padded = Buffer.concat([plaintext, Buffer.from([0x02])]);
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const encrypted = Buffer.concat([cipher.update(padded), cipher.final(), cipher.getAuthTag()]);

  const recordSize = Buffer.alloc(4);
  recordSize.writeUInt32BE(RECORD_SIZE);
  const body = Buffer.concat([salt, recordSize, Buffer.from([asPublic.length]), asPublic, encrypted]);
  return { body, headers: { "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream" } };
}
