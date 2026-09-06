import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generateLink: vi.fn(),
  insert: vi.fn(),
  send: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: { admin: { generateLink: mocks.generateLink } },
    from: () => ({ insert: mocks.insert }),
  }),
}));

vi.mock("@/lib/sop/notifications-drain", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sop/notifications-drain")>();
  return {
    ...actual,
    createResendSender: () => mocks.send,
    isAuthorizedCronRequest: (request: Request) => request.headers.get("authorization") === "Bearer cron-secret",
  };
});

import { GET } from "./route";

function canaryRequest(authorized = true) {
  return new Request("https://pulse.example.com/api/auth/password-reset/canary", {
    headers: authorized ? { authorization: "Bearer cron-secret" } : {},
  });
}

describe("password reset canary route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
    vi.stubEnv("RESEND_API_KEY", "resend-key");
    vi.stubEnv("RESEND_FROM", "Pulse <notifications@example.com>");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://pulse.example.com");
    vi.stubEnv("AUTH_MAIL_CANARY_EMAIL", "delivered@resend.dev");
    vi.stubEnv("NOTIFICATION_EMAIL_REDIRECT_TO", "");
    mocks.insert.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects callers without the cron secret", async () => {
    const response = await GET(canaryRequest(false));
    expect(response.status).toBe(401);
    expect(mocks.generateLink).not.toHaveBeenCalled();
  });

  it("refuses to run when the canary address is not configured", async () => {
    vi.stubEnv("AUTH_MAIL_CANARY_EMAIL", "");
    const response = await GET(canaryRequest());
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "AUTH_MAIL_CANARY_EMAIL is not set." });
  });

  it("names missing configuration instead of failing silently", async () => {
    vi.stubEnv("RESEND_FROM", "");
    const response = await GET(canaryRequest());
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Password recovery is temporarily unavailable.",
      missing: ["RESEND_FROM"],
    });
  });

  it("sends the canary reset through the real recovery path and reports the message id", async () => {
    mocks.generateLink.mockResolvedValue({
      data: { properties: { hashed_token: "canary-hash" }, user: { id: "canary" } },
      error: null,
    });
    mocks.send.mockResolvedValue({ ok: true, id: "re_canary" });

    const response = await GET(canaryRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      recipient: "delivered@resend.dev",
      resendMessageId: "re_canary",
      ledgerRecorded: true,
    });
    expect(mocks.generateLink).toHaveBeenCalledWith({
      type: "recovery",
      email: "delivered@resend.dev",
      options: { redirectTo: "https://pulse.example.com" },
    });
    expect(mocks.send.mock.calls[0]?.[0]).toBe("delivered@resend.dev");
    expect(mocks.send.mock.calls[0]?.[2].idempotencyKey).toMatch(/^recovery:canary:/);
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ kind: "password_recovery", status: "sent" }));
  });

  it("explains a missing canary account", async () => {
    mocks.generateLink.mockResolvedValue({
      data: { properties: null, user: null },
      error: { message: "User not found", code: "user_not_found", status: 404 },
    });
    const response = await GET(canaryRequest());
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Canary account does not exist. Run scripts/create-auth-mail-canary.mjs.",
    });
  });

  it("reports a failed stage so the operator knows where it broke", async () => {
    mocks.generateLink.mockResolvedValue({
      data: { properties: { hashed_token: "canary-hash" }, user: { id: "canary" } },
      error: null,
    });
    mocks.send.mockResolvedValue({ ok: false, status: 500, error: "upstream", failure: "transient" });
    const response = await GET(canaryRequest());
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ ok: false, stage: "send", detail: "500 transient" });
  });
});
