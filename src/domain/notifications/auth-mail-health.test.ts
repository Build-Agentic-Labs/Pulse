import { describe, expect, it } from "vitest";
import {
  CANARY_DELIVERY_GRACE_MINUTES,
  CANARY_STALE_HOURS,
  assessAuthMailHealth,
  type CanaryObservation,
} from "./auth-mail-health";

const NOW = new Date("2026-09-06T12:00:00Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60 * 1000).toISOString();
const hoursAgo = (h: number) => minutesAgo(h * 60);
const CANARY = "delivered@resend.dev";

const observation = (over: Partial<CanaryObservation> = {}): CanaryObservation => ({
  requestedAt: hoursAgo(2),
  status: "sent",
  error: null,
  deliveredAt: hoursAgo(2),
  ...over,
});

describe("assessAuthMailHealth", () => {
  it("lists every missing variable by name and is unhealthy", () => {
    const verdict = assessAuthMailHealth({
      now: NOW,
      missingConfig: ["RESEND_API_KEY", "RESEND_FROM"],
      canaryEmail: null,
      latestCanary: null,
    });
    expect(verdict.healthy).toBe(false);
    expect(verdict.problems).toEqual(["auth mail: missing RESEND_API_KEY, RESEND_FROM"]);
    expect(verdict.canary).toBe("not_configured");
  });

  it("is healthy with the canary not configured when config is complete", () => {
    expect(assessAuthMailHealth({ now: NOW, missingConfig: [], canaryEmail: null, latestCanary: null })).toEqual({
      healthy: true,
      problems: [],
      canary: "not_configured",
    });
  });

  it("is unhealthy when the canary is configured but has never run", () => {
    const verdict = assessAuthMailHealth({ now: NOW, missingConfig: [], canaryEmail: CANARY, latestCanary: null });
    expect(verdict).toEqual({ healthy: false, problems: ["auth-mail canary has never run"], canary: "never_ran" });
  });

  it("surfaces the ledger error when the latest canary failed", () => {
    const verdict = assessAuthMailHealth({
      now: NOW,
      missingConfig: [],
      canaryEmail: CANARY,
      latestCanary: observation({ status: "failed", error: "503: provider down", deliveredAt: null, requestedAt: minutesAgo(5) }),
    });
    expect(verdict.canary).toBe("failed");
    expect(verdict.problems).toEqual(["auth-mail canary failed: 503: provider down"]);
  });

  it("gives a fresh send a grace period before demanding a delivery event", () => {
    const verdict = assessAuthMailHealth({
      now: NOW,
      missingConfig: [],
      canaryEmail: CANARY,
      latestCanary: observation({ requestedAt: minutesAgo(3), deliveredAt: null }),
    });
    expect(verdict).toEqual({ healthy: true, problems: [], canary: "ok" });
  });

  it("flags a send that never produced a delivery event once the grace period passes", () => {
    const verdict = assessAuthMailHealth({
      now: NOW,
      missingConfig: [],
      canaryEmail: CANARY,
      latestCanary: observation({ requestedAt: minutesAgo(20), deliveredAt: null }),
    });
    expect(verdict.canary).toBe("undelivered");
    expect(verdict.problems).toEqual([
      `auth-mail canary sent 20 min ago but no delivery event yet (grace ${CANARY_DELIVERY_GRACE_MINUTES} min)`,
    ]);
  });

  it("flags a canary that has not run within the staleness window even if it was delivered", () => {
    const verdict = assessAuthMailHealth({
      now: NOW,
      missingConfig: [],
      canaryEmail: CANARY,
      latestCanary: observation({ requestedAt: hoursAgo(30), deliveredAt: hoursAgo(30) }),
    });
    expect(verdict.canary).toBe("stale");
    expect(verdict.problems).toEqual([`auth-mail canary last ran 30h ago (threshold ${CANARY_STALE_HOURS}h)`]);
  });

  it("is ok when the latest canary is recent and delivered", () => {
    expect(assessAuthMailHealth({ now: NOW, missingConfig: [], canaryEmail: CANARY, latestCanary: observation() })).toEqual({
      healthy: true,
      problems: [],
      canary: "ok",
    });
  });

  it("combines config and canary problems", () => {
    const verdict = assessAuthMailHealth({
      now: NOW,
      missingConfig: ["RESEND_FROM"],
      canaryEmail: CANARY,
      latestCanary: null,
    });
    expect(verdict.problems).toEqual(["auth mail: missing RESEND_FROM", "auth-mail canary has never run"]);
  });
});
