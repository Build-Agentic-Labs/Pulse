/**
 * SOP notification decisions — who gets emailed about what. Pure: no React, no
 * Supabase, no clocks (callers pass `now` where time matters). The drain route
 * assembles plain-value contexts from the database; these functions only decide.
 * Recipients resolve against CURRENT state (drain time), and each rule carries a
 * skip-unless-now guard so an email whose moment has passed is dropped, not sent.
 * Spec: docs/superpowers/specs/2026-07-21-sop-notifications-design.md
 */

export const REMINDER_AFTER_DAYS = 3;
export const MAX_REMINDERS = 2;

/** Event types the drain scans for. Everything else in sop_event_log is ignored. */
export const SOP_NOTIFIABLE_EVENT_TYPES = [
  "review_sent",
  "final_approval_requested",
  "status_changed",
  "review_returned",
  "review_recalled",
] as const;

export type SopNotificationKind =
  | "review_requested"
  | "final_approval_requested"
  | "quality_release_requested"
  | "sent_back";

/** Local copy of the RASIC union — domain must not import from src/lib. */
export type SopSeatRasic = "responsible" | "accountable" | "support" | "consulted" | "informed";

export interface NotifiableEvent {
  id: number;
  sopId: string;
  eventType: string;
  actorId: string | null;
  actorName: string;
  details: unknown;
  createdAt: string;
}

export interface SopSnapshot {
  id: string;
  title: string | null;
  sopNumber: string | null;
  version: string | null;
  status: string;
  deletedAt: string | null;
  authorId: string | null;
  submittedBy: string | null;
  contentHash: string | null;
  finalApprovalRequestedAt: string | null;
  finalApprovalContentHash: string | null;
  /** The DB's mirror of an open objection; a recall clears it (see review-queue-data). */
  rejectedReason: string | null;
  reviewCycle: number;
}

export interface SeatSnapshot {
  departmentId: string;
  departmentName: string;
  rasic: SopSeatRasic;
  signerId: string | null;
}

export interface QualityApproverSnapshot {
  userId: string;
  /** Holds any review seat on this SOP — barred from release (lifecycle.ts:132-138). */
  holdsSeat: boolean;
  /** Signed an objection_overruled this cycle — barred from release. */
  overruledThisCycle: boolean;
}

export interface SopNotificationContext {
  sop: SopSnapshot;
  seats: SeatSnapshot[];
  qualityApprovers: QualityApproverSnapshot[];
}

export interface PendingNotification {
  recipientId: string;
  kind: SopNotificationKind;
  sopId: string;
  /** Null for reminders; reminders key on (sopId, recipientId, kind, reminderIndex). */
  eventId: number | null;
  /** 0 for first-touch mail, 1..MAX_REMINDERS for nudges. */
  reminderIndex: number;
}

/** The final-approval phase is live only while the content still matches the request. */
export function finalApprovalPhaseActive(sop: SopSnapshot): boolean {
  return Boolean(sop.finalApprovalRequestedAt) && sop.finalApprovalContentHash === sop.contentHash;
}

function isBlocking(rasic: SopSeatRasic): boolean {
  return rasic === "responsible" || rasic === "accountable";
}

function parseEventDetails(details: unknown): { toStatus?: string; noChanges?: boolean } {
  if (typeof details !== "object" || details === null) return {};
  const record = details as Record<string, unknown>;
  return {
    toStatus: typeof record.to_status === "string" ? record.to_status : undefined,
    noChanges: typeof record.no_changes === "boolean" ? record.no_changes : undefined,
  };
}

function dedupeByRecipient(list: PendingNotification[]): PendingNotification[] {
  const seen = new Set<string>();
  return list.filter((notification) => {
    if (seen.has(notification.recipientId)) return false;
    seen.add(notification.recipientId);
    return true;
  });
}

