import { describe, expect, it } from "vitest";

import { buildPlaybackEvents } from "./playback";
import type { Task } from "./types";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1",
    scenarioId: "sc1",
    stationId: "s1",
    rowType: "task",
    wbs: "1",
    name: "Task",
    plannedStart: "2026-01-01T08:00:00.000Z",
    plannedFinish: "2026-01-01T09:00:00.000Z",
    plannedDurationMinutes: 60,
    plannedOperators: 1,
    plannedManHours: 0,
    status: "not_started",
    percentComplete: 0,
    dependencyIds: [],
    criticalPath: false,
    bottleneckFlag: false,
    qualityGate: false,
    travelerSignoffRequired: false,
    customFields: {},
    ...overrides,
  };
}

describe("buildPlaybackEvents", () => {
  const startMs = Date.parse("2026-01-01T08:00:00.000Z");

  it("always includes the build-start event and orders most-recent first", () => {
    const tasks = [
      makeTask({ id: "A", name: "Cut", plannedStart: "2026-01-01T08:00:00.000Z", plannedFinish: "2026-01-01T08:30:00.000Z" }),
    ];
    const events = buildPlaybackEvents(tasks, startMs, 120);
    // A started @0, A complete @30, plus build-started @0 -> sorted desc by time
    expect(events[0]).toMatchObject({ time: 30, label: "Cut complete", taskId: "A" });
    expect(events.some((e) => e.label === "Product build started")).toBe(true);
  });

  it("excludes events beyond the current minute (+0.25 tolerance)", () => {
    const tasks = [
      makeTask({ id: "A", name: "Cut", plannedStart: "2026-01-01T08:00:00.000Z", plannedFinish: "2026-01-01T09:00:00.000Z" }),
    ];
    // currentMinute = 10 -> the 'started' (0) shows, the 'complete' (60) does not
    const events = buildPlaybackEvents(tasks, startMs, 10);
    expect(events.some((e) => e.label === "Cut started")).toBe(true);
    expect(events.some((e) => e.label === "Cut complete")).toBe(false);
  });

  it("caps the feed at 8 events", () => {
    const tasks = Array.from({ length: 10 }, (_, i) =>
      makeTask({
        id: `t${i}`,
        name: `Step ${i}`,
        plannedStart: "2026-01-01T08:00:00.000Z",
        plannedFinish: "2026-01-01T08:05:00.000Z",
      }),
    );
    expect(buildPlaybackEvents(tasks, startMs, 1000).length).toBe(8);
  });
});
