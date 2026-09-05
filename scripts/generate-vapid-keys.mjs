#!/usr/bin/env node
/**
 * Print a fresh VAPID key pair for Web Push. Run once, then set:
 *   NEXT_PUBLIC_VAPID_PUBLIC_KEY=<publicKey>   (public by design)
 *   VAPID_PRIVATE_KEY=<privateKey>             (secret)
 *   VAPID_SUBJECT=mailto:notifications@<your domain>
 * in .env.local and in Vercel (Production + Preview), then redeploy.
 * Rotating the pair invalidates every existing browser subscription.
 */
import { createECDH } from "node:crypto";

const ecdh = createECDH("prime256v1");
ecdh.generateKeys();
const privateKey = ecdh.getPrivateKey();
const padded = privateKey.length >= 32 ? privateKey : Buffer.concat([Buffer.alloc(32 - privateKey.length), privateKey]);

console.log(`NEXT_PUBLIC_VAPID_PUBLIC_KEY=${ecdh.getPublicKey().toString("base64url")}`);
console.log(`VAPID_PRIVATE_KEY=${padded.toString("base64url")}`);
