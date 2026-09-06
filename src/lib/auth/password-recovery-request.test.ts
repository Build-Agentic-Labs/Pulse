import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { EmailSender } from "@/lib/sop/notifications-drain";
import {
  PASSWORD_RECOVERY_ENV,
  describeUnavailable,
  logMissingConfig,
  readPasswordRecoveryConfig,
  requestPasswordRecovery,
} from "./password-recovery-request";

const ORIGIN = "https://pulse.example";
const EMAIL = "person@example.com";
const TOKEN = "HASHED-TOKEN-XYZ";

function fakeAdmin(generateLink: ReturnType<typeof vi.fn>, insert = vi.fn().mockResolvedValue({ error: null })) {
  const admin = {
    auth: { admin: { generateLink } },
    from: vi.fn(() => ({ insert })),
  };
  return { admin: admin as unknown as SupabaseClient<Database>, insert, from: admin.from };
}

function okSender(): { send: EmailSender; calls: { to: string; html: string; key: string }[] } {
  const calls: { to: string; html: string; key: string }[] = [];
  const send: EmailSender = async (to, content, options) => {
    calls.push({ to, html: content.html, key: options.idempotencyKey });
    return { ok: true, id: "re_42" };
  };
  return { send, calls };
}

describe("readPasswordRecoveryConfig", () => {
  const full = {
    NEXT_PUBLIC_SUPABASE_URL: "https://p.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "svc",
    RESEND_API_KEY: "re_key",
    RESEND_FROM: "Pulse <n@pulse.example>",
  };

  it("is ok when every variable and the site origin are present", () => {
    expect(readPasswordRecoveryConfig(full, ORIGIN)).toEqual({ ok: true, missing: [] });
  });

  it("names each missing variable — names only, never values", () => {
    const check = readPasswordRecoveryConfig({ ...full, SUPABASE_SERVICE_ROLE_KEY: "", RESEND_FROM: undefined }, ORIGIN);
    expect(check.ok).toBe(false);
    expect(check.missing).toEqual(["SUPABASE_SERVICE_ROLE_KEY", "RESEND_FROM"]);
  });

  it("treats an empty site origin as missing NEXT_PUBLIC_SITE_URL", () => {
    expect(readPasswordRecoveryConfig(full, "").missing).toEqual(["NEXT_PUBLIC_SITE_URL"]);
  });

  it("checks exactly the four runtime variables", () => {
    expect([...PASSWORD_RECOVERY_ENV]).toEqual([
      "NEXT_PUBLIC_SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
      "RESEND_API_KEY",
      "RESEND_FROM",
    ]);
  });
});

describe("describeUnavailable", () => {
  it("tells a preview visitor why, and where to go instead", () => {
    expect(describeUnavailable("Password recovery", "preview")).toBe(
      "Password recovery is disabled on preview deployments. Use the production site.",
    );
  });

  it("stays generic everywhere else", () => {
    expect(describeUnavailable("Password recovery", "production")).toBe("Password recovery is temporarily unavailable.");
    expect(describeUnavailable("Invitations", undefined)).toBe("Invitations are temporarily unavailable.");
  });
});

describe("logMissingConfig", () => {
  it("logs the feature, the missing names and the environment — nothing else", () => {
    const log = vi.fn();
    logMissingConfig("Password recovery", ["RESEND_API_KEY"], "production", log);
    expect(log).toHaveBeenCalledWith("Password recovery unavailable: missing configuration", {
      missing: ["RESEND_API_KEY"],
      environment: "production",
    });
  });

  it("reports an unknown environment when VERCEL_ENV is unset or empty", () => {
    const log = vi.fn();
    logMissingConfig("Invitations", ["RESEND_FROM"], undefined, log);
    logMissingConfig("Invitations", ["RESEND_FROM"], "", log);
    expect(log.mock.calls[0]?.[1]).toEqual({ missing: ["RESEND_FROM"], environment: "unknown" });
    expect(log.mock.calls[1]?.[1]).toEqual({ missing: ["RESEND_FROM"], environment: "unknown" });
  });
});