function seatRecipients(
  event: NotifiableEvent,
  ctx: SopNotificationContext,
  kind: SopNotificationKind,
  includeSeat: (rasic: SopSeatRasic) => boolean,
): PendingNotification[] {
  return dedupeByRecipient(
    ctx.seats
      .filter((seat) => includeSeat(seat.rasic) && seat.signerId && seat.signerId !== event.actorId)
      .map((seat) => ({
        recipientId: seat.signerId as string,
        kind,
        sopId: ctx.sop.id,
        eventId: event.id,
        reminderIndex: 0,
      })),
  );
}

/**
 * First-touch recipients for one event, resolved against the SOP's CURRENT state.
 * Returns [] whenever the email's moment has passed — a stale "please review"
 * trains people to ignore notifications, which recreates the stall problem.
 */
export function resolveEventRecipients(
  event: NotifiableEvent,
  ctx: SopNotificationContext,
): PendingNotification[] {
  const { sop } = ctx;
  if (sop.deletedAt) return [];

  switch (event.eventType) {
    case "review_sent": {
      // The draft-review phase blocks on EVERY non-informed seat, not just R/A:
      // request_sop_final_approval refuses until each has returned a review.
      if (sop.status !== "in_review" || finalApprovalPhaseActive(sop)) return [];
      return seatRecipients(event, ctx, "review_requested", (rasic) => rasic !== "informed");
    }

    case "final_approval_requested": {
      if (sop.status !== "in_review" || !finalApprovalPhaseActive(sop)) return [];
      return seatRecipients(event, ctx, "final_approval_requested", isBlocking);
    }

    case "status_changed": {
      if (parseEventDetails(event.details).toStatus !== "approved") return [];
      if (sop.status !== "approved") return [];
      return ctx.qualityApprovers
        .filter(
          (approver) =>
            !approver.holdsSeat &&
            !approver.overruledThisCycle &&
            approver.userId !== sop.authorId &&
            approver.userId !== sop.submittedBy &&
            approver.userId !== event.actorId,
        )
        .map((approver) => ({
          recipientId: approver.userId,
          kind: "quality_release_requested" as const,
          sopId: sop.id,
          eventId: event.id,
          reminderIndex: 0,
        }));
    }

    case "review_returned": {
      // no_changes=true is an acceptance, not a send-back. Malformed details -> no mail.
      if (parseEventDetails(event.details).noChanges !== false) return [];
      if (sop.status === "obsolete") return [];
      if (!sop.authorId || sop.authorId === event.actorId) return [];
      return [{ recipientId: sop.authorId, kind: "sent_back", sopId: sop.id, eventId: event.id, reminderIndex: 0 }];
    }

    case "review_recalled": {
      // in_review -> draft covers BOTH recall and rejection under one event name.
      // rejected_reason is the DB's mirror of a standing objection; a plain recall
      // clears it — so its presence is what separates "rejected" from "recalled".
      if (!sop.rejectedReason) return [];
      if (sop.status !== "draft") return [];
      if (!sop.authorId || sop.authorId === event.actorId) return [];
      return [{ recipientId: sop.authorId, kind: "sent_back", sopId: sop.id, eventId: event.id, reminderIndex: 0 }];
    }

    default:
      return [];
  }
}

export interface ReminderLedgerRow {
  recipientId: string;
  kind: SopNotificationKind;
  reminderIndex: number;
  sentAt: string;
}

export interface SopReminderState {
  sop: SopSnapshot;
  seats: SeatSnapshot[];
  qualityApprovers: QualityApproverSnapshot[];
  /** Reviewer ids with a sop_review_submissions row for the current cycle. */
  currentReviewReturns: string[];
  /** dept_approval signatures for the current cycle + final-approval hash, per seat. */
  currentDeptApprovals: { signerId: string; departmentId: string }[];
  approvedAt: string | null;
  /** Latest review_sent event time for the current cycle (any age, no window). */
  reviewSentAt: string | null;
  /** Prior SENT reminder rows for this SOP (event_id null, sent_at not null). */
  reminders: ReminderLedgerRow[];
}

