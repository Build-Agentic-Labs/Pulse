/**
 * The drain request core, separated from the Next.js route so it can be tested
 * with fake stores. Runs every store in turn, isolating failures — one store's
 * missing table must never hide another store's sends — then folds the reports
 * into one verdict, records the run, and picks the HTTP status.
 */

import {
  assessDrainHealth,
  runSopNotificationDrain,
  type DrainReport,
  type DrainStore,
  type EmailSender,
  type TeamsPoster,
} from "@/lib/sop/notifications-drain";
import type { DrainCaller, DrainRunInput } from "./drain-runs-store";

export type { DrainCaller, DrainRunInput } from "./drain-runs-store";

export interface DrainRequestDeps {
  caller: DrainCaller;
  stores: { label: string; store: DrainStore<unknown> }[];
  send: EmailSender | null;
  /** Optional Teams channel poster; absent = channel off. */
  teams?: TeamsPoster | null;
  now: () => Date;
  origin: string;
  recordRun: (run: DrainRunInput) => Promise<void>;
}

export type StoreOutcome = DrainReport | { error: string };

export interface DrainRequestBody {
  configured: boolean;
  healthy: boolean;
  problems: string[];
  caller: DrainCaller;
  durationMs: number;
  /** False when the run log itself could not be written (reported, never thrown). */
  runRecorded: boolean;
  stores: Record<string, StoreOutcome>;
}

export interface DrainRequestResult {
  status: 200 | 503;
  body: DrainRequestBody;
}

export async function runDrainRequest(deps: DrainRequestDeps): Promise<DrainRequestResult> {
  const startedAt = deps.now();
  const stores: Record<string, StoreOutcome> = {};
  const reports: { label: string; report: DrainReport }[] = [];
  const problems: string[] = [];

  for (const { label, store } of deps.stores) {
    try {
      const report = await runSopNotificationDrain({
        store,
        send: deps.send,
        teams: deps.teams ?? null,
        now: deps.now,
        origin: deps.origin,
      });
      stores[label] = report;
      reports.push({ label, report });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "drain failed";
      stores[label] = { error: message };
      problems.push(`${label}: drain failed — ${message}`);
    }
  }

  const health = assessDrainHealth(reports);
  const allProblems = [...health.problems, ...problems];
  const healthy = allProblems.length === 0;
  const finishedAt = deps.now();

  let runRecorded = true;
  try {
    await deps.recordRun({
      caller: deps.caller,
      startedAt,
      finishedAt,
      healthy,
      problems: allProblems,
      report: stores,
    });
  } catch (error: unknown) {
    runRecorded = false;
    console.error("notification drain: run log write failed", {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  return {
    status: healthy ? 200 : 503,
    body: {
      configured: deps.send !== null,
      healthy,
      problems: allProblems,
      caller: deps.caller,
      durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
      runRecorded,
      stores,
    },
  };
}
