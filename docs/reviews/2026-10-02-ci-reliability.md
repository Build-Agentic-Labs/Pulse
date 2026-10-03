# CI reliability review — October 2, 2026

The current application workflow is the intended behavior. This repair changes tests and CI setup, not production approval rules or database migrations.

## Findings and repairs

- The [AWI commit run](https://github.com/Build-Agentic-Labs/Pulse/actions/runs/37090563610) failed the same SOP database tests as the [preceding commit](https://github.com/Build-Agentic-Labs/Pulse/actions/runs/37084061923). Application checks passed in both runs.
- October's assignment model permits an eligible SOP member in the same organization to approve for a different department. The old reassignment test expected rejection and then attempted to sign with the displaced assignee. It now verifies cross-department assignment, restores the signing fixture, and still rejects non-SOP members and admin self-assignment.
- Invalid roster members and self-approval are now rejected at assignment time. Seat tests create valid fixtures, verify rejected assignments, and separately remove membership to test the submission guard.
- The review-submission test expected obsolete error text. It still verifies that a removed member cannot submit.
- The local seed's blanket table grants reversed migration-level revokes. Compatibility grants now name legacy tables, preserving restrictions on private payloads, notification ledgers and newer tables. Notification tests verify the actual permission-denied behavior instead of expecting zero rows after improperly restored grants.
- Added 18 master-AWI database checks: atomic creation, document uniqueness, hidden-document numbering, draft metadata, fixed published content, project isolation and denied privileged calls.
- The Supabase CLI is pinned to 2.119.0, used for the fresh local reset and test runs. GitHub action revisions are pinned; upgrades should be deliberate and validated. An older local CLI (2.109.1) produced a different local database bootstrap and failed the backup-reader permission audit before tests, illustrating why the runtime matters.
- CI now has read-only repository permission, explicit Bash failure propagation through log pipelines, 15-minute checks/database limits (25 minutes for browser setup), cancellation of superseded runs, and retained database startup/reset/test logs.
- Added a post-build type check to cover generated Next.js route types. AWI directory and builder routes are included in existing bundle limits without raising those limits.

Read-only checks against the hosted database confirmed the current assignment and active-reviewer guards. Sampled hosted privileges also matched the repaired tests: clients can read their notification inbox but cannot update it directly, and cannot read notification ledgers or private approver delivery payloads. Hosted Postgres uses major version 17, matching local configuration. This was a targeted comparison, not an exhaustive hosted schema-drift audit.

## Validation

- Fresh local reset applied all repository migrations and the corrected seed.
- 21 pgTAP files / 356 assertions passed.
- 217 application test files / 1,750 tests passed.
- Lint, production build, standalone post-build typecheck, bundle budgets, workflow YAML parsing and whitespace checks passed.
- AWI directory: 281.9 KiB gzip; builder: 272.9 KiB, under the unchanged 350 KiB reference-manifest budget. Largest emitted client chunk: 124.0 KiB, under 160 KiB.

Application validation ran on local macOS Node 22 / npm 10; GitHub runs Linux Node 24 / npm 11. The edited workflow has not yet been executed on GitHub. Local success is evidence, not a claim that the next hosted run is already green.

## What a green run means

CI checks TypeScript, lint, unit/component behavior, build compatibility, conservative client artifact-size limits, migration replay, selected database permissions/workflows and the AWI browser scenarios below. Database tests run against a disposable local database with fixtures, not production data.

It does not establish real browser navigation latency, browser media behavior, concurrent database race safety, production schema parity, recovery of every historic document, or actual email/webhook delivery. The component suite uses JSDOM and emits known canvas/navigation limitations. Bundle sizes are artifact budgets, not timing measurements. Real browser transitions and provider delivery still need focused runtime verification when changes touch them.

## Reproduce the database check

Use a disposable local Supabase database; reset replaces its local data. These commands do not target the hosted project:

```sh
npx --yes supabase@2.119.0 db start
npx --yes supabase@2.119.0 db reset --local
npx --yes supabase@2.119.0 test db --local
```

Keep compatibility seed grants limited to legacy tables. New tables should declare their intended permissions in migrations and have database tests for meaningful access boundaries.

## Browser workflow coverage

A separate Chromium job now runs the production app against a disposable Supabase stack (`pulse-e2e`, API 56321 / Postgres 56322), with no hosted credentials required. `npm run test:browser` copies repository migrations/seed into the ignored `scratch/browser-db` directory, resets only that isolated database, builds into `.next-e2e`, serves on port 3100 and stops the test stack afterwards. It refuses to reuse a running app server. The regular development server and database are unaffected.

The two workflows cover creating a numbered master through Add AWI, editing through the procedure builder, verifying database autosave, returning to the directory, reopening, recovering in a fresh browser context without planner cache, publishing through document control, and retaining a fixed release while subsequent edits show as draft changes. Fixtures are real authenticated local users with editor permissions; no application authorization bypass is added. Release readiness still requires tools and checks.

Failures retain Playwright screenshots, video, traces and an HTML report in the `browser-tests` GitHub artifact for seven days. Retries are disabled so an intermittent failure remains visible. These tests cover the AWI authoring path, not all browser behavior or a measured performance budget.

First-time local setup requires Docker and `npx playwright install chromium`; then run `npm run test:browser`. Open a saved report with `npx playwright show-report`.

Browser validation: both Chromium workflows passed against the production build. The fresh isolated stack replayed all migrations on Postgres 17.11; its 21 pgTAP files / 356 assertions also passed. Local Docker's cached ARM gateway image had a zero-byte entrypoint and needed a local image repair using the official Kong startup script. The Linux/amd64 gateway image used by GitHub was separately inspected and had a nonempty entrypoint. No image workaround or health-check bypass is added to CI. GitHub execution still requires verification after publishing.
