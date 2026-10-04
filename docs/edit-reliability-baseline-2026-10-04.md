# Edit reliability — Package A baseline (2026-10-04)

Deliverable of Package A in `docs/edit-reliability-plan.md`. Branch `codex/edit-reliability-baseline`,
created from `main` at **`438a6df`** (`fix: page and deterministically order every child read of the
single-task loader`). Everything below was measured or verified on that commit. Nothing in this package
changes application behaviour, UI, dependencies, permissions, schemas or persistence paths; the only
code added is measurement tooling under `scripts/measure*`.

Companion documents: `docs/edit-operation-inventory.md` (every production write path),
`docs/deferred-work.md` and `docs/correctness-scope.md` (status lines reconciled), and the raw
measurement run under `outputs/measurements/edit-baseline/20261004-191434/`.

## 1. Baseline refresh

### 1.1 Starting point
| Item | Value | How verified |
|---|---|---|
| Starting SHA | `438a6df` on `main`, equal to `origin/main` | `git fetch`, `git status --short --branch` |
| Main CI | green on `438a6df`, `0b41c81`, `6a0e5c3` | `gh run list --branch main` |
| Working tree before branching | clean except the untracked plan `docs/edit-reliability-plan.md` | `git status` |
| Prerequisite: injected-client procedure retry (`deferred-work.md` §6) | **complete on main** at `0b41c81` | `task-store.ts:512, 574, 599` pass the issuing client to `loadTaskFromSupabase`; the two unused functions at lines 264 and 646 still use the default, as documented |
| Prerequisite: single-task read paging + ordering (`deferred-work.md` §7b) | **complete on main** at `438a6df` | `read-store.ts:534-540`: all seven child reads use `readAllPages` with `order(<key>).order("id")`; confirmed live by the stress fixture (3 paged `step_tools` requests on the 1,100-tool task) |

The plan's "Single task read investigation" prerequisite is therefore satisfied and removed from
Package A.

### 1.2 Component sizes (physical lines, `wc -l`)
| Component | Lines | Plan figure |
|---|---:|---:|
| `src/components/mobile-photo-portal.tsx` | 4,369 | 4,369 |
| `src/components/line-workspace.tsx` | 3,652 | 3,652 |
| `src/components/sop/sop-editor.tsx` | 3,493 | 3,493 |
| `src/components/gantt-timeline.tsx` | 2,787 | 2,787 |
| `src/components/step-photo-viewer.tsx` | 2,455 | 2,455 |
| `UseWorkspaceDataOptions` fields (`use-workspace-data.ts:38`) | 39 | 39 |
| Planner persistence modules (`src/lib/planner/*.ts`) | 15 | 15 |

