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
