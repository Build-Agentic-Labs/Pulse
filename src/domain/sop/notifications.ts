/**
 * SOP notification decisions — who gets emailed about what. Pure: no React, no
 * Supabase, no clocks (callers pass `now` where time matters). The drain route
 * assembles plain-value contexts from the database; these functions only decide.
 * Recipients resolve against CURRENT state (drain time), and each rule carries a
 * skip-unless-now guard so an email whose moment has passed is dropped, not sent.
 * Templates live in ./notification-templates.
 * Spec: docs/superpowers/specs/2026-07-21-sop-notifications-design.md
 * Phase 0 additions: docs/audits/2026-09-04-notification-systems-audit.md §4
 */

export type { SopEmailContent, SopEmailInput } from "./notification-templates";
export { renderSopNotificationEmail } from "./notification-templates";

export const REMINDER_AFTER_DAYS = 3;
export const MAX_REMINDERS = 2;
/** Days after the LAST nudge before an ignored stall is escalated to workspace managers. */
export const ESCALATE_AFTER_REMINDER_DAYS = 4;

/** Event types the drain scans for. Everything else in sop_event_log is ignored. */
export const SOP_NOTIFIABLE_EVENT_TYPES = [
  "review_sent",
  "final_approval_requested",
  "status_changed",
  "review_returned",
  "review_recalled",
  "signature_added",
  "seat_reassigned",
  "remark_added",
] as const;

export type SopNotificationKind =
  | "review_requested"
  | "final_approval_requested"
  | "quality_release_requested"
  | "sent_back"
  | "review_complete"
  | "stall_escalated"
  | "released"
  | "seat_assigned"
  | "objection_raised"
  | "objection_resolved"
  | "remark_added";

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

/** One reviewer's returned draft review for the CURRENT cycle. */
export interface ReviewReturnSnapshot {
  reviewerId: string;
  noChanges: boolean;
  returnedAt: string;
}

export interface SopNotificationContext {
  sop: SopSnapshot;
  seats: SeatSnapshot[];
  qualityApprovers: QualityApproverSnapshot[];
  /** Current-cycle draft-review returns (sop_review_submissions). */
  reviewReturns: ReviewReturnSnapshot[];
  /** Current-cycle remarks still unresolved — they block "send for final approval". */
  openAnnotationCount: number;
  /** signature id → signer id, so a disposition can reach the objector it resolves. */
  signatureSignerById?: Record<string, string>;
}

export interface PendingNotification {
  recipientId: string;
  kind: SopNotificationKind;
  sopId: string;
  /** Null for reminders; reminders key on (sopId, recipientId, kind, reminderIndex, reviewCycle). */
  eventId: number | null;
  /** 0 for first-touch mail, 1..MAX_REMINDERS for nudges. */
  reminderIndex: number;
  /** The SOP's review cycle at decision time — part of the reminder claim key. */
  reviewCycle: number;
}

/** The final-approval phase is live only while the content still matches the request. */
export function finalApprovalPhaseActive(sop: SopSnapshot): boolean {
  return Boolean(sop.finalApprovalRequestedAt) && sop.finalApprovalContentHash === sop.contentHash;
}

function isBlocking(rasic: SopSeatRasic): boolean {
  return rasic === "responsible" || rasic === "accountable";
}

function blockingSignerIds(seats: SeatSnapshot[]): string[] {
  return Array.from(
    new Set(seats.filter((seat) => isBlocking(seat.rasic) && seat.signerId).map((seat) => seat.signerId as string)),
  );
}

/** Every required approver with a seat has returned their draft review this cycle. */
function everyBlockingSignerReturned(seats: SeatSnapshot[], returns: ReviewReturnSnapshot[]): boolean {
  const signers = blockingSignerIds(seats);
  if (signers.length === 0) return false;
  const returned = new Set(returns.map((entry) => entry.reviewerId));
  return signers.every((signer) => returned.has(signer));
}

