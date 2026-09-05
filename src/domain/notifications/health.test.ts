import { describe, expect, it } from "vitest";
import { CRON_SILENCE_HOURS, assessRunFreshness, type DrainRunSummary } from "./health";

const NOW = new Date("2026-09-04T15:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000).toISOString();

const run = (over: Partial<DrainRunSummary> = {}): DrainRunSummary => ({
  id: 1,
  caller: "cron",
  startedAt: hoursAgo(2),
  finishedAt: hoursAgo(2),
  healthy: true,
  problems: [],
  ...over,
});

describe("assessRunFreshness", () => {
  it("is unhealthy when nothing has ever run — the state the audit found", () => {
    const verdict = assessRunFreshness(NOW, []);
    expect(verdict.healthy).toBe(false);
    expect(verdict.problems).toEqual(["no drain run has ever been recorded"]);
  });

  it("is healthy when the latest cron run is recent and clean", () => {
    expect(assessRunFreshness(NOW, [run()])).toEqual({ healthy: true, problems: [], lastCronAt: hoursAgo(2) });
  });

  it("flags cron silence past the threshold even when kicks keep arriving", () => {
    const runs = [run({ id: 3, caller: "kick", startedAt: hoursAgo(1), finishedAt: hoursAgo(1) }), run({ id: 2, startedAt: hoursAgo(30), finishedAt: hoursAgo(30) })];
    const verdict = assessRunFreshness(NOW, runs);
    expect(verdict.healthy).toBe(false);
    expect(verdict.problems).toEqual([`cron has not run for 30h (threshold ${CRON_SILENCE_HOURS}h)`]);
  });

  it("flags a cron that has never run when only kicks exist", () => {
    const verdict = assessRunFreshness(NOW, [run({ caller: "kick" })]);
    expect(verdict.healthy).toBe(false);
    expect(verdict.problems).toEqual(["cron has never run — only browser kicks have drained"]);
    expect(verdict.lastCronAt).toBeNull();
  });

  it("carries the latest run's own problems forward", () => {
    const verdict = assessRunFreshness(NOW, [
      run({ id: 5, startedAt: hoursAgo(1), finishedAt: hoursAgo(1), healthy: false, problems: ["sop: 2 send(s) blocked by configuration"] }),
    ]);
    expect(verdict.healthy).toBe(false);
    expect(verdict.problems).toEqual(["latest run: sop: 2 send(s) blocked by configuration"]);
  });

  it("treats runs in any order — the newest by started_at is the latest", () => {
    const runs = [run({ id: 1, startedAt: hoursAgo(40), finishedAt: hoursAgo(40) }), run({ id: 2, startedAt: hoursAgo(3), finishedAt: hoursAgo(3) })];
    expect(assessRunFreshness(NOW, runs).healthy).toBe(true);
  });
});
