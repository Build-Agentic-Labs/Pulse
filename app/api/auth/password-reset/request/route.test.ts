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

vi.mock("@/lib/sop/notifications-drain", () => ({
  createResendSender: () => mocks.send,
}));

import { POST, passwordRecoveryOrigin } from "./route";

const RESET_LINK = "https://pulse.example.com/reset-password#email=person%40example.com&token_hash=hash-1&type=recovery";

function recoveryRequest(email: string, ip: string) {
  return new Request("http://localhost:3000/api/auth/password-reset/request", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ email }),
  });
}

describe("password recovery request route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
    vi.stubEnv("RESEND_API_KEY", "resend-key");
    vi.stubEnv("RESEND_FROM", "Pulse <notifications@example.com>");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://pulse.example.com");
    vi.stubEnv("NOTIFICATION_EMAIL_REDIRECT_TO", "");
    vi.stubEnv("VERCEL_ENV", "");
    mocks.insert.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("emails a link-only reset built from the hashed token and records it in the ledger", async () => {
    mocks.generateLink.mockResolvedValue({
      data: { properties: { hashed_token: "hash-1", email_otp: "65432109" }, user: { id: "u1" } },
      error: null,
    });
    mocks.send.mockResolvedValue({ ok: true, id: "email-1" });

    const response = await POST(recoveryRequest(" Person@Example.com ", "192.0.2.1"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      accepted: true,
      message: "If an account exists, a reset link has been sent.",
    });
    expect(mocks.generateLink).toHaveBeenCalledWith({
      type: "recovery",
      email: "person@example.com",
      options: { redirectTo: "https://pulse.example.com" },
    });
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(mocks.send.mock.calls[0]?.[0]).toBe("person@example.com");
    expect(mocks.send.mock.calls[0]?.[1].html).toContain(`href="${RESET_LINK}"`);
    expect(mocks.send.mock.calls[0]?.[1].html).not.toContain("65432109");
    expect(mocks.send.mock.calls[0]?.[1].html).not.toContain("supabase.co");
    expect(mocks.send.mock.calls[0]?.[2].idempotencyKey).toMatch(/^recovery:/);
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "password_recovery", recipient_email: "person@example.com", status: "sent", resend_message_id: "email-1" }),
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("returns the same accepted response for an unknown account without sending", async () => {
    mocks.generateLink.mockResolvedValue({
      data: { properties: null, user: null },
      error: { message: "User not found", code: "user_not_found", status: 404 },
    });

    const response = await POST(recoveryRequest("missing@example.com", "192.0.2.2"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ accepted: true });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("logs the missing variable by name and answers 503 when configuration is incomplete", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(recoveryRequest("unconfigured@example.com", "192.0.2.3"));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "Password recovery is temporarily unavailable." });
    expect(error).toHaveBeenCalledWith("Password recovery unavailable: missing configuration", {
      missing: ["SUPABASE_SERVICE_ROLE_KEY"],
      environment: "unknown",
    });
    expect(JSON.stringify(error.mock.calls)).not.toContain("service-key");
    expect(mocks.generateLink).not.toHaveBeenCalled();
  });

  it("tells preview-deployment visitors why recovery is off", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(recoveryRequest("preview@example.com", "192.0.2.4"));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Password recovery is disabled on preview deployments. Use the production site.",
    });
  });

  it("logs the failing stage, ledgers it, and answers 503 when link generation fails for a real account", async () => {
    mocks.generateLink.mockResolvedValue({
      data: { properties: null, user: null },
      error: { message: "boom", code: "unexpected_failure", status: 500 },
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(recoveryRequest("failing@example.com", "192.0.2.5"));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "Password recovery is temporarily unavailable." });
    expect(error).toHaveBeenCalledWith("Password recovery failed", { stage: "generate_link", detail: "unexpected_failure" });
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "password_recovery", status: "failed", error: "500: generate_link: unexpected_failure" }),
    );
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("rate limits repeated requests for one address", async () => {
    mocks.generateLink.mockResolvedValue({
      data: { properties: { hashed_token: "hash-1" }, user: { id: "u1" } },
      error: null,
    });
    mocks.send.mockResolvedValue({ ok: true, id: "email-1" });

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      statuses.push((await POST(recoveryRequest("limited@example.com", "192.0.2.6"))).status);
    }
    expect(statuses).toEqual([200, 200, 200, 429]);
  });

  it("uses the configured HTTPS origin outside local development", () => {
    const request = new Request("https://preview-untrusted.example/api/auth/password-reset/request");
    expect(passwordRecoveryOrigin(request)).toBe("https://pulse.example.com");
  });

  it("uses localhost only when a development checkout has no public URL configured", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    vi.stubEnv("VERCEL_URL", "");

    const request = new Request("http://localhost:3000/api/auth/password-reset/request");
    expect(passwordRecoveryOrigin(request)).toBe("http://localhost:3000");
  });
});