function anyChangesRequested(seats: SeatSnapshot[], returns: ReviewReturnSnapshot[]): boolean {
  const signers = new Set(blockingSignerIds(seats));
  return returns.some((entry) => signers.has(entry.reviewerId) && !entry.noChanges);
}

function latestReturnAt(returns: ReviewReturnSnapshot[]): string | null {
  return returns.reduce<string | null>(
    (latest, entry) => (latest === null || entry.returnedAt > latest ? entry.returnedAt : latest),
    null,
  );
}

interface EventDetails {
  toStatus?: string;
  noChanges?: boolean;
  meaning?: string;
  resolvesSignatureId?: string;
  departmentId?: string;
  toSignerId?: string;
}

function parseEventDetails(details: unknown): EventDetails {
  if (typeof details !== "object" || details === null) return {};
  const record = details as Record<string, unknown>;
  const str = (key: string): string | undefined => (typeof record[key] === "string" ? (record[key] as string) : undefined);
  return {
    toStatus: str("to_status"),
    noChanges: typeof record.no_changes === "boolean" ? record.no_changes : undefined,
    meaning: str("meaning"),
    resolvesSignatureId: str("resolves_signature_id"),
    departmentId: str("department_id"),
    toSignerId: str("to_signer_id"),
  };
}

const OBJECTION_DISPOSITIONS = new Set(["objection_withdrawn", "objection_sustained", "objection_overruled"]);

function dedupeByRecipient(list: PendingNotification[]): PendingNotification[] {
  const seen = new Set<string>();
  return list.filter((notification) => {
    if (seen.has(notification.recipientId)) return false;
    seen.add(notification.recipientId);
    return true;
  });
}

function firstTouch(
  ctx: SopNotificationContext,
  event: NotifiableEvent,
  recipientId: string,
  kind: SopNotificationKind,
): PendingNotification {
  return { recipientId, kind, sopId: ctx.sop.id, eventId: event.id, reminderIndex: 0, reviewCycle: ctx.sop.reviewCycle };
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
      .map((seat) => firstTouch(ctx, event, seat.signerId as string, kind)),
  );
}

