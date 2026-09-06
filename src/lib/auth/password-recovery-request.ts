/**
 * Password recovery, independent of HTTP: the same code path serves the public
 * route and the daily canary, and every outcome — including a failure before any
 * email exists — lands in the transactional ledger so the console and the health
 * check can see it. Nothing here ever logs or stores a token.
 */

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { passwordResetUrl, renderPasswordRecoveryEmail } from "@/domain/auth/password-recovery";
import type { Database } from "@/lib/database.types";
import { recordTransactionalEmail } from "@/lib/notifications/transactional-log";
import type { EmailSender } from "@/lib/sop/notifications-drain";

export const PASSWORD_RECOVERY_ENV = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "RESEND_API_KEY",
  "RESEND_FROM",
] as const;

export interface MailConfigCheck {
  ok: boolean;
  /** Variable NAMES that are absent or empty. Never values. */
  missing: string[];
}

export function readPasswordRecoveryConfig(env: Record<string, string | undefined>, origin: string): MailConfigCheck {
  const missing = PASSWORD_RECOVERY_ENV.filter((name) => !env[name]).map(String);
  if (!origin) missing.push("NEXT_PUBLIC_SITE_URL");
  return { ok: missing.length === 0, missing };
}

/** Public-safe explanation. Preview deployments lack service-role config by design. */
export function describeUnavailable(feature: "Password recovery" | "Invitations", vercelEnv: string | undefined): string {
  const verb = feature === "Invitations" ? "are" : "is";
  if (vercelEnv === "preview") {
    return `${feature} ${verb} disabled on preview deployments. Use the production site.`;
  }
  return `${feature} ${verb} temporarily unavailable.`;
}

export type ConfigLogger = (message: string, meta: Record<string, unknown>) => void;

export function logMissingConfig(
  feature: string,
  missing: string[],
  vercelEnv: string | undefined,
  log: ConfigLogger = console.error,
): void {
  log(`${feature} unavailable: missing configuration`, { missing, environment: vercelEnv || "unknown" });
}

export function isMissingUserError(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  return /user[^a-z]+not[^a-z]+found/i.test(error.message ?? "") || error.code === "user_not_found";
}

export type RecoveryOutcome =
  | { kind: "sent"; resendMessageId: string; ledgerRecorded: boolean }
  | { kind: "unknown_user" }
  | { kind: "failed"; stage: "generate_link" | "send"; detail: string };

export interface RecoveryRequestInput {
  /** Normalized (trimmed, lower-cased) address. */
  email: string;
  /** Trusted site origin — the links in the email point here. */
  origin: string;
  admin: SupabaseClient<Database>;
  send: EmailSender;
  idempotencyKey?: string;
}

export async function requestPasswordRecovery(input: RecoveryRequestInput): Promise<RecoveryOutcome> {
  const { email, origin, admin, send } = input;
  const { data, error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo: origin },
  });

  if (isMissingUserError(error)) {
    return { kind: "unknown_user" };
  }

  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) {
    const detail = error ? (error.code ?? error.message ?? "unknown") : "missing_token";
    await recordTransactionalEmail(admin, {
      kind: "password_recovery",
      recipientEmail: email,
      result: { ok: false, status: error?.status ?? 0, error: `generate_link: ${detail}`, failure: "configuration" },
    });
    return { kind: "failed", stage: "generate_link", detail };
  }

  const actionLink = passwordResetUrl(origin, email, tokenHash);
  const result = await send(email, renderPasswordRecoveryEmail({ actionLink, email, origin }), {
    idempotencyKey: input.idempotencyKey ?? `recovery:${randomUUID()}`,
  });
  const ledgerRecorded = await recordTransactionalEmail(admin, { kind: "password_recovery", recipientEmail: email, result });

  if (!result.ok) {
    return { kind: "failed", stage: "send", detail: `${result.status} ${result.failure}` };
  }
  return { kind: "sent", resendMessageId: result.id, ledgerRecorded };
}
