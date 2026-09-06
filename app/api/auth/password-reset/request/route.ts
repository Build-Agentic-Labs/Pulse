/**
 * Public "forgot password" endpoint. Validates, rate limits, then hands off to
 * requestPasswordRecovery so the email and the ledger row are the same ones the
 * daily canary produces. Every reason for a 503 is logged by NAME (never value)
 * so a misconfigured deployment is visible in Vercel logs instead of silent.
 */

import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createApiRateLimiter } from "@/lib/api-auth";
import {
  describeUnavailable,
  logMissingConfig,
  readPasswordRecoveryConfig,
  requestPasswordRecovery,
} from "@/lib/auth/password-recovery-request";
import type { Database } from "@/lib/database.types";
import { createEmailSenderFromEnv } from "@/lib/notifications/sender-from-env";
import { createResendSender } from "@/lib/sop/notifications-drain";

export const dynamic = "force-dynamic";

const checkEmailRateLimit = createApiRateLimiter({ windowMs: 15 * 60_000, maxRequests: 3 });
const checkIpRateLimit = createApiRateLimiter({ windowMs: 15 * 60_000, maxRequests: 10 });
const ACCEPTED_MESSAGE = "If an account exists, a reset link has been sent.";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(body: object, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function accepted() {
  return json({ accepted: true, message: ACCEPTED_MESSAGE });
}

function unavailable() {
  return json({ error: describeUnavailable("Password recovery", process.env.VERCEL_ENV) }, 503);
}

function clientAddress(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

function hashed(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function passwordRecoveryOrigin(request: Request): string {
  const requestOrigin = new URL(request.url).origin;
  const candidates = [
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : undefined,
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const origin = new URL(candidate).origin;
      if (origin.startsWith("https://")) return origin;
    } catch {
      // Try the next trusted deployment value.
    }
  }

  // Localhost is only a fallback for an unconfigured development checkout.
  // When a public Pulse URL exists, recovery email links must always use it so
  // a request made during local support/testing still works for the recipient.
  const localRequest = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(requestOrigin);
  if (localRequest && process.env.NODE_ENV !== "production") {
    return requestOrigin;
  }

  return "";
}

export async function POST(request: Request) {
  let body: { email?: unknown };
  try {
    body = (await request.json()) as { email?: unknown };
  } catch {
    return json({ error: "Enter a valid email address." }, 400);
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) {
    return json({ error: "Enter a valid email address." }, 400);
  }

  const emailKey = hashed(email);
  const ipKey = hashed(clientAddress(request));
  if (!checkEmailRateLimit(emailKey) || !checkIpRateLimit(ipKey)) {
    return json({ error: "Too many recovery requests. Wait a few minutes and try again." }, 429);
  }

  const origin = passwordRecoveryOrigin(request);
  const config = readPasswordRecoveryConfig(process.env, origin);
  if (!config.ok) {
    logMissingConfig("Password recovery", config.missing, process.env.VERCEL_ENV);
    return unavailable();
  }

  try {
    const admin = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", process.env.SUPABASE_SERVICE_ROLE_KEY ?? "", {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    // Honours NOTIFICATION_EMAIL_REDIRECT_TO during a test window.
    const send =
      createEmailSenderFromEnv().send ??
      createResendSender(process.env.RESEND_API_KEY ?? "", process.env.RESEND_FROM ?? "");

    const outcome = await requestPasswordRecovery({ email, origin, admin, send });
    if (outcome.kind === "failed") {
      console.error("Password recovery failed", { stage: outcome.stage, detail: outcome.detail });
      return unavailable();
    }
  } catch (error) {
    console.error("Password recovery request threw", {
      kind: error instanceof Error ? error.name : "unknown",
      message: error instanceof Error ? error.message : String(error),
    });
    return unavailable();
  }

  // Unknown accounts get the same answer as real ones.
  return accepted();
}
