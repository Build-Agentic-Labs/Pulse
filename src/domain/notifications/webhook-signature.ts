/**
 * Svix-style webhook signature verification (the scheme Resend delivers with).
 * Signed content is `${id}.${timestamp}.${body}`; the secret is `whsec_` + base64
 * key; the header carries one or more space-separated `v1,<base64 hmac>` entries
 * (more than one during key rotation). Pure apart from node:crypto.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/** Replay window: a signed timestamp further from now than this is refused. */
export const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

export interface SvixSignatureInput {
  id: string;
  timestamp: string;
  signature: string;
  body: string;
  secret: string;
  now: Date;
}

function decodeSecret(secret: string): Buffer {
  const raw = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  return Buffer.from(raw, "base64");
}

export function verifySvixSignature(input: SvixSignatureInput): boolean {
  const { id, timestamp, signature, body, secret, now } = input;
  if (!id || !timestamp || !signature || !secret) return false;

  const signedAt = Number(timestamp);
  if (!Number.isFinite(signedAt)) return false;
  if (Math.abs(now.getTime() / 1000 - signedAt) > SIGNATURE_TOLERANCE_SECONDS) return false;

  const expected = createHmac("sha256", decodeSecret(secret)).update(`${id}.${timestamp}.${body}`).digest();
  for (const entry of signature.split(" ")) {
    const [version, encoded] = entry.split(",");
    if (version !== "v1" || !encoded) continue;
    const presented = Buffer.from(encoded, "base64");
    if (presented.length === expected.length && timingSafeEqual(presented, expected)) return true;
  }
  return false;
}