### 1.3 Validation on `438a6df` (run sequentially, this pass)
| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass (`--max-warnings=0`) |
| `npm test` | **2,080 tests / 247 files pass** (plan's last reported figure: 2,072) |
| `npm run build` | pass (run by the measurement tool with the isolated API inlined) |
| `npm run check:bundles` | planner entry **276.9 KiB gzip** (plan: 277.0), largest chunk 124.0 KiB; sops 281.7, planning 283.9, awi directory 286.1, awi master 275.8 |
| pgTAP (22 files) | **not rerun** in this pass; last reported 398 assertions on the retained database (`workspace-structure-handoff.md`) |
| Browser suite (`e2e/`, 20 cases) | **not rerun** in this pass; it is CI's browser job and was green on `438a6df` |

## 2. Measurements

### 2.1 What was built
- `scripts/measure-edit-baseline.mjs` — runner. Reads the isolated API keys from `supabase status`
  for the retained `pulse-e2e` project (never prints them), records the environment, rebuilds with the
  isolated `NEXT_PUBLIC_*` values inlined, runs the measurement spec, writes `summary.md`. It **never
  starts, resets or stops** a database; the operator does that and records the original state.
- `scripts/measure/playwright.config.ts` — separate Playwright config (`testMatch: *.measure.ts`,
  `webServer: next start` on :3100). CI's browser job runs `e2e/` only and cannot pick this up; vitest's
  include globs (`src/`, `app/`, `tests/`) exclude it too.
- `scripts/measure/edit-baseline.measure.ts` — seeds three deterministic synthetic fixtures into fresh
  workspaces (sizes fixed, ids unique per run), then for each sample opens a new browser context, signs in
  by cookie, and records Supabase requests by `METHOD /path`, request and response bytes
  (`request.sizes()`), app-origin bytes, phase durations and the time from the instruction field's blur to
  the row being observable in the database (20 ms poll).
- `scripts/measure/summarize.mjs` — turns a run directory into Markdown (median / min / max / n).

Rerun:
```bash
npx --yes supabase@2.119.0 start --workdir scratch/browser-db -x studio,postgres-meta,edge-runtime,logflare,vector,supavisor,imgproxy,mailpit
node scripts/measure-edit-baseline.mjs --samples 5
npx --yes supabase@2.119.0 stop --workdir scratch/browser-db
```

### 2.2 Environment (from `environment.json`)
| | |
|---|---|
| Build SHA | `438a6dfe677ad9d84e7dc58a61e951af1265f1d7`, working tree clean in `src`/`app` |
| Runtime | Node v22.16.0, Next 16.3.0, Playwright 1.63.0, Chromium 153.0.8010.12 |
| Hardware / OS | Apple M4 Pro, 24 GiB, macOS 27.0.1 (Darwin 27.0.0), Docker 29.7.2 |
| Network | loopback, no throttling; `next start` on :3100; Supabase local stack (Kong) on :56321 |
| Database | retained isolated project `pulse-e2e` (`scratch/browser-db`), started from its existing data, never reset, 151-migration ledger |
| Samples | 5 per fixture. Sample 1 = cold (first visit to that project since the server started). Every sample uses a new browser context, so the browser cache is empty in all of them. Warm = samples 2–5 (n = 4). |
| Recorder limit | Only browser-issued requests are counted. The planner and mobile pages server-render their first paint (`fetchInitialPlannerSummaryData` / `fetchInitialPlannerData`), and those server-side reads are invisible here. |
| Run time | 58 s (small), 58 s (medium), 1.1 min (stress), plus the build |

### 2.3 Fixtures (exact seeded counts)
| Fixture | zones | stations | tasks | steps | step_tools | Purpose |
|---|---:|---:|---:|---:|---:|---|
| small | 0 | 0 | 1 | 1 | 0 | reproduces the historical 61/5 fixture exactly |
| medium | 3 | 6 | 40 | 200 (5 per task) | 400 (2 per step) | a plausible workflow; **not** a measured "typical production project" (anonymized production counts were not obtained) |
| stress | 2 | 4 | 1,100 | 1,100 (1 per task) | 1,100 (all on task 1's single step) | crosses the 500-row read page for tasks, steps and step_tools, and the 1,000-row API cap for step_tools on one task |

No photos, videos or exploded views are seeded (they need storage objects); media paths are therefore
measured only as empty reads.

### 2.4 Request counts by phase (Supabase requests per sample; endpoint tables in `summary.md`)
| Phase | small | medium | stress |
|---|---:|---:|---:|
| open planner | **61** (one sample 60) | 61 | 124 (one sample 119) |
| switch to Procedure | **5** | 5 | 5 |
| edit step 1 instruction (blur → settled) | 14 | **18** | 16 |
| open mobile portal | 30 | 30 | **114** |

**Comparison with the historical 61/5/0 figures:** the small fixture reproduces 61 on open and 5 on the
first Procedure switch, with identical per-endpoint counts to `req-release-1.json`. The historical "0 on
other switches" was not re-measured (this run switches once). The medium and stress numbers are **new**
and were never measured before.

Variance: the one 60 and the one 119 are the only differences between samples. Both come from the
access-bootstrap reads (`is_super_admin`, `project_access`, `projects`, `workspace_members`,
`workspaces`) issuing one fewer duplicate; the planner-data endpoints were identical in every sample.
This is measurement noise from concurrent bootstrap paths, not a data difference.

### 2.5 Bytes (median response bytes, Supabase only)
| Phase | small | medium | stress |
|---|---:|---:|---:|
| open planner | 46.8 KiB | 265.1 KiB | **2,195 KiB** (tasks 1,319 KiB over 3 pages; steps 385 KiB over 11 batches; step_tools 327 KiB over 13 requests) |
| switch to Procedure | 3.1 KiB | 3.1 KiB | 3.1 KiB |
| edit step instruction | 9.8 KiB | 16.1 KiB | 293.6 KiB (284 KiB is the 3-page `step_tools` confirmation read) |
| open mobile portal | 23.6 KiB | 245.1 KiB | **2,277 KiB** |
App-origin bytes (document, chunks, RSC) on planner open: 651–685 KiB in every fixture.

### 2.6 Persistence timing (procedure step instruction edit, desktop)
| Fixture | blur → row observable, cold | warm median (min, max, n=4) |
|---|---:|---|
| small | 802 ms | 801 ms (786, 805) |
| medium | 776 ms | 796 ms (790, 801) |
| stress | 769 ms | 762 ms (755, 776) |
The figure is dominated by the queue's 750 ms debounce (`PROCEDURE_SAVE_DEBOUNCE_MS`,
`use-procedure-save-queue.ts:34`); the network and database part is roughly 15–50 ms on loopback. Four
warm samples per condition is far below the plan's 30-sample target for latency comparisons; these are
baseline reference points, not a statistical basis for regression gates.

Other phase timings (warm medians): planner open 377 / 377 / 638 ms, Procedure switch 68 / 72 / 214 ms,
mobile open 126 / 216 / 1,251 ms (small / medium / stress).

### 2.7 Facts the numbers established
1. **The procedure save writes every step of the task, not only the edited one.** On the 5-step task one
   instruction edit issued 5 `PATCH manufacturing_steps`; on 1-step tasks, 1. This matches
   `task-store.ts:557-588` (one version-checked update per step). It is correct behaviour today, but it
   means a procedure edit's request count scales with the task's step count.
2. **The paging fix behaves as designed under load.** The stress fixture's confirmation read fetched
   `step_tools` in 3 requests (500 + 500 + 100) where the pre-fix loader would have received a silently
   capped 1,000 rows.
3. **The mobile portal loads media tables for every task on open** (`step_photos`, `step_exploded_views`,
   `task_videos`: 11 batched requests each on 1,100 tasks), which the desktop open does not. Browser-issued
   requests on the stress fixture: desktop open 124, mobile open 114; the mobile open is smaller in count
   because it omits 43 of the desktop's requests (29 SOP, notification, department and tool-library
   reads, plus 14 fewer access-bootstrap duplicates) while adding 33 media reads. Mobile response bytes (2,277 KiB) slightly exceed the desktop's (2,195 KiB). These are
   browser-only counts: both pages also server-render their first paint, and that server-side work is
   not measured here, so neither figure is the page's total cost. (An earlier draft of this document
   compared mobile stress with mobile small, 114 vs 30, and called it a desktop ratio; that was wrong.)
