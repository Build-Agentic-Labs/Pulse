/**
 * The drain run log (notification_drain_runs). Service-role only — construct the
 * client inside a route handler, never in shared code. One row per invocation is
 * what lets the health endpoint say whether the cron has ever executed.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import type { DrainRunSummary } from "@/domain/notifications/health";

export type DrainCaller = "cron" | "kick" | "manual";

export interface DrainRunInput {
  caller: DrainCaller;
  startedAt: Date;
  finishedAt: Date;
  healthy: boolean;
  problems: string[];
  /** The per-store reports, exactly as the HTTP response carried them. */
  report: Record<string, unknown>;
}

export interface DrainRun extends DrainRunSummary {
  report: unknown;
}

export async function recordDrainRun(admin: SupabaseClient<Database>, run: DrainRunInput): Promise<void> {
  const { error } = await admin.from("notification_drain_runs").insert({
    caller: run.caller,
    started_at: run.startedAt.toISOString(),
    finished_at: run.finishedAt.toISOString(),
    healthy: run.healthy,
    problems: run.problems,
    report: run.report as Json,
  });
  if (error) throw new Error(error.message);
}

export async function latestDrainRuns(admin: SupabaseClient<Database>, limit = 10): Promise<DrainRun[]> {
  const { data, error } = await admin
    .from("notification_drain_runs")
    .select("id, caller, started_at, finished_at, healthy, problems, report")
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: Number(row.id),
    caller: String(row.caller),
    startedAt: String(row.started_at),
    finishedAt: String(row.finished_at),
    healthy: Boolean(row.healthy),
    problems: Array.isArray(row.problems) ? row.problems.map(String) : [],
    report: row.report,
  }));
}
