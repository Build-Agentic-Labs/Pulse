# Notification System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan is executed inline by its author in the same session; each task lists its test contract (names + assertions) rather than duplicating every code block.

**Goal:** Turn the SOP transactional-email kernel into an enterprise-grade notification system per `docs/audits/2026-09-04-notification-systems-audit.md` §4 (Phases 0–2), test-first, on branch `feat/notification-system`, never merged or applied to production without the user's verification.

**Architecture:** Keep the outbox → decisions → ledger → effects shape. Add (a) new decisions (author stalls, release, objections, reassignment, membership, escalation, weekly digest), (b) a channel-independent `notifications` inbox written before any delivery, (c) preferences + suppressions consulted by the drain, (d) delivery tracking via Resend webhooks, (e) a run log + health endpoint, (f) Teams and web-push channels, (g) an admin console. All decisions stay pure in `src/domain/`; all I/O behind stores with an injected client; every table is RLS-first.

**Tech Stack:** Next.js 16 App Router, Supabase (Postgres + RLS, pgTAP), React 19, Vitest, Resend REST, Svix-style webhook signatures (Node crypto), Web Push (RFC 8291/8292 via Node crypto — no new dependencies).

## Global Constraints

- **No new npm dependencies** (lockfile policy in CLAUDE.md; the sender is plain `fetch`).
- **Migrations are additive only**; never rewrite `enforce_sop_transition` / `sign_sop`; new events come from NEW trigger functions calling the live `append_sop_event(p_sop, p_event_type, p_details)`.
- **Migrations are NOT applied to production in this branch.** `src/lib/database.types.ts` is hand-extended to match; `npm run gen:types` after the user applies them.
- **Ledgers stay service-role only** (RLS on, zero policies, grants only to `service_role`/`postgres`). The inbox and preferences are the only user-readable notification tables.
- **Server reads are read-only**; writes happen in route handlers or client effects.
- **Design language:** squared 4px/6px geometry, no pills, page-scoped CSS files, never `globals.css`.
- **Emails:** inline-styled table layout via `renderEmailShell`; retries must be byte-identical (content snapshot on the ledger row).
- **Idempotency:** every Resend POST carries `Idempotency-Key: <ledger>:<row id>`.
- **Naming:** notification kinds are snake_case nouns of what happened to the recipient (`review_complete`, `released`, `seat_assigned`, `objection_raised`, `objection_resolved`, `remark_added`, `stall_escalated`, `invite_accepted`, `role_changed`, `member_removed`, `stalled_weekly`).

---

## File map

**Migrations (`supabase/migrations/`)**
- `20260905100000_notification_core.sql` — SOP ledger: kind CHECK extended, `review_cycle`, `content`, `skipped_reason`; reminder unique index includes `review_cycle`; workspace ledger: kind CHECK extended, `content`, `skipped_reason`; `notification_drain_runs`; `notification_digests`; triggers `log_sop_signature_event` (→ `signature_added`) and `log_sop_seat_reassignment_event` (→ `seat_reassigned`).
- `20260905101000_notifications_inbox.sql` — `notifications` (user inbox, RLS: own rows; update limited to `read_at`), `notification_preferences` (own rows).
- `20260905102000_email_deliveries.sql` — `email_deliveries`, `email_suppressions`, `transactional_emails` (service-role only).
- `20260905103000_workspace_integrations.sql` — `workspace_integrations` (managers CRUD via `has_workspace_role`), `push_subscriptions` (own rows).
- `supabase/tests/notifications_test.sql` — pgTAP for every posture above + the two new triggers.

