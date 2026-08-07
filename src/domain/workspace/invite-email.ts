import { escapeHtml, renderEmailShell } from "@/domain/notification-email-shell";
import type { SopEmailContent } from "@/domain/sop/notifications";

export function renderQualityModuleInviteEmail(input: {
  actionLink: string;
  accessLabel: string;
  email: string;
  origin: string;
}): SopEmailContent {
  const origin = input.origin.replace(/\/$/, "");
  const email = escapeHtml(input.email);
  const access = escapeHtml(input.accessLabel);
  const body =
    `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#3f3f46;">` +
    `You have been invited to the Pulse Quality Module with <strong>${access}</strong> access.</p>` +
    `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#3f3f46;">` +
    `Your account email is <strong>${email}</strong>. Open the secure link below to create your password and sign in.</p>` +
    `<p style="margin:0;font-size:13px;line-height:1.6;color:#71717a;">` +
    `This one-time link is intended only for ${email}.</p>`;

  return {
    subject: "Create your Pulse password",
    text: [
      "Create your Pulse password",
      `You have been invited to the Pulse Quality Module with ${input.accessLabel} access.`,
      `Your account email is ${input.email}.`,
      `Create your password and sign in: ${input.actionLink}`,
      "This one-time link is intended only for the invited email address.",
    ].join("\n\n"),
    html: renderEmailShell({
      accent: "#111111",
      subtitle: "Quality Module",
      eyebrow: "Account invitation",
      heading: "Create your Pulse password",
      bodyParagraphsHtml: body,
      ctaLabel: "Create password and sign in",
      ctaHref: input.actionLink,
      reason: "You are receiving this because a Pulse administrator invited this email address.",
      origin,
    }),
  };
}
