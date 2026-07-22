# SOP Email Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Email the person an SOP is stalled on — at submit, final-approval request, Quality gate, and send-back — with capped 3-day reminders, driven off `sop_event_log` and drained by a cron + post-mutation kick.

**Architecture:** `sop_event_log` (already written transactionally with every transition) is the outbox. One new table, `sop_notifications`, is a send *ledger* whose unique indexes provide exactly-once claims. Pure decision functions in `src/domain/sop/notifications.ts` resolve recipients at drain time; a service-role drain route (GET = Vercel Cron w/ `CRON_SECRET`, POST = browser kick w/ `requireApiUser`) assembles context, claims by insert, and sends via Resend's REST API with plain `fetch`. Reminders are recomputed from live state each drain (self-cancelling), never pre-scheduled.

**Tech Stack:** Next.js 16 App Router route handler, Supabase (service-role client, RLS-locked ledger), Vitest, Resend REST API (no SDK), Vercel Cron.

**Spec:** `docs/superpowers/specs/2026-07-21-sop-notifications-design.md` — read it first; it is the authority on every rule below.

## Global Constraints

- Branch: `feat/sop-notifications` (already created; spec committed as `3d5d3c2`).
- **Zero new npm dependencies.** Resend via raw `fetch`. Never touch `package.json`/`package-lock.json`.
- Constants, exact values: `REMINDER_AFTER_DAYS = 3`, `MAX_REMINDERS = 2`, `MAX_SEND_ATTEMPTS = 3`, lease `10` minutes, event lookback window `30` days, cron schedule `0 13 * * *`.
- Ledger stores `recipient_id` uuid — **never an email address**. `profiles.email` resolved at send time.
- Idempotency anchors on `(event_id, recipient_id)` — **never** `content_hash` or `review_cycle`.
- RLS posture of `sop_notifications`: RLS enabled, **zero** policies, `revoke all ... from anon, authenticated`. Service-role only.
- Domain module is pure: no React, no Supabase imports, no `Date.now()`/`new Date()` without an injected `now`.
- The event's `actor_id` is always excluded from first-touch recipients.
- Existing files may be edited only at the exact call sites named in Task 7.
- Env vars (new): `RESEND_API_KEY`, `RESEND_FROM`, `CRON_SECRET`. Existing: `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`.
- Commit format: `<type>: <description>` (repo uses `feat(sop): ...` style). No attribution footers.
- Gate before finishing any task: `npm run typecheck && npm run lint && npm run test` all green.

---

### Task 1: Migration — `sop_notifications` ledger

**Files:**
- Create: `supabase/migrations/20260721150000_sop_notifications_ledger.sql`
- Modify (generated): `src/lib/database.types.ts`

**Interfaces:**
- Consumes: `public.sops`, `public.sop_event_log`, `auth.users` (FKs only).
- Produces: table `public.sop_notifications` with columns exactly as below; later tasks read/write it **only** through the service-role client.

- [ ] **Step 1: Write the migration**

```sql
-- Send ledger for SOP email notifications. NOT a queue: sop_event_log is the
-- outbox (written transactionally with every transition); this table records
-- what has been sent, and its unique indexes are the exactly-once claims.
-- Spec: docs/superpowers/specs/2026-07-21-sop-notifications-design.md

create table public.sop_notifications (
  id                 bigint generated always as identity primary key,
  sop_id             text not null references public.sops(id) on delete cascade,
  recipient_id       uuid not null references auth.users(id) on delete cascade,
  kind               text not null check (kind in (
                       'review_requested',
                       'final_approval_requested',
                       'quality_release_requested',
                       'sent_back'
                     )),
  event_id           bigint references public.sop_event_log(id) on delete cascade,
  reminder_index     integer not null default 0 check (reminder_index >= 0),
  sent_at            timestamptz,
  attempts           integer not null default 0,
  last_error         text,
  resend_message_id  text,
  created_at         timestamptz not null default now()
);

-- Exactly-once per event occurrence (first-touch mail).
create unique index sop_notifications_event_recipient_key
  on public.sop_notifications(event_id, recipient_id)
  where event_id is not null;

-- Exactly-once per nudge (reminders have event_id null, reminder_index 1..N).
create unique index sop_notifications_reminder_key
  on public.sop_notifications(sop_id, recipient_id, kind, reminder_index)
  where event_id is null;

-- Retry-lane scan: unsent rows.
create index sop_notifications_unsent_idx
  on public.sop_notifications(created_at)
  where sent_at is null;

-- Service-role only, both directions. Mirrors sop_event_log's write posture
-- (20260715170000 lines 38-45) but stricter: users never read this table.
alter table public.sop_notifications enable row level security;
revoke all on public.sop_notifications from anon, authenticated;
```

- [ ] **Step 2: Apply to the live database**

Try: `npx supabase db push`
If the CLI is not linked/authorized: **PAUSE** and ask your human partner to paste the file into the Supabase SQL editor (project `neaadefipcpxxcqszpud`) and run it, then continue. Do not skip ahead.

- [ ] **Step 3: Verify RLS posture**

Run in the SQL editor (or `psql`) as a check — expected: `rowsecurity = true` and zero policies:

```sql
select relrowsecurity from pg_class where relname = 'sop_notifications';
select count(*) from pg_policies where tablename = 'sop_notifications';
```

Expected: `true`, `0`.

- [ ] **Step 4: Regenerate types**

Run: `npm run gen:types` (needs `SUPABASE_ACCESS_TOKEN`; if missing, PAUSE and ask).
Expected: `src/lib/database.types.ts` gains a `sop_notifications` block.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260721150000_sop_notifications_ledger.sql src/lib/database.types.ts
git commit -m "feat(sop): sop_notifications send ledger (service-role only)"
```

---

### Task 2: Domain — types + `resolveEventRecipients`

**Files:**
- Create: `src/domain/sop/notifications.ts`
- Test: `src/domain/sop/notifications.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks (pure module; defines its own rasic union — do NOT import from `src/lib/`).
- Produces (exact, later tasks rely on these):
  - `type SopNotificationKind = "review_requested" | "final_approval_requested" | "quality_release_requested" | "sent_back"`
  - `interface NotifiableEvent { id: number; sopId: string; eventType: string; actorId: string | null; actorName: string; details: unknown; createdAt: string }`
  - `interface SopSnapshot { id: string; title: string | null; sopNumber: string | null; version: string | null; status: string; deletedAt: string | null; authorId: string | null; submittedBy: string | null; contentHash: string | null; finalApprovalRequestedAt: string | null; finalApprovalContentHash: string | null; rejectedReason: string | null; reviewCycle: number }`
  - `interface SeatSnapshot { departmentId: string; departmentName: string; rasic: "responsible" | "accountable" | "support" | "consulted" | "informed"; signerId: string | null }`
  - `interface QualityApproverSnapshot { userId: string; holdsSeat: boolean; overruledThisCycle: boolean }`
  - `interface SopNotificationContext { sop: SopSnapshot; seats: SeatSnapshot[]; qualityApprovers: QualityApproverSnapshot[] }`
  - `interface PendingNotification { recipientId: string; kind: SopNotificationKind; sopId: string; eventId: number | null; reminderIndex: number }`
  - `function resolveEventRecipients(event: NotifiableEvent, ctx: SopNotificationContext): PendingNotification[]`
  - Constants: `REMINDER_AFTER_DAYS = 3`, `MAX_REMINDERS = 2`, `SOP_NOTIFIABLE_EVENT_TYPES: readonly string[]` = `["review_sent", "final_approval_requested", "status_changed", "review_returned", "review_recalled"]`

