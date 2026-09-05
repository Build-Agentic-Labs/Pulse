import { describe, expect, it } from "vitest";
import {
  STALL_DIGEST_DAYS,
  buildStalledDigest,
  isoWeekKey,
  renderStalledDigestEmail,
  selectStalledSops,
  type DigestSop,
  type DigestWorkspaceState,
} from "./digest";

describe("isoWeekKey", () => {
  it("formats the ISO week, including year rollover", () => {
    expect(isoWeekKey(new Date("2026-09-04T12:00:00Z"))).toBe("2026-W36");
    expect(isoWeekKey(new Date("2027-01-01T12:00:00Z"))).toBe("2026-W53");
    expect(isoWeekKey(new Date("2026-01-01T12:00:00Z"))).toBe("2026-W01");
  });
});

const NOW = new Date("2026-09-04T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 60 * 60 * 1000).toISOString();

const sop = (over: Partial<DigestSop> = {}): DigestSop => ({
  sopId: "sop-1",
  label: "PRD · Line Clearance",
  status: "in_review",
  lastMovedAt: daysAgo(10),
  waitingOn: "1 review outstanding (Engineering)",
  ...over,
});

describe("selectStalledSops", () => {
  it("keeps in-flight SOPs that have not moved for the threshold, with their age", () => {
    const out = selectStalledSops(NOW, [
      sop(),
      sop({ sopId: "fresh", lastMovedAt: daysAgo(3) }),
      sop({ sopId: "edge", lastMovedAt: daysAgo(STALL_DIGEST_DAYS) }),
      sop({ sopId: "done", status: "effective", lastMovedAt: daysAgo(40) }),
    ]);
    expect(out.map((entry) => [entry.sopId, entry.days])).toEqual([
      ["sop-1", 10],
      ["edge", STALL_DIGEST_DAYS],
    ]);
  });

  it("orders the oldest stall first", () => {
    const out = selectStalledSops(NOW, [sop({ sopId: "b", lastMovedAt: daysAgo(8) }), sop({ sopId: "a", lastMovedAt: daysAgo(30) })]);
    expect(out.map((entry) => entry.sopId)).toEqual(["a", "b"]);
  });
});

describe("buildStalledDigest", () => {
  const workspace = (over: Partial<DigestWorkspaceState> = {}): DigestWorkspaceState => ({
    workspaceId: "ws-1",
    workspaceName: "Anacorp",
    recipients: ["owner", "quality", "owner"],
    stalled: [{ ...sop(), days: 10 }],
    ...over,
  });

  it("emits one pending per distinct recipient for the current ISO week", () => {
    expect(buildStalledDigest(NOW, [workspace()])).toEqual([
      { recipientId: "owner", kind: "stalled_weekly", workspaceId: "ws-1", periodKey: "2026-W36" },
      { recipientId: "quality", kind: "stalled_weekly", workspaceId: "ws-1", periodKey: "2026-W36" },
    ]);
  });

  it("sends nothing for a workspace with no stalls", () => {
    expect(buildStalledDigest(NOW, [workspace({ stalled: [] })])).toEqual([]);
  });
});

describe("renderStalledDigestEmail", () => {
  it("summarises every stalled SOP with its age and what it waits on", () => {
    const out = renderStalledDigestEmail({
      workspaceName: "Anacorp",
      periodKey: "2026-W36",
      stalled: [
        { ...sop(), days: 10 },
        { ...sop({ sopId: "sop-2", label: "ENG · Torque Spec", status: "approved", waitingOn: "Quality release" }), days: 37 },
      ],
      origin: "https://pulse.example.com",
    });
    expect(out.subject).toBe("Stalled SOP work this week: 2 SOPs in Anacorp");
    expect(out.text).toContain("PRD · Line Clearance — 10 days, waiting on 1 review outstanding (Engineering)");
    expect(out.text).toContain("ENG · Torque Spec — 37 days, waiting on Quality release");
    expect(out.html).toContain('href="https://pulse.example.com/sops/sop-2"');
    expect(out.html).toContain("owner or admin");
  });

  it("uses the singular for one SOP", () => {
    const out = renderStalledDigestEmail({ workspaceName: "Anacorp", periodKey: "2026-W36", stalled: [{ ...sop(), days: 10 }], origin: "https://x" });
    expect(out.subject).toBe("Stalled SOP work this week: 1 SOP in Anacorp");
  });
});
