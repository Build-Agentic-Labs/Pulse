/**
 * The one place outbound email is configured from the environment: Resend
 * credentials, plus the optional NOTIFICATION_EMAIL_REDIRECT_TO test redirect.
 * Every route that sends mail (drain, console resend, invites, recovery) builds
 * its sender here so a redirect can never be half-applied.
 */

import { createResendSender, type EmailSender } from "@/lib/sop/notifications-drain";
import { withRecipientRedirect } from "./redirect-sender";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ConfiguredEmailSender {
  /** Null when Resend is not configured. */
  send: EmailSender | null;
  /** The address every message is being redirected to, or null in normal operation. */
  redirectedTo: string | null;
}

export function createEmailSenderFromEnv(fetchImpl: typeof fetch = fetch): ConfiguredEmailSender {
  const apiKey = process.env.RESEND_API_KEY ?? "";
  const from = process.env.RESEND_FROM ?? "";
  if (!apiKey || !from) return { send: null, redirectedTo: null };

  const redirectRaw = (process.env.NOTIFICATION_EMAIL_REDIRECT_TO ?? "").trim().toLowerCase();
  const redirectedTo = EMAIL_PATTERN.test(redirectRaw) ? redirectRaw : null;
  const base = createResendSender(apiKey, from, fetchImpl);
  return { send: redirectedTo ? withRecipientRedirect(base, redirectedTo) : base, redirectedTo };
}
