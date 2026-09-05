/**
 * Notification drain. GET = Vercel Cron (CRON_SECRET bearer, attached
 * automatically by Vercel once the env var exists) or an external heartbeat
 * monitor using the same secret. POST = the browser kick after a mutation — any
 * signed-in user, because the drain is idempotent: over-kicking can only produce
 * skips, never duplicate email.
 * The request core lives in src/lib/notifications/run-drain-request.ts (tested
 * with fake stores); this file only wires env, clients, and HTTP.
 */

import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createApiRateLimiter, requireApiUser } from "@/lib/api-auth";
import { createStalledDigestDrainStore } from "@/lib/notifications/digest-store";
import { recordDrainRun, type DrainCaller } from "@/lib/notifications/drain-runs-store";
import { runDrainRequest } from "@/lib/notifications/run-drain-request";
import { createTeamsSender } from "@/lib/notifications/teams-sender";
import { createResendSender, isAuthorizedCronRequest } from "@/lib/sop/notifications-drain";
import { createSopNotificationDrainStore } from "@/lib/sop/notifications-store";
import { createWorkspaceWelcomeDrainStore } from "@/lib/workspace/welcome-store";
import type { Database } from "@/lib/database.types";

const kickRateLimit = createApiRateLimiter({ windowMs: 60_000, maxRequests: 6 });

async function drain(request: Request, caller: DrainCaller): Promise<NextResponse> {
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

  // Links go into emails sent to OTHER users, so the origin must come from
  // trusted config, not the request's Host. NEXT_PUBLIC_SITE_URL wins if set;
  // Vercel's canonical production host is next; the request origin is the
  // dev-only fallback.
  const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? "";
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL ??
    (vercelHost ? `https://${vercelHost}` : new URL(request.url).origin);

  try {
    const send = resendApiKey && resendFrom ? createResendSender(resendApiKey, resendFrom) : null;
    const result = await runDrainRequest({
      caller,
      stores: [
        { label: "sop", store: createSopNotificationDrainStore(admin) },
        { label: "workspace", store: createWorkspaceWelcomeDrainStore(admin) },
        // Digests are periodic by nature: only the scheduled run owns them, so a
        // burst of browser kicks can never mail a week's summary early.
        ...(caller === "cron" ? [{ label: "digest", store: createStalledDigestDrainStore(admin) }] : []),
      ],
      send,
      teams: createTeamsSender(),
      now: () => new Date(),
      origin,
      recordRun: (run) => recordDrainRun(admin, run),
    });
    // A drain that "succeeds" while sending nothing is exactly how the
    // RESEND_FROM outage hid for two weeks. 503 keeps the failure visible to
    // Vercel's cron status, the heartbeat monitor, or a plain curl.
    if (!result.body.healthy) {
      console.error(`notification drain unhealthy — ${result.body.problems.join("; ")}`);
    }
    return NextResponse.json(result.body, { status: result.status });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Drain failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  return drain(request, "cron");
}

export async function POST(request: Request) {
  const { userId, failure } = await requireApiUser(request);
  if (failure) return failure;
  if (!kickRateLimit(userId)) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }
  return drain(request, "kick");
}
