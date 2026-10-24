# Backend Reliability Audit — 2026-10-24

**Branch:** `audit/backend-reliability-review` · **Base:** `main` @ `b6cc5cb`
**Scope:** the 50-topic backend checklist (concurrency, transactions, data
access, caching, resilience, async/eventing, operability) applied to the
whole repo: 176 migrations, every `src/lib/**/store.ts`, all 19 API routes,
the proxy, realtime, notification drain, and the prior audits in
`docs/audits/`, `docs/db-audit-2026-06-01.md`, `docs/deferred-work.md`.
**Method:** read-only code review. Four parallel passes (DB integrity;
query/data access; caching/resilience; async/eventing/ops), then the top
findings were re-verified by hand against the source. Nothing was run
against the live database; where a finding is code-derived and not
reproduced, it says so.

**Verdict.** The architecture is sound for its scale and the newer features
(SOP signatures, AWI save, task reorder, quality-WI, notification drain,
approver submit) are well above average: row locks taken in a stated order,
advisory locks closing check-then-act races, idempotency receipts, a
transactional outbox fed by triggers, HMAC-verified webhooks, and
attempt-capped retries. The debt is concentrated in **older planner write
paths** (whole-scenario, non-transactional, version-blind saves), in
**unbounded reads** that will silently truncate at PostgREST's 1000-row cap,
in **per-instance rate limiting on a public endpoint**, and in **zero
observability** (no query plans, no tracing, no consumer of the health
endpoint). Several items below were already named in earlier audits and are
still open; those are marked *(open since …)*.

Status key: **Strong** — correct and defended in code · **Adequate** —
works, with named caveats · **Gap** — real risk, fix recommended ·
**N/A** — does not apply at this architecture/scale (stated why).

---

## 1. Scorecard