**Domain (`src/domain/`)**
- `sop/notifications.ts` — decisions; extended kinds, cycle-aware reminders, `review_complete`, `released`, `seat_assigned`, `objection_*`, `remark_added`, escalation.
- `sop/notification-templates.ts` — `renderSopNotificationEmail` moved here + new templates.
- `notifications/channels.ts` — kind catalog, default channel matrix, `resolveEmailEnabled`.
- `notifications/inbox.ts` — `describeNotification` (kind → title/body/link).
- `notifications/health.ts` — `assessRunFreshness`.
- `notifications/webhook-signature.ts` — Svix HMAC verification.
- `notifications/resend-webhook.ts` — payload parsing → deliveries/suppressions.
- `notifications/digest.ts` — stalled-work digest decisions + template.
- `notifications/teams-card.ts` — Adaptive Card payload.
- `notifications/web-push.ts` — VAPID JWT + aes128gcm payload encryption.
- `workspace/membership-notifications.ts` — `invite_accepted`, `role_changed`, `member_removed` decisions + templates.
- `sop/queue-summary.ts` + `lib/sop/review-queue-data.ts` — `readyForFinalApproval` section.

**Lib (`src/lib/`)**
- `sop/notifications-drain.ts` — idempotency key, `skipped_reason`, channel fan-out, dead-row health.
- `sop/notifications-store.ts` — cycle + content on claim, preferences/suppression lookups, inbox writes, escalation context.
- `workspace/welcome-store.ts` — membership kinds.
- `notifications/drain-runs-store.ts`, `digest-store.ts`, `inbox-store.ts`, `preferences-store.ts`, `transactional-log.ts`, `integrations-store.ts`, `teams-sender.ts`, `push-store.ts`, `run-drain-request.ts` (route core, testable).

**Routes (`app/api/`)**
- `sops/notifications/drain/route.ts` (thin), `notifications/health/route.ts`, `webhooks/resend/route.ts`, `notifications/admin/route.ts`, `notifications/push/route.ts`.

**UI (`src/components/`)**
- `notification-bell.tsx` (+ inbox section, mark read), `notification-preferences-settings.tsx`, `notification-admin-settings.tsx`, `sop/review-queue.tsx` (+ section), `public/pulse-push-sw.js`.

**Docs**
- `docs/runbooks/notifications.md`, `docs/audits/2026-09-04-notification-systems-audit-followup.md`.

---

## Phase 0 — stop the bleeding

### Task 1: Core migration + pgTAP + types

**Files:** create `supabase/migrations/20260905100000_notification_core.sql`, `supabase/tests/notifications_test.sql`; modify `src/lib/database.types.ts`.

**Produces:** columns `sop_notifications.review_cycle int not null default 0`, `.content jsonb`, `.skipped_reason text`; `workspace_notifications.content jsonb`, `.skipped_reason text`; tables `notification_drain_runs(id, caller check in ('cron','kick'), started_at, finished_at, healthy bool, problems text[], report jsonb)`, `notification_digests(id, workspace_id, recipient_id, kind check ('stalled_weekly'), period_key, content, sent_at, attempts, last_error, last_attempt_at, resend_message_id, skipped_reason, created_at, unique(workspace_id, recipient_id, kind, period_key))`; events `signature_added {meaning, signer_id, seat_department_id, review_cycle, rejected_reason, resolves_signature_id}` and `seat_reassigned {department_id, from_signer_id, to_signer_id}`.

- [ ] pgTAP asserts: authenticated cannot select ledgers/runs/digests (permission denied); inserting a `sop_signatures` row appends a `signature_added` event carrying `meaning`; updating `sop_review_seats.signer_id` appends `seat_reassigned` with both ids; reminder unique index includes `review_cycle` (two rows same key, different cycle both insert).
- [ ] Migration written; `npm run typecheck` green after types edit.
- [ ] Commit `feat(notifications): core ledger columns, run log, digest ledger, signature/seat events`.

### Task 2: Cycle-aware reminders + `review_complete` decisions

**Files:** modify `src/domain/sop/notifications.ts`, `src/domain/sop/notifications.test.ts`; create `src/domain/sop/notification-templates.ts` (+ test).

