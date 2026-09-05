/**
 * Supabase-backed DrainStore: assembles plain-value contexts for the domain
 * resolvers and owns every read/write against sop_notifications. Service-role
 * only — this module must ONLY ever be constructed inside the drain route.
 * All queries are batched by id set; the working set is bounded by the 30-day
 * event window plus currently stalled (in_review / approved / rejected-draft) SOPs.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { renderSopNotificationEmail, type SopEmailContent } from "@/domain/sop/notification-templates";
import {
  REMINDER_AFTER_DAYS,
  SOP_NOTIFIABLE_EVENT_TYPES,
  resolveEventRecipients,
  resolveReminders,
  type NotifiableEvent,
  type PendingNotification,
  type QualityApproverSnapshot,
  type ReminderLedgerRow,
  type ReviewReturnSnapshot,
  type SeatSnapshot,
  type SopNotificationContext,
  type SopNotificationKind,
  type SopReminderState,
  type SopSnapshot,
} from "@/domain/sop/notifications";
import {
  MAX_SEND_ATTEMPTS,
  isRetryDue,
  type DrainBatch,
  type DrainItem,
  type DrainStore,
  type RetryItem,
} from "./notifications-drain";

const EVENT_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

// Single string literal (not `+` concatenation): Supabase's generated `.select()`
// overloads parse the column list at the type level and only resolve a typed Row
// when the argument is a literal type. `+`-concatenated strings widen to `string`,
// which made the two `.select(SOP_COLUMNS)` calls below fall back to a
// `GenericStringError` return type instead of `SopRow[]`.
const SOP_COLUMNS =
  "id, workspace_id, title, sop_number, version, status, deleted_at, created_by, submitted_by, content_hash, final_approval_requested_at, final_approval_content_hash, rejected_reason, review_cycle, approved_at";

/** SOPs the reminder scan owns: signer stalls AND author stalls (a rejected draft awaiting rework). */
const STALL_SCAN_FILTER = "status.in.(in_review,approved),and(status.eq.draft,rejected_reason.not.is.null)";

type SopRow = {
  id: string;
  workspace_id: string;
  title: string | null;
  sop_number: string | null;
  version: string | null;
  status: string;
  deleted_at: string | null;
  created_by: string | null;
  submitted_by: string | null;
  content_hash: string | null;
  final_approval_requested_at: string | null;
  final_approval_content_hash: string | null;
  rejected_reason: string | null;
  review_cycle: number;
  approved_at: string | null;
};

function toSnapshot(row: SopRow): SopSnapshot {
  return {
    id: row.id,
    title: row.title,
    sopNumber: row.sop_number,
    version: row.version,
    status: row.status,
    deletedAt: row.deleted_at,
    authorId: row.created_by,
    submittedBy: row.submitted_by,
    contentHash: row.content_hash,
    finalApprovalRequestedAt: row.final_approval_requested_at,
    finalApprovalContentHash: row.final_approval_content_hash,
    rejectedReason: row.rejected_reason,
    reviewCycle: row.review_cycle,
  };
}

/** Everything the resolvers and templates need about a set of SOPs, batched. */
interface SopContextBundle {
  sops: Map<string, SopRow>;
  seatsBySop: Map<string, SeatSnapshot[]>;
  qualityApproversBySop: Map<string, QualityApproverSnapshot[]>;
  /** Current-cycle draft-review returns per SOP. */
  returnsBySop: Map<string, ReviewReturnSnapshot[]>;
  /** Current-cycle unresolved remarks per SOP. */
  openAnnotationsBySop: Map<string, number>;
  emailByUser: Map<string, string | null>;
}