- [ ] **Step 1: Write the failing tests**

Create `src/domain/sop/notifications.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  resolveEventRecipients,
  type NotifiableEvent,
  type SopNotificationContext,
  type SopSnapshot,
} from "./notifications";

const sop = (over: Partial<SopSnapshot> = {}): SopSnapshot => ({
  id: "sop-1",
  title: "Line Clearance",
  sopNumber: "SOP-0042",
  version: "C",
  status: "in_review",
  deletedAt: null,
  authorId: "author",
  submittedBy: "submitter",
  contentHash: "hash-1",
  finalApprovalRequestedAt: null,
  finalApprovalContentHash: null,
  rejectedReason: null,
  reviewCycle: 1,
  ...over,
});

const ctx = (over: Partial<SopNotificationContext> = {}): SopNotificationContext => ({
  sop: sop(),
  seats: [
    { departmentId: "d-r", departmentName: "Engineering", rasic: "responsible", signerId: "resp" },
    { departmentId: "d-a", departmentName: "Ops", rasic: "accountable", signerId: "acct" },
    { departmentId: "d-s", departmentName: "Safety", rasic: "support", signerId: "supp" },
    { departmentId: "d-i", departmentName: "HR", rasic: "informed", signerId: "info" },
  ],
  qualityApprovers: [],
  ...over,
});

const event = (over: Partial<NotifiableEvent> = {}): NotifiableEvent => ({
  id: 10,
  sopId: "sop-1",
  eventType: "review_sent",
  actorId: "submitter",
  actorName: "Sam Submitter",
  details: {},
  createdAt: "2026-07-21T12:00:00Z",
  ...over,
});

const ids = (list: { recipientId: string }[]) => list.map((n) => n.recipientId).sort();

describe("resolveEventRecipients: review_sent", () => {
  it("emails every non-informed seat signer, excluding the actor", () => {
    const out = resolveEventRecipients(event(), ctx());
    expect(ids(out)).toEqual(["acct", "resp", "supp"]);
    expect(out.every((n) => n.kind === "review_requested")).toBe(true);
    expect(out.every((n) => n.eventId === 10 && n.reminderIndex === 0)).toBe(true);
  });

  it("never emails informed seats", () => {
    expect(ids(resolveEventRecipients(event(), ctx()))).not.toContain("info");
  });

  it("excludes the actor when they hold a seat", () => {
    const out = resolveEventRecipients(event({ actorId: "supp" }), ctx());
    expect(ids(out)).toEqual(["acct", "resp"]);
  });

  it("dedupes a signer holding two seats", () => {
    const c = ctx();
    const twoSeats = { ...c, seats: [c.seats[0], { ...c.seats[1], signerId: "resp" }] };
    expect(ids(resolveEventRecipients(event(), twoSeats))).toEqual(["resp"]);
  });

  it("skips when the SOP has left in_review (moment passed)", () => {
    const c = ctx({ sop: sop({ status: "draft" }) });
    expect(resolveEventRecipients(event(), c)).toEqual([]);
  });

  it("skips when final approval has since been requested", () => {
    const c = ctx({
      sop: sop({ finalApprovalRequestedAt: "2026-07-21T13:00:00Z", finalApprovalContentHash: "hash-1" }),
    });
    expect(resolveEventRecipients(event(), c)).toEqual([]);
  });
});

describe("resolveEventRecipients: final_approval_requested", () => {
  const fa = () =>
    ctx({
      sop: sop({ finalApprovalRequestedAt: "2026-07-21T13:00:00Z", finalApprovalContentHash: "hash-1" }),
    });

  it("emails only Responsible and Accountable signers", () => {
    const out = resolveEventRecipients(event({ eventType: "final_approval_requested", actorId: "author" }), fa());
    expect(ids(out)).toEqual(["acct", "resp"]);
    expect(out.every((n) => n.kind === "final_approval_requested")).toBe(true);
  });

  it("skips when the content changed after the request (phase reset)", () => {
    const c = ctx({
      sop: sop({ finalApprovalRequestedAt: "2026-07-21T13:00:00Z", finalApprovalContentHash: "old-hash" }),
    });
    expect(resolveEventRecipients(event({ eventType: "final_approval_requested" }), c)).toEqual([]);
  });
});

describe("resolveEventRecipients: quality gate", () => {
  const approvedEvent = () =>
    event({ eventType: "status_changed", actorId: "resp", details: { from_status: "in_review", to_status: "approved" } });
  const qctx = () =>
    ctx({
      sop: sop({ status: "approved" }),
      qualityApprovers: [
        { userId: "q-clean", holdsSeat: false, overruledThisCycle: false },
        { userId: "q-seated", holdsSeat: true, overruledThisCycle: false },
        { userId: "q-overruled", holdsSeat: false, overruledThisCycle: true },
        { userId: "author", holdsSeat: false, overruledThisCycle: false },
        { userId: "submitter", holdsSeat: false, overruledThisCycle: false },
      ],
    });

  it("emails only unbarred quality approvers", () => {
    const out = resolveEventRecipients(approvedEvent(), qctx());
    expect(ids(out)).toEqual(["q-clean"]);
    expect(out[0].kind).toBe("quality_release_requested");
  });

  it("ignores status_changed events that are not -> approved", () => {
    const e = event({ eventType: "status_changed", details: { to_status: "obsolete" } });
    expect(resolveEventRecipients(e, qctx())).toEqual([]);
  });

  it("skips when the SOP is no longer approved", () => {
    const c = qctx();
    expect(resolveEventRecipients(approvedEvent(), { ...c, sop: sop({ status: "effective" }) })).toEqual([]);
  });

  it("treats malformed details as not-classifiable (no mail, no throw)", () => {
    const e = event({ eventType: "status_changed", details: "corrupt" });
    expect(resolveEventRecipients(e, qctx())).toEqual([]);
  });
});

describe("resolveEventRecipients: sent_back", () => {
  it("review_returned with remarks emails the author", () => {
    const e = event({ eventType: "review_returned", actorId: "resp", details: { no_changes: false } });
    const out = resolveEventRecipients(e, ctx());
    expect(ids(out)).toEqual(["author"]);
    expect(out[0].kind).toBe("sent_back");
  });

  it("review_returned with no_changes=true sends nothing", () => {
    const e = event({ eventType: "review_returned", actorId: "resp", details: { no_changes: true } });
    expect(resolveEventRecipients(e, ctx())).toEqual([]);
  });

  it("review_recalled with an open rejection emails the author", () => {
    const e = event({ eventType: "review_recalled", actorId: "resp" });
    const c = ctx({ sop: sop({ status: "draft", rejectedReason: "Missing PPE step" }) });
    expect(ids(resolveEventRecipients(e, c))).toEqual(["author"]);
  });

  it("review_recalled without a rejection is a recall: no mail", () => {
    const e = event({ eventType: "review_recalled", actorId: "author" });
    const c = ctx({ sop: sop({ status: "draft" }) });
    expect(resolveEventRecipients(e, c)).toEqual([]);
  });

  it("never emails the author about their own action", () => {
    const e = event({ eventType: "review_returned", actorId: "author", details: { no_changes: false } });
    expect(resolveEventRecipients(e, ctx())).toEqual([]);
  });
});

describe("resolveEventRecipients: universal guards", () => {
  it("deleted SOPs never notify", () => {
    const c = ctx({ sop: sop({ deletedAt: "2026-07-20T00:00:00Z" }) });
    expect(resolveEventRecipients(event(), c)).toEqual([]);
  });

  it("unknown event types resolve to nothing", () => {
    expect(resolveEventRecipients(event({ eventType: "remark_added" }), ctx())).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/domain/sop/notifications.test.ts`