**Produces:** `PendingNotification.reviewCycle: number`; `ReminderLedgerRow.reviewCycle`; `SopReminderState.openAnnotationCount: number`, `.lastReviewReturnedAt: string | null`, `.lastSentBackAt: string | null`, `.workspaceManagers: string[]`; `SopNotificationKind` += `review_complete`; `resolveEventRecipients` handles `review_returned` → `review_complete` for the author when every blocking seat with a signer has returned this cycle and `openAnnotationCount === 0`; `resolveReminders` nudges authors on `review_complete` and `sent_back`; `renderSopNotificationEmail` moved to templates with `review_complete` copy.

- [ ] Tests (RED): "cycle 2 gets its own reminders after cycle 1 exhausted"; "review_returned with every blocking seat responded emails the author review_complete"; "review_returned with a seat still waiting emails nobody"; "open annotations hold review_complete"; "author reminders: review_complete after 3 days, sent_back after 3 days, capped at 2"; template subject `Ready for final approval: SOP-0042 "Line Clearance"`.
- [ ] Implement; all domain tests green; commit.

### Task 3: Store writes cycle + content; idempotent sender; stored-content retries

**Files:** modify `src/lib/sop/notifications-drain.ts` (+test), `src/lib/sop/notifications-store.ts` (+ new test), `src/lib/workspace/welcome-store.ts` (+test).

**Produces:** `EmailSender = (to, content, options: { idempotencyKey: string }) => Promise<EmailSendResult>`; `DrainStore.ledger: "sop" | "workspace" | "digest"`; `DrainStore.claim(pending, content)`; `RetryItem.content` comes from the stored snapshot; `createResendSender` sends header `Idempotency-Key`; `SopNotificationContext.openAnnotationCount` assembled from `sop_review_annotations` (`resolved_at is null`, current cycle).

- [ ] Tests (RED): sender puts `Idempotency-Key` on the request; drain passes `${store.ledger}:${ledgerId}` to send on first-touch and retry; store `claim` inserts `review_cycle` and `content`; `retryItems` returns the stored content untouched.
- [ ] Implement; commit.

### Task 4: Run log, health endpoint, dead rows, constant-time secret

**Files:** create `src/lib/notifications/drain-runs-store.ts` (+test), `src/domain/notifications/health.ts` (+test), `src/lib/notifications/run-drain-request.ts` (+test), `app/api/notifications/health/route.ts`; modify `app/api/sops/notifications/drain/route.ts`, `src/lib/sop/notifications-drain.ts`.

**Produces:** `recordDrainRun(admin, run: DrainRunInput)`, `latestDrainRuns(admin, limit)`; `assessRunFreshness(now, runs, { cronMaxAgeHours: 26 })`; `runDrainRequest({ caller, admin, send, now, origin, includeDigests })` returning `{ status, body }`; `DrainStore.deadRows?(now)`; `DrainReport.dead`; health flags `dead > 0`; `isAuthorizedCronRequest` uses `timingSafeEqual`.

- [ ] Tests (RED): runs store inserts the shape; freshness: no cron run in 26h → unhealthy "cron silent"; latest run unhealthy → unhealthy; `runDrainRequest` returns 503 + records a run when unhealthy, 200 otherwise, and never throws when a store fails (reports `error` for that store); secret compare rejects wrong-length and wrong-value tokens.
- [ ] Implement; commit.

### Task 5: "Ready for final approval" in queue data, bell, review page

**Files:** modify `src/lib/sop/review-queue-data.ts`, `src/domain/sop/queue-summary.ts` (+test), `src/components/sop/review-queue.tsx`, `src/components/notification-bell.tsx`.

**Produces:** `QueueData.readyForFinalApproval: SopListItem[]` — SOPs I authored, `in_review`, final phase not active, every blocking seat with a signer has a current-cycle submission, zero unresolved current-cycle annotations; pure `selectReadyForFinalApproval(input)` in `src/domain/sop/queue-ready.ts` (+test); bell section key `readyForFinalApproval` label "Ready for final approval"; queue page section with CTA to the editor.

