# Package D: atomic task reorder pilot

Status: implemented and tested on `codex/atomic-task-reorder`, based on published main `8f97b8a`.
**Production deployment is pending approval.** No production database, UI markup, style, dependency,
permission policy on existing tables, or other save path was changed. Do not merge the client before
the new database entry points are deployed. Catalog and delete/restore rollout remain blocked.

## Problem and bounded correction

Desktop Gantt and mobile process reorder used two `saveTasksToSupabase` calls. The first committed
`tmp-*` WBS values; the second assigned final WBS. An interruption before the second call leaves
numbering parked. The saver also writes whole task rows and synchronizes tools, although reordering
needs only WBS, zone and station.

Both screens now use `src/lib/planner/task-order-store.ts`. It reads an authorized, id-ordered
scalar-JSON baseline of
`id,wbs,zone_id,station_id,version`, checks that task membership and order still match the original
user snapshot, and sends changed placement rows in one atomic operation. The complete version map still detects
added/deleted tasks and concurrent edits anywhere in the scenario. The baseline RPC checks project
edit access and actor identity without evaluating task RLS once
per row; one JSON result contains all rows beyond the API row cap. Reading fresh versions handles
newly created tasks
whose server version is not yet in the editor; it does not replace the user's intended order with
an automatically rebased order. Concurrent unrelated fields already saved before this read are not
rewritten. A change between the read and transaction fails its version check.

The database locks the scenario (excluding concurrent FK task inserts), its product scope, tasks by
id, and placement parents. It validates project edit access, the captured actor, full task membership,
versions, unique numbering, allowed fields and placement scope. Parking, final numbering and the
receipt commit together. Existing version triggers stay enabled: changed tasks advance twice while
unchanged tasks do not advance. Only WBS/zone/station plus existing version/timestamp machinery change.

A completed operation's immutable receipt prevents duplicate replay. Retries must carry the same
actor, operation id and request; a changed payload refuses. An old retry returns current confirmed
ordering without overwriting a later operation. A transport failure retries once with the same
request; permission/conflict errors do not retry. Every attempt rechecks the current account/scope.
The database actor check closes the race between a browser account check and request submission.

On desktop, existing local saves drain before reordering. Mobile refuses while local writes are
pending. Completion merges order/version only into current editor state; failure rolls back only
our still-visible optimistic order, preserving unrelated fields and newer ordering. Existing save
status/error surfaces are reused. The remote-refresh path owns subsequent cache updates.

## Measurements

Same retained isolated fixture: 3 tasks, 3 steps, 3 tools; 2 changed tasks. Actual old saver and new
store, five sequential samples each. First latency sample excluded; four warm samples per path.

| Metric | Before | After | Difference |
|---|---:|---:|---:|
| REST requests per reorder, 3-task fixture | 10 in every sample | 2 in every sample | 80% fewer |
| Request-body bytes, 3-task fixture | 5,862 | 906 | 84.5% fewer |
| Warm median API time, 3-task fixture | 21.26 ms | 4.80 ms | 77.4% lower on loopback |
| REST requests, adjacent move among 1,100 tasks | 10 in every sample | 2 in every sample | 80% fewer |
| Warm median API time, 1,100 tasks | 23.34 ms | 15.10 ms | 35.3% lower on loopback |
| Request-body bytes, 1,100 tasks | 5,864 | 60,143 | 10.3x higher: complete version baseline |
| Independently committed task-write phases | 2 | 1 | all-or-none task placement |
| Tool-table requests in the measured reorder | 4 | 0 | no tool synchronization |

These are API measurements, not user-perceived or production latency. Request bytes exclude headers,
URL query strings, responses, auth and realtime. Both fixtures have three steps/tools and two changed
tasks. Five sequential samples per path/fixture; four warm latency samples after excluding the first.
No application-wide speed percentage is claimed. A transport retry adds an RPC.

