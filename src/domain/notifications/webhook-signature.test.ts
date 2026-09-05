import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SIGNATURE_TOLERANCE_SECONDS, verifySvixSignature } from "./webhook-signature";

const rawSecret = Buffer.from("0123456789abcdef0123456789abcdef");
const secret = `whsec_${rawSecret.toString("base64")}`;
const now = new Date("2026-09-04T12:00:00Z");
const timestamp = String(Math.floor(now.getTime() / 1000));
const id = "msg_2abc";
const body = '{"type":"email.delivered","data":{"email_id":"re_1"}}';

function sign(content: string, key: Buffer = rawSecret): string {
  return createHmac("sha256", key).update(content).digest("base64");
}

describe("verifySvixSignature", () => {
  it("accepts a signature computed over id.timestamp.body with the decoded secret", () => {
    const signature = `v1,${sign(`${id}.${timestamp}.${body}`)}`;
    expect(verifySvixSignature({ id, timestamp, signature, body, secret, now })).toBe(true);
  });

  it("rejects a tampered body", () => {
    const signature = `v1,${sign(`${id}.${timestamp}.${body}`)}`;
    expect(verifySvixSignature({ id, timestamp, signature, body: body + " ", secret, now })).toBe(false);
  });

  it("rejects a stale timestamp beyond the tolerance, in either direction", () => {
    const old = String(Number(timestamp) - SIGNATURE_TOLERANCE_SECONDS - 1);
    const future = String(Number(timestamp) + SIGNATURE_TOLERANCE_SECONDS + 1);
    for (const ts of [old, future]) {
      const signature = `v1,${sign(`${id}.${ts}.${body}`)}`;
      expect(verifySvixSignature({ id, timestamp: ts, signature, body, secret, now })).toBe(false);
    }
  });

  it("accepts when any one of several space-separated signatures matches (key rotation)", () => {
    const stale = `v1,${sign(`${id}.${timestamp}.${body}`, Buffer.from("otherkeyotherkeyotherkeyotherkey"))}`;
    const good = `v1,${sign(`${id}.${timestamp}.${body}`)}`;
    expect(verifySvixSignature({ id, timestamp, signature: `${stale} ${good}`, body, secret, now })).toBe(true);
  });

  it("ignores signatures with an unknown version prefix", () => {
    const signature = `v2,${sign(`${id}.${timestamp}.${body}`)}`;
    expect(verifySvixSignature({ id, timestamp, signature, body, secret, now })).toBe(false);
  });

  it("refuses when the secret, id, timestamp, or signature is missing", () => {
    const signature = `v1,${sign(`${id}.${timestamp}.${body}`)}`;
    expect(verifySvixSignature({ id, timestamp, signature, body, secret: "", now })).toBe(false);
    expect(verifySvixSignature({ id: "", timestamp, signature, body, secret, now })).toBe(false);
    expect(verifySvixSignature({ id, timestamp: "not-a-number", signature, body, secret, now })).toBe(false);
    expect(verifySvixSignature({ id, timestamp, signature: "", body, secret, now })).toBe(false);
  });
});
