import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  latestDrainRuns: vi.fn(),
  latestTransactionalEmailFor: vi.fn(),
  latestDeliveryStatuses: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/notifications/drain-runs-store", () => ({ latestDrainRuns: mocks.latestDrainRuns }));
vi.mock("@/lib/notifications/transactional-log", () => ({ latestTransactionalEmailFor: mocks.latestTransactionalEmailFor }));
vi.mock("@/lib/notifications/deliveries-store", () => ({ latestDeliveryStatuses: mocks.latestDeliveryStatuses }));
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
    vi.stubEnv("AUTH_MAIL_CANARY_EMAIL", "delivered@resend.dev");
    mocks.latestDrainRuns.mockResolvedValue([freshRun()]);
    mocks.latestDeliveryStatuses.mockResolvedValue(new Map());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is healthy when the drain is fresh and the canary was sent and delivered recently", async () => {
    mocks.latestTransactionalEmailFor.mockResolvedValue({
      createdAt: minutesAgo(60),
      status: "sent",
      error: null,
      resendMessageId: "re_c1",
    });
    mocks.latestDeliveryStatuses.mockResolvedValue(
      new Map([["re_c1", { resendMessageId: "re_c1", latestEvent: "email.delivered", occurredAt: minutesAgo(59) }]]),
    );

    const response = await GET(healthRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.healthy).toBe(true);
    expect(body.problems).toEqual([]);
    expect(body.authMail).toEqual({ healthy: true, problems: [], canary: "ok" });
    expect(mocks.latestTransactionalEmailFor).toHaveBeenCalledWith(expect.anything(), "delivered@resend.dev");
  });

  it("turns unhealthy when the canary never ran, even though the drain is fine", async () => {
    mocks.latestTransactionalEmailFor.mockResolvedValue(null);

    const response = await GET(healthRequest());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.healthy).toBe(false);
    expect(body.problems).toEqual(["auth-mail canary has never run"]);
    expect(body.authMail.canary).toBe("never_ran");
  });

  it("names missing auth-mail configuration in the same verdict", async () => {
    vi.stubEnv("RESEND_FROM", "");
    mocks.latestTransactionalEmailFor.mockResolvedValue(null);

    const body = await (await GET(healthRequest())).json();

    expect(body.healthy).toBe(false);
    expect(body.problems).toEqual(["auth mail: missing RESEND_FROM", "auth-mail canary has never run"]);
  });

  it("reports the canary as not configured, and stays healthy, when the address is unset", async () => {
    vi.stubEnv("AUTH_MAIL_CANARY_EMAIL", "");

    const response = await GET(healthRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.authMail).toEqual({ healthy: true, problems: [], canary: "not_configured" });
    expect(mocks.latestTransactionalEmailFor).not.toHaveBeenCalled();
  });

  it("still answers 401 without the secret", async () => {
    const response = await GET(new Request("https://pulse.example.com/api/notifications/health"));
    expect(response.status).toBe(401);
  });
});