The first full-order implementation regressed the 1,100-task adjacent move to about 295 ms. Sending
only changed placement rows cut its write payload, but the per-row baseline authorization remained
slow. The final read RPC keeps equivalent explicit authorization while checking scope a constant number
of times, and the final measurements above include that correction. Only the final samples are release
measurements. Both reads/writes return only the fields needed for their stage.

**Scale tradeoff:** the full expected-version map still costs O(N) request bytes. A tiny move on a large
scenario sends more bytes than the old changed-row path; that cost buys complete membership/version
conflict detection. Large fixtures improved on loopback, but constrained-bandwidth/production latency
has not been measured. Do not advertise an unconditional speed improvement on every network.
Raw samples and summary: `outputs/measurements/task-reorder/2026-10-04-pilot/`.

## Validation

- 2,204 unit/component tests in 255 files; 31 new cases across the domain/store files.
- 41 isolated pgTAP assertions: authorization, actor mismatch, forbidden receipt writes/deletes,
  project/placement mismatch, stale field edit, task additions/deletions, exact duplicate replay,
  token reuse, later-order protection, valid placement and mid-operation rollback.
- Five real-DB/API cases: measured small/stress request paths; old-path interruption reproduction; two actors'
  overlapping transactions (second blocks, then rejects stale versions); concurrent task insert
  (waits, then survives after commit). Fixtures are synthetic and retained.
- Two Chromium drag cases: mobile success, refusal/rollback and reload; desktop success and reload.
  Both assert one reorder RPC and no task upsert/tool write from the screens.
- Lint, production build, generated-route typecheck and bundle budgets pass. Planner entry remains
  277.1 KiB gzip; largest chunk remains 124.0 KiB. All 26 existing browser cases and both new pilot cases pass (28 total).
- Retained database suite: 462 assertions / 24 files pass (includes 64 pre-existing experimental
  assertions beyond the active production 398 / 22; this does not authorize those experimental objects).
- Initial additive prototype application left every pre-existing record unchanged: 32,389 rows over
  79 tables, including 657 users and 102 storage objects. Subsequent actor binding and the baseline
  read added RPCs only; no row DML was involved. No user record or volume was removed/reset.

## Concrete production change for review

Candidate: `supabase/isolated/2026-10-04-task-reorder/20261005022000_atomic_task_reorder.sql`.
It creates one receipt table, one six-argument write RPC and one three-argument narrow read RPC.
The receipt table is append-only through the
RPC, contains scope/version/order evidence rather than task content, enables RLS, and grants users
only SELECT of their own receipts while they retain project access. No cleanup/expiry is introduced.
Both RPCs are SECURITY DEFINER with an empty search path and explicit authorization matching existing
project edit rules; PUBLIC/anon execution is revoked. Existing table policies/constraints remain intact.

Before deployment: confirm these object names are absent on production; promote this exact candidate
and its SQL tests to the active migration/test paths; regenerate schema types and remove the temporary
pilot-only client type extension; verify clean-migration CI; then apply the single migration using the
existing safe application procedure, verify row preservation and permissions, and publish the client
only after branch CI passes. Production application is a separate decision per the approved roadmap.

Rollback means reverting the client implementation while leaving additive objects and receipts in
place. It restores the old reorder risks; there is no authorized DROP, purge, reset or record deletion.

## Limits and isolated infrastructure

Updated clients gain atomicity; existing open/offline clients and other whole-row save paths still
can overwrite ordering afterward. This pilot does not claim a global writer cutover, make every save
atomic, or solve delete/restore/catalog consistency. Receipts grow with successful operations; retention
policy requires a separate decision. A lost response after both attempts leaves an honest error until
reload, rather than declaring an unconfirmed save successful.

The retained `pulse-e2e` has an early five-argument prototype and the final actor-bound six-argument
write function plus the baseline read; the application calls only the final actor-bound pair. Its experimental ledger entry is not an active repo
migration. A future active migration must not be blindly replayed into that already-provisioned pilot
schema. Production/fresh CI receive only the final candidate. The development `pulse` database was
untouched. Test server used port 3214 after another application occupied 3100; that application was
not stopped. No notification email configuration was supplied to tests.
