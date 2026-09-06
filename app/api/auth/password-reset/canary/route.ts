/**
 * Daily auth-mail canary. Sends a real password-reset email to a dedicated
 * account whose address is Resend's always-delivers test sink, through exactly
 * the code the public route uses. The health endpoint then checks that the send
 * was accepted AND that Resend's delivery webhook confirmed it — proving the
 * whole wire every day without touching a real person's inbox.
 *
 * Called by the Vercel cron (vercel.json) with the CRON_SECRET bearer.
 * Enabled only when AUTH_MAIL_CANARY_EMAIL is set; the account must exist
 * (scripts/create-auth-mail-canary.mjs creates it once).
 */

import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import {
  describeUnavailable,
  logMissingConfig,
  readPasswordRecoveryConfig,
  requestPasswordRecovery,
} from "@/lib/auth/password-recovery-request";
import type { Database } from "@/lib/database.types";
import { createEmailSenderFromEnv } from "@/lib/notifications/sender-from-env";
import { createResendSender, isAuthorizedCronRequest } from "@/lib/sop/notifications-drain";
import { passwordRecoveryOrigin } from "../request/route";

export const dynamic = "force-dynamic";

function json(body: object, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return json({ error: "Unauthorized." }, 401);
  }

  const canaryEmail = (process.env.AUTH_MAIL_CANARY_EMAIL ?? "").trim().toLowerCase();
  if (!canaryEmail) {
    return json({ ok: false, error: "AUTH_MAIL_CANARY_EMAIL is not set." }, 503);
  }

  const origin = passwordRecoveryOrigin(request);
  const config = readPasswordRecoveryConfig(process.env, origin);
  if (!config.ok) {
    logMissingConfig("Password recovery canary", config.missing, process.env.VERCEL_ENV);
    return json({ ok: false, error: describeUnavailable("Password recovery", process.env.VERCEL_ENV), missing: config.missing }, 503);
  }

  const admin = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", process.env.SUPABASE_SERVICE_ROLE_KEY ?? "", {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const send =
    createEmailSenderFromEnv().send ??
    createResendSender(process.env.RESEND_API_KEY ?? "", process.env.RESEND_FROM ?? "");

  const outcome = await requestPasswordRecovery({
    email: canaryEmail,
    origin,
    admin,
    send,
    idempotencyKey: `recovery:canary:${randomUUID()}`,
  });

  if (outcome.kind === "unknown_user") {
    return json({ ok: false, error: "Canary account does not exist. Run scripts/create-auth-mail-canary.mjs." }, 503);
  }
  if (outcome.kind === "failed") {
    console.error("Password recovery canary failed", { stage: outcome.stage, detail: outcome.detail });
    return json({ ok: false, stage: outcome.stage, detail: outcome.detail }, 503);
  }
  return json({ ok: true, recipient: canaryEmail, resendMessageId: outcome.resendMessageId, ledgerRecorded: outcome.ledgerRecorded });
}