- [ ] Tests (RED): domain selector cases; summary includes the section and counts it.
- [ ] Implement; commit. **UI change** (report to user).

---

## Phase 1 — a notification core

### Task 6: Inbox + preferences + deliveries + integrations migrations, types, pgTAP

**Files:** create the three remaining migrations; extend `supabase/tests/notifications_test.sql`; modify `src/lib/database.types.ts`.

**Produces:** `notifications(id, recipient_id, workspace_id, source check('sop','workspace','digest'), source_ledger_id, kind, entity_type, entity_id, title, body, link, delivered_channels jsonb default '{}', created_at, read_at)`; `notification_preferences(user_id, workspace_id text default '' , kind, channel check('email','teams','push'), mode check('immediate','off'), updated_at, pk(user_id, workspace_id, kind, channel))`; `email_deliveries(id, webhook_event_id unique, resend_message_id, event_type, recipient_email, occurred_at, payload)`; `email_suppressions(email pk, reason, source_message_id, created_at)`; `transactional_emails(id, kind, recipient_email, recipient_id, workspace_id, resend_message_id, status check('sent','failed'), error, created_at)`; `workspace_integrations(workspace_id, kind check('teams_webhook'), config jsonb, enabled, updated_by, updated_at, pk(workspace_id, kind))`; `push_subscriptions(endpoint pk, user_id, p256dh, auth, user_agent, created_at)`; RPC `mark_notifications_read(p_ids bigint[])` + `mark_all_notifications_read(p_workspace text)`.

- [ ] pgTAP: user reads only own inbox rows; cannot update `title`; RPC marks read; preferences own-only; deliveries/suppressions/transactional denied to authenticated; integrations readable/writable by owner/admin only; push subscriptions own-only.
- [ ] Commit.

### Task 7: Channel matrix, inbox rows, skips for preference/suppression

**Files:** create `src/domain/notifications/channels.ts` (+test), `src/domain/notifications/inbox.ts` (+test); modify drain, sop store, welcome store, tests.

**Produces:** `NOTIFICATION_KINDS` catalog with labels + `defaultEmail: boolean` (`remark_added` false, everything else true); `resolveEmailEnabled(kind, rows: PreferenceRow[])`; `describeNotification(kind, ctx): { title, body, link, entityType, entityId }`; `DrainItem.channels: { email: boolean; suppressed: boolean }`; `DrainReport.skippedSuppressed`, `.skippedByPreference`; store `claim` also inserts the inbox row (`source_ledger_id`), and when email is off writes `skipped_reason` so the row is terminal; `retryItems` excludes `skipped_reason is not null`.

- [ ] Tests (RED): channel defaults + overrides; drain counts skips and writes `skipped_reason` (fake store records it); inbox describe copy for each kind; store claim inserts both rows.
- [ ] Implement; commit.

### Task 8: Bell inbox + preferences settings UI

**Files:** create `src/lib/notifications/inbox-store.ts` (+test), `src/lib/notifications/preferences-store.ts` (+test), `src/components/notification-preferences-settings.tsx` (+test); modify `src/components/notification-bell.tsx`, `notification-bell.css`, `src/components/app-settings-panel.tsx` (Account section), `notification-bell.test.tsx`.

**Produces:** `listInbox(userId, workspaceId, client?)`, `markRead(ids)`, `markAllRead(workspaceId)`; `loadPreferences(userId, workspaceId?)`, `savePreference(...)`; bell panel gains "Recent" list (unread dot, relative time, click → mark read + navigate) and "Mark all read"; Account settings gains a "Notifications" block: per-kind email toggle + "Weekly stalled-work digest" toggle.

- [ ] Tests (RED): inbox store maps rows; preferences store upserts; bell renders recent items and calls markRead on click; settings toggle calls savePreference.
- [ ] Implement; commit. **UI change**.

### Task 9: Resend webhook → deliveries + suppressions

