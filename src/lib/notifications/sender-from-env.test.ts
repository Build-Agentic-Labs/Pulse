import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmailSenderFromEnv } from "./sender-from-env";

describe("createEmailSenderFromEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is unconfigured without Resend credentials", () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("RESEND_FROM", "");
    vi.stubEnv("NOTIFICATION_EMAIL_REDIRECT_TO", "");
    expect(createEmailSenderFromEnv()).toEqual({ send: null, redirectedTo: null });
  });

  it("returns a plain sender when no redirect is set", () => {
    vi.stubEnv("RESEND_API_KEY", "re_key");
    vi.stubEnv("RESEND_FROM", "Pulse <n@pulse.test>");
    vi.stubEnv("NOTIFICATION_EMAIL_REDIRECT_TO", "");
    const { send, redirectedTo } = createEmailSenderFromEnv();
    expect(typeof send).toBe("function");
    expect(redirectedTo).toBeNull();
  });

  it("wraps the sender so every message goes to the redirect address", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_key");
    vi.stubEnv("RESEND_FROM", "Pulse <n@pulse.test>");
    vi.stubEnv("NOTIFICATION_EMAIL_REDIRECT_TO", " rlopez@anacorp.com ");
    const seen: string[] = [];
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      seen.push(String(JSON.parse(String(init?.body)).to[0]));
      return new Response(JSON.stringify({ id: "re_9" }), { status: 200 });
    }) as typeof fetch;
    const { send, redirectedTo } = createEmailSenderFromEnv(fetchImpl);
    expect(redirectedTo).toBe("rlopez@anacorp.com");
    await send!("jli@anacorp.com", { subject: "s", text: "t", html: "<p>t</p>" }, { idempotencyKey: "k" });
    expect(seen).toEqual(["rlopez@anacorp.com"]);
  });

  it("ignores a redirect value that is not an email address", () => {
    vi.stubEnv("RESEND_API_KEY", "re_key");
    vi.stubEnv("RESEND_FROM", "Pulse <n@pulse.test>");
    vi.stubEnv("NOTIFICATION_EMAIL_REDIRECT_TO", "not-an-address");
    expect(createEmailSenderFromEnv().redirectedTo).toBeNull();
  });
});