function authorRecipient(
  event: NotifiableEvent,
  ctx: SopNotificationContext,
  kind: SopNotificationKind,
): PendingNotification[] {
  const { sop } = ctx;
  if (!sop.authorId || sop.authorId === event.actorId) return [];
  return [firstTouch(ctx, event, sop.authorId, kind)];
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
      // Only required departmental approvers participate in draft review.
      // Procedure Consult / Support / Inform roles are not approval recipients.
      if (sop.status !== "in_review" || finalApprovalPhaseActive(sop)) return [];
      return seatRecipients(event, ctx, "review_requested", isBlocking);
    }

    case "final_approval_requested": {
      if (sop.status !== "in_review" || !finalApprovalPhaseActive(sop)) return [];
      return seatRecipients(event, ctx, "final_approval_requested", isBlocking);
    }

    case "status_changed": {
      const { toStatus } = parseEventDetails(event.details);
      if (toStatus === "effective") {
        // Release: the author and every seat — Informed seats exist for exactly this.
        if (sop.status !== "effective") return [];
        const seatHolders = ctx.seats.map((seat) => seat.signerId).filter((id): id is string => Boolean(id));
        return dedupeByRecipient(
          [...(sop.authorId ? [sop.authorId] : []), ...seatHolders]
            .filter((userId) => userId !== event.actorId)
            .map((userId) => firstTouch(ctx, event, userId, "released")),
        );
      }
      if (toStatus !== "approved") return [];
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
        .map((approver) => firstTouch(ctx, event, approver.userId, "quality_release_requested"));
    }

    case "seat_reassigned": {
      // A first touch for the new signer — only while there is something to do.
      const { departmentId, toSignerId } = parseEventDetails(event.details);
      if (!toSignerId || sop.status !== "in_review" || toSignerId === event.actorId) return [];
      const stillTheirs = ctx.seats.some((seat) => seat.departmentId === departmentId && seat.signerId === toSignerId);
      if (!stillTheirs) return [];
      const alreadyReturned =
        !finalApprovalPhaseActive(sop) && ctx.reviewReturns.some((entry) => entry.reviewerId === toSignerId);
      if (alreadyReturned) return [];
      return [firstTouch(ctx, event, toSignerId, "seat_assigned")];
    }

    case "signature_added": {
      const { meaning, resolvesSignatureId } = parseEventDetails(event.details);
      if (meaning === "rejection") {
        // A standing objection. If it recalled the draft, sent_back already covers it.
        if (sop.status !== "in_review") return [];
        const disposers = ctx.qualityApprovers
          .filter((approver) => !approver.holdsSeat && !approver.overruledThisCycle)
          .map((approver) => approver.userId);
        return dedupeByRecipient(
          [...(sop.authorId ? [sop.authorId] : []), ...disposers]
            .filter((userId) => userId !== event.actorId)
            .map((userId) => firstTouch(ctx, event, userId, "objection_raised")),
        );
      }
      if (meaning && OBJECTION_DISPOSITIONS.has(meaning)) {
        if (sop.status === "obsolete") return [];
        const objector = resolvesSignatureId ? (ctx.signatureSignerById?.[resolvesSignatureId] ?? null) : null;
        return dedupeByRecipient(
          [...(sop.authorId ? [sop.authorId] : []), ...(objector ? [objector] : [])]
            .filter((userId) => userId !== event.actorId)
            .map((userId) => firstTouch(ctx, event, userId, "objection_resolved")),
        );
      }
      return [];
    }

    case "remark_added": {
      if (sop.status !== "in_review") return [];
      return authorRecipient(event, ctx, "remark_added");
    }

    case "review_returned": {
      const { noChanges } = parseEventDetails(event.details);
      // Malformed details -> no mail.
      if (noChanges === undefined) return [];
      if (noChanges === false) {
        if (sop.status === "obsolete") return [];
        return authorRecipient(event, ctx, "sent_back");
      }
      // An acceptance: the author's next move exists only once EVERY required
      // approver has accepted and nothing remains open. Until then, silence —
      // and a change request already reached the author as sent_back.
      if (sop.status !== "in_review" || finalApprovalPhaseActive(sop)) return [];
      if (!everyBlockingSignerReturned(ctx.seats, ctx.reviewReturns)) return [];
      if (anyChangesRequested(ctx.seats, ctx.reviewReturns)) return [];
      if (ctx.openAnnotationCount > 0) return [];
      return authorRecipient(event, ctx, "review_complete");
    }

    case "review_recalled": {
      // in_review -> draft covers BOTH recall and rejection under one event name.
      // rejected_reason is the DB's mirror of a standing objection; a plain recall
      // clears it — so its presence is what separates "rejected" from "recalled".
      if (!sop.rejectedReason) return [];
      if (sop.status !== "draft") return [];
      return authorRecipient(event, ctx, "sent_back");
    }

    default:
      return [];
  }
}

export interface ReminderLedgerRow {
  recipientId: string;
  kind: SopNotificationKind;
  reminderIndex: number;
  reviewCycle: number;
  sentAt: string;
}

export interface SopReminderState {
  sop: SopSnapshot;
  seats: SeatSnapshot[];
  qualityApprovers: QualityApproverSnapshot[];
  /** Current-cycle draft-review returns (sop_review_submissions). */
  reviewReturns: ReviewReturnSnapshot[];
  /** Current-cycle remarks still unresolved. */
  openAnnotationCount: number;
  /** Latest review_recalled event time for the current cycle — the send-back anchor for a rejected draft. */
  recalledAt: string | null;
  /** dept_approval signatures for the current cycle + final-approval hash, per seat. */
  currentDeptApprovals: { signerId: string; departmentId: string }[];
  approvedAt: string | null;
  /** Latest review_sent event time for the current cycle (any age, no window). */
  reviewSentAt: string | null;
  /** Prior SENT reminder rows for this SOP, any cycle (event_id null, sent_at not null). */
  reminders: ReminderLedgerRow[];
  /** Workspace owners/admins — where an ignored stall escalates. */
  workspaceManagers: string[];
}