**Files:** create `src/domain/notifications/webhook-signature.ts` (+test), `src/domain/notifications/resend-webhook.ts` (+test), `src/lib/notifications/deliveries-store.ts` (+test), `app/api/webhooks/resend/route.ts`.

**Produces:** `verifySvixSignature({ id, timestamp, signature, body, secret, now })` (base64 HMAC-SHA256 of `${id}.${timestamp}.${body}`, `whsec_` prefix stripped, 5-minute tolerance, multiple `v1,` signatures); `parseResendWebhookEvent(json)` → `{ eventId, type, messageId, recipients, occurredAt, suppress: { email, reason } | null }` (bounce type `Permanent` or complaint → suppress); route: 401 on bad signature, 200 + dedupe on replay, inserts delivery + suppression. Env `RESEND_WEBHOOK_SECRET`.

- [ ] Tests (RED): signature valid/invalid/stale; parse bounced/complained/delivered; store dedupes on `webhook_event_id`.
- [ ] Implement; commit.

### Task 10: Escalation + weekly stalled digest

**Files:** modify `src/domain/sop/notifications.ts` (+test), `src/lib/sop/notifications-store.ts`; create `src/domain/notifications/digest.ts` (+test), `src/lib/notifications/digest-store.ts` (+test); modify `run-drain-request.ts`.

**Produces:** `ESCALATE_AFTER_DAYS = 10`; `resolveEscalations(now, states)` → kind `stall_escalated`, recipients `state.workspaceManagers` minus stalled signer/author, `reminderIndex: 1`, once per (sop, manager, cycle); template lists stalled signers + days; `buildStalledDigest(now, workspaces: DigestWorkspaceState[])` → per recipient one `stalled_weekly` pending with `periodKey = isoWeek(now)`; digest store is a `DrainStore<DigestPending>` over `notification_digests`, recipients = owners/admins + quality approvers with email preference on; digests run only when `caller === 'cron'`.

- [ ] Tests (RED): escalation timing, dedupe, exclusions; digest period key, empty workspace → nothing, recipient dedupe, template lists SOPs.
- [ ] Implement; commit.

### Task 11: New SOP kinds: released, seat_assigned, objections, remarks

**Files:** modify `src/domain/sop/notifications.ts` (+test), `notification-templates.ts` (+test), `src/lib/sop/notifications-store.ts`, `src/domain/notifications/channels.ts`.

**Produces:** `status_changed` with `to_status = 'effective'` → `released` to author + every seat signer (incl. informed) minus actor, skip unless still effective; `seat_reassigned` → `seat_assigned` to `to_signer_id` when SOP `in_review` and seat still theirs and they have not responded; `signature_added` with meaning `rejection` → `objection_raised` to author; meanings `objection_withdrawn|objection_sustained|objection_overruled` → `objection_resolved` to author (+ the objecting signer when overruled/sustained); `remark_added` → `remark_added` to author (inbox by default, email opt-in), actor excluded. Store: `SOP_NOTIFIABLE_EVENT_TYPES` += `signature_added`, `seat_reassigned`, `remark_added`; context gains `objectionSignerId` lookup via `resolves_signature_id`.

- [ ] Tests (RED) per rule + templates.
- [ ] Implement; commit.

### Task 12: Membership kinds + transactional log

**Files:** create `src/domain/workspace/membership-notifications.ts` (+test), `src/lib/notifications/transactional-log.ts` (+test); modify `src/lib/workspace/welcome-store.ts` (+test), `app/api/invites/route.ts`, `app/api/auth/password-reset/request/route.ts`.

**Produces:** `parseMembershipEvent(auditRow)` → `invite_accepted` (grants.update, `redeemed_at` set, recipient `granted_by`), `role_changed` (members.update, role differs, recipient member), `member_removed` (members.delete, recipient member); templates; welcome store scans all four actions; `recordTransactionalEmail(admin, entry)` called after every invite/access-granted/recovery send (never storing the code).

