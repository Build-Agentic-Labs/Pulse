/**
 * SOP notification drain. GET = Vercel Cron (CRON_SECRET bearer, attached
 * automatically by Vercel once the env var exists). POST = the browser kick
 * after an SOP mutation — any signed-in user, because the drain is idempotent:
 * over-kicking can only produce skips, never duplicate email.
 * Degrades like app/api/invites: missing secrets report, never crash.
 */

import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createApiRateLimiter, requireApiUser } from "@/lib/api-auth";
import {
  createResendSender,
  isAuthorizedCronRequest,
  runSopNotificationDrain,
} from "@/lib/sop/notifications-drain";
import { createSopNotificationDrainStore } from "@/lib/sop/notifications-store";
import type { Database } from "@/lib/database.types";

const kickRateLimit = createApiRateLimiter({ windowMs: 60_000, maxRequests: 6 });

async function drain(request: Request): Promise<NextResponse> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ configured: false, reason: "SUPABASE_SERVICE_ROLE_KEY missing." });
  }

  const admin = createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const resendApiKey = process.env.RESEND_API_KEY ?? "";
  const resendFrom = process.env.RESEND_FROM ?? "";

  try {
    const report = await runSopNotificationDrain({
      store: createSopNotificationDrainStore(admin),
      send: resendApiKey && resendFrom ? createResendSender(resendApiKey, resendFrom) : null,
      now: () => new Date(),
      origin: new URL(request.url).origin,
    });
    return NextResponse.json(report);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Drain failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  return drain(request);
}

export async function POST(request: Request) {
  const { userId, failure } = await requireApiUser(request);
  if (failure) return failure;
  if (!kickRateLimit(userId)) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }
  return drain(request);
}