describe("requestPasswordRecovery", () => {
  it("answers unknown_user without sending or ledgering when the account does not exist", async () => {
    const generateLink = vi.fn().mockResolvedValue({
      data: { properties: null, user: null },
      error: { message: "User not found", code: "user_not_found", status: 404 },
    });
    const { admin, insert } = fakeAdmin(generateLink);
    const { send, calls } = okSender();

    const outcome = await requestPasswordRecovery({ email: "missing@example.com", origin: ORIGIN, admin, send });

    expect(outcome).toEqual({ kind: "unknown_user" });
    expect(calls).toHaveLength(0);
    expect(insert).not.toHaveBeenCalled();
  });

  it("sends a link-only email built from the hashed token and records a sent ledger row", async () => {
    const generateLink = vi.fn().mockResolvedValue({
      data: { properties: { hashed_token: TOKEN, email_otp: "12345678" }, user: { id: "u1" } },
      error: null,
    });
    const { admin, insert } = fakeAdmin(generateLink);
    const { send, calls } = okSender();

    const outcome = await requestPasswordRecovery({ email: EMAIL, origin: ORIGIN, admin, send, idempotencyKey: "recovery:fixed" });

    expect(outcome).toEqual({ kind: "sent", resendMessageId: "re_42", ledgerRecorded: true });
    expect(generateLink).toHaveBeenCalledWith({ type: "recovery", email: EMAIL, options: { redirectTo: ORIGIN } });
    expect(calls).toHaveLength(1);
    expect(calls[0].to).toBe(EMAIL);
    expect(calls[0].key).toBe("recovery:fixed");
    expect(calls[0].html).toContain(`${ORIGIN}/reset-password#email=person%40example.com&token_hash=${TOKEN}&type=recovery`);
    expect(calls[0].html).not.toContain("12345678");
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "password_recovery", recipient_email: EMAIL, status: "sent", resend_message_id: "re_42" }),
    );
  });

  it("generates its own recovery-prefixed idempotency key when none is given", async () => {
    const generateLink = vi.fn().mockResolvedValue({
      data: { properties: { hashed_token: TOKEN }, user: { id: "u1" } },
      error: null,
    });
    const { admin } = fakeAdmin(generateLink);
    const { send, calls } = okSender();
    await requestPasswordRecovery({ email: EMAIL, origin: ORIGIN, admin, send });
    expect(calls[0].key).toMatch(/^recovery:[0-9a-f-]{36}$/);
  });

  it("records a failed ledger row when link generation fails for an existing account", async () => {
    const generateLink = vi.fn().mockResolvedValue({
      data: { properties: null, user: null },
      error: { message: "boom", code: "unexpected_failure", status: 500 },
    });
    const { admin, insert } = fakeAdmin(generateLink);
    const { send, calls } = okSender();

    const outcome = await requestPasswordRecovery({ email: EMAIL, origin: ORIGIN, admin, send });

    expect(outcome).toEqual({ kind: "failed", stage: "generate_link", detail: "unexpected_failure" });
    expect(calls).toHaveLength(0);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "password_recovery",
        recipient_email: EMAIL,
        status: "failed",
        error: "500: generate_link: unexpected_failure",
      }),
    );
  });

  it("treats a response without a hashed token as a generation failure", async () => {
    const generateLink = vi.fn().mockResolvedValue({
      data: { properties: { email_otp: "12345678" }, user: { id: "u1" } },
      error: null,
    });
    const { admin, insert } = fakeAdmin(generateLink);
    const { send } = okSender();

    const outcome = await requestPasswordRecovery({ email: EMAIL, origin: ORIGIN, admin, send });

    expect(outcome).toEqual({ kind: "failed", stage: "generate_link", detail: "missing_token" });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", error: "0: generate_link: missing_token" }));
  });

  it("records a failed ledger row when the provider rejects the send", async () => {
    const generateLink = vi.fn().mockResolvedValue({
      data: { properties: { hashed_token: TOKEN }, user: { id: "u1" } },
      error: null,
    });
    const { admin, insert } = fakeAdmin(generateLink);
    const send: EmailSender = async () => ({ ok: false, status: 422, error: "Invalid `from`", failure: "configuration" });

    const outcome = await requestPasswordRecovery({ email: EMAIL, origin: ORIGIN, admin, send });

    expect(outcome).toEqual({ kind: "failed", stage: "send", detail: "422 configuration" });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", error: "422: Invalid `from`" }));
  });

  it("never lets the token leak into the ledger", async () => {
    const generateLink = vi.fn().mockResolvedValue({
      data: { properties: { hashed_token: TOKEN }, user: { id: "u1" } },
      error: null,
    });
    const { admin, insert } = fakeAdmin(generateLink);
    const { send } = okSender();
    await requestPasswordRecovery({ email: EMAIL, origin: ORIGIN, admin, send });
    expect(JSON.stringify(insert.mock.calls)).not.toContain(TOKEN);
  });
});
