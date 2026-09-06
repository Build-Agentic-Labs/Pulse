import { escapeHtml, renderEmailShell } from "@/domain/notification-email-shell";

export interface PasswordRecoveryEmailInput {
  /** The /reset-password link carrying the token in its fragment. */
  actionLink: string;
  email: string;
  origin: string;
}

export interface PasswordRecoveryEmailContent {
  subject: string;
  text: string;
  html: string;
}

const RECOVERY_REASON = "You are receiving this because someone requested a password reset for your Pulse account.";

/**
 * The reset link mirrors the invitation link: the one-time token travels in the
 * URL fragment, which browsers never send to a server and mail scanners never
 * consume. Pulse verifies it only when the recipient submits a new password.
 */
export function passwordResetUrl(siteUrl: string, email: string, tokenHash: string): string {
  const url = new URL("/reset-password", siteUrl);
  url.hash = new URLSearchParams({
    email: email.trim().toLowerCase(),
    token_hash: tokenHash,
    type: "recovery",
  }).toString();
  return url.toString();
}

export function renderPasswordRecoveryEmail({
  actionLink,
  email,
  origin,
}: PasswordRecoveryEmailInput): PasswordRecoveryEmailContent {
  const normalizedOrigin = origin.replace(/\/$/, "");
  const safeEmail = escapeHtml(email);
  const body =
    `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#3f3f46;">` +
    `Someone asked to reset the password for <strong>${safeEmail}</strong>. ` +
    `Choose a new one with the button below.</p>` +
    `<p style="margin:0;font-size:13px;line-height:1.6;color:#71717a;">` +
    `The link expires and works once. If you did not request a reset, you can ignore this email — ` +
    `your password stays as it is.</p>`;

  return {
    subject: "Reset your Pulse password",
    text: [
      "Reset your Pulse password",
      `Someone asked to reset the password for ${email}. Open this link to choose a new one:`,
      actionLink,
      "The link expires and works once. If you did not request a reset, you can ignore this email — your password stays as it is.",
    ].join("\n\n"),
    html: renderEmailShell({
      accent: "#2563eb",
      subtitle: "Account security",
      eyebrow: "Password reset",
      heading: "Reset your Pulse password",
      bodyParagraphsHtml: body,
      ctaLabel: "Set a new password",
      ctaHref: actionLink,
      reason: RECOVERY_REASON,
      origin: normalizedOrigin,
    }),
  };
}
