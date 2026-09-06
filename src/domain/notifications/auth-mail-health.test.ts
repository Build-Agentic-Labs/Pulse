import { describe, expect, it } from "vitest";
import { FAILURE_WINDOW_HOURS, assessAuthMailHealth } from "./auth-mail-health";

describe("assessAuthMailHealth", () => {
  it("lists every missing variable by name and is unhealthy", () => {
    const verdict = assessAuthMailHealth({
      missingConfig: ["RESEND_API_KEY", "RESEND_FROM"],
      recentFailures: { count: 0, latestError: null },
    });
    expect(verdict).toEqual({
      healthy: false,
      problems: ["auth mail: missing RESEND_API_KEY, RESEND_FROM"],
      failedInWindow: 0,
    });
  });

  it("is healthy when config is complete and nothing failed recently", () => {
    expect(assessAuthMailHealth({ missingConfig: [], recentFailures: { count: 0, latestError: null } })).toEqual({
      healthy: true,
      problems: [],
      failedInWindow: 0,
    });
  });

  it("surfaces real failed sends with the latest error so the operator knows where it broke", () => {
    const verdict = assessAuthMailHealth({
      missingConfig: [],
      recentFailures: { count: 2, latestError: "500: generate_link: unexpected_failure" },
    });
    expect(verdict.healthy).toBe(false);
    expect(verdict.failedInWindow).toBe(2);
    expect(verdict.problems).toEqual([
      `auth mail: 2 send(s) failed in the last ${FAILURE_WINDOW_HOURS}h (latest: 500: generate_link: unexpected_failure)`,
    ]);
  });

  it("copes with a failed row that carries no error text", () => {
    const verdict = assessAuthMailHealth({ missingConfig: [], recentFailures: { count: 1, latestError: null } });
    expect(verdict.problems).toEqual([`auth mail: 1 send(s) failed in the last ${FAILURE_WINDOW_HOURS}h (latest: unknown error)`]);
  });

  it("combines config and failure problems, config first", () => {
    const verdict = assessAuthMailHealth({
      missingConfig: ["RESEND_FROM"],
      recentFailures: { count: 1, latestError: "422: Invalid `from`" },
    });
    expect(verdict.problems).toEqual([
      "auth mail: missing RESEND_FROM",
      `auth mail: 1 send(s) failed in the last ${FAILURE_WINDOW_HOURS}h (latest: 422: Invalid \`from\`)`,
    ]);
  });

  it("looks back one day", () => {
    expect(FAILURE_WINDOW_HOURS).toBe(24);
  });
});
