# Notification Systems Audit — Follow-up (re-audit after the build)

**Date:** 2026-09-05 · **Branch:** `feat/notification-system` (not merged, not applied
to production — both gated on the user's verification)
**Baseline:** `docs/audits/2026-09-04-notification-systems-audit.md`
**Plan executed:** `docs/superpowers/plans/2026-09-04-notification-system.md` (Tasks 1–17)

This re-scores every finding of the original audit. Three states are used:

- **Fixed** — built, tested, and provable from the code path.
- **Built, needs go-live** — built and tested; becomes live only after the user
  applies the migrations / sets an env var / configures a third party.
- **Open** — not addressed, with the reason.

Verification performed for this document: typecheck clean, lint clean (zero
warnings), 152 test files / 1216 tests passing (up from 125 / 1034), production
build succeeds, every new API surface probed on the worktree dev server (auth
gates answer 401, health answers 503 naming the missing table, the webhook
answers 503 naming the missing secret, the push service worker is served).
Signed-in screens could not be driven in the preview browser (no session on
the worktree's port and credentials cannot be typed by the agent); the
production database has not been migrated, so live drain behaviour is by
design not exercised. pgTAP runs in CI on the pushed branch.

---

## §2 — Broken or degraded (original findings)

| # | Finding | State | What changed |
|---|---|---|---|
| 2.1 | Pipeline blind to author-side stalls | **Fixed** | `review_complete` first-touch to the author; author reminders (day 3/6) for `review_complete` and `sent_back`; "Ready for final approval" section in the review queue and bell; escalation to managers at day 10; weekly digest lists it. The 37-day SOP would today have produced 1 email, 2 nudges, 1 escalation, and 5 digest lines. |
| 2.2 | No proof the cron has ever run | **Built, needs go-live** | `notification_drain_runs` written on every run (cron/kick/manual); `GET /api/notifications/health` flags "cron has never run" / silence > 26h. Live once migration 1 is applied. |
| 2.3 | 503 health signal has no consumer | **Built, needs go-live** | Read-only health endpoint for an uptime monitor + runbook §1.4 (hourly heartbeat drain). The monitor itself must be created by the user (needs an account). |
| 2.4 | Duplicate-send window (no Idempotency-Key) | **Fixed** | `Idempotency-Key: <ledger>:<row id>` on every Resend POST; ledger rows snapshot their rendered content so retries are byte-identical (Resend 409s on a changed body). |
| 2.5 | `sent_at` means accepted, not delivered | **Live — verified 2026-09-05 with real traffic (15 `email.sent` + 15 `email.delivered` events recorded)** | `/api/webhooks/resend` (Svix signature, replay dedupe) → `email_deliveries`; permanent bounces and complaints → `email_suppressions`, honoured by the drain. Needs `RESEND_WEBHOOK_SECRET` + the webhook configured in Resend. |
| 2.6 | Invites and recovery bypass the ledger | **Fixed** | `transactional_emails` records every invitation, access-granted, and recovery send (outcome only, never a code). Shown in the console. |
| 2.7 | Welcome email never fired | **Open (by design)** | Unchanged: invite redemptions are deliberately covered by the invitation email. Membership kinds (`role_changed`, `member_removed`, `invite_accepted`) now share the store, so the path is exercised as soon as any membership changes. |
| 2.8 | Silence after day 6 | **Fixed** | Escalation to workspace owners/admins 4 days after the last unanswered nudge, once per manager per cycle, naming who it waits on; weekly stalled digest to owners/admins + Quality. |
| 2.9 | Retry budget ~3.5h then silent death | **Fixed** | Dead rows (attempts exhausted, < 7d) counted per ledger and folded into the health verdict; console lists them with a one-click Resend that revives and drains immediately. The 3-attempt budget itself is unchanged and now visible. |
| 2.10 | Auth mail on Supabase's built-in mailer | **Closed 2026-09-05 — verified, no change needed** | `--report` run by the owner: hosted auth mail is already on Resend SMTP (`smtp.resend.com:465`, sender `Pulse <notifications@pulse.agenticlabs.studio>`, matching `RESEND_FROM`); `rate_limit_email_sent` 30/h; `mailer_otp_exp` 86400 is deliberate (set 2026-08-13). |
| 2.11 | Bell acks per device; app-wide polling | **Partly fixed** | Inbox read state is server-side via RPCs (cross-device). The derived actionable count is unchanged (its `localStorage` acks and 60s polling remain — the badge semantics were a deliberate 2026-07-22 decision). |
| 2.12 | Constant-time secret, retry wording, per-instance limiter | **Fixed / accepted** | `CRON_SECRET` compared with `timingSafeEqual`. Retried wording is now moot (snapshot). Rate limiter remains per instance (documented). |

### Bug found and fixed during the build (not in the original audit)

- **Reminders could never fire in a later review cycle.** The reminder claim key
  had no cycle, and prior nudges from any cycle counted toward the cap. Cycle
  added to the key (`sop_notifications.review_cycle`, new unique index) and to
  the domain rule, with a test.

## §3 — Missing for enterprise grade (original findings)

| # | Gap | State | What changed |
|---|---|---|---|
| 3.1 | Event coverage | **Largely fixed** | New kinds: `review_complete`, `released` (author + every seat incl. Informed), `seat_assigned`, `objection_raised`, `objection_resolved`, `remark_added` (inbox-only by default), `stall_escalated`, `invite_accepted`, `role_changed`, `member_removed`, `stalled_weekly`. Two new outbox triggers (`signature_added`, `seat_reassigned`) — additive, no change to `sign_sop`. **Still open:** security events (password changed, new sign-in) and the Planning/Production spaces — no outbox events exist for them yet. |
| 3.2 | Preferences | **Fixed (email); partial (channels)** | Per-kind email switches (Settings → Account), workspace-scoped rows honoured by the drain; `push` per-kind preference honoured; Teams is workspace-level (no per-user switch by design). No digest-frequency option beyond the weekly digest's own kind. |
| 3.3 | Persistent inbox | **Fixed** | `notifications` table written before delivery; bell "Recent" list with cross-device read state, mark-on-open, mark-all-read. |
| 3.4 | Escalation and SLA | **Fixed** | Day 3/6 nudges → day 10 escalation → weekly digest. No per-workspace SLA settings yet (constants). |
| 3.5 | Delivery tracking + suppression | **Live — webhook verified 2026-09-05** | Webhook + suppression + console view + manual unsuppress. |
| 3.6 | Operational visibility + runbook | **Fixed** | Run log, health endpoint, admin console, `docs/runbooks/notifications.md`. No Sentry (would need a dependency + account; the run log and heartbeat cover alerting). |
| 3.7 | Channels | **Push live (verified 2026-09-05); Teams declined by owner** | Teams incoming webhook (one Adaptive Card per decision; admin form + test send) and browser push (VAPID + aes128gcm on Node crypto, service worker, device switch). Push verified end-to-end in production 2026-09-05: device subscribed from Settings → Account, test push accepted by FCM (HTTP 201). Teams: the owner chose not to configure it (2026-09-05); the channel stays in the code, inert until a webhook is saved. |
| 3.8 | Test coverage | **Fixed** | Drain store: 0 → 13 tests; request core tested with fake stores; every new module has a colocated test; pgTAP `notifications_test.sql` (29 assertions) covers ledger posture, inbox RLS, RPCs, triggers, integrations, push. Bell: 1 → 3 tests. No end-to-end Inbucket test (would need local Supabase in CI beyond the existing pgTAP job). |

## What the user must do to make it live

**All done 2026-09-05.** Kept for the record:

1. ~~Verify the branch on the preview deployment.~~ Reviewed, then merged.
2. ~~Apply the four migrations in order and regenerate types.~~ Applied via `apply-migration-safely`; `gen:types` diff empty.
3. ~~Set `RESEND_WEBHOOK_SECRET` and the three VAPID vars; redeploy.~~ Set in Vercel Production.
4. ~~Configure the Resend webhook; create the heartbeat monitor(s).~~ Webhook verified by real traffic (30 events); cron-job.org checks health every 15 min and drains hourly.
5. ~~Run `apply-auth-config.mjs --report`; move auth mail to Resend SMTP if needed.~~ Already on Resend SMTP.
6. ~~Merge to main; delete the branch.~~ Fast-forwarded; branch and worktree deleted.
7. Browser push verified end to end on the owner’s Mac. Teams channel left unconfigured by choice.

## UI changes in this branch (for the user's review)

- **Review queue** (`/sops/review`): new "Ready for final approval" section for
  authors, linking to the final-approval step.
- **Bell**: "Recent" inbox list with unread markers, mark-on-open, "Mark all
  read"; unread dot when nothing is actionable; panel widened.
- **Settings → Account**: new "Notifications" blocks — per-kind email switches
  grouped SOP / Workspace / Digests, and "Browser push on this device" (shown
  only when the browser supports push and the VAPID key is configured).
- **Settings → Organization**: new "Notifications" console (owners/admins) —
  health + runs, ledger with Resend, invitations/recovery log, suppressed
  addresses, Teams webhook form with test send.
- **SOP editor audit trail**: two new event labels, "Signature recorded" and
  "Review seat reassigned".

## Residual risks and honest limits

- Migrations are unapplied; until they are, the health endpoint answers 503
  naming the missing table (verified live) and the drain reports every store as
  erroring — visible, never silent.
- The hourly heartbeat is the practical substitute for a more frequent Vercel
  cron; without it, first-touch mail still relies on the browser kick plus the
  daily cron.
- Teams posts and push messages are best-effort channels: failures are
  recorded per channel on the inbox row, never retried.
- Digest retries need the content snapshot; a digest row claimed without one
  is left to the dead-row report rather than re-rendered.


## Incident 2026-09-05 evening — "Password recovery is temporarily unavailable"

The owner tested the reset flow and got a 503. Vercel runtime logs showed the
request had gone to the afternoon **preview** deployment host, which has no
service-role key by design; production answered 200 and delivered a real reset
email minutes later. Not a production bug — but the failure was silent (no log
line, no ledger row, health green) and the preview host looked identical to
production. Plus the typed recovery code was poor UX.

Fixed on branch `worktree-password-reset-hardening`
(plan: `docs/superpowers/plans/2026-09-05-password-reset-hardening.md`):
link-only reset on the invite fragment-token pattern (`/reset-password`);
`requestPasswordRecovery` as one shared request core with a ledger row for every
failure; missing config logged by name, and both missing config and any failed
reset / invitation send in the last 24 h reported by the health endpoint
(`authMail`) — a synthetic daily canary was built, then dropped at the owner's
decision because it would have needed an exemption in the signup-domain trigger; production `*.vercel.app` hosts redirect to the canonical
domain; preview deployments show a banner and say why email features are off;
invitations get the same loud-failure treatment.

## Finding 2026-09-05 late — eleven invitations stuck since 2026-08-12

While looking for a resend target, the data showed eleven `workspace_access_grants`
rows still unredeemed from the 2026-08-11/12 invite batch. Every one of those auth
accounts carries `email_confirmed_at = last_sign_in_at` between 62 and 150 seconds
after its invite email was delivered, and none has a workspace membership: a mail
security scanner opened the old-style Supabase `action_link`s on delivery and
consumed the one-time tokens (the exact failure the 2026-08-13 fragment-link
redesign fixed). The resend logic then judged these people "already set up" because
it keyed on `last_sign_in_at`, so every later resend (08-13, 09-03) went down the
reminder / already-registered branch instead of minting a fresh setup link.

Fix (branch `fix/invite-resend-membership`): `inviteeHasCompletedSetup` now keys on
**workspace membership**, looked up with the service role, not on sign-in; a
signed-in-but-never-joined account gets a setup link again.

Adjacent display fix (branch `fix/members-panel-access-update-pending`): re-inviting
an existing member resets that grant's `redeemed_at` to null **on purpose** —
`redeem_workspace_access_grants()` applies only unredeemed grants, so that is how
changed entitlements reach a member at their next sign-in. The Members panel used to
list such a grant as a second, pending person; it now stays on the member's row as
"access update applies at next sign-in" (`partitionAccessGrants`). The database
behaviour is unchanged.