interface ReminderCandidate {
  recipientId: string;
  kind: SopNotificationKind;
  anchorAt: string;
  /** The seat the stall belongs to; null for author and Quality stalls. */
  departmentId: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Nudges for stalls, recomputed from CURRENT state every drain — which is what
 * makes reminders self-cancelling on recall/rejection/retirement, and what hands
 * a reassigned seat's new signer their first nudge with no special case.
 * Signer stalls (review, signature, release) AND author stalls (every review is
 * back, or a send-back awaits rework) are covered. Nudge 1 anchors on the stall's
 * start; nudge N anchors on nudge N-1's sent_at. Claims key on the review cycle,
 * so a later cycle earns its own nudges.
 */
export function resolveReminders(now: Date, states: SopReminderState[]): PendingNotification[] {
  return states.flatMap((state) => remindersForSop(now, state));
}

function signerCandidates(state: SopReminderState): ReminderCandidate[] {
  const { sop } = state;
  const candidates: ReminderCandidate[] = [];

  if (sop.status === "in_review" && !finalApprovalPhaseActive(sop) && state.reviewSentAt) {
    const returned = new Set(state.reviewReturns.map((entry) => entry.reviewerId));
    for (const seat of state.seats) {
      if (!isBlocking(seat.rasic) || !seat.signerId || returned.has(seat.signerId)) continue;
      candidates.push({
        recipientId: seat.signerId,
        kind: "review_requested",
        anchorAt: state.reviewSentAt,
        departmentId: seat.departmentId,
      });
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
        departmentId: seat.departmentId,
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
        departmentId: null,
      });
    }
  }

  return candidates;
}

/** Blocking seats whose signer has not returned a draft review this cycle. */
function unreturnedSeats(state: SopReminderState): SeatSnapshot[] {
  const returned = new Set(state.reviewReturns.map((entry) => entry.reviewerId));
  return state.seats.filter((seat) => isBlocking(seat.rasic) && seat.signerId && !returned.has(seat.signerId));
}

