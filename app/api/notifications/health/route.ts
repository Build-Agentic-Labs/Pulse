/**
 * Read-only notification health for an uptime monitor: GET with the CRON_SECRET
 * bearer. Sends nothing and claims nothing — it only reads the run log and
 * answers 200 when the latest run was clean and the cron has run recently,
 * 503 otherwise. Point a heartbeat check here and the audit's "the 503 goes
 * nowhere" finding is closed.
 */

import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { assessRunFreshness } from "@/domain/notifications/health";
import { latestDrainRuns } from "@/lib/notifications/drain-runs-store";
import { isAuthorizedCronRequest } from "@/lib/sop/notifications-drain";
import type { Database } from "@/lib/database.types";

export const dynamic = "force-dynamic";

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
    const runs = await latestDrainRuns(admin, 20);
    const verdict = assessRunFreshness(new Date(), runs);
    return NextResponse.json(
      { ...verdict, latestRun: runs[0] ?? null },
      { status: verdict.healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Health check failed.";
    return NextResponse.json({ healthy: false, problems: [message], lastCronAt: null }, { status: 503 });
  }
}
