/**
 * Notification pipeline freshness — the verdict an uptime monitor reads. Pure:
 * the caller passes `now` and the recent run log. Answers the question the
 * 2026-09-04 audit could not: "has the cron ever run, and did the latest run
 * succeed?"
 */

/** Daily cron plus slack for a slow deploy. Past this, silence is an outage. */
export const CRON_SILENCE_HOURS = 26;

export interface DrainRunSummary {
  id: number;
  caller: string;
  startedAt: string;
  finishedAt: string;
  healthy: boolean;
  problems: string[];
}

export interface RunFreshness {
  healthy: boolean;
  /** Human-readable, safe to log. Empty when healthy. */
  problems: string[];
  lastCronAt: string | null;
}

const HOUR_MS = 60 * 60 * 1000;

export function assessRunFreshness(now: Date, runs: DrainRunSummary[]): RunFreshness {
  if (runs.length === 0) {
    return { healthy: false, problems: ["no drain run has ever been recorded"], lastCronAt: null };
  }

  const newestFirst = [...runs].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const latest = newestFirst[0];
  const lastCron = newestFirst.find((run) => run.caller === "cron") ?? null;

  const problems: string[] = [];
  if (!latest.healthy) {
    for (const problem of latest.problems) problems.push(`latest run: ${problem}`);
    if (latest.problems.length === 0) problems.push("latest run: unhealthy");
  }

  if (!lastCron) {
    problems.push("cron has never run — only browser kicks have drained");
  } else {
    const ageHours = (now.getTime() - new Date(lastCron.startedAt).getTime()) / HOUR_MS;
    if (ageHours > CRON_SILENCE_HOURS) {
      problems.push(`cron has not run for ${Math.round(ageHours)}h (threshold ${CRON_SILENCE_HOURS}h)`);
    }
  }

  return { healthy: problems.length === 0, problems, lastCronAt: lastCron?.startedAt ?? null };
}