| # | Topic | Status | One-line finding |
|---|---|---|---|
| 1 | Race conditions | Adequate | New RPCs lock + CAS; planner shell save and step writers are still last-writer-wins. |
| 2 | Deadlocks | Adequate | "Lock `sops` first", children `order by id`; advisory-vs-row lock order differs between functions and is unwritten. |
| 3 | Database transactions | **Gap** | supabase-js calls are auto-commit; ~10 multi-call write sequences are non-atomic, led by `savePlannerShellToSupabase`. *(open since 2026-06-01 #2)* |
| 4 | ACID | Adequate | Consistency enforced in triggers/constraints; atomicity only per statement/RPC; lost-response ack handling missing for shell saves and work orders. |
| 5 | Isolation levels | Adequate | READ COMMITTED everywhere, correctly paired with `for update`; `security invoker` + `for update` + UPDATE-RLS trap documented but still latent in 4 RPCs. |
| 6 | Optimistic locking | Adequate | `version` + `bump_row_version` on tasks/steps, `updated_at` CAS on sops/products; 7 task writers bypass the version. *(open since 2026-06-01 #12)* |
| 7 | Pessimistic locking | Strong | 40+ `for update`, 9 `pg_advisory_xact_lock`, `for share` on scope parents; no `skip locked` needed. |
| 8 | Connection pooling | Adequate | All app traffic is HTTP to PostgREST (no `pg` in app); duplicate server clients cost extra `getUser()` round trips; scripts disable TLS verification. |
| 9 | N+1 queries | **Gap** | Per-SOP RPC on the 60 s bell poll; per-step write loops; per-row RLS function chains (6–9 nested calls, one VOLATILE). *(open since 2026-06-01 #7, #10)* |
| 10 | Database indexes | **Gap** | 3 exact duplicates of UNIQUE constraints; ~15 meaningful FK/filter columns unindexed incl. `sop_release_files.storage_path` used per storage object. |
| 11 | Query optimization | **Gap** | Planner load is `select('*')` on 14 tables incl. the PFMEA JSON blob; `actual_events` unbounded; whole-collection list reads. |
| 12 | EXPLAIN ANALYZE | **Gap** | No plan analysis, `pg_stat_statements`, or slow-query evidence anywhere; perf numbers are local-fixture only. |
| 13 | Foreign keys | Strong | ~296 FKs, deliberate cascade/set-null/restrict; a few intentional no-FK columns; 33 `auth.users` FKs lack `on delete` (no user-deletion path exists). |
| 14 | Unique constraints | Adequate | Enforced in DB and translated (23505) in app; non-deferrable sequence/wbs uniques force "parking"; `tasks(scenario_id,wbs)` has no client parking in the shell path. |
| 15 | Migrations | Adequate | Forward-only, in-place `pg_get_functiondef` patches; anchor-uniqueness guard inconsistent; two appliers can drift the ledger. *(open since 2026-06-01 #13)* |
| 16 | Zero-downtime migrations | Adequate | Purely additive so far; all `set not null`/`add check`/index builds take ACCESS EXCLUSIVE in-transaction — fine today, a cliff later. |
| 17 | Read replicas | N/A | Single Supabase project, single workspace; not warranted. |
| 18 | Replication lag | Adequate | No replicas; staleness is Realtime vs. local state — channel status is ignored, so a dropped socket is silently stale. |
| 19 | Sharding | N/A | Not needed; task-child tables carry no `workspace_id`, which would block any future tenant partitioning. |
| 20 | Partitioning | **Gap** (retention) | No partitioning (not needed); ~17 append-only tables with no retention policy. |
| 21 | Cache invalidation | Adequate | Browser-only caches with explicit invalidation; sign-out purge is a no-op; no server data cache. |
| 22 | Redis eviction | N/A → Gap | No Redis; the one server-side `Map` (rate limiter) never evicts, and public password-reset keys feed it. |
| 23 | Cache stampedes | Adequate | Proxy gates token refresh on expiry (narrows, doesn't serialize); realtime full-reload herd scales with viewers × saves; 15 s SOP polls unjittered. |
| 24 | Distributed caching | Adequate | Nothing assumes shared memory except the rate limiter; two routes correctly back it with DB counts. |
| 25 | Idempotency | Adequate | Submit, convert, webhook, drain, AWI save are model implementations; `stage_sop_approver` and nominate are not. |
| 26 | Retry mechanisms | Adequate | Drain: classified, capped; procedure-save queue retries every 2.5 s forever with a `"conflict"` substring stop. |
| 27 | Exponential backoff | Adequate | Drain uses 30·2ⁿ min; nothing else backs off. |
| 28 | Jitter | **Gap** (minor) | None in app code. |
| 29 | Circuit breakers | N/A → minor | None; config-failure classification is the stand-in; one Resend call per row per run is still spent. |
| 30 | Rate limiting | **Gap** | Public password-reset throttled only per-instance in memory and bypasses GoTrue's mail limits; `/api/performance` unauthenticated and unlimited. |
| 31 | Load balancing | Strong | No sticky-session or in-memory lock assumptions; mutexes are DB rows. |
| 32 | Horizontal scaling | Adequate | PostgREST absorbs fan-out; unfiltered child-table realtime subscriptions broadcast org-wide. |
| 33 | Vertical scaling | Adequate | `maxDuration` on heavy AI routes; missing on the drain; SolidWorks routes advertise 200 MB uploads against Vercel's 4.5 MB body cap. |
| 34 | Reverse proxies | Strong | Canonical redirect never trusts Host for the target; email origins env-first; CSP tight except `unsafe-inline`. |
| 35 | Message queues | Adequate | Trigger-fed outbox + ledgers with unique-index claims; collect scan unbounded (1000-row cap). |
| 36 | Dead letter queues | Adequate | Dead rows surfaced for 7 days via health + admin resend; cycle-stale retry rows become invisible. |
| 37 | Background workers | Adequate | Cron secret, DB claims make overlap safe; no batch cap, time budget, or provider timeouts. |
| 38 | Job scheduling | **Gap** | Daily cron + browser kicks; non-browser events wait up to 24 h; retry backoff unreachable between runs. *(hourly recommended 2026-09-04)* |
| 39 | Event-driven | Adequate | Realtime planner, DB-trigger outbox; SOP surfaces poll. |
| 40 | Webhook verification | Strong | Svix HMAC, constant-time, ±300 s, rotation support, 503 when secret missing. |
| 41 | Webhook retries | Adequate | 500 → Svix retries, 23505 → 200; suppression write is not atomic with delivery insert. |
| 42 | Eventual consistency | Strong | DB is the gate; stale UI yields a server error, never corruption; bounded staleness windows. |
| 43 | Distributed transactions | Adequate | Annex/WI uploads compensate; step photos / exploded views / videos do not (orphans). |
| 44 | Outbox pattern | Strong | Real transactional outbox via triggers for SOP + membership; inbox and transactional mail are dual-write by design. |
| 45 | CQRS | N/A | Minimal projections (`planner_tasks` view, inbox); no separate read model needed. |
| 46 | Event sourcing | Adequate | Append-only logs, mutable current state; immutability is RLS-level only. |
| 47 | Backpressure | Adequate | PFMEA queue is a textbook single-slot coalescer; drain has no cap and burns attempts on 429. |
| 48 | Graceful shutdown | Adequate | No server fire-and-forget; client `keepalive`/`sendBeacon`/pagehide flushes; SOP editor warn-only. |
| 49 | Health checks | **Gap** | Endpoints exist and are correct; nothing in the repo consumes them. |
| 50 | Distributed tracing | **Gap** | None: no request id, no `instrumentation.ts`, no error reporting; console logs only. |

---

## 2. Top findings, ranked

Ranking weighs blast radius × likelihood × cost to fix. File references are
to the current tree.

### F1 — Planner shell save is destructive, non-transactional and version-blind
`src/lib/planner/shell-store.ts:230-358` issues ~15 independent PostgREST
requests (parents, tasks, deps, custom columns, then six stale-row
deletes). `taskRow` (`src/lib/planner/row-mappers.ts:548`) writes whole task
rows including `wbs` and omits `version`, so the write bypasses
`bump_row_version` CAS. Consequences: a failure mid-sequence leaves parents
upserted and stale rows undeleted (or the reverse); a teammate's new task in
another tab is deleted by this client's next save; `assertSaneStateDeletion`
(`:88-98`) only blocks >50 % deletions and, by its own comment, not child
truncation. Prior audit items #2 and #12 (2026-06-01) are still open.
**Fix:** one `security invoker` RPC that takes the diff (parents, tasks,
deps, deletes) with a full expected-version map, in the shape of
`reorder_scenario_tasks` (`20261005012055`). Until then, add `version` to
`taskRow` so the shell save at least fails loudly on concurrent edits.

### F2 — Unbounded reads silently truncate at PostgREST's 1000-row cap
The notification collector reads 30 days of `sop_event_log` with no
`.limit()`/pagination (`src/lib/sop/notifications-store.ts:551-556`) and
anti-joins the ledger the same way (`:570-572`). Past 1000 notifiable events
in the window, the newest events are never seen until older ones age out:
notifications are lost for up to 30 days with no error. `readAllPages`
exists (`src/lib/supabase/read-all-pages.ts`) and the workspace welcome store
already uses it. Structure audit DATA-9 lists seven more unbounded list
reads. **Fix:** `readAllPages` with a `(created_at, id)` tiebreaker on both
reads; consider a per-ledger watermark so kicks don't rescan 30 days.

### F3 — Public password-reset endpoint is rate-limited per instance, in memory
`app/api/auth/password-reset/request/route.ts:25-26,71-75` keys an in-memory
bucket (`src/lib/api-auth.ts:107-130`) by hashed email and IP. On Vercel the
effective cap is N × instances, the map never evicts (hostile keys grow until
the instance recycles), and the route bypasses GoTrue's own email limits by
minting links with `admin.generateLink` and sending through Resend. **Fix:**
count `transactional_emails` by recipient in the last 15 min (index exists),
add a Vercel Firewall rate rule on this path and on `/api/performance`, and
sweep expired buckets on write.

### F4 — Realtime channel status is ignored; stale planner state can drive a destructive save
`src/lib/planner/realtime.ts:163` calls `channel.subscribe()` with no status
callback. After sleep or a network drop, missed `postgres_changes` are never
replayed, no polling fallback exists, and the cached planner snapshot
diverges silently. Combined with F1, the next diff-save deletes rows the
client never saw. Structure audit ERR-4/DRIFT-2 (P0/P1). **Fix:** handle
`subscribe((status) => …)`; on `CHANNEL_ERROR|TIMED_OUT|CLOSED` mark remote
state unconfirmed and block saves; on `SUBSCRIBED` after a gap, full-refresh.

### F5 — Notification drain has no time budget, batch cap, or provider timeouts
`app/api/sops/notifications/drain/route.ts` sets no `maxDuration`; the loop
(`src/lib/sop/notifications-drain.ts:434-502`) awaits Resend, Teams and
push fetches per item with no `AbortSignal`; `recordRun` runs after the loop,
not in `finally`. One hung provider stalls the function until Vercel kills
it, the run never records (health then reports "cron silent"), and claimed
rows re-enter only via the 30-minute retry lane on the *next* drain, which
on the daily schedule is tomorrow. **Fix:** `export const maxDuration`,
`AbortSignal.timeout(10_000)` on the three senders, cap items per run,
record the run in `finally`, stop the loop on the first 429.

### F6 — Three RPCs still raise `40001` for application conflicts
`reorder_scenario_tasks` (`20261005012055:88`), `update_awi_metadata`
(`20261008215826:26`), `rename_awi_master` (`20261023215019:52`). The repo
itself established that PostgREST 14 retries `40001` internally and can
exhaust the shared pool, and switched AWI save and quality-WI to `PT409`
(`20261009020244:1-3`, `20261008034342`). **Fix:** patch the three in place
with the guarded `pg_get_functiondef` replace pattern; have the clients
accept both codes during rollout (`task-order-store.ts` already does).

### F7 — Per-row RLS function chains, never measured
391 policies; 463 bare `auth.uid()` vs 2 wrapped `(select auth.uid())`;
`has_project_access` → `project_workspace_id` + `has_workspace_role` (the
live definition in `20260601120000:40-62` is `language sql security definer`
with **no `stable`**, so it is VOLATILE and re-evaluated per row) →
`is_super_admin` + two more tables. Storage policies call
`sop_released_file_readable(name)` per `storage.objects` row, which looks up
`sop_release_files.storage_path` with no index (`20261022202248:41-68`).
Open since db-audit #7; no EXPLAIN output exists anywhere in the repo.
**Fix:** `EXPLAIN (ANALYZE, BUFFERS)` as `authenticated` on the planner
child loads, `listSops`, the bell query and the annex listing; then mark the
helper functions `stable`, wrap `auth.uid()` in a scalar subselect in the hot
policies, and index `sop_release_files(storage_path)`.

### F8 — Procedure-save retry loop is unbounded and unjittered
`src/components/line-workspace/use-procedure-save-queue.ts:357-376`
reschedules every 2500 ms with no attempt cap, no backoff, no jitter; the
only stop is a `"conflict"` substring match (`:325`). A Supabase incident
turns every open AWI tab into a permanent 0.4 req/s loop per dirty task.
**Fix:** cap at ~6 attempts with `min(2.5 s·2ⁿ, 60 s)` ± 20 %, then surface
"Save paused — Retry"; classify by error code, not message text.

### F9 — Nothing consumes the health signals; no tracing
`/api/notifications/health` and the drain's 503 are correct, but no uptime
monitor, workflow or script in the repo calls them; the 2026-09-04 audit's
"external heartbeat" is unimplemented. There is no request/correlation id,
no `instrumentation.ts`, no error reporter; `app/error.tsx` logs to the
browser console. The two-week `RESEND_FROM` outage this pipeline already had
recurs silently without a consumer. **Fix:** an external heartbeat hitting
the GET drain hourly with the secret (which also fixes F10), and a minimal
log drain or Sentry with a run id stamped on every drain log line.

### F10 — Daily cron is the only delivery guarantee
`vercel.json` fires once at 13:00 UTC. First-touch mail depends on browser
kicks; events from the SolidWorks plugin, SQL console, admin scripts or
triggers such as `seat_reassigned` wait up to 24 h; the 30/60/120-minute
retry backoff cannot fire between runs. Hourly was recommended on 2026-09-04
and not adopted. **Fix:** hourly cron (Pro) or the external heartbeat above.

### Also material (fix alongside the above)
- **Orphaned storage objects:** `src/lib/planner/media-store.ts:160-200,
  339-375, 408-448` upload then insert with no compensation, unlike
  `src/lib/sop/annex-files.ts:119-164`. `scripts/cleanup-orphaned-storage.mjs`
  mitigates manually.
- **Resend suppression can be permanently skipped:**
  `src/lib/notifications/deliveries-store.ts` inserts the delivery, then
  upserts suppressions; if the upsert fails, the handler 500s, Svix
  redelivers, the insert hits 23505 and returns early, and the hard-bounced
  address keeps being mailed. Run the suppression upserts before (or
  regardless of) the duplicate short-circuit.
- **`stage_sop_approver` check-then-insert race** (`20261013214237:108-121`)
  with no unique on `sop_approver_nominations (sop_id, lower(email))` after the
  PK moved to `(seat_id)`.
- **Version-free step writers:** `saveMobileStepToSupabase`,
  `saveTaskCustomFieldsToSupabase`, `saveTaskWithManufacturingStepsToSupabase`
  (`src/lib/planner/task-store.ts:164-168, 170-198, 238-241`); the
  `planned_duration_minutes` recompute at `:258-263` is a read-sum-write.
- **`tasks(scenario_id, wbs)` has no client-side parking** in the shell path
  (`row-mappers.ts` writes `wbs`; `shell-store.ts:55-74` parks only
  stations/zones). Any shell-path WBS renumbering across surviving tasks
  aborts the autosave with 23505. Code-derived, not reproduced: verify with a
  delete-middle-task + autosave test.
- **Sign-out planner cache purge is a no-op:**
  `src/components/auth-project-gate.tsx:253` calls
  `clearCachedPlannerState()` with no argument and
  `src/lib/planner-state-cache.ts:134-137` returns early.
- **Planner load ships the PFMEA document on every paint:** `select('*')` in
  `src/lib/planner/read-store.ts` includes `products.custom_fields`, which
  holds the whole PFMEA JSON (`src/lib/planner/pfmea-store.ts:8-24`), and
  `tasks.custom_fields` with annotation JSON; `actual_events` is loaded in full.
- **Three duplicate indexes** on hot planner tables
  (`20260507203000:358-360` duplicate the UNIQUE constraints at `:187, :198,
  :245`); the `manufacturing_steps` twin was already dropped in
  `20260601127000:51`.
- **SolidWorks ingest contract vs Vercel body cap:** routes advertise
  200 MB / 10 MB via `formData()` but Vercel rejects >4.5 MB before the route
  runs (acknowledged for SOP extract). Needs the signed-upload handshake.
- **Migration ledger split-brain:** 28 non-idempotent migrations plus
  `scripts/apply-migration-safely.mjs`, which bypasses
  `supabase_migrations.schema_migrations`; anchor-uniqueness in the 20
  `pg_get_functiondef` patches ranges from exactly-once (`20260921230000:16-18`)
  to definition-equality only (`20261013214237:40-57`).

---

## 3. Detail by topic

### 3.1 Concurrency and integrity (1–7, 13–16)

**What is done well.** `sign_sop` takes `for update` on the SOP before
quorum checks (`20260710122500:71`); `reassign_sop_seat` and
`enforce_seat_freeze` were re-created to lock `sops` first
(`20260723123000:1-14`); `submit_sop_review`, `auto_route_sop_unanimous_review`,
`send_sop_for_signatures`, `sign_sop_with_mark`, `stage_sop_approver` and the
quality-WI edit/publish RPCs all lock their parent row. Check-then-act races
are closed with `pg_advisory_xact_lock` for project create
(`20260805210000:62`), work-order approval numbering (`20260721150000:106`),
reviewer nomination (`20260910121000:55`), WI release index
(`20260918120000:88`), AWI number minting (`20261003014311:10,31`), reminder
dedupe (`20260923120000:54`) and WI conversion (`20261008053624:39`).
`next_sop_number` is an atomic `insert … on conflict do update … returning`.
Idempotency receipts exist for task reorder (`task_reorder_receipts`),
quality-WI operations, and AWI save (content-equality early return,
`20261009020244:98-107`). Child-row locks are taken `order by id`
(`20261009020244:68-70`, `20261005012055:68-74`). The approver submit route
uses a 10-minute DB lease (`acquire_sop_submission_lock`) released in
`finally` with a re-check after acquisition. ~296 FKs with deliberate
cascade/set-null/restrict choices; 27 table-level uniques and 40+ unique
indexes, many partial; 23505 is translated to user-facing messages across
every store.

**Gaps.** See F1, F6 and the "also material" list. Additionally: client-side
max+1 numbering for work-order drafts (`src/lib/planning/store.ts:441-473,
559-620, 677-725`) retries once on 23505 and `createGenPmSet`'s compensating
delete is itself non-atomic; `copyAwiMaster` runs N storage copies and
inserts in the browser after the RPC (`src/lib/awi/store.ts:48-85`), leaving
half-copied drafts on failure; the advisory-vs-row lock order differs between
`approve_work_order_set` (row first) and `create_awi_master` (advisory
first) with no written rule; `security invoker` RPCs that `for update` a
table whose UPDATE policy excludes the caller silently see zero rows (fixed
for `sign_sop_with_mark` by `security definer` in `20261002060000:1-7`, still
latent in `replace_task_children`, `reorder_manufacturing_steps`,
`approve_work_order_set`, `send_sop_for_signatures`). `sops` has no integer
`version` and uses `updated_at` as its CAS token. Projects' duplicate-name
rule lives only in the RPC's advisory lock + `exists`, with no unique index.
Zero-downtime: no column has ever been dropped or renamed (good), but every
`set not null`, `add constraint … check` and the 156 index builds run under
ACCESS EXCLUSIVE inside the migration transaction, and two migrations take
`lock table … share row exclusive` on live tables.

### 3.2 Data access and query performance (8–12, 17–20)

**What is done well.** No `pg` import in app code; all access is stateless
HTTP to PostgREST, so serverless fan-out never touches `max_connections`.
Planner child loads are batched by ≤100 ids (`read-all-pages.ts:18-38`);
the SOP detail server read is 2 + 8 parallel + 1; notification collectors
select column lists and batch recipients; photo/video signing uses
`createSignedUrls`; FK hints are explicit where PostgREST would otherwise
return `PGRST201`. Backup scripts enforce direct-5432 connections with
verified TLS (`scripts/backup/source.mjs:22-60`).

**Gaps.** See F2, F7 and the "also material" list. Additionally: the review
queue issues one `sop_author_display_name` RPC per SOP inside `Promise.all`
(`src/lib/sop/review.ts:209-214`) on the bell's 60 s poll, plus a
workspace-unscoped `sop_review_annotations` read on `created_by` with no
index (`review-queue-data.ts:102-110`); task save deletes and upserts steps
one row at a time (`task-store.ts:563-590`) and the mobile step save re-reads
all steps per save; the approver submit route re-reads the same workspace
and department names on every loop iteration (`submit/route.ts:85-91`);
server components create duplicate clients that each call `getUser()`
(`detail-data.server.ts:23-25` alongside `request-context.ts:7`); migration
and seed scripts set `ssl: { rejectUnauthorized: false }`. Missing indexes
worth adding: `sop_review_seats(department_id)` (ON DELETE RESTRICT),
`sop_signatures(revision_id)`, `sop_change_log(revision_id)`,
`notifications(workspace_id)`, `workspace_notifications(workspace_id)`,
`work_orders(template_id)`, `sales_order_lines(work_order_id)`,
`work_instruction_references(sop_id)`, `sop_release_files(sop_id)` and
`(storage_path)`, `sop_review_annotations(created_by) where author_response <> ''`,
and a composite for the SOP list query
`sops(workspace_id, updated_at desc) where deleted_at is null`. Retention: ~17
append-only tables (`actual_events`, `audit_log`, `sop_event_log`,
`sop_change_log`, `notifications`, `notification_drain_runs`,
`email_deliveries`, `transactional_emails`, `problem_history`,
`quality_wi_operations`, …) have no pruning; only `sop_extraction_requests`
and `push_subscriptions` are trimmed. Read replicas, sharding and partitioning
are correctly absent at this scale.

### 3.3 Caching, idempotency, retries, scaling (21–34)

**What is done well.** No server-side data cache to go stale; every API route
is dynamic with `Cache-Control: private, no-store`. Browser caches invalidate
on access change, conflict and failed save; `signedUrlCache` is browser-only
and opt-in for immutable paths; `coalesced-refresh` and the shared review
queue dedupe in-flight reads and never drop a post-mutation refresh; every
server-side module cache is WeakMap-keyed by client per CLAUDE.md. The proxy
refreshes the token only within 300 s of expiry, removing the per-navigation
GoTrue call and narrowing the refresh-token stampede. Approver submit,
quality-WI convert, the Resend webhook, the drain and AWI save are model
idempotency implementations. Two expensive AI routes back the in-memory
limiter with DB counts; the convert route's advisory-locked RPC is the right
pattern. No sticky-session or in-memory-lock assumptions; mutexes are DB rows.
The canonical-host redirect uses the forwarded host only to decide and builds
the target from `NEXT_PUBLIC_SITE_URL`; email link origins are env-first.
CSP, HSTS, Referrer-Policy and Permissions-Policy are set.

**Gaps.** See F3, F4, F8 and the "also material" list. Additionally: the
realtime full-reload herd (each viewer debounces 350 ms then reloads the
whole scenario) scales with viewers × saves; the five SOP surfaces poll every
15 s in lockstep with no jitter; the proxy tests do not cover "far from
expiry → no auth call" or "near expiry → exactly one call", and comments in
`planner/client.ts:124-128` and `supabase/server.ts:12-14` still claim
middleware ran `getUser()` on every request; the extract route's DB rate gate
fails open silently on error (`extract/route.ts:91,101`); invites and
nominate send a fresh email with a random idempotency key on every call, so a
network-retried click sends twice; `/api/performance` is unauthenticated
with no limiter; no circuit breaker exists, so a dead Resend key still costs
one call per pending row per run; no jitter anywhere; CSP relies on
`'unsafe-inline'` for scripts (a nonce via the proxy is the upgrade); the
drain, template and approver-submit routes have no `maxDuration`.

### 3.4 Async, eventing, operability (35–50)

**What is done well.** The SOP outbox is a genuine transactional outbox:
AFTER triggers on `sops`, `sop_signatures`, `sop_review_seats`, annotations and
submissions write `sop_event_log` in the same transaction as the domain
change (`20260715170000:23-116`, `20260905100000:120-174`); membership uses
`audit_log` the same way. Ledgers use unique partial indexes as the claim
mutex and a conditional `attempts` bump for the retry lane, so overlapping
drains cannot double-send; content is snapshotted and sent with
`Idempotency-Key: ${ledger}:${id}`. Failures are classified
(`recipient|transient|configuration`) with 30/60/120-minute backoff and a cap
of 3; dead rows surface through health and a superadmin resend console. The
cron endpoint requires `CRON_SECRET` with constant-time comparison and fails
closed when unset. The Resend webhook verifies Svix HMAC with ±300 s
tolerance, supports key rotation, dedupes on event id and returns 500 so Svix
retries on DB failure. The PFMEA save queue is a textbook bounded single-slot
coalescer with CAS base tracking. Client flushes use `keepalive`,
`sendBeacon` and `pagehide`; nothing server-side is fire-and-forget.

**Gaps.** See F2, F5, F9, F10 and the "also material" list. Additionally:
retry rows whose SOP has moved to a later `review_cycle` are dropped by
`retryItems` without being marked, so they sit unsent, below the attempt cap,
and invisible to `deadRows` (mark them `skipped_reason='superseded'`); dead
rows older than 7 days vanish from health; ledger claim and inbox insert are
two statements and can diverge; `delivered_channels` is stamped
read-merge-write; the SOP editor, WI editor and problem workspace warn on
unload but do not flush; immutability of the append-only logs is RLS-level
only (service role can mutate; no block triggers); unfiltered child-table
realtime subscriptions deliver every org-wide row change to every open
planner.

---

## 4. Suggested remediation order

Each line is one branch of bounded scope. Order is by risk reduced per hour.

1. **Drain hardening** (F5, F10 partial, 36 cycle-stale rows, 41 suppression
   order): `maxDuration`, `AbortSignal.timeout` on three senders, per-run cap,
   `recordRun` in `finally`, stop on 429, `readAllPages` on the collector (F2),
   suppression-before-duplicate-check. All unit-testable; the drain already
   has 29 tests.
2. **Health consumer + cron cadence** (F9, F10): hourly cron or an external
   heartbeat on the GET drain; stamp a run id on drain logs. Config, not code.
3. **Password-reset limiter** (F3): DB count on `transactional_emails`,
   sweep-on-write in `createApiRateLimiter`, Vercel Firewall rule.
4. **Realtime status handling** (F4): status callback, block saves while
   unconfirmed, full refresh on resubscribe. One file plus the hook.
5. **`40001 → PT409` in-place patches** (F6): one migration following
   `20261008034342`, with the exactly-once anchor guard.
6. **Index migration** (10): drop the three duplicates, add the FK/filter
   indexes above, index `sop_release_files(storage_path)`. Verify
   `pg_stat_user_indexes.idx_scan` live before dropping anything further.
7. **EXPLAIN pass** (F7, 12): run as `authenticated` on the four hot queries,
   record plans in `docs/performance.md`, then `stable` + `(select auth.uid())`
   on the policies the plans implicate. The scope of that policy work depends
   on what the plans show, which is why it comes after measuring.
8. **Procedure-save retry policy** (F8): capped exponential with jitter,
   error-code classification. Domain-testable.
9. **Planner shell save RPC** (F1, 14 wbs parking, 6 version bypassers):
   the large one. Already Packages E–G in `docs/edit-reliability-plan.md`.
   Interim: add `version` to `taskRow`.
10. **Hygiene:** storage compensation in `media-store.ts`; unique on
    `sop_approver_nominations (sop_id, lower(email))`; sign-out cache purge;
    column-prune the planner load; retention via `pg_cron` for the log tables;
    deterministic idempotency keys for invite/nominate mail.

Topics 17, 19, 45 and 29 need no work at this architecture and scale; this
document records why so the question does not get re-asked.
