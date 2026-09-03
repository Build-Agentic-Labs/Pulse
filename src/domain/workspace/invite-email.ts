import { escapeHtml, renderEmailShell } from "@/domain/notification-email-shell";
import type { SopEmailContent } from "@/domain/sop/notifications";

export function renderWorkspaceInviteEmail(input: {
  actionLink: string;
  accessSummary: readonly string[];
  email: string;
  organizationName: string;
  origin: string;
}): SopEmailContent {
  const origin = input.origin.replace(/\/$/, "");
  const email = escapeHtml(input.email);
  const organizationName = escapeHtml(input.organizationName);
  const accessRows = input.accessSummary
    .map((item) => `<li style="margin:0 0 6px;">${escapeHtml(item)}</li>`)
    .join("");
  const body =
    `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#3f3f46;">` +
    `You have been invited to <strong>${organizationName}</strong> in Pulse.</p>` +
    `<ul style="margin:0 0 14px;padding-left:20px;font-size:14px;line-height:1.55;color:#3f3f46;">${accessRows}</ul>` +
    `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#3f3f46;">` +
    `Your account email is <strong>${email}</strong>. Open the secure link below to create your password and sign in.</p>` +
    `<p style="margin:0 0 6px;font-size:13px;line-height:1.6;color:#71717a;">` +
    `This one-time link is intended only for ${email}.</p>` +
    `<p style="margin:0;font-size:13px;line-height:1.6;color:#71717a;">` +
    `For your security, the setup link expires in 24 hours. An organization administrator can resend it.</p>`;

  return {
    subject: "Create your Pulse password",
    text: [
      "Create your Pulse password",
      `You have been invited to ${input.organizationName} in Pulse.`,
      ...input.accessSummary,
      `Your account email is ${input.email}.`,
      `Create your password and sign in: ${input.actionLink}`,
      "This one-time link is intended only for the invited email address.",
      "For your security, the setup link expires in 24 hours. An organization administrator can resend it.",
    ].join("\n\n"),
    html: renderEmailShell({
      accent: "#111111",
      subtitle: input.organizationName,
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

/**
 * Sent when an administrator (re)invites someone who already finished setting up
 * their Pulse account. No credential goes out — they own a password — but they
 * still get a nudge with the access they were granted and a link to sign in.
 */
export function renderWorkspaceAccessGrantedEmail(input: {
  accessSummary: readonly string[];
  email: string;
  organizationName: string;
  origin: string;
  signInLink: string;
}): SopEmailContent {
  const origin = input.origin.replace(/\/$/, "");
  const email = escapeHtml(input.email);
  const organizationName = escapeHtml(input.organizationName);
  const accessRows = input.accessSummary
    .map((item) => `<li style="margin:0 0 6px;">${escapeHtml(item)}</li>`)
    .join("");
  const body =
    `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#3f3f46;">` +
    `An administrator granted <strong>${email}</strong> access to <strong>${organizationName}</strong> in Pulse.</p>` +
    `<ul style="margin:0 0 14px;padding-left:20px;font-size:14px;line-height:1.55;color:#3f3f46;">${accessRows}</ul>` +
    `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#3f3f46;">` +
    `You already have a Pulse password, so sign in with it and this access applies right away.</p>` +
    `<p style="margin:0;font-size:13px;line-height:1.6;color:#71717a;">` +
    `Forgot your password? Choose <strong>Forgot password</strong> on the sign-in page to set a new one.</p>`;

  return {
    subject: `You now have access to ${input.organizationName} in Pulse`,
    text: [
      `You now have access to ${input.organizationName} in Pulse`,
      `An administrator granted ${input.email} access to ${input.organizationName} in Pulse.`,
      ...input.accessSummary,
      "You already have a Pulse password, so sign in with it and this access applies right away.",
      `Sign in: ${input.signInLink}`,
      "Forgot your password? Choose Forgot password on the sign-in page to set a new one.",
    ].join("\n\n"),
    html: renderEmailShell({
      accent: "#111111",
      subtitle: input.organizationName,
      eyebrow: "Access update",
      heading: "Your Pulse access was updated",
      bodyParagraphsHtml: body,
      ctaLabel: "Sign in to Pulse",
      ctaHref: input.signInLink,
      reason: "You are receiving this because a Pulse administrator granted this email address access.",
      origin,
    }),
  };
}
