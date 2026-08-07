import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generateLink: vi.fn(),
  send: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: { admin: { generateLink: mocks.generateLink } } }),
}));

vi.mock("@/lib/sop/notifications-drain", () => ({
  createResendSender: () => mocks.send,
}));

import { POST, passwordRecoveryOrigin } from "./route";

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
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
    process.env.RESEND_API_KEY = "resend-key";
    process.env.RESEND_FROM = "Pulse <notifications@example.com>";
    process.env.NEXT_PUBLIC_SITE_URL = "https://pulse.example.com";
  });

  it("generates a recovery OTP and sends it through the Pulse email sender", async () => {
    mocks.generateLink.mockResolvedValue({
      data: { properties: { email_otp: "654321" } },
      error: null,
    });
    mocks.send.mockResolvedValue({ ok: true, id: "email-1" });

    const response = await POST(recoveryRequest(" Person@Example.com ", "192.0.2.1"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      accepted: true,
      message: "If an account exists, a recovery code has been sent.",
    });
    expect(mocks.generateLink).toHaveBeenCalledWith({
      type: "recovery",
      email: "person@example.com",
      options: { redirectTo: "https://pulse.example.com" },
    });
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(mocks.send.mock.calls[0]?.[0]).toBe("person@example.com");
    expect(mocks.send.mock.calls[0]?.[1].html).toContain("654321");
    expect(mocks.send.mock.calls[0]?.[1].html).not.toContain("supabase.co");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("returns the same accepted response for an unknown account without sending", async () => {
    mocks.generateLink.mockResolvedValue({
      data: { properties: null },
      error: { message: "User not found", code: "user_not_found", status: 404 },
    });

    const response = await POST(recoveryRequest("missing@example.com", "192.0.2.2"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ accepted: true });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("uses the configured HTTPS origin outside local development", () => {
    const request = new Request("https://preview-untrusted.example/api/auth/password-reset/request");
    expect(passwordRecoveryOrigin(request)).toBe("https://pulse.example.com");
  });

  it("uses localhost only when a development checkout has no public URL configured", () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    delete process.env.VERCEL_URL;

    const request = new Request("http://localhost:3000/api/auth/password-reset/request");
    expect(passwordRecoveryOrigin(request)).toBe("http://localhost:3000");
  });
});
