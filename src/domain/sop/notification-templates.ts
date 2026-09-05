/**
 * SOP notification email templates — one literal template per kind, deliberately
 * no engine and no registry. The html is a branded, email-client-safe card
 * (inline styles, table layout, squared 4px geometry) rendered through the shared
 * shell so every notification source looks identical. Pure: no I/O, no clocks.
 *
 * Templates must be deterministic for a given input: the drain snapshots the
 * rendered content on the ledger row so retries are byte-identical, which is what
 * lets a Resend idempotency key dedupe a resend safely.
 */

import { escapeHtml, renderEmailShell, type EmailContent } from "@/domain/notification-email-shell";
import type { SopNotificationKind } from "./notifications";

export type SopEmailContent = EmailContent;

export interface SopEmailInput {
  kind: SopNotificationKind;
  sopNumber: string | null;
  title: string | null;
  version: string | null;
  actorName: string;
  departmentName: string | null;
  origin: string;
  sopId: string;
  reminderIndex: number;
  waitingDays: number | null;
}

const SEAT_REASON = "You are receiving this because you hold a review seat on this SOP.";
const AUTHOR_REASON = "You are receiving this because you are the author of this SOP.";
const QUALITY_REASON = "You are receiving this because you are a Quality approver in this workspace.";

interface TemplateCopy {
  subject: string;
  eyebrow: string;
  accent: string;
  reason: string;
  happened: string;
  needed: string;
}

function copyFor(input: SopEmailInput, label: string): TemplateCopy {
  const revision = input.version ? ` (Rev ${input.version})` : "";
  switch (input.kind) {
    case "review_requested":
      return {
        subject: `Review requested: ${label}${revision}`,
        eyebrow: "Review requested",
        accent: "#2563eb",
        reason: SEAT_REASON,
        happened: `${input.actorName} sent ${label} for review.`,
        needed: input.departmentName
          ? `You are the reviewer for the ${input.departmentName} seat — please review it and return your result.`
          : `Please review it and return your result.`,
      };
    case "final_approval_requested":
      return {
        subject: `Signature needed: ${label}`,
        eyebrow: "Signature needed",
        accent: "#7c3aed",
        reason: SEAT_REASON,
        happened: `Every reviewer accepted ${label}.`,
        needed: input.departmentName
          ? `Your formal ${input.departmentName} department signature is needed to approve it.`
          : `Your formal department signature is needed to approve it.`,
      };
    case "quality_release_requested":
      return {
        subject: `Ready for release: ${label}`,
        eyebrow: "Ready for release",
        accent: "#059669",
        reason: QUALITY_REASON,
        happened: `${label} has every department signature.`,
        needed: `As a Quality approver, you can review it and make it effective.`,
      };
    case "sent_back":
      return {
        subject: `Sent back with remarks: ${label}`,
        eyebrow: "Sent back",
        accent: "#dc2626",
        reason: AUTHOR_REASON,
        happened: `${input.actorName} sent ${label} back.`,
        needed: `Please address the remarks and resubmit it for review.`,
      };
    case "review_complete":
      return {
        subject: `Ready for final approval: ${label}`,
        eyebrow: "Ready for final approval",
        accent: "#0f766e",
        reason: AUTHOR_REASON,
        happened: `Every reviewer has responded to ${label}, and no remarks remain open.`,
        needed: `Open it and send it for final approval to collect the formal department signatures.`,
      };
  }
}

export function renderSopNotificationEmail(input: SopEmailInput): SopEmailContent {
  const label = `${input.sopNumber ?? "SOP"} "${input.title ?? "Untitled SOP"}"`;
  const link = `${input.origin}/sops/${input.sopId}`;
  const copy = copyFor(input, label);

  const isReminder = input.reminderIndex > 0;
  const subject = isReminder ? `Reminder: ${copy.subject}` : copy.subject;
  const eyebrowText = isReminder ? `Reminder — ${copy.eyebrow}` : copy.eyebrow;
  const waiting =
    isReminder && input.waitingDays !== null ? `This has been waiting ${input.waitingDays} days.` : null;

  const heading = `${input.sopNumber ?? "SOP"} — ${input.title ?? "Untitled SOP"}${
    input.version ? ` (Rev ${input.version})` : ""
  }`;

  const textLines = [copy.happened, copy.needed, waiting, `Open it: ${link}`, "—", copy.reason, input.origin].filter(
    Boolean,
  );

  const bodyParagraph = (line: string): string =>
    `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#3f3f46;">${escapeHtml(line)}</p>`;
  const waitingNote = waiting
    ? `<p style="margin:0 0 12px;padding:10px 14px;background:#fef3c7;border-radius:4px;font-size:13px;line-height:1.5;color:#92400e;">${escapeHtml(waiting)}</p>`
    : "";

  const html = renderEmailShell({
    accent: copy.accent,
    subtitle: "SOP document control",
    eyebrow: eyebrowText,
    heading,
    bodyParagraphsHtml: bodyParagraph(copy.happened) + bodyParagraph(copy.needed) + waitingNote,
    ctaLabel: "Open in Pulse",
    ctaHref: link,
    reason: copy.reason,
    origin: input.origin,
  });

  return { subject, text: textLines.join("\n\n"), html };
}