- [ ] Tests (RED): parser cases; templates; transactional log insert shape (status/error).
- [ ] Implement; commit.

---

## Phase 2 — channels and operations

### Task 13: Teams channel

**Files:** create `src/domain/notifications/teams-card.ts` (+test), `src/lib/notifications/teams-sender.ts` (+test), `src/lib/notifications/integrations-store.ts` (+test); modify drain (channel fan-out), sop/welcome stores (`DrainItem.channels.teams`), `notification-admin-settings.tsx` (Task 15 hosts the UI), `app/api/notifications/admin/route.ts` (`action: "teams_test"`).

**Produces:** `buildTeamsCard({ title, body, link, kindLabel })` (Adaptive Card 1.4 wrapped in `message` attachment); `createTeamsSender(fetchImpl)`; drain posts after email for items whose workspace integration is enabled and the recipient's `teams` preference is not off; result recorded in `notifications.delivered_channels.teams`.

- [ ] Tests (RED): card shape; sender success/failure; drain records channel outcome; store loads only enabled integrations.
- [ ] Implement; commit.

### Task 14: Web push channel

**Files:** create `src/domain/notifications/web-push.ts` (+test), `src/lib/notifications/push-store.ts` (+test), `app/api/notifications/push/route.ts`, `public/pulse-push-sw.js`; modify preferences settings (toggle), drain (channel).

**Produces:** `createVapidAuthHeader({ audience, subject, publicKey, privateKey, now })` (ES256 JWT, `vapid t=..., k=...`); `encryptPushPayload({ p256dh, auth, payload })` (RFC 8291 aes128gcm, returns body + headers); `sendWebPush(subscription, payload, keys, fetchImpl)`; 410/404 → delete subscription. Env `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.

- [ ] Tests (RED): JWT verifies with the public key; encrypted payload decrypts with the subscriber's private key (test generates a keypair); gone subscription is pruned.
- [ ] Implement; commit. **UI change** (toggle).

### Task 15: Admin notifications console

**Files:** create `app/api/notifications/admin/route.ts` (+ `src/lib/notifications/admin-overview.ts` +test), `src/components/notification-admin-settings.tsx` (+test), `notification-admin-settings.css`; modify `src/components/organization-settings.tsx`.

**Produces:** GET `?workspaceId=` → `{ health, runs[10], ledger: { sop[], workspace[], digests[] } (last 50 each with delivery status), suppressions[], integration }`, owner/admin only (`has_workspace_role`), service-role reads scoped by workspace; POST `{ action: "resend", ledger, id }` resets attempts/last_error/skipped_reason and kicks; `{ action: "save_teams", ... }`, `{ action: "teams_test" }`, `{ action: "unsuppress", email }`. UI block "Notifications" in Organization settings: health strip, runs table, ledger table with Resend, suppressions, Teams webhook form.

- [ ] Tests (RED): overview assembly from fake client; authz denied for editor; component renders health + resend calls API.
- [ ] Implement; commit. **UI change**.

### Task 16: Runbook, auth-config report, docs

**Files:** create `docs/runbooks/notifications.md`; modify `scripts/apply-auth-config.mjs` (`--report` prints mailer keys), `docs/superpowers/specs/2026-07-21-sop-notifications-design.md` (status note).

- [ ] Runbook covers: apply order, env vars, Resend webhook + Idempotency, heartbeat monitor setup (hourly GET with `CRON_SECRET` = both monitor and hourly drain), reviving rows, reading the console, SMTP verification.
- [ ] Commit.

### Task 17: Re-audit

- [ ] Full gate: `npm run typecheck && npm run lint && npm test && npm run build`.
- [ ] Write `docs/audits/2026-09-04-notification-systems-audit-followup.md` re-scoring every §2/§3 item: fixed / built-not-live / open, with what the user must do (apply migrations, set env, configure webhook, monitor).
- [ ] Commit; report UI changes to the user; do not merge.
