# Workspace Welcome Email — Design

**Date:** 2026-07-22
**Status:** Draft (pending user review of design + spec together)
**Problem:** Nobody tells a new member they've landed in a workspace. Invited
users get Supabase's magic-link auth email, but no "you're in, here's Pulse"
welcome; domain auto-joiners and manually-added members get nothing at all.

## Decisions

1. **Audience: the added member only** (user-confirmed). No admin/owner
   notifications, no all-members announcements.
2. **Channel: email only.** The bell deliberately shows only *actionable*
   items (spec 2026-07-22-sop-notification-bell); a welcome is informational
   and stays out of it.
3. **Every add path is covered, including auto-join.** An auto-joiner chose to
   sign up but didn't choose the workspace — the welcome tells them where they
   landed and gives them the entry link. Wording adapts: a named actor when an
   admin added them, "via your company email domain" when there is none.
4. **One-shot.** No reminders, ever.

## Architecture — second source on the existing notification drain

The shipped pipeline separates facts → decisions → effects. This feature adds
one of each and reuses the rest (drain loop, Resend sender, cron, kick
pattern, branded template layout):

- **Fact source (exists already):** `audit_log` rows with
  `action = 'workspace_members.insert'` — written transactionally by the
  `audit_access_change` trigger (migration `20260703120000`, lines 139-190)
  for every add path: invite redemption, domain auto-join, manual add, re-add
  after removal. `target_id` is the added user's id; `details.new` carries the
  member-row snapshot (role); `actor_id`/`actor_email` identify who did it
  (null for self-caused paths).
- **Ledger (new):** `workspace_notifications` — a clone of the
  `sop_notifications` pattern, NOT a modification of it (`sop_notifications`
  has `sop_id NOT NULL` and a kind CHECK; leaving a shipped table untouched is
  a feature):

```sql
create table public.workspace_notifications (
  id                 bigint generated always as identity primary key,
  workspace_id       text not null references public.workspaces(id) on delete cascade,
  recipient_id       uuid not null references auth.users(id) on delete cascade,
  kind               text not null check (kind = 'workspace_welcome'),
  event_id           bigint not null references public.audit_log(id) on delete cascade,
  sent_at            timestamptz,
  attempts           integer not null default 0,
  last_error         text,
  resend_message_id  text,
  created_at         timestamptz not null default now()
);
create unique index workspace_notifications_event_recipient_key
  on public.workspace_notifications(event_id, recipient_id);
create index workspace_notifications_unsent_idx
  on public.workspace_notifications(created_at) where sent_at is null;
alter table public.workspace_notifications enable row level security;
revoke all on public.workspace_notifications from anon, authenticated;
```

  RLS posture identical to `sop_notifications`: zero policies, service-role
  only. Idempotency anchors on `(event_id, recipient_id)` — each membership
  insert is a fresh audit row, so re-adds correctly notify again.
- **Decisions (new, pure):** `src/domain/workspace/welcome.ts` + colocated
  test:
  - `parseMemberAddedEvent(row: unknown)` — defensive narrowing of the audit
    row (`action`, `target_id` as uuid, `workspace_id`, `details.new.role`,
    `actor_id`); unparseable → null, never throw.
  - `resolveWorkspaceWelcome(event, ctx)` — recipient = the added user, with
    skip-unless-now guards: recipient **still a member** of that workspace at
    drain time (an immediate removal self-cancels), workspace still exists.
    Actor never equals recipient in the admin-add path; when `actor_id` is
    null OR equals the recipient (auto-join), the template switches to the
    domain wording.
  - `renderWorkspaceWelcomeEmail(input)` — same branded card layout as the SOP
    templates (Pulse wordmark, white card, squared 4px, footer). Subject:
    `Welcome to {workspaceName} on Pulse`. Body: one sentence of what happened
    ("{actorName} added you to {workspaceName}." / "You joined {workspaceName}
    via your company email domain."), one sentence of what Pulse is for at
    Anacorp, button "Open Pulse" → `{origin}/`. Footer reason: "You are
    receiving this because you were added to this workspace."
- **Effects (extended):** the drain route's store gains a
  `src/lib/workspace/welcome-store.ts` collect phase producing the same
  `DrainItem` shape the send loop already consumes; `runSopNotificationDrain`
  is already source-agnostic (items in, claims/sends/stamps out). The claim
  writes to `workspace_notifications`; retry lane and health-signal mechanics
  are shared. 30-day event lookback, same as SOP events.
- **Latency:** kicks after the two client-side add paths
  (`ensureDefaultWorkspaceMembership` auto-join; the members-settings add
  flow), reusing `kickSopNotifications()` (rename-in-place is out of scope —
  the drain it kicks now serves both sources). Invite redemptions that happen
  inside sign-in flows are caught by the next kick from anyone or the daily
  cron at worst.

## Rejected alternatives

- **Inline send at each add path** — three call sites (one inside a DB
  function), loses events on tab close, misses future paths. Same rejection
  as the SOP feature's option B.
- **Generalizing `sop_notifications`** — relaxing `sop_id` nullability and
  the kind CHECK on a shipped, live table for zero user-visible gain.
- **Admin "X joined" notifications** — explicitly declined by the user.
- **Bell entry** — violates the bell's actionable-only semantics.

## Error handling

Inherited wholesale from the drain: per-item try/catch, transient vs permanent
(4xx) failure handling, attempts cap 3, lease-based retry, missing
`profiles.email` → skip-without-claim, unconfigured → report-only. New guards:
member removed before drain → skip (never claim); malformed audit `details` →
skip + count, never throw.

## Testing

- `src/domain/workspace/welcome.test.ts`: parse (valid row, malformed
  details, non-member-insert actions filtered); guards (removed member,
  missing workspace); actor vs auto-join wording; template subject/body/link
  exact-string checks; escaping of workspace/actor names.
- Drain-loop and claim semantics already tested (SOP feature); the new store
  phase is integration, verified live: add a member (or re-add a test user)
  → welcome lands; auto-join wording verified by inspecting the rendered
  template in tests (a live auto-join needs a fresh domain signup — not
  required for go-live).
- Full gate + CI; live verification per CLAUDE.md rule 6.

## YAGNI cuts

- No admin/member announcements; no bell integration; no reminders; no
  per-workspace or per-user opt-out; no digest; no notification history UI;
  no backfill of pre-feature members (only events after ship notify).