export function createSopNotificationDrainStore(admin: SupabaseClient<Database>): DrainStore {
  async function loadContext(sopIds: string[]): Promise<SopContextBundle> {
    const bundle: SopContextBundle = {
      sops: new Map(),
      seatsBySop: new Map(),
      qualityApproversBySop: new Map(),
      returnsBySop: new Map(),
      openAnnotationsBySop: new Map(),
      emailByUser: new Map(),
    };
    if (sopIds.length === 0) return bundle;

    const { data: sopRows, error: sopError } = await admin
      .from("sops")
      .select(SOP_COLUMNS)
      .in("id", sopIds);
    if (sopError) throw new Error(sopError.message);
    for (const row of (sopRows ?? []) as SopRow[]) bundle.sops.set(row.id, row);

    const foundIds = Array.from(bundle.sops.keys());
    if (foundIds.length === 0) return bundle;
    const workspaceIds = Array.from(new Set(Array.from(bundle.sops.values()).map((sop) => sop.workspace_id)));

    const [seatsResult, departmentsResult, submissionsResult, annotationsResult] = await Promise.all([
      admin.from("sop_review_seats").select("sop_id, department_id, rasic, signer_id").in("sop_id", foundIds),
      admin.from("departments").select("id, workspace_id, name, is_quality_gate").in("workspace_id", workspaceIds),
      admin
        .from("sop_review_submissions")
        .select("sop_id, reviewer_id, review_cycle, no_changes, submitted_at")
        .in("sop_id", foundIds),
      admin
        .from("sop_review_annotations")
        .select("sop_id, review_cycle")
        .in("sop_id", foundIds)
        .is("resolved_at", null),
    ]);
    for (const result of [seatsResult, departmentsResult, submissionsResult, annotationsResult]) {
      if (result.error) throw new Error(result.error.message);
    }

    const departmentNameById = new Map(
      (departmentsResult.data ?? []).map((department) => [department.id, department.name]),
    );
    for (const seat of seatsResult.data ?? []) {
      const list = bundle.seatsBySop.get(seat.sop_id) ?? [];
      bundle.seatsBySop.set(seat.sop_id, [
        ...list,
        {
          departmentId: seat.department_id,
          departmentName: departmentNameById.get(seat.department_id) ?? "Unknown department",
          rasic: seat.rasic as SeatSnapshot["rasic"],
          signerId: seat.signer_id,
        },
      ]);
    }

    for (const submission of submissionsResult.data ?? []) {
      const sop = bundle.sops.get(submission.sop_id);
      if (!sop || submission.review_cycle !== sop.review_cycle) continue;
      const list = bundle.returnsBySop.get(submission.sop_id) ?? [];
      bundle.returnsBySop.set(submission.sop_id, [
        ...list,
        { reviewerId: submission.reviewer_id, noChanges: submission.no_changes, returnedAt: submission.submitted_at },
      ]);
    }

    for (const annotation of annotationsResult.data ?? []) {
      const sop = bundle.sops.get(annotation.sop_id);
      if (!sop || annotation.review_cycle !== sop.review_cycle) continue;
      bundle.openAnnotationsBySop.set(annotation.sop_id, (bundle.openAnnotationsBySop.get(annotation.sop_id) ?? 0) + 1);
    }

    const qualityDeptByWorkspace = new Map(
      (departmentsResult.data ?? [])
        .filter((department) => department.is_quality_gate)
        .map((department) => [department.workspace_id, department.id]),
    );
    const qualityDeptIds = Array.from(new Set(qualityDeptByWorkspace.values()));
    const { data: members, error: membersError } = qualityDeptIds.length
      ? await admin
          .from("department_members")
          .select("department_id, user_id, dept_role")
          .in("department_id", qualityDeptIds)
          .eq("dept_role", "approver")
      : { data: [], error: null };
    if (membersError) throw new Error(membersError.message);
    const approversByDept = new Map<string, string[]>();
    for (const member of members ?? []) {
      approversByDept.set(member.department_id, [...(approversByDept.get(member.department_id) ?? []), member.user_id]);
    }

    const { data: overrules, error: overrulesError } = await admin
      .from("sop_signatures")
      .select("sop_id, signer_id, review_cycle")
      .in("sop_id", foundIds)
      .eq("meaning", "objection_overruled");
    if (overrulesError) throw new Error(overrulesError.message);

    for (const sop of bundle.sops.values()) {
      const deptId = qualityDeptByWorkspace.get(sop.workspace_id);
      const approverIds = deptId ? (approversByDept.get(deptId) ?? []) : [];
      const seats = bundle.seatsBySop.get(sop.id) ?? [];
      const seatHolders = new Set(seats.map((seat) => seat.signerId).filter(Boolean));
      bundle.qualityApproversBySop.set(
        sop.id,
        approverIds.map((userId) => ({
          userId,
          holdsSeat: seatHolders.has(userId),
          overruledThisCycle: (overrules ?? []).some(
            (signature) =>
              signature.sop_id === sop.id &&
              signature.signer_id === userId &&
              signature.review_cycle === sop.review_cycle,
          ),
        })),
      );
    }
    return bundle;
  }

  async function loadEmails(bundle: SopContextBundle, userIds: string[]): Promise<void> {
    const missing = Array.from(new Set(userIds)).filter((id) => !bundle.emailByUser.has(id));
    if (missing.length === 0) return;
    const { data, error } = await admin.from("profiles").select("id, email").in("id", missing);
    if (error) throw new Error(error.message);
    const found = new Map((data ?? []).map((row) => [row.id, row.email]));
    for (const id of missing) bundle.emailByUser.set(id, found.get(id) ?? null);
  }

  function contextFor(bundle: SopContextBundle, sopId: string): SopNotificationContext | null {
    const row = bundle.sops.get(sopId);
    if (!row) return null;
    return {
      sop: toSnapshot(row),
      seats: bundle.seatsBySop.get(sopId) ?? [],
      qualityApprovers: bundle.qualityApproversBySop.get(sopId) ?? [],
      reviewReturns: bundle.returnsBySop.get(sopId) ?? [],
      openAnnotationCount: bundle.openAnnotationsBySop.get(sopId) ?? 0,
    };
  }

  function toItem(
    bundle: SopContextBundle,
    pending: PendingNotification,
    origin: string,
    actorName: string,
    waitingDays: number | null,
  ): DrainItem | null {
    const row = bundle.sops.get(pending.sopId);
    if (!row) return null;
    const seats = bundle.seatsBySop.get(pending.sopId) ?? [];
    const recipientSeat = seats.find((seat) => seat.signerId === pending.recipientId);
    return {
      pending,
      email: bundle.emailByUser.get(pending.recipientId) ?? null,
      content: renderSopNotificationEmail({
        kind: pending.kind,
        sopNumber: row.sop_number,
        title: row.title,
        version: row.version,
        actorName,
        departmentName: recipientSeat?.departmentName ?? null,
        origin,
        sopId: pending.sopId,
        reminderIndex: pending.reminderIndex,
        waitingDays,
      }),
    };
  }

  return {
    async collect(now, origin): Promise<DrainBatch> {
      const windowStart = new Date(now.getTime() - EVENT_WINDOW_DAYS * DAY_MS).toISOString();

      // 1) Notifiable events in the window.
      const { data: eventRows, error: eventsError } = await admin
        .from("sop_event_log")
        .select("id, sop_id, review_cycle, event_type, actor_id, actor_name, details, created_at")
        .gte("created_at", windowStart)
        .in("event_type", [...SOP_NOTIFIABLE_EVENT_TYPES])
        .order("created_at", { ascending: true });
      if (eventsError) throw new Error(eventsError.message);
      const events: NotifiableEvent[] = (eventRows ?? []).map((row) => ({
        id: Number(row.id),
        sopId: row.sop_id,
        eventType: row.event_type,
        actorId: row.actor_id,
        actorName: row.actor_name || "Someone",
        details: row.details,
        createdAt: row.created_at,
      }));

      // 2) Ledger rows for those events — the per-recipient anti-join set.
      const eventIds = events.map((event) => event.id);
      const { data: ledgerRows, error: ledgerError } = eventIds.length
        ? await admin.from("sop_notifications").select("event_id, recipient_id").in("event_id", eventIds)
        : { data: [], error: null };
      if (ledgerError) throw new Error(ledgerError.message);
      const covered = new Set((ledgerRows ?? []).map((row) => `${row.event_id}:${row.recipient_id}`));

      // 3) Stalled SOPs for the reminder scan: signer stalls and author stalls.
      const { data: stalledRows, error: stalledError } = await admin
        .from("sops")
        .select(SOP_COLUMNS)
        .or(STALL_SCAN_FILTER)
        .is("deleted_at", null);
      if (stalledError) throw new Error(stalledError.message);
      const stalled = (stalledRows ?? []) as SopRow[];

      const sopIds = Array.from(new Set([...events.map((event) => event.sopId), ...stalled.map((sop) => sop.id)]));
      const bundle = await loadContext(sopIds);

      // 4) First-touch pendings, minus already-covered (event, recipient) pairs.
      const eventItems: { pending: PendingNotification; event: NotifiableEvent }[] = [];
      for (const event of events) {
        const ctx = contextFor(bundle, event.sopId);
        if (!ctx) continue;
        for (const pending of resolveEventRecipients(event, ctx)) {
          if (covered.has(`${event.id}:${pending.recipientId}`)) continue;
          eventItems.push({ pending, event });
        }
      }

      // 5) Reminder pendings from current state.
      const stalledIds = stalled.map((sop) => sop.id);
      const [deptApprovals, phaseEvents, reminderRows] = await Promise.all([
        stalledIds.length
          ? admin
              .from("sop_signatures")
              .select("sop_id, signer_id, seat_department_id, review_cycle, signed_content_hash")
              .in("sop_id", stalledIds)
              .eq("meaning", "dept_approval")
          : Promise.resolve({ data: [], error: null }),
        stalledIds.length
          ? admin
              .from("sop_event_log")
              .select("sop_id, review_cycle, event_type, created_at")
              .in("sop_id", stalledIds)
              .in("event_type", ["review_sent", "review_recalled"])
              .order("created_at", { ascending: true })
          : Promise.resolve({ data: [], error: null }),
        stalledIds.length
          ? admin
              .from("sop_notifications")
              .select("sop_id, recipient_id, kind, reminder_index, review_cycle, sent_at")
              .in("sop_id", stalledIds)
              .is("event_id", null)
              .not("sent_at", "is", null)
          : Promise.resolve({ data: [], error: null }),
      ]);
      for (const result of [deptApprovals, phaseEvents, reminderRows]) {
        if (result.error) throw new Error(result.error.message);
      }

      const reviewSentAtBySop = new Map<string, string>();
      const recalledAtBySop = new Map<string, string>();
      for (const row of phaseEvents.data ?? []) {
        const sop = bundle.sops.get(row.sop_id);
        // Ascending order: the last write per (sop, current cycle) wins = latest.
        if (!sop || row.review_cycle !== sop.review_cycle) continue;
        if (row.event_type === "review_sent") reviewSentAtBySop.set(row.sop_id, row.created_at);
        else recalledAtBySop.set(row.sop_id, row.created_at);
      }

      const states: SopReminderState[] = stalled.flatMap((sop) => {
        const ctx = contextFor(bundle, sop.id);
        if (!ctx) return [];
        return [
          {
            sop: ctx.sop,
            seats: ctx.seats,
            qualityApprovers: ctx.qualityApprovers,
            reviewReturns: ctx.reviewReturns,
            openAnnotationCount: ctx.openAnnotationCount,
            recalledAt: recalledAtBySop.get(sop.id) ?? null,
            currentDeptApprovals: (deptApprovals.data ?? [])
              .filter(
                (row) =>
                  row.sop_id === sop.id &&
                  row.review_cycle === sop.review_cycle &&
                  row.signed_content_hash === (sop.final_approval_content_hash ?? "") &&
                  row.seat_department_id !== null,
              )
              .map((row) => ({ signerId: row.signer_id, departmentId: row.seat_department_id as string })),
            approvedAt: sop.approved_at,
            reviewSentAt: reviewSentAtBySop.get(sop.id) ?? null,
            reminders: ((reminderRows.data ?? []) as {
              sop_id: string;
              recipient_id: string;
              kind: string;
              reminder_index: number;
              review_cycle: number;
              sent_at: string;
            }[])
              .filter((row) => row.sop_id === sop.id)
              .map(
                (row): ReminderLedgerRow => ({
                  recipientId: row.recipient_id,
                  kind: row.kind as SopNotificationKind,
                  reminderIndex: row.reminder_index,
                  reviewCycle: row.review_cycle,
                  sentAt: row.sent_at,
                }),
              ),
          },
        ];
      });
      const reminderPendings = resolveReminders(now, states);

      // 6) Emails + rendered content for everything.
      await loadEmails(bundle, [
        ...eventItems.map((entry) => entry.pending.recipientId),
        ...reminderPendings.map((pending) => pending.recipientId),
      ]);

      const items: DrainItem[] = [];
      for (const { pending, event } of eventItems) {
        const item = toItem(bundle, pending, origin, event.actorName, null);
        if (item) items.push(item);
      }
      for (const pending of reminderPendings) {
        const waitingDays = pending.reminderIndex * REMINDER_AFTER_DAYS;
        const item = toItem(bundle, pending, origin, "Pulse", waitingDays);
        if (item) items.push(item);
      }

      // 7) Health signal: the oldest event still owed a first-touch send.
      const oldest = eventItems.length
        ? Math.max(...eventItems.map((entry) => now.getTime() - new Date(entry.event.createdAt).getTime()))
        : null;
      return {
        items,
        oldestUnnotifiedEventAgeHours: oldest === null ? null : Math.round(oldest / (60 * 60 * 1000)),
      };
    },

    async retryItems(now, origin): Promise<RetryItem[]> {
      const { data, error } = await admin
        .from("sop_notifications")
        .select("id, sop_id, recipient_id, kind, reminder_index, review_cycle, attempts, last_attempt_at, created_at")
        .is("sent_at", null)
        .lt("attempts", MAX_SEND_ATTEMPTS);
      if (error) throw new Error(error.message);
      // Attempt-scaled lease off last_attempt_at (created_at for a never-tried
      // row) so one outage can't burn every attempt within minutes.
      const rows = (data ?? []).filter((row) =>
        isRetryDue(
          now,
          row.last_attempt_at ? new Date(row.last_attempt_at) : null,
          new Date(row.created_at),
          row.attempts,
        ),
      );
      if (rows.length === 0) return [];

      const bundle = await loadContext(Array.from(new Set(rows.map((row) => row.sop_id))));
      await loadEmails(bundle, rows.map((row) => row.recipient_id));

      return rows.flatMap((row) => {
        const item = toItem(
          bundle,
          {
            recipientId: row.recipient_id,
            kind: row.kind as SopNotificationKind,
            sopId: row.sop_id,
            eventId: null,
            reminderIndex: row.reminder_index,
            reviewCycle: row.review_cycle,
          },
          origin,
          "Pulse",
          row.reminder_index > 0 ? row.reminder_index * REMINDER_AFTER_DAYS : null,
        );
        if (!item) return [];
        return [{ ledgerId: Number(row.id), email: item.email, content: item.content, attempts: row.attempts }];
      });
    },

    async claim(pending, content: SopEmailContent) {
      const { data, error } = await admin
        .from("sop_notifications")
        .insert({
          sop_id: pending.sopId,
          recipient_id: pending.recipientId,
          kind: pending.kind,
          event_id: pending.eventId,
          reminder_index: pending.reminderIndex,
          review_cycle: pending.reviewCycle,
          content: content as unknown as Json,
        })
        .select("id")
        .single();
      if (error) {
        if (error.code === "23505") return { claimed: false, ledgerId: null };
        throw new Error(error.message);
      }
      return { claimed: true, ledgerId: Number(data.id) };
    },

    async claimRetry(ledgerId, expectedAttempts) {
      // Conditional bump: matches only while the row is still unsent AT the
      // attempt count the caller read. A concurrent drain that already advanced
      // it sees attempts move past `expectedAttempts` and updates zero rows.
      const { data, error } = await admin
        .from("sop_notifications")
        .update({ attempts: expectedAttempts + 1, last_attempt_at: new Date().toISOString() })
        .eq("id", ledgerId)
        .is("sent_at", null)
        .eq("attempts", expectedAttempts)
        .select("id");
      if (error) throw new Error(error.message);
      return (data ?? []).length > 0;
    },

    async markSent(ledgerId, messageId) {
      const { error } = await admin
        .from("sop_notifications")
        .update({ sent_at: new Date().toISOString(), resend_message_id: messageId })
        .eq("id", ledgerId);
      if (error) throw new Error(error.message);
    },

    async markFailed(ledgerId, message, attemptsAfter) {
      const { error } = await admin
        .from("sop_notifications")
        .update({
          attempts: attemptsAfter,
          last_error: message.slice(0, 1000),
          last_attempt_at: new Date().toISOString(),
        })
        .eq("id", ledgerId);
      if (error) throw new Error(error.message);
    },
  };
}
