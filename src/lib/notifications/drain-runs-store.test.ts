import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { latestDrainRuns, recordDrainRun } from "./drain-runs-store";

type Result = { data: unknown; error: { message: string } | null };

function makeAdmin(results: Record<string, Result>, capture: { inserts: Record<string, unknown>[]; limits: number[] }) {
  const from = (table: string) => {
    const builder: Record<string, unknown> = {};
    Object.assign(builder, {
      select: () => builder,
      order: () => builder,
      limit: (n: number) => {
        capture.limits.push(n);
        return builder;
      },
      insert: (values: Record<string, unknown>) => {
        capture.inserts.push(values);
        return builder;
      },
      then: (resolve: (r: Result) => void) => resolve(results[table] ?? { data: [], error: null }),
    });
    return builder;
  };
  return { from } as unknown as SupabaseClient<Database>;
}

describe("recordDrainRun", () => {
  it("writes one row per invocation with the verdict and the full report", async () => {
    const capture = { inserts: [] as Record<string, unknown>[], limits: [] as number[] };
    const admin = makeAdmin({}, capture);
    await recordDrainRun(admin, {
      caller: "cron",
      startedAt: new Date("2026-09-04T13:00:00Z"),
      finishedAt: new Date("2026-09-04T13:00:02Z"),
      healthy: false,
      problems: ["sop: 1 dead row(s)"],
      report: { sop: { sent: 0 } },
    });
    expect(capture.inserts).toEqual([
      {
        caller: "cron",
        started_at: "2026-09-04T13:00:00.000Z",
        finished_at: "2026-09-04T13:00:02.000Z",
        healthy: false,
        problems: ["sop: 1 dead row(s)"],
        report: { sop: { sent: 0 } },
      },
    ]);
  });

  it("surfaces a database rejection instead of swallowing it", async () => {
    const admin = makeAdmin({ notification_drain_runs: { data: null, error: { message: "relation missing" } } }, { inserts: [], limits: [] });
    await expect(
      recordDrainRun(admin, { caller: "kick", startedAt: new Date(), finishedAt: new Date(), healthy: true, problems: [], report: {} }),
    ).rejects.toThrow("relation missing");
  });
});

describe("latestDrainRuns", () => {
  it("maps rows newest-first and honours the limit", async () => {
    const capture = { inserts: [] as Record<string, unknown>[], limits: [] as number[] };
    const admin = makeAdmin(
      {
        notification_drain_runs: {
          data: [
            { id: 2, caller: "kick", started_at: "2026-09-04T14:00:00Z", finished_at: "2026-09-04T14:00:01Z", healthy: true, problems: [], report: {} },
            { id: 1, caller: "cron", started_at: "2026-09-04T13:00:00Z", finished_at: "2026-09-04T13:00:02Z", healthy: false, problems: ["x"], report: { a: 1 } },
          ],
          error: null,
        },
      },
      capture,
    );
    const runs = await latestDrainRuns(admin, 10);
    expect(capture.limits).toEqual([10]);
    expect(runs).toEqual([
      { id: 2, caller: "kick", startedAt: "2026-09-04T14:00:00Z", finishedAt: "2026-09-04T14:00:01Z", healthy: true, problems: [], report: {} },
      { id: 1, caller: "cron", startedAt: "2026-09-04T13:00:00Z", finishedAt: "2026-09-04T13:00:02Z", healthy: false, problems: ["x"], report: { a: 1 } },
    ]);
  });
});