4. **Request counts are deterministic on the planner-data endpoints** across all 15 samples; only the
   access-bootstrap duplicates vary.

### 2.8 Isolated infrastructure handling
- `supabase_db_pulse` (the development project, port 55322) was running before this work and was
  **never touched**; it is still running.
- The retained `pulse-e2e` project was **stopped** before this pass (its two volumes present). It was
  started from its existing data, never reset, and **stopped again** afterwards (`supabase stop`,
  backup kept). Its migration ledger is unchanged (151 before and after). Row counts grew only by the
  seeded fixtures and the server's own bookkeeping: `tasks` +1,141, `manufacturing_steps` +1,301,
  `step_tools` +1,500, `zones` +5, `stations` +10, three each of `workspaces`, `projects`, `products`,
  `scenarios`, `profiles`, `project_access`, `workspace_members`, `workspace_auto_join_domains`,
  `auth.users`; `notification_drain_runs` +19 (the app's own health polling); `document_type_codes` +12
  (starter plan). Full delta: `outputs/measurements/edit-baseline/20261004-191434/retained-db-delta.json`.
  Previous measurement runs left their fixtures in the same way.
- The two stopped `pulse-release-*` projects and their volumes were not touched. No volume was deleted.
- No production system was read or written.

## 3. Reconciliation of the planning documents
- `docs/deferred-work.md`: every section now carries a dated status line (verified current / fixed /
  historical / not yet verified). Stale items corrected: `schedule-import.ts` no longer exists;
  `version.ts` is wired; `/design/nothing` CSS is imported; CI exists; the `org_tool_access` write policy is
  workspace-scoped since `20260811120000`; §6 and §7b are fixed on main. Confirmed current: `numbering.ts`
  unwired, `canTransitionSop` uncalled, in-memory rate limiting, §7a and §7c.
- `docs/correctness-scope.md`: status note added at the top — the branch was merged (`5526cfe`), the
  isolated migration is still outside the active paths, **the catalog rollout remains BLOCKED**, the
  release-checklist item (§2 step 2) is still not written, "What resumes now" is historical. Incident
  history retained verbatim.
- `docs/edit-reliability-plan.md`: baseline table refreshed, the single-task prerequisite marked
  complete, Package A marked delivered.
- Not reconciled (out of scope, noted for later): `docs/workspace-structure-handoff.md` items 7 and 9
  are stale since the two fixes; `docs/restore-step-design.md` cites line numbers that have drifted by
  up to two lines.
- Catalog rollout and experimental database deployment stay **blocked**. No isolated function was
  activated or referenced.

## 4. Recommended first Package B slice — extract the hook-free capture-session utilities

Full dependency map: 39 `useState`, 43 `useRef`, 23 `useEffect`, 14 `useMemo`, 6 `useCallback` and about
95 inner functions in `MobilePhotoPortal` (lines 809–3346), followed by one 1,020-line JSX return. State
clusters: planner core, capture session, new-step draft, write coordination, navigation/ordering,
layout. Candidate boundary sizes today (estimates from declaration ranges): capture session ~815 lines
(of which ~337 are hook-free functions at lines 137–148 and 152–476), new-step drafts ~650–700,
write coordination ~240, media actions ~275, navigation/ordering ~350, view JSX ~1,080.

**Recommendation:** move lines 137–148 and 152–476 of `mobile-photo-portal.tsx` verbatim into a new
plain module. This is the only boundary with **zero** cross-boundary setter or ref edges. It is hook-free
but **not entirely pure**: it contains pure calculations (types, constants, timer arithmetic, snapshot
building and normalization, header-chip derivation) **and** `localStorage` functions
(`readMobileCaptureSession`, `writeMobileCaptureSession`, which read, write and remove the
`pulse:mobile-capture-session:*` and legacy `pulse:capture-timer:*` keys and swallow quota errors). No
hook, effect or JSX moves. The storage functions are why the characterization tests below run under
jsdom with a real `localStorage`.

- **New file:** `src/components/mobile-photo-portal/capture-session.ts` (touches `window.localStorage`,
  so not `src/domain/`). Plain module, no `"use client"` directive (CLAUDE.md: values shared across the
  boundary belong in plain modules).
- **Exports (names and signatures unchanged):** types `CaptureTimerState`, `ParkedTaskCaptureState`,
  `MobileCaptureSessionSnapshot`, `HeaderCaptureTimerEntry`; `EMPTY_CAPTURE_TIMER`; `formatElapsedTimer`,
  `elapsedMinutesFromTimer`, `mobileCaptureSessionStorageKey`, `legacyCaptureTimerStorageKey`,
  `readMobileCaptureSession`, `writeMobileCaptureSession`, `buildMobileCaptureSessionSnapshot`,
  `shouldPersistMobileCaptureSession`, `restoreRunningCaptureTimer`, `getCaptureTimerElapsed`,
  `getCaptureTimerLapElapsed`, `freezeCaptureTimer`, `preserveRunningCaptureTimer`,
  `collectHeaderCaptureTimers`, `isActiveHeaderCaptureTimer`. `isRecord` and the `normalize*` helpers stay
  module-private unless a test needs one.
- **Stays in the component:** all state (lines 869–873), effects 1059–1169, every handler from 2620 on.
  Call sites do not change text.
- **Why not the IndexedDB helpers (569–637) first:** also zero-edge and ~70 lines, but their single fixed
  key `mobile-new-step-draft-v1` is a scoping defect Package C will redesign; moving them now invites
  "fixing" them in an extraction commit. They are the natural second slice.
- **Why not media:** `use-workspace-media.ts:61-120` already implements the same upload/rollback shape,
  so media is where **reuse may beat extraction** — but only after the mobile write lock
  (`localWriteCountRef` / `photoUploadQueuesRef`) is reconciled with `WorkspaceWriteTracker`, which is a
  behaviour change, not an extraction.

**Characterization tests to write before moving anything** (today there are none for any of this: no
test mentions `captureTimer`, `mobile-capture-session`, `Start timer` or `pulse:capture-timer`):

Unit, new `capture-session.test.ts` (jsdom, real `localStorage`):
1. Key builders produce the literal strings `pulse:mobile-capture-session:<id>` / `:default` and
   `pulse:capture-timer:<id>` / `:default`.
2. `writeMobileCaptureSession` with a running timer stores `storedElapsedMs` = elapsed at `now`,
   `startedAt: null`, parked timers frozen the same way, legacy key removed; with an empty session both
   keys are removed.
3. `readMobileCaptureSession` round-trips (2); malformed JSON → null; timer without boolean `running` →
   null; legacy-key-only payload → `activeScreen: "detail"` when `taskId` is set, `showNewStepForm =
   Boolean(activeStepId)`, parked `{}`.
4. `normalizeParkedTaskCaptureState` drops entries lacking `taskId` / `activeStepId`; defaults
   `draftDurationText` to `"5"` and `newStepId` to `timer.activeStepId`.
5. Timer arithmetic at a fixed `now`: stopped vs running elapsed; freeze / preserve / restore; lap elapsed
   clamps at 0.
6. `collectHeaderCaptureTimers`: an active timer overrides the parked entry for the same task; inactive
   entries are excluded.
7. `elapsedMinutesFromTimer` / `formatElapsedTimer` at 0, 59,999 and 3,600,000 ms.

Component, extend `mobile-photo-portal.test.tsx` with fake timers:
8. Timer park/resume: start on task A, advance 65 s, select B → the session key holds
   `parkedCaptureByTaskId[A].timer.running === true` and the current timer is empty; A's header chip
   still renders; select A → resumed, parked map empty.
9. Reload hydration: pre-seed a running session for A with the draft form open; render; assert the detail
   screen, the open draft panel and an elapsed ≥ the seeded value.
10. Pending edits during selection and unmount: type in the new-step name, immediately select another
    task → exactly one `saveMobileStepToSupabase` call before the switch; unmount with the autosave timer
    armed → **document the current behaviour** (no save fires — a known gap, not a target to fix here).
11. Late response after task change: let `saveMobileStepToSupabase` resolve after the selection changed;
    assert the `onSaved` path does not open a draft on the new task (guard at line 2029).

**Acceptance criteria**
- `git diff mobile-photo-portal.tsx` consists only of the removed lines 137–148 and 152–476 plus one
  added import block; no JSX line changes; hook and effect declaration order unchanged.
- Tests 1–11 pass before the move (against the component file) and after (against the module), and tests
  8–11 record an identical `saveMobileStepToSupabase` / `uploadStepPhotoAttachment` call sequence before
  and after.
- Typecheck, lint, full vitest green; the optimized build shows no new chunk and no bundle growth above
  measurement noise (the module is imported only by the same dynamic chunk).
- Rerun `scripts/measure-edit-baseline.mjs`: identical per-endpoint counts on all three fixtures for
  `mobile:open`.
- No new production write path, no new storage key, no UI change.

Cases the plan names that belong to **later** slices, not this one: new-step recovery, upload failure,
rejected delete, retry ordering.

## 5. Remaining unknowns (explicit, not assigned zero risk)
- Typical production project size is not known; the medium fixture is a guess. Obtain anonymized counts
  before claiming any fixture is representative.
- Server-side first-paint reads are not in the request counts.
- Media-bearing fixtures (photos with storage objects, signed-URL traffic) were not measured.
- Latency samples are 1 cold + 4 warm per condition on loopback; no network profile other than loopback.
- pgTAP and the browser suite were not rerun in this pass (CI green on the SHA is the evidence).
- Code-derived defects in the inventory that were **not reproduced live**: desktop "Restore Task/Zone"
  after autosave losing children (§2.2 of the inventory), photo-paste `custom_fields` overwrite (§4.5),
  the webhook suppression gap (§8 W12), mobile removed-draft-photo rows reappearing (§5.2), and the mobile
  idle-draft adoption race (§5.16).
- Unverified items listed in inventory §11.8 (AWI `stepToolLists` stripping, release `content_hash`
  validation, mobile id collisions, SolidWorks plugin retry/versioning, operator process adherence,
  `/design/nothing`).

## 6. Package A status
Delivered: baseline refresh (§1), edit-operation inventory (`docs/edit-operation-inventory.md`, 68
operation and topic sections, unused exports separated), reproducible measurement tooling and a first
run (§2), planning-document reconciliation (§3), first Package B slice proposal (§4). Not done, by
instruction: no Package B code, no merge, no push, no production or isolated-database function changes.
