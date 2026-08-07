import { escapeHtml, renderEmailShell } from "@/domain/notification-email-shell";

export interface PasswordRecoveryEmailInput {
  code: string;
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
 * Keep the credential out of the URL. Corporate link scanners can safely inspect
 * the Pulse link without consuming the one-time recovery code.
 */
export function renderPasswordRecoveryEmail({
  code,
  email,
  origin,
}: PasswordRecoveryEmailInput): PasswordRecoveryEmailContent {
  const normalizedOrigin = origin.replace(/\/$/, "");
  // Route directly to the recovery form without putting the one-time code in
  // the URL. A fragment is not sent to the web server and is consumed by Pulse.
  const recoveryHref = `${normalizedOrigin}/#auth=recovery&email=${encodeURIComponent(email)}`;
  const safeCode = escapeHtml(code);
  const body =
    `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#3f3f46;">` +
    `Enter this one-time code in Pulse to continue resetting your password.</p>` +
    `<div style="margin:18px 0 8px;padding:14px 18px;background:#f4f4f5;border:1px solid #e4e4e7;border-radius:4px;` +
    `font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:28px;font-weight:700;` +
    `letter-spacing:0.22em;text-align:center;color:#111111;cursor:text;user-select:all;-webkit-user-select:all;">${safeCode}</div>` +
    `<p style="margin:0 0 14px;font-size:12px;line-height:1.5;text-align:center;color:#71717a;">` +
    `Select the code above to copy it, then use Paste code in Pulse.</p>` +
    `<p style="margin:0;font-size:13px;line-height:1.6;color:#71717a;">` +
    `This code expires and can only be used once. If you did not request a reset, you can ignore this email.</p>`;

  return {
    subject: "Reset your Pulse password",
    text: [
      "Reset your Pulse password",
      `Your one-time recovery code is: ${code}`,
      "Enter this code in Pulse to continue. It expires and can only be used once.",
      `Open Pulse: ${recoveryHref}`,
      "If you did not request a password reset, you can ignore this email.",
    ].join("\n\n"),
    html: renderEmailShell({
      accent: "#2563eb",
      subtitle: "Account security",
      eyebrow: "Password recovery",
      heading: "Reset your Pulse password",
      bodyParagraphsHtml: body,
      ctaLabel: "Open Pulse",
      ctaHref: recoveryHref,
      reason: RECOVERY_REASON,
      origin: normalizedOrigin,
    }),
  };
}
