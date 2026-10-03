# Performance checks

Run `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`, and
`npm run check:bundles`. Finish a build before running standalone typechecking;
Next generates route types during the build. Development uses `.next-dev` and
production builds use `.next`.

CI builds with placeholder public Supabase configuration and enforces gzip
budgets of 160 KiB per JavaScript chunk and 350 KiB for the referenced client
entry code of Product, SOPs, and Planning. Entry budgets exclude deferred feature
chunks; these measurements are artifact sizes, not total network transfer or
page-load timings. Investigate a budget failure before raising a limit.

Production browsers send LCP, INP, CLS, FCP, and TTFB to `/api/performance`.
Filter hosting logs for `"event":"web-vital"` and group by metric and route.
The collector records metric values and route shapes, strips query parameters
and dynamic project/document IDs, and omits resource entries. Development does
not report metrics. A custom HTTPS collector can be configured using
`NEXT_PUBLIC_WEB_VITALS_ENDPOINT`; its origin is included in the connection policy.
This public setting is applied at build time.

Planner calculation snapshots are local to each workspace component. Instruction
text and part-mention edits reuse scheduling results; live task content remains
the source for display and saving. Core confirmation still gates autosave, and
private-media hydration only merges media fields into the current task.

Workspace save feedback combines procedure queues (including debounce/retry timers)
with independent tool, photo, catalog, BOM, and planner writes. An unrelated
successful write or refresh cannot clear a failed save; a confirmed replacement
for that operation clears it. Tracking is scoped to the current project, and the
existing navigation guard waits for these writes too. Browser checks hold and fail
real requests to verify both completion orders and draft recovery. Immediately
drained procedure edits cancel their old debounce timer to prevent stale replays.

List and planner graph loaders paginate internally with deterministic ordering;
child queries also bound their ID filters. They return complete collections and
throw on any failed page, preserving the existing scrolling/filtering UI. This
prevents default API row-limit truncation but does not make total collection
transfer constant-size. Visible pagination and large-editor virtualization remain
separate product changes. Real-user latency, database query plans, and hosting
region alignment must be measured in the deployed environment.


### Notification batching and editor opening — October 3, 2026

The workspace notification collector now pages the audit outbox, ledger coverage,
recipient context and retries. ID lookups contain at most 100 values; redeemed
invites group 50 participant pairs per query, avoiding a workspace/recipient
Cartesian request explosion. Email suppression filters also have a conservative
encoded-length budget. Every page has a unique ordering tie-breaker. Existing
membership decisions, preferences, suppression, duplicate claims, retry leases
and recorded message content remain unchanged. A failed page rejects the whole
collection rather than using a partial delivery bundle.

A retained local fixture with 500 pending workspace welcomes reproduced the old
URI-too-long error in all five runs. The largest request URL fell from 19,680 to
4,054 bytes (79.4% smaller). The corrected collector returned all 500 items in
all five runs, with zero HTTP failures and a 28 ms median collection time. These
were read-only collection calls: no claims or email sends, and table counts
remained unchanged. This is a reliability result, not a speed comparison against
the failed old collector. Automated fixtures separately cover 2,107 outbox events,
1,205 retry rows, child collections beyond the API cap, and later-page failures.

Procedure now loads with the already deferred LineWorkspace module. This removes
a nested code-loading/Suspense boundary while retaining server summaries, the
same skeletons and controls, fresh permission checks, core confirmation before
editing, and lazy private-media hydration. Other feature panels remain lazy.
Importing code does not mount hidden panels or issue their database reads.

The production-build browser benchmark uses an isolated retained database and
five fresh authenticated browser contexts per screen/latency case. The Product
fixture contains one task and one manufacturing step. Readiness is the visible,
editable instruction; AWI also waits for Saved. Dashboard timing is first visible
Line readiness content, which can use the server summary. Measurements come from
browser animation frames rather than assertion polling. The 80 ms delay is
simulated per browser database request; server requests remain local.

| Screen / condition | Before median | After median | Change |
| --- | ---: | ---: | ---: |
| Product Procedure, local | 996 ms | 694 ms | 30.3% faster |
| Product Procedure, added 80 ms/read | 1,179 ms | 912 ms | 22.6% faster |
| AWI editor, local | 223 ms | 190 ms | 14.8% faster |
| AWI editor, added 80 ms/read | 794 ms | 678 ms | 14.6% faster |
| Dashboard first paint, local | 336 ms | 330 ms | Essentially unchanged |
| Dashboard first paint, added 80 ms/read | 330 ms | 330 ms | Unchanged |

Tradeoff: a cold Dashboard downloads about 31 KiB more encoded JavaScript because
Procedure accompanies the workspace. Editor transfer falls slightly (1,248 bytes)
by removing the extra loading wrapper/chunk arrangement. The measured Dashboard
first paint stays stable, and client entry/chunk budgets pass. These local fixture
results do not establish deployed latency or large-product performance.

Validation: 1,814 automated tests and 15 real browser tests passed, plus production
build, typecheck, lint, and bundle budgets. The view-only browser check excludes
only the certified read-only permission/scope RPCs from its POST mutation monitor,
retains all save RPCs, and observes past the edit debounce before checking that the
stored instruction remains unchanged. No production data or schema was modified.

## Recovery follow-up (2026-10-03)

The save review found two recovery gaps. A failed master BOM write remained in
the tracker and blocked its own Retry action. The save barrier now allows that
specific retry while continuing to block unrelated failures and procedure
conflicts, and to wait for active or debounced edits. Its failure stays visible
until the replacement write is confirmed.

Failed video/exploded-view deletions now restore the affected item into the
current task so the existing Delete control can retry. This merges the item
without restoring an obsolete task snapshot or losing instruction edits made
while the request was pending. Storage cleanup still follows a successful row
deletion only. No new controls, schema changes, or production-data changes.

Regression coverage includes a failed BOM replacement followed by Retry without
reloading, preservation of the previous confirmed BOM, and both media deletion
failures with concurrent instruction edits, successful retries, and navigation
after saving. Pure barrier tests also cover unrelated errors, conflicts, and
pending writes.

Validation: 1,820 automated tests passed. The browser suite passed 17 cases;
the new BOM test initially omitted the existing replacement-confirmation click.
After correcting that test, the BOM recovery case passed separately (all 18
cases verified). Optimized browser build, typecheck, lint, and bundle budgets
passed. The isolated database was stopped with its fixtures retained.

The first publishing CI run exposed a browser-test readiness race after a cached
AWI reload: Playwright typed while the displayed editor still had an inert
ancestor pending fresh core/access confirmation. The trace showed no tool-save
request. Release preparation now waits for that existing editability gate, and
the media test adds a 500 ms core-read delay after its measurement samples to
exercise this interval. Durable row, media, and release assertions remain in
place. The corrected case passed three consecutive local runs with no retries.
