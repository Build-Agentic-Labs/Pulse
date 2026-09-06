/**
 * Read-only notification health for an uptime monitor: GET with the CRON_SECRET
 * bearer. Sends nothing and claims nothing — it reads the run log and the
 * auth-mail canary's ledger row and answers 200 only when the latest drain was
 * clean, the cron has run recently, every auth-mail variable is present, and the
 * last canary reset was sent and delivered. 503 otherwise, with the problems
 * spelled out.
 */

import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { assessAuthMailHealth, type CanaryObservation } from "@/domain/notifications/auth-mail-health";
import { assessRunFreshness } from "@/domain/notifications/health";
import { readPasswordRecoveryConfig } from "@/lib/auth/password-recovery-request";
import type { Database } from "@/lib/database.types";
import { latestDeliveryStatuses } from "@/lib/notifications/deliveries-store";
import { latestDrainRuns } from "@/lib/notifications/drain-runs-store";
import { latestTransactionalEmailFor } from "@/lib/notifications/transactional-log";
import { isAuthorizedCronRequest } from "@/lib/sop/notifications-drain";

export const dynamic = "force-dynamic";

type Admin = ReturnType<typeof createClient<Database>>;

async function observeCanary(admin: Admin, canaryEmail: string): Promise<CanaryObservation | null> {
  const latest = await latestTransactionalEmailFor(admin, canaryEmail);
  if (!latest) return null;
  let deliveredAt: string | null = null;
  if (latest.resendMessageId) {
    const status = (await latestDeliveryStatuses(admin, [latest.resendMessageId])).get(latest.resendMessageId);
    if (status?.latestEvent === "email.delivered") deliveredAt = status.occurredAt;
  }
  return {
    requestedAt: latest.createdAt,
    status: latest.status === "sent" ? "sent" : "failed",
    error: latest.error,
    deliveredAt,
  };
}

function siteOrigin(request: Request): string {
  const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? "";
  return process.env.NEXT_PUBLIC_SITE_URL ?? (vercelHost ? `https://${vercelHost}` : new URL(request.url).origin);
}

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { healthy: false, problems: ["SUPABASE_SERVICE_ROLE_KEY missing"], lastCronAt: null },
      { status: 503 },
    );
  }
  try {
    const admin = createClient<Database>(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const now = new Date();
    const runs = await latestDrainRuns(admin, 20);
    const drain = assessRunFreshness(now, runs);

    const canaryEmail = (process.env.AUTH_MAIL_CANARY_EMAIL ?? "").trim().toLowerCase() || null;
    const authMail = assessAuthMailHealth({
      now,
      missingConfig: readPasswordRecoveryConfig(process.env, siteOrigin(request)).missing,
      canaryEmail,
      latestCanary: canaryEmail ? await observeCanary(admin, canaryEmail) : null,
    });

    const healthy = drain.healthy && authMail.healthy;
    return NextResponse.json(
      {
        healthy,
        problems: [...drain.problems, ...authMail.problems],
        lastCronAt: drain.lastCronAt,
        latestRun: runs[0] ?? null,
        authMail,
      },
      { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Health check failed.";
    return NextResponse.json({ healthy: false, problems: [message], lastCronAt: null }, { status: 503 });
  }
}
