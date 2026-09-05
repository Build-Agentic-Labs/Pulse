/**
 * The one branded email layout: Pulse wordmark header, white card with a
 * kind-colored accent stripe, squared 4px geometry, cta button, and a
 * why-you-received-this footer. Extracted from the SOP templates so every
 * notification source renders the identical card. Inline styles + table
 * markup only (email-client compatibility). Pure module — no imports.
 */

/** A rendered email: what every sender in the app accepts. */
export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export interface EmailShellInput {
  accent: string;
  /** Small muted tag beside the wordmark. Already plain text; escaped here. */
  subtitle: string;
  /** Already plain text; escaped here. */
  eyebrow: string;
  /** Already plain text; escaped here. */
  heading: string;
  /** Pre-rendered, pre-escaped paragraph/notes html for the card body. */
  bodyParagraphsHtml: string;
  /** Already plain text; escaped here. */
  ctaLabel: string;
  ctaHref: string;
  /** Already plain text; escaped here. */
  reason: string;
  origin: string;
}

export function renderEmailShell(input: EmailShellInput): string {
  const host = input.origin.replace(/^https?:\/\//, "");
  return (
    `<div style="margin:0;padding:32px 16px;background:#f4f4f5;font-family:-apple-system,'Segoe UI',system-ui,sans-serif;">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" width="100%" style="max-width:560px;margin:0 auto;">` +
    `<tr><td style="padding:0 2px 14px;">` +
    `<span style="font-size:17px;font-weight:700;letter-spacing:0.02em;color:#111111;">Pulse</span>` +
    `<span style="font-size:12px;color:#71717a;">&nbsp;&middot;&nbsp;${escapeHtml(input.subtitle)}</span>` +
    `</td></tr>` +
    `<tr><td style="background:#ffffff;border:1px solid #e4e4e7;border-top:3px solid ${input.accent};border-radius:4px;padding:28px 32px;">` +
    `<p style="margin:0 0 6px;font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${input.accent};">${escapeHtml(input.eyebrow)}</p>` +
    `<p style="margin:0 0 16px;font-size:17px;font-weight:600;line-height:1.4;color:#111111;">${escapeHtml(input.heading)}</p>` +
    input.bodyParagraphsHtml +
    `<p style="margin:20px 0 0;"><a href="${input.ctaHref}" ` +
    `style="display:inline-block;padding:10px 18px;background:#111111;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:4px;">` +
    `${escapeHtml(input.ctaLabel)}</a></p>` +
    `</td></tr>` +
    `<tr><td style="padding:16px 2px 0;font-size:12px;line-height:1.6;color:#71717a;">` +
    `${escapeHtml(input.reason)}<br>` +
    `<a href="${input.origin}" style="color:#71717a;">${escapeHtml(host)}</a>&nbsp;&middot;&nbsp;Automated notification from Pulse &mdash; replies are not monitored.` +
    `</td></tr>` +
    `</table></div>`
  );
}
