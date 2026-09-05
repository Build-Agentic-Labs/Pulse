# Notifications — operations runbook

Everything a human needs to bring the notification system up, keep it up, and
fix it when it stalls. Architecture: `sop_event_log` / `audit_log` are the
outboxes → pure decisions in `src/domain/` → ledgers (`sop_notifications`,
`workspace_notifications`, `notification_digests`) → channels (email via Resend,
Teams webhook, browser push) → per-user inbox (`notifications`). Every drain
invocation is recorded in `notification_drain_runs`.

## 1. Bringing the branch live (one-time, in this order)

1. **Apply migrations** (additive; never `supabase db push`):
   ```bash
   node --env-file=.env.local scripts/apply-migration-safely.mjs 20260904120000_notification_core.sql
   node --env-file=.env.local scripts/apply-migration-safely.mjs 20260904121000_notifications_inbox.sql
   node --env-file=.env.local scripts/apply-migration-safely.mjs 20260904122000_email_deliveries.sql
   node --env-file=.env.local scripts/apply-migration-safely.mjs 20260904123000_workspace_integrations.sql
   node scripts/repair-migration-ledger.mjs
   npm run gen:types
   ```
   Then commit the regenerated `src/lib/database.types.ts` (the branch carries a
   hand-written version that matches these migrations).
2. **Environment** (Vercel Production + Preview, then **redeploy** — env changes
   do not reach running functions otherwise):

   | Variable | Purpose | Required |
   |---|---|---|
   | `RESEND_API_KEY`, `RESEND_FROM` | email channel | yes (already set) |
   | `CRON_SECRET` | cron / heartbeat / health auth | yes (already set) |
   | `SUPABASE_SERVICE_ROLE_KEY` | drain + webhook + console | yes (Production already) |
   | `NEXT_PUBLIC_SITE_URL` | links in email/cards | yes (already set) |
   | `RESEND_WEBHOOK_SECRET` | delivery webhook signature (`whsec_…`) | for delivery tracking |
   | `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | browser push | for push |

   Generate the VAPID pair once with `node scripts/generate-vapid-keys.mjs`.
   Rotating it invalidates every browser subscription.
3. **Resend webhook**: Resend → Webhooks → add
   `https://pulse.agenticlabs.studio/api/webhooks/resend` with events
   `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`,
   `email.complained`, `email.opened` (optional). Copy the signing secret into
   `RESEND_WEBHOOK_SECRET`. Send a test event from the Resend UI; the console's
   ledger should show a delivery status within seconds.
4. **Heartbeat monitor** (closes the "503 goes nowhere" finding). In any uptime
   service (Checkly, Better Stack, cron-job.org, …) create two checks:
   - `GET https://pulse.agenticlabs.studio/api/notifications/health` with header
     `Authorization: Bearer <CRON_SECRET>`, every 15 minutes, alert on non-200.
     Read-only; it answers 503 when the cron has never run, has been silent
     > 26 hours, or the latest run reported problems.
   - Optionally `GET https://pulse.agenticlabs.studio/api/sops/notifications/drain`
     with the same header, **hourly**. This both monitors and drains — reminders,
     escalations, and first-touch mail land within the hour instead of once a
     day, without changing the Vercel plan or `vercel.json`.
5. **Supabase auth mailer** (signup confirmation, email change): verify hosted
   SMTP with `SUPABASE_ACCESS_TOKEN=… node scripts/apply-auth-config.mjs --report`.
   If `smtp_host` is empty the project is on Supabase's built-in mailer (a few
   emails per hour, not for production). Point it at Resend SMTP
   (`smtp.resend.com:465`, user `resend`, password = API key, sender =
   `RESEND_FROM`) in the dashboard, or extend the script's `DESIRED` block.

## 2. Reading the system

- **Settings → Organization → Notifications** (owners/admins): health verdict
  and last cron, the last 10 runs, the ledger (state chip: sent / pending /
  blocked / dead / skipped, delivery status from the webhook), invitations and
  recovery sends, suppressed addresses, Teams webhook.
- **Settings → Account → Notifications** (everyone): per-kind email switches,
  browser push for this device.
- **Bell**: actionable count (things waiting on you) + Recent inbox with read state.
- **SQL** (service role):
  ```sql
  select * from notification_drain_runs order by started_at desc limit 20;
  select kind, count(*) filter (where sent_at is not null) sent,
         count(*) filter (where sent_at is null and skipped_reason is null and attempts >= 3) dead,
         count(*) filter (where skipped_reason is not null) skipped
  from sop_notifications group by kind;
  select * from email_suppressions;
  ```

## 3. When something is wrong

| Symptom | Meaning | Fix |
|---|---|---|
| Health: "cron has never run" / "silent for Nh" | Vercel cron not firing or deploy broken | Vercel → Crons; redeploy; the hourly heartbeat drain covers meanwhile |
| Health: "N send(s) blocked by configuration" | Resend rejected OUR key or `from` | Fix `RESEND_FROM` / `RESEND_API_KEY`, redeploy. Rows are held (not spent) and deliver on the next run |
| Health: "N dead row(s)" | address rejected 3× or provider down > 3.5h | Console → Ledger → Resend (revives + drains now). Check the address / suppressions |
| Ledger row `skipped` = suppressed | address hard-bounced or complained | Fix the address in the profile; Console → Suppressed → Remove; Resend the row |
| Ledger row `skipped` = preference | recipient turned that kind's email off | Nothing — the inbox row still exists; they chose this |
| Delivery column empty for sent rows | webhook not configured or secret wrong | §1 step 3; check `RESEND_WEBHOOK_SECRET`; 401s appear in Vercel logs |
| Teams test card fails | webhook URL not Microsoft, or channel connector removed | Re-create the incoming webhook in Teams; URL must be `*.webhook.office.com` or `*.logic.azure.com` over https |
| Push never arrives | VAPID env missing, or the browser subscription was pruned (410) | Set VAPID env; user toggles push off/on in Account settings |
| An SOP sits for weeks | author-side stall | Now covered: the author gets `review_complete`, nudges at day 3/6, managers at day 10, and the weekly digest lists it |

Never edit `enforce_sop_transition` or `sign_sop` to add notifications; the
outbox triggers (`log_sop_signature_event`, `log_sop_seat_reassignment_event`)
are separate functions on top of the live `append_sop_event`.

## 4. Adding a notification kind (checklist)

1. Migration: extend the ledger's `kind` CHECK (additive `drop constraint if
   exists` + `add constraint`).
2. `src/domain/notifications/channels.ts`: catalog entry (label, group,
   `defaultEmail`).
3. Decision: `resolveEventRecipients` (SOP) or `parseMembershipEvent`
   (workspace) — with the skip-unless-now guard. Test first.
4. Template: `notification-templates.ts` / `membership-notifications.ts`.
5. Store: add the event type to the scan list if it is new.
6. pgTAP: add the kind to `supabase/tests/notifications_test.sql`.

## 5. Guarantees and their limits

- Exactly-once claim per (event, recipient) and per (sop, recipient, kind,
  nudge, cycle); provider-side dedupe via `Idempotency-Key = <ledger>:<row id>`
  on byte-identical snapshotted content.
- Retries: 3 attempts at 30/60/120 minutes; configuration faults do not spend
  attempts; dead rows are counted in health and revivable from the console.
- The inbox row is written before any delivery — it is the record of the
  decision, whatever the channels do.
- Teams posts one card per decision (not per recipient); push goes to every
  subscribed device of a recipient whose `push` preference is on.
- Digests run only on the scheduled (cron) caller, once per ISO week.
