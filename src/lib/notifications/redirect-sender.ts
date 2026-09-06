/**
 * Test-window safety: route every outbound email to ONE address, keeping the
 * original recipient visible in the subject and a banner. Used when
 * NOTIFICATION_EMAIL_REDIRECT_TO is set (see sender-from-env.ts) so a drain can
 * be exercised against real data without a single coworker receiving mail.
 * Ledger semantics are unchanged — rows are claimed and stamped sent exactly as
 * if the real recipient had been mailed.
 */

import { escapeHtml } from "@/domain/notification-email-shell";
import type { EmailSender } from "@/lib/sop/notifications-drain";

export function withRecipientRedirect(send: EmailSender, redirectTo: string): EmailSender {
  return (to, content, options) => {
    const notice = `TEST REDIRECT — this email was addressed to ${to}.`;
    return send(
      redirectTo,
      {
        subject: `[TEST → ${to}] ${content.subject}`,
        text: `${notice}\n\n${content.text}`,
        html:
          `<div style="margin:0 0 12px;padding:10px 14px;background:#fef3c7;border:1px solid #f59e0b;border-radius:4px;` +
          `font-family:-apple-system,'Segoe UI',system-ui,sans-serif;font-size:13px;line-height:1.5;color:#92400e;">` +
          `<strong>Test redirect.</strong> This email was addressed to ${escapeHtml(to)}.</div>` +
          content.html,
      },
      options,
    );
  };
}