interface ReminderCandidate {
  recipientId: string;
  kind: SopNotificationKind;
  anchorAt: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Nudges for signer stalls, recomputed from CURRENT state every drain — which is
 * what makes reminders self-cancelling on recall/rejection/retirement, and what
 * hands a reassigned seat's new signer their first nudge with no special case.
 * Nudge 1 anchors on the stall's start; nudge N anchors on nudge N-1's sent_at.
 */
export function resolveReminders(now: Date, states: SopReminderState[]): PendingNotification[] {
  return states.flatMap((state) => remindersForSop(now, state));
}

function remindersForSop(now: Date, state: SopReminderState): PendingNotification[] {
  const { sop } = state;
  if (sop.deletedAt) return [];

  const candidates: ReminderCandidate[] = [];

  if (sop.status === "in_review" && !finalApprovalPhaseActive(sop) && state.reviewSentAt) {
    const returned = new Set(state.currentReviewReturns);
    for (const seat of state.seats) {
      if (seat.rasic === "informed" || !seat.signerId || returned.has(seat.signerId)) continue;
      candidates.push({ recipientId: seat.signerId, kind: "review_requested", anchorAt: state.reviewSentAt });
    }
  }

  if (sop.status === "in_review" && finalApprovalPhaseActive(sop) && sop.finalApprovalRequestedAt) {
    for (const seat of state.seats) {
      if (!isBlocking(seat.rasic) || !seat.signerId) continue;
      const signed = state.currentDeptApprovals.some(
        (approval) => approval.signerId === seat.signerId && approval.departmentId === seat.departmentId,
      );
      if (signed) continue;
      candidates.push({
        recipientId: seat.signerId,
        kind: "final_approval_requested",
        anchorAt: sop.finalApprovalRequestedAt,
      });
    }
  }

  if (sop.status === "approved" && state.approvedAt) {
    for (const approver of state.qualityApprovers) {
      if (approver.holdsSeat || approver.overruledThisCycle) continue;
      if (approver.userId === sop.authorId || approver.userId === sop.submittedBy) continue;
      candidates.push({
        recipientId: approver.userId,
        kind: "quality_release_requested",
        anchorAt: state.approvedAt,
      });
    }
  }

  const out: PendingNotification[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const key = `${candidate.recipientId}:${candidate.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const prior = state.reminders
      .filter((row) => row.recipientId === candidate.recipientId && row.kind === candidate.kind)
      .sort((a, b) => a.reminderIndex - b.reminderIndex);
    const last = prior[prior.length - 1];
    const nextIndex = last ? last.reminderIndex + 1 : 1;
    if (nextIndex > MAX_REMINDERS) continue;

    const anchor = last ? last.sentAt : candidate.anchorAt;
    const waitedDays = (now.getTime() - new Date(anchor).getTime()) / DAY_MS;
    if (waitedDays < REMINDER_AFTER_DAYS) continue;

    out.push({
      recipientId: candidate.recipientId,
      kind: candidate.kind,
      sopId: sop.id,
      eventId: null,
      reminderIndex: nextIndex,
    });
  }
  return out;
}

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

export interface SopEmailContent {
  subject: string;
  text: string;
  html: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const SEAT_REASON = "You are receiving this because you hold a review seat on this SOP.";

/**
 * Four literal templates, one per kind — deliberately no engine, no registry
 * (spec's YAGNI cuts). The html is a branded, email-client-safe card: inline
 * styles only, table layout (Outlook), squared 4px geometry to match the app's
 * design language, and a per-kind accent + "why you got this" footer.
 */
export function renderSopNotificationEmail(input: SopEmailInput): SopEmailContent {
  const label = `${input.sopNumber ?? "SOP"} "${input.title ?? "Untitled SOP"}"`;
  const link = `${input.origin}/sops/${input.sopId}`;

  let subject: string;
  let eyebrow: string;
  let accent: string;
  let reason: string;
  let happened: string;
  let needed: string;
  switch (input.kind) {
    case "review_requested":
      subject = `Review requested: ${label}${input.version ? ` (Rev ${input.version})` : ""}`;
      eyebrow = "Review requested";
      accent = "#2563eb";
      reason = SEAT_REASON;
      happened = `${input.actorName} sent ${label} for review.`;
      needed = input.departmentName
        ? `You are the reviewer for the ${input.departmentName} seat — please review it and return your result.`
        : `Please review it and return your result.`;
      break;
    case "final_approval_requested":
      subject = `Signature needed: ${label}`;
      eyebrow = "Signature needed";
      accent = "#7c3aed";
      reason = SEAT_REASON;
      happened = `Every reviewer accepted ${label}.`;
      needed = input.departmentName
        ? `Your formal ${input.departmentName} department signature is needed to approve it.`
        : `Your formal department signature is needed to approve it.`;
      break;
    case "quality_release_requested":
      subject = `Ready for release: ${label}`;
      eyebrow = "Ready for release";
      accent = "#059669";
      reason = "You are receiving this because you are a Quality approver in this workspace.";
      happened = `${label} has every department signature.`;
      needed = `As a Quality approver, you can review it and make it effective.`;
      break;
    case "sent_back":
      subject = `Sent back with remarks: ${label}`;
      eyebrow = "Sent back";
      accent = "#dc2626";
      reason = "You are receiving this because you are the author of this SOP.";
      happened = `${input.actorName} sent ${label} back.`;
      needed = `Please address the remarks and resubmit it for review.`;
      break;
  }

  const isReminder = input.reminderIndex > 0;
  if (isReminder) subject = `Reminder: ${subject}`;
  const eyebrowText = isReminder ? `Reminder — ${eyebrow}` : eyebrow;
  const waiting =
    isReminder && input.waitingDays !== null ? `This has been waiting ${input.waitingDays} days.` : null;

  const heading = `${input.sopNumber ?? "SOP"} — ${input.title ?? "Untitled SOP"}${
    input.version ? ` (Rev ${input.version})` : ""
  }`;
  const host = input.origin.replace(/^https?:\/\//, "");

  const textLines = [happened, needed, waiting, `Open it: ${link}`, "—", reason, input.origin].filter(Boolean);

  const bodyParagraph = (line: string): string =>
    `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#3f3f46;">${escapeHtml(line)}</p>`;
  const waitingNote = waiting
    ? `<p style="margin:0 0 12px;padding:10px 14px;background:#fef3c7;border-radius:4px;font-size:13px;line-height:1.5;color:#92400e;">${escapeHtml(waiting)}</p>`
    : "";

  const html =
    `<div style="margin:0;padding:32px 16px;background:#f4f4f5;font-family:-apple-system,'Segoe UI',system-ui,sans-serif;">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" width="100%" style="max-width:560px;margin:0 auto;">` +
    `<tr><td style="padding:0 2px 14px;">` +
    `<span style="font-size:17px;font-weight:700;letter-spacing:0.02em;color:#111111;">Pulse</span>` +
    `<span style="font-size:12px;color:#71717a;">&nbsp;&middot;&nbsp;SOP document control</span>` +
    `</td></tr>` +
    `<tr><td style="background:#ffffff;border:1px solid #e4e4e7;border-top:3px solid ${accent};border-radius:4px;padding:28px 32px;">` +
    `<p style="margin:0 0 6px;font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${accent};">${escapeHtml(eyebrowText)}</p>` +
    `<p style="margin:0 0 16px;font-size:17px;font-weight:600;line-height:1.4;color:#111111;">${escapeHtml(heading)}</p>` +
    bodyParagraph(happened) +
    bodyParagraph(needed) +
    waitingNote +
    `<p style="margin:20px 0 0;"><a href="${link}" ` +
    `style="display:inline-block;padding:10px 18px;background:#111111;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:4px;">` +
    `Open in Pulse</a></p>` +
    `</td></tr>` +
    `<tr><td style="padding:16px 2px 0;font-size:12px;line-height:1.6;color:#71717a;">` +
    `${escapeHtml(reason)}<br>` +
    `<a href="${input.origin}" style="color:#71717a;">${escapeHtml(host)}</a>&nbsp;&middot;&nbsp;Automated notification from Pulse &mdash; replies are not monitored.` +
    `</td></tr>` +
    `</table></div>`;

  return { subject, text: textLines.join("\n\n"), html };
}
