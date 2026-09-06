import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  latestDrainRuns: vi.fn(),
  countRecentTransactionalFailures: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/notifications/drain-runs-store", () => ({ latestDrainRuns: mocks.latestDrainRuns }));
vi.mock("@/lib/notifications/transactional-log", () => ({
  countRecentTransactionalFailures: mocks.countRecentTransactionalFailures,
}));
vi.mock("@/lib/sop/notifications-drain", () => ({
  isAuthorizedCronRequest: (request: Request) => request.headers.get("authorization") === "Bearer cron-secret",
}));

import { GET } from "./route";

const NOW = Date.now();
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

function healthRequest() {
  return new Request("https://pulse.example.com/api/notifications/health", {
    headers: { authorization: "Bearer cron-secret" },
  });
}

function freshRun() {
  return { id: 9, caller: "cron", startedAt: minutesAgo(30), finishedAt: minutesAgo(29), healthy: true, problems: [] };
}

describe("notification health route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
    vi.stubEnv("RESEND_API_KEY", "resend-key");
    vi.stubEnv("RESEND_FROM", "Pulse <notifications@example.com>");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://pulse.example.com");
    mocks.latestDrainRuns.mockResolvedValue([freshRun()]);
    mocks.countRecentTransactionalFailures.mockResolvedValue({ count: 0, latestError: null });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is healthy when the drain is fresh, config is complete and no auth mail failed recently", async () => {
    const response = await GET(healthRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.healthy).toBe(true);
    expect(body.problems).toEqual([]);
    expect(body.authMail).toEqual({ healthy: true, problems: [], failedInWindow: 0 });
    const since = mocks.countRecentTransactionalFailures.mock.calls[0]?.[1] as Date;
    expect(NOW - since.getTime()).toBeGreaterThan(23 * 60 * 60_000);
    expect(NOW - since.getTime()).toBeLessThan(25 * 60 * 60_000);
  });

  it("turns unhealthy when a real reset or invitation send failed, even though the drain is fine", async () => {
    mocks.countRecentTransactionalFailures.mockResolvedValue({ count: 1, latestError: "500: generate_link: unexpected_failure" });

    const response = await GET(healthRequest());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.healthy).toBe(false);
    expect(body.problems).toEqual(["auth mail: 1 send(s) failed in the last 24h (latest: 500: generate_link: unexpected_failure)"]);
    expect(body.authMail.failedInWindow).toBe(1);
  });

  it("names missing auth-mail configuration in the same verdict", async () => {
    vi.stubEnv("RESEND_FROM", "");

    const body = await (await GET(healthRequest())).json();

    expect(body.healthy).toBe(false);
    expect(body.problems).toEqual(["auth mail: missing RESEND_FROM"]);
  });

  it("still answers 401 without the secret", async () => {
    const response = await GET(new Request("https://pulse.example.com/api/notifications/health"));
    expect(response.status).toBe(401);
  });
});