Expected: FAIL — cannot resolve `./notifications`.

- [ ] **Step 3: Implement**

Create `src/domain/sop/notifications.ts`:

```ts
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
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/domain/sop/notifications.test.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Commit**

```bash
git add src/domain/sop/notifications.ts src/domain/sop/notifications.test.ts
git commit -m "feat(sop): notification recipient resolution for the four stall events"
```

---

### Task 3: Domain — `resolveReminders`

**Files:**
- Modify: `src/domain/sop/notifications.ts` (append)
- Test: `src/domain/sop/notifications.test.ts` (append)

**Interfaces:**
- Consumes: Task 2's types (`SopSnapshot`, `SeatSnapshot`, `QualityApproverSnapshot`, `PendingNotification`, `finalApprovalPhaseActive`, constants).
- Produces:
  - `interface ReminderLedgerRow { recipientId: string; kind: SopNotificationKind; reminderIndex: number; sentAt: string }`
  - `interface SopReminderState { sop: SopSnapshot; seats: SeatSnapshot[]; qualityApprovers: QualityApproverSnapshot[]; currentReviewReturns: string[]; currentDeptApprovals: { signerId: string; departmentId: string }[]; approvedAt: string | null; reviewSentAt: string | null; reminders: ReminderLedgerRow[] }`
  - `function resolveReminders(now: Date, states: SopReminderState[]): PendingNotification[]`

- [ ] **Step 1: Write the failing tests**

Append to `src/domain/sop/notifications.test.ts` (extend the existing imports with `resolveReminders`, `type SopReminderState`):

```ts
describe("resolveReminders", () => {
  const NOW = new Date("2026-07-25T12:00:00Z"); // 4 days after 07-21
  const state = (over: Partial<SopReminderState> = {}): SopReminderState => ({
    sop: sop(),
    seats: [
      { departmentId: "d-r", departmentName: "Engineering", rasic: "responsible", signerId: "resp" },
      { departmentId: "d-s", departmentName: "Safety", rasic: "support", signerId: "supp" },
    ],
    qualityApprovers: [],
    currentReviewReturns: [],
    currentDeptApprovals: [],
    approvedAt: null,
    reviewSentAt: "2026-07-21T12:00:00Z",
    reminders: [],
    ...over,
  });

  it("nudges every stalled draft-phase reviewer after 3 days", () => {
    const out = resolveReminders(NOW, [state()]);
    expect(ids(out)).toEqual(["resp", "supp"]);
    expect(out.every((n) => n.kind === "review_requested" && n.reminderIndex === 1 && n.eventId === null)).toBe(true);
  });

  it("does not nudge before the threshold", () => {
    const early = new Date("2026-07-23T12:00:00Z"); // 2 days
    expect(resolveReminders(early, [state()])).toEqual([]);
  });

  it("skips reviewers who already returned their review", () => {
    expect(ids(resolveReminders(NOW, [state({ currentReviewReturns: ["resp"] })]))).toEqual(["supp"]);
  });

  it("caps at MAX_REMINDERS", () => {
    const capped = state({
      reminders: [
        { recipientId: "resp", kind: "review_requested", reminderIndex: 1, sentAt: "2026-07-24T12:00:00Z" },
        { recipientId: "resp", kind: "review_requested", reminderIndex: 2, sentAt: "2026-07-28T12:00:00Z" },
      ],
    });
    const late = new Date("2026-08-15T12:00:00Z");
    expect(ids(resolveReminders(late, [capped]))).toEqual(["supp"]);
  });

  it("anchors nudge 2 on nudge 1's sent_at, not the original event", () => {
    const one = state({
      reminders: [{ recipientId: "resp", kind: "review_requested", reminderIndex: 1, sentAt: "2026-07-24T00:00:00Z" }],
    });
    // 07-25 is only 1.5 days after nudge 1: resp not due; supp (no nudges yet) is.
    expect(ids(resolveReminders(NOW, [one]))).toEqual(["supp"]);
    const later = new Date("2026-07-27T06:00:00Z");
    const out = resolveReminders(later, [one]);
    expect(out.find((n) => n.recipientId === "resp")?.reminderIndex).toBe(2);
  });

  it("final-approval phase nudges only unsigned R/A seats", () => {
    const fa = state({
      sop: sop({ finalApprovalRequestedAt: "2026-07-21T12:00:00Z", finalApprovalContentHash: "hash-1" }),
      currentDeptApprovals: [],
    });
    const out = resolveReminders(NOW, [fa]);
    expect(ids(out)).toEqual(["resp"]); // supp is not R/A
    expect(out[0].kind).toBe("final_approval_requested");
  });

  it("final-approval nudge respects an existing signature for that seat", () => {
    const fa = state({
      sop: sop({ finalApprovalRequestedAt: "2026-07-21T12:00:00Z", finalApprovalContentHash: "hash-1" }),
      currentDeptApprovals: [{ signerId: "resp", departmentId: "d-r" }],
    });
    expect(resolveReminders(NOW, [fa])).toEqual([]);
  });

  it("quality stall nudges unbarred approvers, anchored on approved_at", () => {
    const q = state({
      sop: sop({ status: "approved" }),
      approvedAt: "2026-07-21T12:00:00Z",
      qualityApprovers: [
        { userId: "q-clean", holdsSeat: false, overruledThisCycle: false },
        { userId: "q-seated", holdsSeat: true, overruledThisCycle: false },
      ],
    });
    const out = resolveReminders(NOW, [q]);
    expect(ids(out)).toEqual(["q-clean"]);
    expect(out[0].kind).toBe("quality_release_requested");
  });

  it("self-cancels: a recalled SOP produces no reminders", () => {
    expect(resolveReminders(NOW, [state({ sop: sop({ status: "draft" }) })])).toEqual([]);
  });

  it("a reassigned seat's new signer gets nudge 1 (their first contact)", () => {
    const reassigned = state({
      seats: [{ departmentId: "d-r", departmentName: "Engineering", rasic: "responsible", signerId: "new-signer" }],
      reminders: [{ recipientId: "old-signer", kind: "review_requested", reminderIndex: 1, sentAt: "2026-07-22T12:00:00Z" }],
    });
    const out = resolveReminders(NOW, [reassigned]);
    expect(ids(out)).toEqual(["new-signer"]);
    expect(out[0].reminderIndex).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/domain/sop/notifications.test.ts`
Expected: FAIL — `resolveReminders` is not exported.

- [ ] **Step 3: Implement**

Append to `src/domain/sop/notifications.ts`:

```ts
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
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/domain/sop/notifications.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/sop/notifications.ts src/domain/sop/notifications.test.ts
git commit -m "feat(sop): scan-based reminder resolution (3-day, capped, self-cancelling)"
```

---

### Task 4: Domain — email templates

**Files:**
- Modify: `src/domain/sop/notifications.ts` (append)
- Test: `src/domain/sop/notifications.test.ts` (append)

**Interfaces:**
- Consumes: `SopNotificationKind` (Task 2).
- Produces:
  - `interface SopEmailInput { kind: SopNotificationKind; sopNumber: string | null; title: string | null; version: string | null; actorName: string; departmentName: string | null; origin: string; sopId: string; reminderIndex: number; waitingDays: number | null }`
  - `interface SopEmailContent { subject: string; text: string; html: string }`
  - `function renderSopNotificationEmail(input: SopEmailInput): SopEmailContent`

- [ ] **Step 1: Write the failing tests**

Append to `src/domain/sop/notifications.test.ts` (add `renderSopNotificationEmail`, `type SopEmailInput` to imports):

```ts
describe("renderSopNotificationEmail", () => {
  const input = (over: Partial<SopEmailInput> = {}): SopEmailInput => ({
    kind: "review_requested",
    sopNumber: "SOP-0042",
    title: "Line Clearance",
    version: "C",
    actorName: "Sam Submitter",
    departmentName: "Engineering",
    origin: "https://pulse.example.com",
    sopId: "sop-1",
    reminderIndex: 0,
    waitingDays: null,
    ...over,
  });

  it("review subject carries number, title, and revision", () => {
    expect(renderSopNotificationEmail(input()).subject).toBe('Review requested: SOP-0042 "Line Clearance" (Rev C)');
  });

  it("subjects match the spec shapes for the other kinds", () => {
    expect(renderSopNotificationEmail(input({ kind: "final_approval_requested" })).subject).toBe(
      'Signature needed: SOP-0042 "Line Clearance"',
    );
    expect(renderSopNotificationEmail(input({ kind: "quality_release_requested" })).subject).toBe(
      'Ready for release: SOP-0042 "Line Clearance"',
    );
    expect(renderSopNotificationEmail(input({ kind: "sent_back" })).subject).toBe(
      'Sent back with remarks: SOP-0042 "Line Clearance"',
    );
  });

  it("body links to the SOP in both text and html", () => {
    const { text, html } = renderSopNotificationEmail(input());
    expect(text).toContain("https://pulse.example.com/sops/sop-1");
    expect(html).toContain('href="https://pulse.example.com/sops/sop-1"');
  });

  it("reminders get the prefix and the waiting line", () => {
    const out = renderSopNotificationEmail(input({ reminderIndex: 1, waitingDays: 4 }));
    expect(out.subject).toBe('Reminder: Review requested: SOP-0042 "Line Clearance" (Rev C)');
    expect(out.text).toContain("waiting 4 days");
  });

  it("html-escapes user-controlled fields", () => {
    const out = renderSopNotificationEmail(input({ title: '<img src=x onerror=1>' }));
    expect(out.html).not.toContain("<img");
    expect(out.html).toContain("&lt;img");
  });

  it("falls back gracefully when number/title/version are missing", () => {
    const out = renderSopNotificationEmail(input({ sopNumber: null, title: null, version: null }));
    expect(out.subject).toBe('Review requested: SOP "Untitled SOP"');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/domain/sop/notifications.test.ts`
Expected: FAIL — `renderSopNotificationEmail` is not exported.

- [ ] **Step 3: Implement**

Append to `src/domain/sop/notifications.ts`:

```ts
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

/**
 * Four literal templates, one per kind — deliberately no engine, no registry
 * (spec's YAGNI cuts). Email is a UI surface: plain sentences, one link.
 */
export function renderSopNotificationEmail(input: SopEmailInput): SopEmailContent {
  const label = `${input.sopNumber ?? "SOP"} "${input.title ?? "Untitled SOP"}"`;
  const link = `${input.origin}/sops/${input.sopId}`;

  let subject: string;
  let happened: string;
  let needed: string;
  switch (input.kind) {
    case "review_requested":
      subject = `Review requested: ${label}${input.version ? ` (Rev ${input.version})` : ""}`;
      happened = `${input.actorName} sent ${label} for review.`;
      needed = input.departmentName
        ? `You are the reviewer for the ${input.departmentName} seat — please review it and return your result.`
        : `Please review it and return your result.`;
      break;
    case "final_approval_requested":
      subject = `Signature needed: ${label}`;
      happened = `Every reviewer accepted ${label}.`;
      needed = input.departmentName
        ? `Your formal ${input.departmentName} department signature is needed to approve it.`
        : `Your formal department signature is needed to approve it.`;
      break;
    case "quality_release_requested":
      subject = `Ready for release: ${label}`;
      happened = `${label} has every department signature.`;
      needed = `As a Quality approver, you can review it and make it effective.`;
      break;
    case "sent_back":
      subject = `Sent back with remarks: ${label}`;
      happened = `${input.actorName} sent ${label} back.`;
      needed = `Please address the remarks and resubmit it for review.`;
      break;
  }

  const isReminder = input.reminderIndex > 0;
  if (isReminder) subject = `Reminder: ${subject}`;
  const waiting =
    isReminder && input.waitingDays !== null ? `This has been waiting ${input.waitingDays} days.` : null;

  const textLines = [happened, needed, waiting, `Open it: ${link}`].filter(Boolean);
  const htmlParagraphs = [happened, needed, waiting]
    .filter((line): line is string => Boolean(line))
    .map((line) => `<p style="margin:0 0 12px">${escapeHtml(line)}</p>`)
    .join("");

  return {
    subject,
    text: textLines.join("\n\n"),
    html:
      `<div style="font-family:system-ui,sans-serif;font-size:14px;color:#111">` +
      htmlParagraphs +
      `<p style="margin:16px 0 0"><a href="${link}" ` +
      `style="display:inline-block;padding:8px 14px;background:#111;color:#fff;text-decoration:none">` +
      `Open in Pulse</a></p></div>`,
  };
}
```

- [ ] **Step 4: Run to verify pass, then full gate**

Run: `npx vitest run src/domain/sop/notifications.test.ts` — expected PASS.
Run: `npm run typecheck && npm run lint` — expected clean.

- [ ] **Step 5: Commit**

```bash
git add src/domain/sop/notifications.ts src/domain/sop/notifications.test.ts
git commit -m "feat(sop): notification email templates"
```

---

### Task 5: Drain library — auth check, Resend sender, drain loop

**Files:**
- Create: `src/lib/sop/notifications-drain.ts`
- Test: `src/lib/sop/notifications-drain.test.ts`

**Interfaces:**
- Consumes: `PendingNotification`, `SopEmailContent` from `@/domain/sop/notifications` (Tasks 2/4).
- Produces (Task 6 relies on these exactly):
  - `const MAX_SEND_ATTEMPTS = 3`
  - `function isAuthorizedCronRequest(request: Request): boolean`
  - `interface EmailSendResult` = `{ ok: true; id: string } | { ok: false; status: number; error: string; permanent: boolean }`
  - `type EmailSender = (to: string, content: SopEmailContent) => Promise<EmailSendResult>`
  - `function createResendSender(apiKey: string, from: string): EmailSender`
  - `interface DrainItem { pending: PendingNotification; email: string | null; content: SopEmailContent }`
  - `interface RetryItem { ledgerId: number; email: string | null; content: SopEmailContent; attempts: number }`
  - `interface DrainBatch { items: DrainItem[]; oldestUnnotifiedEventAgeHours: number | null }`
  - `interface DrainStore { collect(now: Date, origin: string): Promise<DrainBatch>; retryItems(now: Date, origin: string): Promise<RetryItem[]>; claim(pending: PendingNotification): Promise<{ claimed: boolean; ledgerId: number | null }>; markSent(ledgerId: number, messageId: string): Promise<void>; markFailed(ledgerId: number, error: string, attemptsAfter: number): Promise<void> }`
  - `interface DrainReport { configured: boolean; sent: number; retried: number; skippedDuplicate: number; skippedNoEmail: number; failed: number; oldestUnnotifiedEventAgeHours: number | null }`
  - `function runSopNotificationDrain(deps: { store: DrainStore; send: EmailSender | null; now: () => Date; origin: string }): Promise<DrainReport>`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/sop/notifications-drain.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { SopEmailContent } from "@/domain/sop/notifications";
import {
  isAuthorizedCronRequest,
  runSopNotificationDrain,
  type DrainBatch,
  type DrainItem,
  type DrainStore,
  type RetryItem,
} from "./notifications-drain";

const content: SopEmailContent = { subject: "s", text: "t", html: "<p>t</p>" };
const item = (over: Partial<DrainItem> = {}): DrainItem => ({
  pending: { recipientId: "u1", kind: "review_requested", sopId: "sop-1", eventId: 10, reminderIndex: 0 },
  email: "u1@example.com",
  content,
  ...over,
});

function fakeStore(batch: DrainBatch, retries: RetryItem[] = []) {
  const calls = { claims: 0, sent: [] as number[], failed: [] as { id: number; attempts: number }[] };
  let nextLedgerId = 100;
  const store: DrainStore = {
    collect: async () => batch,
    retryItems: async () => retries,
    claim: async () => ({ claimed: true, ledgerId: nextLedgerId++ }),
    markSent: async (id) => void calls.sent.push(id),
    markFailed: async (id, _error, attempts) => void calls.failed.push({ id, attempts }),
  };
  return { store, calls };
}

const okSender = async () => ({ ok: true as const, id: "re_123" });

describe("isAuthorizedCronRequest", () => {
  it("accepts the CRON_SECRET bearer and nothing else", () => {
    process.env.CRON_SECRET = "topsecret";
    const withAuth = (value?: string) =>
      new Request("https://x.test/api", { headers: value ? { authorization: value } : {} });
    expect(isAuthorizedCronRequest(withAuth("Bearer topsecret"))).toBe(true);
    expect(isAuthorizedCronRequest(withAuth("Bearer wrong"))).toBe(false);
    expect(isAuthorizedCronRequest(withAuth())).toBe(false);
    delete process.env.CRON_SECRET;
    expect(isAuthorizedCronRequest(withAuth("Bearer topsecret"))).toBe(false);
  });
});

describe("runSopNotificationDrain", () => {
  const now = () => new Date("2026-07-21T12:00:00Z");
  const origin = "https://pulse.example.com";

  it("unconfigured (no sender): reports without claiming anything", async () => {
    const { store, calls } = fakeStore({ items: [item()], oldestUnnotifiedEventAgeHours: 5 });
    const report = await runSopNotificationDrain({ store, send: null, now, origin });
    expect(report.configured).toBe(false);
    expect(report.sent).toBe(0);
    expect(report.oldestUnnotifiedEventAgeHours).toBe(5);
    expect(calls.sent).toEqual([]);
  });

  it("claims, sends, and stamps each item", async () => {
    const { store, calls } = fakeStore({ items: [item()], oldestUnnotifiedEventAgeHours: null });
    const report = await runSopNotificationDrain({ store, send: okSender, now, origin });
    expect(report.sent).toBe(1);
    expect(calls.sent).toEqual([100]);
  });

  it("a lost claim (unique-index race) is a skip, not a failure", async () => {
    const { store } = fakeStore({ items: [item()], oldestUnnotifiedEventAgeHours: null });
    store.claim = async () => ({ claimed: false, ledgerId: null });
    const report = await runSopNotificationDrain({ store, send: okSender, now, origin });
    expect(report.skippedDuplicate).toBe(1);
    expect(report.sent).toBe(0);
    expect(report.failed).toBe(0);
  });

  it("missing email skips WITHOUT claiming (retries when the profile gains one)", async () => {
    const { store, calls } = fakeStore({ items: [item({ email: null })], oldestUnnotifiedEventAgeHours: null });
    let claims = 0;
    const baseClaim = store.claim;
    store.claim = async (pending) => {
      claims += 1;
      return baseClaim(pending);
    };
    const report = await runSopNotificationDrain({ store, send: okSender, now, origin });
    expect(report.skippedNoEmail).toBe(1);
    expect(claims).toBe(0);
    expect(calls.sent).toEqual([]);
  });

  it("a permanent send failure jumps attempts to the cap (dead row, never retried)", async () => {
    const { store, calls } = fakeStore({ items: [item()], oldestUnnotifiedEventAgeHours: null });
    const bouncer = async () => ({ ok: false as const, status: 422, error: "invalid to", permanent: true });
    const report = await runSopNotificationDrain({ store, send: bouncer, now, origin });
    expect(report.failed).toBe(1);
    expect(calls.failed).toEqual([{ id: 100, attempts: 3 }]);
  });

  it("a transient failure increments attempts by one", async () => {
    const { store, calls } = fakeStore({ items: [item()], oldestUnnotifiedEventAgeHours: null });
    const flaky = async () => ({ ok: false as const, status: 500, error: "boom", permanent: false });
    await runSopNotificationDrain({ store, send: flaky, now, origin });
    expect(calls.failed).toEqual([{ id: 100, attempts: 1 }]);
  });

  it("one thrown send never aborts the batch", async () => {
    const items = [item(), item({ pending: { ...item().pending, recipientId: "u2" }, email: "u2@example.com" })];
    const { store } = fakeStore({ items, oldestUnnotifiedEventAgeHours: null });
    let first = true;
    const explosive = async () => {
      if (first) {
        first = false;
        throw new Error("network died");
      }
      return { ok: true as const, id: "re_2" };
    };
    const report = await runSopNotificationDrain({ store, send: explosive, now, origin });
    expect(report.sent).toBe(1);
    expect(report.failed).toBe(1);
  });

  it("retry lane resends claimed-but-unsent rows below the attempt cap", async () => {
    const retries: RetryItem[] = [
      { ledgerId: 55, email: "u1@example.com", content, attempts: 1 },
      { ledgerId: 56, email: null, content, attempts: 1 },
    ];
    const { store, calls } = fakeStore({ items: [], oldestUnnotifiedEventAgeHours: null }, retries);
    const report = await runSopNotificationDrain({ store, send: okSender, now, origin });
    expect(report.retried).toBe(1);
    expect(calls.sent).toEqual([55]);
    expect(report.skippedNoEmail).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/sop/notifications-drain.test.ts`
Expected: FAIL — cannot resolve `./notifications-drain`.

- [ ] **Step 3: Implement**

Create `src/lib/sop/notifications-drain.ts`:

```ts
/**
 * SOP notification drain — the effects layer. Claims ledger rows (the unique
 * index IS the mutex: a lost insert race means another drain owns that send),
 * emails via Resend's REST API, and stamps results. All DECISIONS (who, what,
 * when) live in src/domain/sop/notifications.ts; all DATA ACCESS lives behind
 * DrainStore so this loop tests against an in-memory fake.
 * Spec: docs/superpowers/specs/2026-07-21-sop-notifications-design.md
 */

import type { PendingNotification, SopEmailContent } from "@/domain/sop/notifications";
import { getBearerToken } from "@/lib/api-auth";

/** After this many attempts an unsent row is dead — visible, never retried. */
export const MAX_SEND_ATTEMPTS = 3;

/** Cron caller auth: constant bearer, set by Vercel Cron when CRON_SECRET exists. */
export function isAuthorizedCronRequest(request: Request): boolean {
  const secret = process.env.CRON_SECRET ?? "";
  if (!secret) return false;
  return getBearerToken(request) === secret;
}

export type EmailSendResult =
  | { ok: true; id: string }
  | { ok: false; status: number; error: string; permanent: boolean };

export type EmailSender = (to: string, content: SopEmailContent) => Promise<EmailSendResult>;

/** Plain fetch to Resend — deliberately no SDK (zero new dependencies). */
export function createResendSender(apiKey: string, from: string): EmailSender {
  return async (to, content) => {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject: content.subject, text: content.text, html: content.html }),
    });
    if (response.ok) {
      const body = (await response.json().catch(() => ({}))) as { id?: string };
      return { ok: true, id: body.id ?? "" };
    }
    const error = await response.text().catch(() => "");
    // 4xx (except 429) is a permanent rejection — a bounce-shaped failure we
    // must not retry. 429 and 5xx are transient.
    const permanent = response.status >= 400 && response.status < 500 && response.status !== 429;
    return { ok: false, status: response.status, error: error.slice(0, 500), permanent };
  };
}

export interface DrainItem {
  pending: PendingNotification;
  email: string | null;
  content: SopEmailContent;
}

export interface RetryItem {
  ledgerId: number;
  email: string | null;
  content: SopEmailContent;
  attempts: number;
}

export interface DrainBatch {
  items: DrainItem[];
  /** Health signal: age of the oldest event still owed a notification. */
  oldestUnnotifiedEventAgeHours: number | null;
}

export interface DrainStore {
  /** Scan events + reminders, resolve recipients, render emails. Read-only. */
  collect(now: Date, origin: string): Promise<DrainBatch>;
  /** Claimed-but-unsent rows past the lease, below the attempt cap. */
  retryItems(now: Date, origin: string): Promise<RetryItem[]>;
  /** Insert the ledger row; a unique-index conflict returns claimed:false. */
  claim(pending: PendingNotification): Promise<{ claimed: boolean; ledgerId: number | null }>;
  markSent(ledgerId: number, messageId: string): Promise<void>;
  markFailed(ledgerId: number, error: string, attemptsAfter: number): Promise<void>;
}

export interface DrainReport {
  configured: boolean;
  sent: number;
  retried: number;
  skippedDuplicate: number;
  skippedNoEmail: number;
  failed: number;
  oldestUnnotifiedEventAgeHours: number | null;
}

export async function runSopNotificationDrain(deps: {
  store: DrainStore;
  send: EmailSender | null;
  now: () => Date;
  origin: string;
}): Promise<DrainReport> {
  const { store, send } = deps;
  const batch = await store.collect(deps.now(), deps.origin);
  const report: DrainReport = {
    configured: send !== null,
    sent: 0,
    retried: 0,
    skippedDuplicate: 0,
    skippedNoEmail: 0,
    failed: 0,
    oldestUnnotifiedEventAgeHours: batch.oldestUnnotifiedEventAgeHours,
  };
  // Unconfigured: report what WOULD send (and the age signal) but claim nothing,
  // so a later configured drain still owns every send.
  if (!send) return report;

  for (const item of batch.items) {
    if (!item.email) {
      // No claim: the notification stays pending and resolves itself the day
      // the profile gains an address.
      report.skippedNoEmail += 1;
      continue;
    }
    const { claimed, ledgerId } = await store.claim(item.pending);
    if (!claimed || ledgerId === null) {
      report.skippedDuplicate += 1;
      continue;
    }
    const outcome = await attemptSend(store, send, ledgerId, item.email, item.content, 0);
    if (outcome === "sent") report.sent += 1;
    else report.failed += 1;
  }

  for (const retry of await store.retryItems(deps.now(), deps.origin)) {
    if (retry.attempts >= MAX_SEND_ATTEMPTS) continue;
    if (!retry.email) {
      report.skippedNoEmail += 1;
      continue;
    }
    const outcome = await attemptSend(store, send, retry.ledgerId, retry.email, retry.content, retry.attempts);
    if (outcome === "sent") report.retried += 1;
    else report.failed += 1;
  }

  return report;
}

async function attemptSend(
  store: DrainStore,
  send: EmailSender,
  ledgerId: number,
  email: string,
  content: SopEmailContent,
  priorAttempts: number,
): Promise<"sent" | "failed"> {
  try {
    const result = await send(email, content);
    if (result.ok) {
      await store.markSent(ledgerId, result.id);
      return "sent";
    }
    // Permanent rejections jump straight to the cap: dead row, never retried.
    const attemptsAfter = result.permanent ? MAX_SEND_ATTEMPTS : priorAttempts + 1;
    await store.markFailed(ledgerId, `${result.status}: ${result.error}`, attemptsAfter);
    return "failed";
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unexpected send error";
    await store.markFailed(ledgerId, message, priorAttempts + 1);
    return "failed";
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/sop/notifications-drain.test.ts`
Expected: PASS. (POST-caller auth is `requireApiUser`, already covered by `src/lib/api-auth.test.ts` — do not re-test it here.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/sop/notifications-drain.ts src/lib/sop/notifications-drain.test.ts
git commit -m "feat(sop): notification drain loop, cron auth, Resend sender"
```

---

### Task 6: Supabase store + drain route

**Files:**
- Create: `src/lib/sop/notifications-store.ts`
- Create: `app/api/sops/notifications/drain/route.ts`

**Interfaces:**
- Consumes: `DrainStore`, `DrainBatch`, `DrainItem`, `RetryItem`, `MAX_SEND_ATTEMPTS`, `isAuthorizedCronRequest`, `createResendSender`, `runSopNotificationDrain` (Task 5); domain resolvers + templates (Tasks 2–4); `requireApiUser`, `createApiRateLimiter` from `@/lib/api-auth`.
- Produces: `function createSopNotificationDrainStore(admin: SupabaseClient<Database>): DrainStore`; route handlers `GET` (cron) and `POST` (kick) at `/api/sops/notifications/drain`.

This is the integration layer — no unit test (verified live in Task 8); correctness pressure sits in the domain and drain-loop tests. Keep every query batched (`.in(...)`), never per-SOP loops.

- [ ] **Step 1: Implement the store**

Create `src/lib/sop/notifications-store.ts`:

```ts
/**
 * Supabase-backed DrainStore: assembles plain-value contexts for the domain
 * resolvers and owns every read/write against sop_notifications. Service-role
 * only — this module must ONLY ever be constructed inside the drain route.
 * All queries are batched by id set; the working set is bounded by the 30-day
 * event window plus currently in-flight (in_review/approved) SOPs.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  MAX_REMINDERS,
  REMINDER_AFTER_DAYS,
  SOP_NOTIFIABLE_EVENT_TYPES,
  renderSopNotificationEmail,
  resolveEventRecipients,
  resolveReminders,
  type NotifiableEvent,
  type PendingNotification,
  type QualityApproverSnapshot,
  type ReminderLedgerRow,
  type SeatSnapshot,
  type SopNotificationContext,
  type SopNotificationKind,
  type SopReminderState,
  type SopSnapshot,
} from "@/domain/sop/notifications";
import {
  MAX_SEND_ATTEMPTS,
  type DrainBatch,
  type DrainItem,
  type DrainStore,
  type RetryItem,
} from "./notifications-drain";

const EVENT_WINDOW_DAYS = 30;
const RETRY_LEASE_MINUTES = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

const SOP_COLUMNS =
  "id, workspace_id, title, sop_number, version, status, deleted_at, created_by, submitted_by, " +
  "content_hash, final_approval_requested_at, final_approval_content_hash, rejected_reason, " +
  "review_cycle, approved_at, department_id";

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
  department_id: string | null;
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
  emailByUser: Map<string, string | null>;
}

export function createSopNotificationDrainStore(admin: SupabaseClient<Database>): DrainStore {
  async function loadContext(sopIds: string[]): Promise<SopContextBundle> {
    const bundle: SopContextBundle = {
      sops: new Map(),
      seatsBySop: new Map(),
      qualityApproversBySop: new Map(),
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

    const [seatsResult, departmentsResult] = await Promise.all([
      admin.from("sop_review_seats").select("sop_id, department_id, rasic, signer_id").in("sop_id", foundIds),
      admin.from("departments").select("id, workspace_id, name, is_quality_gate").in("workspace_id", workspaceIds),
    ]);
    if (seatsResult.error) throw new Error(seatsResult.error.message);
    if (departmentsResult.error) throw new Error(departmentsResult.error.message);

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

      // 3) In-flight SOPs for the reminder scan.
      const { data: inFlightRows, error: inFlightError } = await admin
        .from("sops")
        .select(SOP_COLUMNS)
        .in("status", ["in_review", "approved"])
        .is("deleted_at", null);
      if (inFlightError) throw new Error(inFlightError.message);
      const inFlight = (inFlightRows ?? []) as SopRow[];

      const sopIds = Array.from(new Set([...events.map((event) => event.sopId), ...inFlight.map((sop) => sop.id)]));
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
      const inFlightIds = inFlight.map((sop) => sop.id);
      const [submissions, deptApprovals, reviewSentEvents, reminderRows] = await Promise.all([
        inFlightIds.length
          ? admin.from("sop_review_submissions").select("sop_id, reviewer_id, review_cycle").in("sop_id", inFlightIds)
          : Promise.resolve({ data: [], error: null }),
        inFlightIds.length
          ? admin
              .from("sop_signatures")
              .select("sop_id, signer_id, seat_department_id, review_cycle, signed_content_hash")
              .in("sop_id", inFlightIds)
              .eq("meaning", "dept_approval")
          : Promise.resolve({ data: [], error: null }),
        inFlightIds.length
          ? admin
              .from("sop_event_log")
              .select("sop_id, review_cycle, created_at")
              .in("sop_id", inFlightIds)
              .eq("event_type", "review_sent")
              .order("created_at", { ascending: true })
          : Promise.resolve({ data: [], error: null }),
        inFlightIds.length
          ? admin
              .from("sop_notifications")
              .select("sop_id, recipient_id, kind, reminder_index, sent_at")
              .in("sop_id", inFlightIds)
              .is("event_id", null)
              .not("sent_at", "is", null)
          : Promise.resolve({ data: [], error: null }),
      ]);
      for (const result of [submissions, deptApprovals, reviewSentEvents, reminderRows]) {
        if (result.error) throw new Error(result.error.message);
      }

      const reviewSentAtBySop = new Map<string, string>();
      for (const row of reviewSentEvents.data ?? []) {
        const sop = bundle.sops.get(row.sop_id);
        // Ascending order: the last write per (sop, current cycle) wins = latest.
        if (sop && row.review_cycle === sop.review_cycle) reviewSentAtBySop.set(row.sop_id, row.created_at);
      }

      const states: SopReminderState[] = inFlight.flatMap((sop) => {
        const ctx = contextFor(bundle, sop.id);
        if (!ctx) return [];
        return [
          {
            sop: ctx.sop,
            seats: ctx.seats,
            qualityApprovers: ctx.qualityApprovers,
            currentReviewReturns: (submissions.data ?? [])
              .filter((row) => row.sop_id === sop.id && row.review_cycle === sop.review_cycle)
              .map((row) => row.reviewer_id),
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
              sent_at: string;
            }[])
              .filter((row) => row.sop_id === sop.id)
              .map(
                (row): ReminderLedgerRow => ({
                  recipientId: row.recipient_id,
                  kind: row.kind as SopNotificationKind,
                  reminderIndex: row.reminder_index,
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
      const lease = new Date(now.getTime() - RETRY_LEASE_MINUTES * 60 * 1000).toISOString();
      const { data, error } = await admin
        .from("sop_notifications")
        .select("id, sop_id, recipient_id, kind, reminder_index, attempts")
        .is("sent_at", null)
        .lt("attempts", MAX_SEND_ATTEMPTS)
        .lt("created_at", lease);
      if (error) throw new Error(error.message);
      const rows = data ?? [];
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
          },
          origin,
          "Pulse",
          row.reminder_index > 0 ? row.reminder_index * REMINDER_AFTER_DAYS : null,
        );
        if (!item) return [];
        return [{ ledgerId: Number(row.id), email: item.email, content: item.content, attempts: row.attempts }];
      });
    },

    async claim(pending) {
      const { data, error } = await admin
        .from("sop_notifications")
        .insert({
          sop_id: pending.sopId,
          recipient_id: pending.recipientId,
          kind: pending.kind,
          event_id: pending.eventId,
          reminder_index: pending.reminderIndex,
        })
        .select("id")
        .single();
      if (error) {
        if (error.code === "23505") return { claimed: false, ledgerId: null };
        throw new Error(error.message);
      }
      return { claimed: true, ledgerId: Number(data.id) };
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
        .update({ attempts: attemptsAfter, last_error: message.slice(0, 1000) })
        .eq("id", ledgerId);
      if (error) throw new Error(error.message);
    },
  };
}
```

- [ ] **Step 2: Implement the route**

Create `app/api/sops/notifications/drain/route.ts`:

```ts
/**
 * SOP notification drain. GET = Vercel Cron (CRON_SECRET bearer, attached
 * automatically by Vercel once the env var exists). POST = the browser kick
 * after an SOP mutation — any signed-in user, because the drain is idempotent:
 * over-kicking can only produce skips, never duplicate email.
 * Degrades like app/api/invites: missing secrets report, never crash.
 */

import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createApiRateLimiter, requireApiUser } from "@/lib/api-auth";
import {
  createResendSender,
  isAuthorizedCronRequest,
  runSopNotificationDrain,
} from "@/lib/sop/notifications-drain";
import { createSopNotificationDrainStore } from "@/lib/sop/notifications-store";
import type { Database } from "@/lib/database.types";

const kickRateLimit = createApiRateLimiter({ windowMs: 60_000, maxRequests: 6 });

async function drain(request: Request): Promise<NextResponse> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ configured: false, reason: "SUPABASE_SERVICE_ROLE_KEY missing." });
  }

  const admin = createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const resendApiKey = process.env.RESEND_API_KEY ?? "";
  const resendFrom = process.env.RESEND_FROM ?? "";

  try {
    const report = await runSopNotificationDrain({
      store: createSopNotificationDrainStore(admin),
      send: resendApiKey && resendFrom ? createResendSender(resendApiKey, resendFrom) : null,
      now: () => new Date(),
      origin: new URL(request.url).origin,
    });
    return NextResponse.json(report);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Drain failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  return drain(request);
}

export async function POST(request: Request) {
  const { userId, failure } = await requireApiUser(request);
  if (failure) return failure;
  if (!kickRateLimit(userId)) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }
  return drain(request);
}
```

- [ ] **Step 3: Gate**

Run: `npm run typecheck && npm run lint && npm run test`
Expected: all green. (If `sop_notifications` types are missing, Task 1 Step 4 was skipped — go back.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/sop/notifications-store.ts app/api/sops/notifications/drain/route.ts
git commit -m "feat(sop): drain route (cron GET + kick POST) and supabase drain store"
```

---

### Task 7: The kick — helper + four call sites

**Files:**
- Create: `src/lib/sop/notify-kick.ts`
- Modify: `src/lib/sop/review.ts` — inside `signSop` (~line 204), `requestSopFinalApproval` (~line 154), `transitionSop` (~line 440)
- Modify: `src/lib/sop/review-annotations.ts` — inside `submitSopReviewResult` (~line 99)

**Interfaces:**
- Consumes: the drain route (Task 6).
- Produces: `function kickSopNotifications(): void` — fire-and-forget; safe to call anywhere (no-ops off-browser).

- [ ] **Step 1: Implement the helper**

Create `src/lib/sop/notify-kick.ts`:

```ts
/**
 * Fire-and-forget nudge to the notification drain after an SOP mutation, so
 * first-touch email lands in seconds instead of at the next daily cron. The
 * drain is idempotent — a failed or duplicate kick costs nothing, which is why
 * this swallows every error. Browser-only by construction (matches the
 * createPlannerSupabaseClient contract of its callers).
 */
export function kickSopNotifications(): void {
  if (typeof window === "undefined") return;
  void fetch("/api/sops/notifications/drain", { method: "POST" }).catch(() => {
    // Intentionally silent: the daily cron is the delivery guarantee.
  });
}
```

- [ ] **Step 2: Wire the four call sites**

In `src/lib/sop/review.ts`, add the import at the top:

```ts
import { kickSopNotifications } from "./notify-kick";
```

In `signSop`, after the `throwIfError(...)` resolves and before `return String(value);`:

```ts
  kickSopNotifications();
  return String(value);
```

In `requestSopFinalApproval`, after the `await throwIfError(...)` line:

```ts
  await throwIfError(supabase.rpc("request_sop_final_approval", { p_sop: sopId }));
  kickSopNotifications();
```

In `transitionSop`, after the conflict check and before `return mapControl(...)`:

```ts
  if (!updated) throw new SopConflictError();
  kickSopNotifications();
  return mapControl(updated as unknown as Record<string, unknown>);
```

In `src/lib/sop/review-annotations.ts`, add the same import, then in `submitSopReviewResult` before `return String(data);`:

```ts
  kickSopNotifications();
  return String(data);
```

- [ ] **Step 3: Gate**

Run: `npm run typecheck && npm run lint && npm run test`
Expected: all green — the kick changes no return values and no control flow on the error path (it runs only after success).

- [ ] **Step 4: Commit**

```bash
git add src/lib/sop/notify-kick.ts src/lib/sop/review.ts src/lib/sop/review-annotations.ts
git commit -m "feat(sop): kick the notification drain after sign/submit/transition"
```

---

### Task 8: Cron config, env, full gate, live verification

**Files:**
- Create: `vercel.json`

**Interfaces:**
- Consumes: everything above.
- Produces: a scheduled daily drain in production; verified end-to-end feature.

- [ ] **Step 1: Create `vercel.json`**

```json
{
  "crons": [{ "path": "/api/sops/notifications/drain", "schedule": "0 13 * * *" }]
}
```

Daily at 13:00 UTC (morning US) — Hobby-plan-compatible; the kick covers first-touch latency.

- [ ] **Step 2: Environment variables**

Ask your human partner to set (Vercel Production + local `.env.local`):
- `CRON_SECRET` — any long random string; Vercel Cron attaches it automatically.
- `RESEND_API_KEY` — from the Resend dashboard.
- `RESEND_FROM` — e.g. `Pulse <notifications@theirdomain.com>` — **the domain must be verified in Resend with SPF/DKIM first; this gates go-live** (unverified domains get spam-foldered and the feature silently fails its purpose).

Local dev works without any of these: the drain reports `configured: false`.

- [ ] **Step 3: Full gate**

Run: `npm run typecheck && npm run lint && npm run test && npm run build`
Expected: all green.

- [ ] **Step 4: Live verification (CLAUDE.md rule 6)**

Using the preview browser against the dev server:
1. Drive a real SOP: submit for review → confirm a `review_sent` event row exists.
2. `POST /api/sops/notifications/drain` signed in (or `curl -X GET -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/sops/notifications/drain`).
3. Without Resend configured: expect `{"configured": false, ...}` and **zero** `sop_notifications` rows (unconfigured never claims).
4. With a test `RESEND_API_KEY` in `.env.local`: expect `sent >= 1`, ledger rows with `sent_at` stamped and `resend_message_id` set, and the email in the Resend dashboard/test inbox.
5. Sign a review returning remarks → kick fires → author gets `sent_back`. Verify in the ledger.
6. Confirm the auth matrix live: GET without bearer → 401; GET with wrong bearer → 401.

- [ ] **Step 5: Commit and finish the branch**

```bash
git add vercel.json
git commit -m "feat(sop): daily notification drain cron"
```

Then run the full branch-finish flow (CI green → merge to main per repo process). Use superpowers:finishing-a-development-branch.