/** Blocking seats without a current-cycle department signature. */
function unsignedSeats(state: SopReminderState): SeatSnapshot[] {
  return state.seats.filter(
    (seat) =>
      isBlocking(seat.rasic) &&
      seat.signerId &&
      !state.currentDeptApprovals.some(
        (approval) => approval.signerId === seat.signerId && approval.departmentId === seat.departmentId,
      ),
  );
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * One line naming what an in-flight SOP is waiting on right now — for digests
 * and escalations, where the reader is not the person who owes the action.
 */
export function describeStall(state: SopReminderState): string {
  const { sop } = state;
  if (sop.status === "draft") return sop.rejectedReason ? "author to rework a rejected draft" : "";
  if (sop.status === "approved") return "Quality release";
  if (sop.status !== "in_review") return "";

  if (finalApprovalPhaseActive(sop)) {
    const seats = unsignedSeats(state);
    if (seats.length === 0) return "";
    return `${plural(seats.length, "signature")} outstanding (${seats.map((seat) => seat.departmentName).join(", ")})`;
  }

  const outstanding = unreturnedSeats(state);
  if (outstanding.length > 0) {
    return `${plural(outstanding.length, "review")} outstanding (${outstanding.map((seat) => seat.departmentName).join(", ")})`;
  }
  if (blockingSignerIds(state.seats).length === 0) return "";
  return state.openAnnotationCount > 0
    ? `author to address ${plural(state.openAnnotationCount, "open remark")}`
    : "author to send for final approval";
}

export interface StalledEntry {
  userId: string;
  departmentId: string | null;
  kind: SopNotificationKind;
  waitingDays: number;
}

export interface EscalationPending extends PendingNotification {
  kind: "stall_escalated";
  stalled: StalledEntry[];
}

/**
 * Escalations: a stall whose every nudge went unanswered for
 * ESCALATE_AFTER_REMINDER_DAYS is raised once per workspace manager per cycle,
 * naming who it waits on and for how long. Recomputed from live state, so it
 * self-cancels the moment the stalled person acts. The stalled person is never
 * a recipient of their own escalation.
 */
export function resolveEscalations(now: Date, states: SopReminderState[]): EscalationPending[] {
  return states.flatMap((state) => escalationsForSop(now, state));
}

function escalationsForSop(now: Date, state: SopReminderState): EscalationPending[] {
  const { sop } = state;
  if (sop.deletedAt || state.workspaceManagers.length === 0) return [];

  const stalled: StalledEntry[] = [];
  const seen = new Set<string>();
  for (const candidate of [...signerCandidates(state), ...authorCandidates(state)]) {
    const key = `${candidate.recipientId}:${candidate.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const nudges = state.reminders
      .filter(
        (row) =>
          row.recipientId === candidate.recipientId &&
          row.kind === candidate.kind &&
          row.reviewCycle === sop.reviewCycle,
      )
      .sort((a, b) => a.reminderIndex - b.reminderIndex);
    if (nudges.length < MAX_REMINDERS) continue;
    const last = nudges[nudges.length - 1];
    const sinceLastNudgeDays = (now.getTime() - new Date(last.sentAt).getTime()) / DAY_MS;
    if (sinceLastNudgeDays < ESCALATE_AFTER_REMINDER_DAYS) continue;
    stalled.push({
      userId: candidate.recipientId,
      departmentId: candidate.departmentId,
      kind: candidate.kind,
      waitingDays: Math.floor((now.getTime() - new Date(candidate.anchorAt).getTime()) / DAY_MS),
    });
  }
  if (stalled.length === 0) return [];

  const stalledIds = new Set(stalled.map((entry) => entry.userId));
  const alreadyEscalated = new Set(
    state.reminders
      .filter((row) => row.kind === "stall_escalated" && row.reviewCycle === sop.reviewCycle)
      .map((row) => row.recipientId),
  );
  return Array.from(new Set(state.workspaceManagers))
    .filter((manager) => !stalledIds.has(manager) && !alreadyEscalated.has(manager))
    .map((manager) => ({
      recipientId: manager,
      kind: "stall_escalated" as const,
      sopId: sop.id,
      eventId: null,
      reminderIndex: 1,
      reviewCycle: sop.reviewCycle,
      stalled,
    }));
}

function authorCandidates(state: SopReminderState): ReminderCandidate[] {
  const { sop } = state;
  if (!sop.authorId) return [];

  if (sop.status === "in_review" && !finalApprovalPhaseActive(sop)) {
    if (!everyBlockingSignerReturned(state.seats, state.reviewReturns)) return [];
    const anchorAt = latestReturnAt(state.reviewReturns);
    if (!anchorAt) return [];
    // Remarks still open: the author owes rework. None open: the author owes the
    // "send for final approval" click — the stall the pipeline used to be blind to.
    const kind: SopNotificationKind = state.openAnnotationCount > 0 ? "sent_back" : "review_complete";
    return [{ recipientId: sop.authorId, kind, anchorAt, departmentId: null }];
  }

  if (sop.status === "draft" && sop.rejectedReason && state.recalledAt) {
    return [{ recipientId: sop.authorId, kind: "sent_back", anchorAt: state.recalledAt, departmentId: null }];
  }

  return [];
}

function remindersForSop(now: Date, state: SopReminderState): PendingNotification[] {
  const { sop } = state;
  if (sop.deletedAt) return [];

  const candidates = [...signerCandidates(state), ...authorCandidates(state)];

  const out: PendingNotification[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const key = `${candidate.recipientId}:${candidate.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const prior = state.reminders
      .filter(
        (row) =>
          row.recipientId === candidate.recipientId &&
          row.kind === candidate.kind &&
          row.reviewCycle === sop.reviewCycle,
      )
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
      reviewCycle: sop.reviewCycle,
    });
  }
  return out;
}
