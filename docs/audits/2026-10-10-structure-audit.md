# Pulse structure audit (2026-10-10): structure for performance and maintainability

**Date:** 2026-10-10

**Base:** `main` at `e9dd1a3` (feat: link Gantt tasks to master AWIs), clean tree.

**Mode:** read-only. No application code, dependencies, database or hosted environment was touched. The only commands run were targeted reads, a handful of single-file `vitest` runs, and read-only analysis of the existing `.next` build. This file is the only artifact.

**Method:**
- Measured inputs: a static import graph (851 TS/TSX files) and the production build at HEAD (`.next`, BUILD_ID `wjowUdcpj8UZhKsex23OY`).
- Review: 9 parallel dimension auditors (routes, API, data layer, domain, dead code, client performance, unaudited surfaces, drift, platform), then completeness-critic gap auditors (DB query performance, test architecture, error handling/observability).
- Verification: every finding was adversarially verified against source. All P0/P1 defects (DRIFT-2, DRIFT-3, PERF-1, SURF-2) were re-checked independently from the UI entry point down to the DB write.
- Totals: 130 findings, 54 confirmed, 76 confirmed with corrections, 0 unverifiable. No finding was refuted outright, but verifiers corrected about 60 sub-claims (counts, lines, triggers, provenance). Appendix A lists them. Where a verifier corrected a count, line or severity, this report uses the corrected value.
- Lead verification: the lead re-traced all four P0/P1 defects in source (DRIFT-2 test re-run at HEAD) and re-measured two CI facts. An independent model then re-checked a stratified sample of 18 P2 claims: 16 held, 2 held partly, 0 were wrong. Severities it judged one notch high are lowered here (Appendix A.1).

**Scope note:** these areas are excluded by owner decision:
- the Planning space (`src/lib/planning`, `src/components/planning`, `app/planning`, `src/domain/planning`)
- SOP approval routing (routing state, workflow-view derivation, approval writes)
- the mobile C1 scoped recovery-drafts design
- extractions justified only by line count

CLAUDE.md hard rules and "Deliberate decisions" are binding. Recommendations that cut into excluded areas were trimmed (Appendix D).

Labels:
- **CONFIRMED DEFECT**: the wrong code path is fully visible.
- **STRUCTURAL**: an ownership, coupling or testability problem, not a bug.
- **PERFORMANCE**: a render, network or bundle cost with a named mechanism.
- **HYGIENE**: dead code, stale docs or config.
- **HYPOTHESIS**: plausible from code; needs runtime or DB confirmation.
- **[rechecked]**: an independent second trace from the UI to the database.

---

## 0. Headline

- **The skeleton is healthy.**
  - There are **0 runtime import cycles**; the only two type-level cycles are one misplaced import each (RT-8, DOM-9).
  - No mutation happens during RSC render, on any server-seeded page outside Planning.
  - Module-level state in shared code is WeakMap-keyed by client, as CLAUDE.md requires.
  - Coordinators did not regrow. `line-workspace.tsx` went from 3,656 to 2,821 lines and from 37 to 30 `useState`.
  - The Phase 0–1 fixes from 2026-10-08 are all present at HEAD.
  - There are 0 TODO/FIXME markers, 0 commented-out code blocks and 0 `as any` outside Planning.
- **Two live data-loss paths in the product planner come before any refactor.**
  - Switching back to a cached Gantt scenario lets the next edit delete or revert a teammate's rows. The repo's own characterization test proves this (DRIFT-2, **P0**).
  - The one-day-old Gantt↔AWI link has a "linked task owns no procedure" rule that only some client write paths enforce. Moving a step into a linked task, or capturing on the phone, writes rows that then become invisible (DRIFT-3, **P1**).
  - The same feature put an unbatched N+1 read into *every* planner load. One failed per-link request now fails the whole load (PERF-1, **P1**).
- **The main structural blocker for navigation performance is the client session, which has no owner.**
  - Every product space mounts its own auth gate per page. The SOP space re-implements the same gate (8 commits changed both in lockstep).
  - 10 components subscribe to auth events independently.
  - A tab return reloads the groups, unthrottled, in every gate.
  - Navigation therefore cannot cost less than auth plus groups twice, plus profile and notification reads (RT-6/RT-7/SURF-3/SURF-4).
- **A planner persistence barrel ships on every route, and the SOP editor routes are over the bundle cap with no CI check.**
  - Through the root layout, `@/domain/supabase-planner` puts about 25 KiB gzip of planner write, realtime and task code into every route, `/login` included (DATA-1/DOM-1/PERF-2).
  - The SOP editor routes are 361.6 KiB against a 350 KiB cap, and CI checks only 5 of 34 routes (PLAT-1).
  - Narrowing the facade safely depends first on retargeting 28 test mocks. Otherwise about five guard assertions in the planner data-loss tests silently become no-ops (TEST-1; several of those tests keep other, positive assertions).
- **About 3,300 lines can be deleted with no behavior change**, including a deployed, caller-less endpoint that spends OpenAI tokens (DEAD-1).
  - Prior Phase 2 item 10, golden tests for the allocation engine, now targets dead code and should be redirected to the live allocation surface, which has no tests (DOM-3).
- **The coming performance work has no way to measure its effect yet.**
  - There is no error reporter and no `instrumentation.ts`.
  - The 14 server first-paint fallbacks are silent.
  - The web-vitals route normalizer mislabels 3 screens.
  - The date-only controlled-document regression test cannot fail on CI's UTC runners (ERR-1/2/8, PLAT-4).

---

## 1. What changed since the 2026-10-08 audit

**Commits since base `e47add7`:** 22.
- 9 are Phase 0/1 fixes.
- 6 are features or fixes: 87ce032 product-module RBAC, d249952 and 9e03a8c shared controls, 2b6ff60, 6bc115e WI pagination, e9dd1a3 Gantt↔AWI link.
- The rest are docs and merges.

### 1.1 Backlog status (DRIFT-1, DEAD-8; confirmed with corrections)

| Prior item | Status at HEAD | Evidence / note |
|---|---|---|
| §0.1 date-only parsing | **Done** (f186348) | `formatting.ts:67-122`. Regression test cannot fail in CI (§2.5, PLAT-4/TEST-8) |
| #2 photo-switch cross-save | **Done** | `step-photo-viewer.tsx:2016-2017` cancel/lost-capture handlers |
| #3 `useMobileWrites` | Untouched; **mobile D2 still live** | One `saveState` string (`mobile-photo-portal.tsx:236`), 40 setters, 12 `setErrorMessage(null)` clears; Retry only while `errorMessage` set (2973-2976); `hasLocalSaveWork` counts failed patches (779-781) |
| #4 planner save session | Step 1 done (611e4f4, eec16ec); step 2 untouched | Option bags still 38/26/25 (`useWorkspaceData`/`Scenarios`/`Realtime`); leftovers in DRIFT-6 |
| #5 dead planner code | Client half done (2462bb4); **server half left behind** | DEAD-1 |
| #6 mobile `settleWriteBatch` | **Done** (0df3711) | 1446, 1901, 2037 |
| #7 SOP review-conversation hook | Partial | Poll gated (`domain/sop/review-polling.ts`); 3 fetchers still repeat the cycle filter |
| #8 command reducers | Untouched | Step-duration rule still re-derived 5× (DOM-5) |
| #9 `buildGanttLayout` | Untouched | `gantt-timeline.tsx` has 0 `useMemo` and no test file |
| #10 mobile new-step controller | Untouched; **mobile D1 still live** | `handleNewStepPhotoFiles` 2629-2649 reads render-closure state after `await` |
| #11, #12, #14, #17, #18, #19 | Untouched | #11 also seeds approval seats (parked area) |
| #13 print preview | Partial | Attachment churn fixed; fallback untouched (Change History still duplicated) |
| #20 allocation golden tests / Phase 2 #10 | **Obsolete** | All three targets are now unreachable (DEAD-1). Redirect to the live surface (DOM-3) |
| Phase 2 #7, #8 | Untouched | #9 partial |
| Phase 3, Phase 4 | Untouched | Gantt dialogs were only wrapped in `ModalSurface` |
| §4.3 D5 (scenario switch-back) | **Status change: HYPOTHESIS → CONFIRMED, still open** | DRIFT-2 (P0) |
| §4.5 F3 (user-unscoped caches) | **Status change: the purge added in 87ce032 is a no-op** | SURF-1 |
| §4.1 D7, D8; §4.2 D8, S2; §4.3 D2, D3, D6, D8, D9, D10; §4.4 H | Still present | DRIFT-1 |
| §4.4 D3 | Partial | In-place mutation fixed; persist still runs inside a state updater |
| §4.5 lib→components imports | Still present | `render-image.tsx:6-7`, `wi-photos.tsx:6` |
| §4.5 `queue-ready`↔`review-queue-data` type cycle | **Resolved** | Only a type-only domain→lib edge remains (DOM-10) |
| §6 consolidation table (13 rows) | 2 fixed (`copyTextWithSelection`, `formatDate` copy); 11 open; **role predicates grew from 8 sites to 20 lines in 13 files** | DEAD-8, SURF-8 |

### 1.2 New debt introduced since the base

- **e9dd1a3 (Gantt↔AWI link):** the link invariant is enforced on the client only (DRIFT-3). Link resolution runs in the generic read path as an N+1 that can fail the load (PERF-1/DRIFT-4). The new focus-refresh effect landed in the coordinator.
- **87ce032 (Product RBAC):** Settings → Projects was not migrated (SURF-2). The sign-out purge is a no-op (SURF-1). A third project-context role rule appeared (RT-11). 87ce032 also maintained the orphaned activity feed and edited four e2e specs that have never run in CI (PLAT-3).
- **2462bb4 (dead-code removal):** it deleted the client half of the LLM allocation and left the route, solver, playback and `taskTone` (DEAD-1). There is no tooling to stop that recurring (DEAD-12).
- **d249952 / 9e03a8c (UI primitives):** two button systems now sit side by side and already render differently (DEAD-9/SURF-10).
- **6bc115e (WI pagination):** a second, hand-built DOM renderer is used for text measurement and already differs from the real one (DRIFT-7).
- **7e4ad78:** paused both browser CI jobs. 23 commits have landed since (PLAT-3).

**Coordinator debt did not migrate back.**
- `mobile-photo-portal`, `sop-editor` and `sop-print-preview` hook counts are identical to the base.
- Gantt `useState` went from 18 to 17.
- The only new coordinator effect is e9dd1a3's focus refresh.

---

## 2. Confirmed defects

### 2.1 Switching back to a cached scenario lets the next edit delete or revert a teammate's work: CONFIRMED DEFECT, P0 [rechecked] (DRIFT-2; same mechanism as ERR-4)

- **Where:** `loadScenarioIntoView` applies `scenarioCacheRef.current.get(scenarioId)` with no reload (`use-workspace-scenarios.ts:139-143`). `applyScenarioSwitch` (88-110) never resets `remoteStateConfirmedRef`.
  - Realtime is scoped to the active scenario only and does no catch-up on resubscribe (`use-workspace-realtime.ts:347-390`).
  - The cache is cleared only on a project change (`line-workspace.tsx:336-338`).
  - `savePlannerShellToSupabase` diffs against the DB per `scenario_id`. It deletes stale tasks, stations, zones and components, and upserts the stale copies of existing rows.
  - `assertSaneStateDeletion` does nothing below 5 rows or at a deletion fraction of 50% or less.
- **Proof:** the repo's own test, `use-workspace-scenarios.test.tsx:166-200`, titled "OBSERVED: … the first edit's shell save would delete a task inserted server-side … (the deletion tripwire does not trip)", asserts `wouldDelete == [["task-b2-remote"]]`. It was re-run at HEAD and **passes**.
- **Trigger:** two editors are on one product.
  1. User 1 goes from Main (seeded into the cache by the mirror effect, `line-workspace.tsx:340-344`) to a duplicate and back.
  2. Meanwhile the teammate adds or edits rows in Main.
  3. User 1 makes any shell edit.
  4. 900 ms later the teammate's inserts are deleted and their edits reverted. Neither user sees an error.
- **Fix (S, Med risk):** on a cached switch-back, paint from the cache but set `remoteStateConfirmedRef` false **and** `setHasConfirmedRemoteState(false)`. Start a background `loadPlannerStateFromSupabase(projectId, scenarioId)` tagged with the requested scenario id, discarding the result if the user has switched again.
  - Confirm only when that load lands. On failure, stay unconfirmed and surface an error.
  - The existing guard (`use-workspace-saves.ts:496-501`) then blocks the destructive diff.
  - A simpler alternative: evict the cache entry for the scenario being left.
  - Flip the OBSERVED test into the regression test.
  - Violates no CLAUDE.md rule; it narrows the existing diff save and adds no new path.

### 2.2 Gantt↔AWI link: the "linked task owns no procedure" rule has no DB enforcement; two reachable paths hide data and one blocks the feature: CONFIRMED DEFECT, P1 [rechecked] (DRIFT-3, absorbs DEAD-4)

- **Where:** the rule exists only as client guards: throws in `task-store.ts:169, 199, 480`, filters in `row-mappers.ts:644, 679`, and an early return in `line-workspace.tsx:1603`. e9dd1a3 shipped no migration.
- **(a) Step move:**
  - The move target list is `tasks.filter(rowType === "task" && id !== task.id)` (`procedure.tsx:339-342`), so linked tasks are offered as targets.
  - `moveManufacturingStepToTaskInSupabase` (`task-store.ts:620-661`) commits `manufacturing_steps.task_id` first (646-651). It then moves `step_tools`/`step_photos` (653-656), saves the source (659), and only then throws on the target (480).
  - The catch rolls back local state only (`line-workspace.tsx:1696-1699`).
  - On reload, `resolveLinkedAwiTask` swaps in the master's steps (`read-store.ts:574-582`). The moved step, photos and tools are now invisible on both tasks.
- **(b) Phone:**
  - `mobile-photo-portal.tsx` has no `awiTaskLink` reference and shows the master's steps.
  - A new step goes through the unguarded `saveMobileStepToSupabase` (`task-store.ts:206-262`). It inserts under the planning task and rewrites `tasks.planned_duration_minutes` from those hidden rows (254-259). Photos and tools go under the planning task too.
  - All of it disappears after a reload.
  - Editing a displayed master step fails with a misleading "This step was deleted on another device" (240-242).
  - Desktop is guarded at `line-workspace.tsx:2575`.
- **(c) Duration:**
  - New linked tasks get `plannedDurationMinutes: 0` (`line-workspace.tsx:2223`).
  - The Gantt input is read-only once steps exist (`gantt-timeline.tsx:1616, 1629-1631`), and `enforceStepDerivedDuration` strips patches (`task-mutations.ts:50-66`).
  - The task is therefore stuck at 0 min whenever the master has at least one step. This contradicts the picker copy "Plan this task's timing and operators here".
- **Fix (M, Med risk):** follow CLAUDE.md recipe step 1.
  - Add a BEFORE INSERT/UPDATE trigger on `manufacturing_steps`, `part_references`, `step_tools` and `step_photos` that rejects rows whose task carries `custom_fields ? 'awiMasterLink'`. Confirm first that seed and fixtures never create linked tasks with steps.
  - Validate the move target before any write (better still, make the move a single RPC), and exclude linked tasks from `moveTargetTasks`.
  - Make mobile treat `awiTaskLink(task)` as read-only.
  - Owner decision for (c): either derive the duration from the master, or exempt linked tasks keyed on `awiTaskLink` (`awi-task-link.test.ts:13` already pins "keep own duration").
  - Run a **read-only** query for rows already orphaned since 2026-10-09. Delete them only with owner approval (`step_photos` is soft-delete).
  - Add one test per path.

### 2.3 AWI link resolution: an unbatched N+1 on every planner load, where one failed request fails the whole planner: CONFIRMED DEFECT (fatal path) + PERFORMANCE, P1 [rechecked: likely] (PERF-1, DRIFT-4)

- **Where:** `read-store.ts:243` runs `state.tasks = await Promise.all(state.tasks.map(task => resolveLinkedAwiTask(task, supabase)))` on every path through `loadPlannerStateWithProjectFromSupabase`:
  - the media-less core load (`:370-379`)
  - full load, scenario switch, realtime full reload
  - mobile (`mobile-photo-portal.tsx:789, 1082`)
  - print (`work-instruction-print.tsx:446`)
  - server first paint (`server-data.ts:198`, which catches)
- **Cost per linked task:** an `awi_masters` read, then `loadTaskFromSupabase` (`task_project_id` RPC, `tasks`, 7 paged child selects, up to 3 signing calls). That is about 11–13 requests in about 5 dependent stages, with media signed even on the "media-less" core load.
  - Nothing is deduplicated across tasks that share a master.
  - `loadTaskPrivateMediaFromSupabase` (494-497) re-loads the linking task and its master: about 20+ requests against about 4 for an unlinked task.
  - `line-workspace.tsx:1253-1273` re-fetches every link on every window focus, with no in-flight guard, and always allocates new task objects.
- **Fatal path:** a throw at 577-580, or any `throwIfError` in the per-link chain, rejects the `Promise.all`. `use-workspace-data.ts:358-369` then puts the whole planner in its error state for every viewer of that product.
  - *Refuted trigger:* "can view the linking product but not the master" is unreachable, because `has_product_project_access` is workspace-scoped and the picker lists same-workspace masters only.
  - The realistic trigger is any transient error in the chain. A missing master row is reachable only outside the UI (cascade).
- **Fix (M, Med risk):**
  - Batch: `awi_masters` `.in("id", ids)`, then one load per distinct master, signing only when `includeTaskMedia`.
  - On a per-link failure, **keep `customFields.awiMasterLink`** (it is what keeps the task read-only and save-guarded) and render "master unavailable", never an empty editable procedure.
  - Move the focus refresh into the realtime/refresh owner with coalescing and visibility gating. Skip `setPlannerState` when the master is unchanged.
  - Tests: one failing master still loads the planner; a request count for 3 tasks linking 1 master (extend `supabase-planner.task-read.test.ts:172-195`).

### 2.4 Settings → Projects missed the Product RBAC change: CONFIRMED DEFECT, P1 [rechecked] (SURF-2)

- **Where:**
  - `canCreate` allows `editor` (`project-settings.tsx:16-18`) and gates "New project" (41, 169-174). Migration `20261009144351:204-212` changed `create_project_with_starter_plan` to `has_product_access(…,'edit')` and cut the creator-grant block (213-216).
  - Settings loads the legacy `"project"` scope (`project-route-shells.tsx:114`, `app/settings/page.tsx:12`), which drops projects without a `project_access` row (`workspace-store.ts:291-299`). The sidebar uses `"product"` scope.
- **Trigger:** a Member (stored as `editor`):
  - without Product access sees "New project", and the RPC then raises a raw error;
  - with Product access sees "No active projects", or only their old grant subset, while the sidebar lists everything;
  - who creates a product from Settings loses it from Settings on reload.
  - Reverse drift: `canManage` hides rename/archive from Product-Edit Members whom the DB now allows (`"projects editor update"`, migration :99).
  - The DB still enforces, so data is safe.
- **Fix (S, Low risk), owner decision:**
  - **(a)** retire the lifecycle controls in Settings (the sidebar owns them; keep `PhonePhotoPortalPanel`), or
  - **(b)** switch the shell **and** the server seed to `fetchInitialWorkspaceGroups("product")` (it is `cache()`-keyed by scope) and gate with `effectiveProductAccess`/`productAuthorRole`.
  - Fix the stale copy at `app-settings-panel.tsx:571` and `workspace-invite-composer.tsx:170`.
  - Check whether the line-127 shell (`directoryScope="project"`) has the same staleness.

### 2.5 Other confirmed defects (P2/P3)

| ID | Defect | Trigger | Fix | Sev |
|---|---|---|---|---|
| RT-1 | AWI builder (`app/awi/[masterId]/page.tsx:8-19`) and Problem Solving (`problem-solving/page.tsx:9-23`) treat the server read as a dependency | A signed-out visitor (anon is revoked on `awi_masters`; `getServerAuthContext` throws `AuthSessionMissingError`, so `redirect("/login")` is unreachable) or a transient PostgREST error leads to a generic error page with no sign-in | Wrap in try. Fall back to a client load inside `AuthProjectGate`/the provider's auth panel; keep `notFound()` only for an authenticated null. Add `loading.tsx` and make `line-workspace.tsx:2568` a `Link` | P2 |
| RT-2 | All three error boundaries call `reset()`, which never re-fetches (Next 16.3 `error.md:155-157`; `retry` is stable since 16.3.0) | Any server-thrown error makes Retry inert. `app/error.tsx` passes no `error`, so 6 routes (`/`, `/settings`, `/production`, `/awi`, `/awi/[masterId]`, `/mobile-photos`) get no logging and no stale-chunk recovery | `RouteErrorState` takes `retry`; `app/error.tsx` passes `error` + `recoverStaleClient`; update `error.test.tsx`; optional `global-error.tsx` | P2 |
| RT-5 / ERR-5 | `SopWorkspaceProvider` discards the server-seeded `orgToolAccess` on mount (`sop-workspace-provider.tsx:139, 260`) | Non-owner/admin editor with SOP edit access: author controls go true (SSR), false, then true; plus a redundant request pair per SOP-space load | Skip the clear and refetch when `workspaceId === initial.workspaceId` and the seed is known-good. Seed `undefined` (not `"none"`) on a failed server read (`server-data.ts:171`). Add a provider test | P3 (calibrated: brief, self-healing) |
| SURF-1 (+DATA-11) | Sign-out purge `clearCachedPlannerState()` passes no argument and returns early (`auth-project-gate.tsx:250-254` → `planner-state-cache.ts:134-137`); cache keyed by `projectId` only | After sign-out, snapshots stay in memory and IndexedDB; IDB residue on a shared browser; a revocation seen on a cold mount is never purged. Not cross-user private data (directory is org-scoped); DB still denies | `clearAllCachedPlannerState()` on null session; purge IDB keys not in current groups; store `userId` and treat mismatch as a miss; window guard on the memory write (DATA-11). Tests that fail today | P2 |
| DATA-2 | Project delete is two non-atomic client deletes with different RLS (`workspace-store.ts:411-416`); the first cascades the whole graph | An admin demoted mid-session, a per-project edit grant without owner/admin, or a network drop between awaits: products, scenarios, tasks, steps and photos are deleted, the project row survives, and the UI says "removed". Storage objects are orphaned | Schema first: a `delete_project(p_project_id)` RPC (owner/admin or super-admin; graph goes in the same transaction; returns storage paths); `gen:types`; single call plus best-effort cleanup; pgTAP for an editor caller | P2 |
| API-3 | Resend webhook inserts the event before suppressions (`deliveries-store.ts:17-45`) | Suppression upsert fails, then a 500, then a redelivery hits the 23505 duplicate branch, so the complaint suppression is lost (a hard bounce re-suppresses on its next bounce). Already inventoried as W12 in `edit-operation-inventory.md:1038-1044`; still open | Upsert suppressions first, or re-apply on the duplicate branch; add a replay test | P3 (calibrated: needs a double fault) |
| API-4 (part) | Superadmin notifications console caches its mount-time token (`notification-admin-settings.tsx:50, 76`) | After `jwt_expiry` 3600 s, Resend/Unsuppress/Teams-test return 401 until reload | Fresh token per action (see the API-4 helper, §5) | P2 |
| API-5 | SolidWorks ingest contract ≤200 MB / ≤10 MB through `request.formData()` on a 4.5 MB platform body cap | Latent: the plugin is design-only. Once built, most uploads get a plain-text 413 | Signed-upload handshake (upload-url → PUT → finalize), mirroring SOP conversion, before the plugin ships | P3 today; P1 when the plugin is built |
| ERR-6 | 7 store sites rethrow raw PostgREST objects (`workspace-store.ts:100, 497, 541, 558`; `access-store.ts:88, 167, 211`); the UI's `instanceof Error` fails | A sole owner demoting themselves sees "Unable to change the role." instead of the trigger's "An organization must keep at least one owner…" | Wrap with `throwIfError`/`toDataError`; show P0001 text verbatim; add a store test | P3 (calibrated: message loss only) |
| ERR-7 | "Unknown" rendered as "empty" | Members admin: grants, space access and departments `.catch(() => [])` then "ready" (`workspace-members-settings.tsx:149-159`). WI print maps a transient failure to "could not be found, or you do not have access" (`work-instruction-print.tsx:509`). Job-title sharing fails silently (`departments-admin.tsx:98-108`) | Model each sub-list as loaded/error with Retry; use the existing `"error"` status; non-blocking notice | P2 |
| ERR-8 | Web-vitals `performanceRoute` (`web-vitals.ts:3-9`) predates 4 routes | `/sops/problem-solving` and `/sops/work-instructions` are bucketed as `/sops/[sopId]`; WI editor ids are kept (unbounded buckets); `/awi/<id>` is unchanged. Skews the SOP-editor baseline | Table-driven normalizer plus a UUID fallback; a test that walks `app/**/page.tsx` | P2 |
| PLAT-2 | Root `proxy.test.ts` (4 cases incl. the f01b66b Host-header guard) matches no Vitest project (`vitest.config.ts:19, 27`); `proxy.ts` is not linted | A revert of the canonical-host fix merges green | Move the test under `src/lib/` or add a root glob; add `proxy.ts` to lint paths | P2 |
| PLAT-8 | CSP still allows `frame-ancestors https://*.office.com https://*.officeapps.live.com https://*.microsoft.com` and `appsforoffice` (`next.config.mjs:18, 31`), but the add-in was deleted in 8a9c333 | Any page on those domains can frame authenticated Pulse pages (clickjacking surface for a dead feature) | `frame-ancestors 'self'`; drop `appsforoffice`; delete `office/` and the excel-gantt icons | P3 (calibrated: Microsoft-controlled origins only) |
| PLAT-10 (verifier finding) | `tailwind.config.ts` `amber: "var(--color-warn)"` under `theme.extend` replaces Tailwind's amber scale; `sop-list.tsx:88` uses `bg-amber-500` | The reviewer "awaiting signature" badge renders white text on no background (no `amber-500` rule in the compiled CSS). Styling only | Use `bg-warn` (or equivalent); drop the unused aliases | P2 |
| PLAT-4 / TEST-8 | Date-only regression test can't fail in UTC (`formatting.test.ts:86-89` says so); nothing pins TZ | A revert of f186348 (P0 controlled-document dates) merges green | `test.env.TZ = "America/Los_Angeles"` in `vitest.config.ts` after one full local run in that TZ (risk: UTC-assuming tests). Avoid an env prefix in `package.json` (Windows npm) | P2 (CI gap) |
| SURF-11 | Third copy of the visible-remark rule (`sop-review-workspace.tsx:171-174`) drops answered remarks | After a reviewer deletes one remark, resolved remarks with responses vanish for up to 15 s; dead autosave states at :314 | Pure `visibleReviewRemarks()` in `domain/sop` plus a test; display only | P3 |
| Prior D1, D2 (mobile) | Still live (§1.1) | Overlapping photo picks drop photos; a failed save is masked as "Saved" while realtime stays deferred | Prior candidates #10 and #3 | P1 (prior) |

### 2.6 Hypotheses that need runtime or DB confirmation

| ID | Hypothesis | How to confirm | Sev |
|---|---|---|---|
| ERR-4 | Realtime ignores channel status (`realtime.ts:163` has no callback). After sleep or a network drop, missed `postgres_changes` are never caught up, and the next shell diff-save deletes a teammate's rows: the DRIFT-2 mechanism via another trigger | Two-client test: B offline, A adds a task, B back, B edits, check whether A's task survives. Fix: forward status; on error/timeout/closed set `remoteStateConfirmedRef=false`, reconfirm on `SUBSCRIBED`. Fold into prior candidate #4, not a separate stream | P1 |
| API-4 (part) | Cookie-mode `requireApiUser` builds its client with `setAll: () => {}` (`api-auth.ts:102`); `/api` is excluded from the proxy; auth-js refreshes within 90 s of expiry. A rotation is minted then discarded, which may trip reuse detection ("logs out while idle") | GoTrue log showing token reuse after a cookie-mode API call made near expiry | P2 |
| DOM-6 | WBS sorts via `parseFloat` (pfmea, procedure, operator-allocation, joint-scheduler, calculations) mis-order dotted WBS with 10+ siblings; KPIs mix two hierarchy rules | `select count(*) from tasks where wbs ~ '\.\d{2,}'` and `… where parent_task_id is not null` | P2 |
| DOM-7 | Mobile has no view-only gate, so a view-only Product member sees edit controls whose saves fail | View-only Product member on the phone | P2 |
| PERF-11 | Draft-review margin keystrokes re-paginate the whole embedded SOP preview | Profile typing in a 15+ page SOP | P2 |
| DATA-9 | 8 unbounded list reads skip `readAllPages` and would truncate silently at `max_rows = 1000` (incl. the SOP drain stall/retry scans) | Row counts per table; hosted `max_rows` | P3 |
| SURF-6 | `DepartmentsAdmin.refresh` has no stale-response guard, so it may show the previous org's departments after a switch | Two-org runtime check | P3 |
| DBP-1/2/4 | Per-row RLS chain cost (see §4.4) | `EXPLAIN (ANALYZE, BUFFERS)` as `authenticated` on an isolated copy | P2/P3 |

---

## 3. Ranked candidates

Priority is value ÷ (effort × risk), with defects weighted up. IDs in parentheses are the merged source findings.

| # | Candidate | Files | Type | Priority | Effort | Risk | Verdict |
|---|---|---|---|---|---|---|---|
| 1 | Scenario switch-back revalidation (DRIFT-2; ERR-4 test alongside) | `use-workspace-scenarios.ts:89-153`, `use-workspace-saves.ts:494-501` | Defect | **P0** | S | Med | Fix now |
| 2 | AWI-link invariant in DB + move/mobile guards + duration decision (DRIFT-3, DEAD-4) | `task-store.ts:206-262, 620-661`, `procedure.tsx:339-342`, `mobile-photo-portal.tsx`, new migration | Defect | **P1** | M | Med | Fix; read-only orphan query |
| 3 | Batched, non-fatal AWI-link resolution; coalesced focus refresh (PERF-1, DRIFT-4) | `read-store.ts:243, 487-582`, `line-workspace.tsx:1253-1273` | Defect + Perf | **P1** | M | Med | Fix |
| 4 | Settings → Projects RBAC drift (SURF-2) | `project-settings.tsx`, `project-route-shells.tsx:114`, `app/settings/page.tsx:12` | Defect | **P1** | S | Low | Owner: retire or rebase |
| 5 | TZ-pinned tests (PLAT-4, TEST-8); root proxy test collected (PLAT-2) | `vitest.config.ts`, `package.json:9` | CI gap | P2 | S | Med / Low | Do now (Phase 0) |
| 6 | Error boundaries use `retry`; root boundary gets `error` (RT-2) | `app/error.tsx`, `route-error-state.tsx:22-54` | Defect | P2 | S | Low | Fix |
| 7 | Server-read-as-dependency on AWI builder / Problem Solving (RT-1) | `app/awi/[masterId]/page.tsx`, `app/sops/problem-solving/page.tsx` | Defect | P2 | S | Low | Fix |
| 8 | Keep seeded `orgToolAccess` (RT-5, ERR-5) | `sop-workspace-provider.tsx:139, 253-272`, `server-data.ts:171` | Defect | P3 | S | Low | Fix + test |
| 9 | Sign-out purge + user-scoped planner cache (SURF-1, DATA-11) | `auth-project-gate.tsx:248-256`, `planner-state-cache.ts` | Defect | P2 | S | Low | Fix + tests |
| 10 | `delete_project` RPC (DATA-2) | `workspace-store.ts:411-416`, new migration | Defect | P2 | M | Med | Schema first |
| 11 | Small defect batch: API-3, API-4 admin token, ERR-6, ERR-7, ERR-8, PLAT-8, amber badge, SURF-11 | see §2.5 | Defects | P2–P3 | S each | Low | Fix |
| 12 | Delete dead smart-allocation surface (API-1, DOM-2, DEAD-1, DRIFT-5) | `app/api/smart-allocation/*`, `ie-smart-allocation-solver.ts`, `operator-allocation.ts:104-127, 655-886`, `smart-allocation-report.ts:166-372`, `report.ts:49-211`, `playback.ts`, smoke script, root doc | Hygiene | P2 | S | Low | Owner confirms, then delete |
| 13 | Delete 11 dead planner writers (DEAD-3) + fix TEST-4 comment | `task-store.ts`, `access-store.ts`, `tool-store.ts`, `media-store.ts`, facade | Hygiene | P2 | S | Low | Delete (keep `saveTasksToSupabase`) |
| 14 | Remove unused PFMEA re-export (DEAD-2, PERF-3) | `planner-foundation-pages.tsx:7` | Perf | P2 | S | Low | One line; ~38–40 KiB gz off every planner open |
| 15 | AWI directory: nav import + single shell (PERF-6, SURF-9) | `line-workspace/nav.tsx:24`, `awi-directory-loading.tsx` | Perf | P2 | S | Low | Do |
| 16 | Bundle guard over all route manifests (PERF-5, PLAT-1) | `scripts/check-client-bundles.mjs:33-34` | Hygiene/Perf | P2 | S | Low | Do before perf work |
| 17 | Observability seam: `serverSeed`, `logServerIssue`, `reportClientIssue`, `instrumentation.ts` (ERR-1, ERR-2, ERR-10) | `server-data.ts`, new `src/lib/observability/*` | Structural | P2 | M | Low | Do before perf work |
| 18 | Retarget 28 facade test mocks to leaves + positive controls + lint ban (TEST-1) | 28 test files | Structural | P2 | M | Low | Prerequisite for #19 |
| 19 | Narrow the planner facade for non-planner importers (DATA-1, DOM-1, PERF-2, DOM-10) | `display-name-prompt.tsx:5`, ~24 non-planner lib importers, `tool-registry.ts:2`, `project-catalog.ts:3` | Perf/Structural | P2 | M | Low | After #18 |
| 20 | Characterization tests for live domain (DOM-3), FK hint (TEST-6), auth/first-paint seams (TEST-7), planner RLS pgTAP (PLAT-7) | see §5.6 | Tests | P2 | M | Low | Phase 2 |
| 21 | Client session owner: quick win, then `useSessionGate`, then profile store (RT-7, SURF-4, DATA-4) | `auth-project-gate.tsx`, `sop-workspace-provider.tsx`, `user-nav.tsx`, `display-name-prompt.tsx` | Structural/Perf | P2 | M | Med | After TEST-7 |
| 22 | `(product)` route-group layout; data-free loading fallbacks; root identity/notification provider (RT-6, SURF-3) | `project-route-shells.tsx`, `app/layout.tsx`, loading states | Structural/Perf | P2 | L | High | After #21 |
| 23 | One cached `getSopServerContext()` (RT-4, DATA-7) | `server-data.ts`, `app/sops/*`, `detail-data.server.ts` | Perf | P2 | M | Low | Do |
| 24 | Mobile routes: `loading.tsx` + core seed (RT-3) | `app/mobile-photos`, `app/projects/[projectId]/mobile-photos` | Perf | P2 | S | Med | Do, measure HTML size |
| 25 | SOP read model in the provider; batched author names; reply index (DATA-3, SURF-6, DBP-6, DBP-5) | `review-queue-data.ts`, `notification-bell.tsx`, SOP tab panels, migration | Perf | P2 | M | Med | Quick wins first; input plumbing only |
| 26 | Product directory owner + portfolio rules in domain (SURF-5) | `sidebar-workspace-panel.tsx` | Structural | P2 | M | Med | With #22 |
| 27 | Settings org context; pass seeded groups (SURF-7, RT-12) | `settings-workspace.tsx`, members/list/notification-admin settings | Structural | P2 | M | Low | Do |
| 28 | Permission mirrors module (SURF-8, DOM-7, RT-11, DEAD-8 row 9) | 13 component files, `product-access.ts` | Structural | P2 | M | Med | Only pure owner/admin checks; SOP layers stay distinct |
| 29 | Browser API client helper + cookie-rotation fix (API-4) | 9 call sites, `api-auth.ts:102` | Structural | P2 | M | Low | Do |
| 30 | Error vocabulary `DataError` + procedure-save retry policy (ERR-9, ERR-3) | `supabase-errors.ts`, `query-helpers.ts:71-78`, `use-procedure-save-queue.ts:322-377` | Structural | P2 | M | Med | `PlannerConflictError` can land first |
| 31 | Gantt layout model + operator load index (prior #9, DOM-4, PERF-10) | `gantt-timeline.tsx:470-708`, `operator-allocation.ts:204-304` | Perf/Structural | P2 | M | Med | After DOM-3 tests |
| 32 | Render locality: mobile timer/drag, photo-map cache, procedure keystroke (PERF-7, PERF-8, PERF-9) | `mobile-photo-portal.tsx`, `step-photos.ts`, `use-procedure-save-queue.ts` | Perf | P2 | S–M | Low–Med | Profile first; PERF-8 now |
| 33 | WI preview payload (PERF-4) | `render-image.tsx`, `export-pdf.ts` | Perf | P2 | M | Med | createRoot first; alias standard-fonts before any hand-written PDF writer |
| 34 | Step-list rules (DOM-5) and WBS/hierarchy (DOM-6) | `procedure.tsx`, `mobile-photo-portal.tsx`, `move-manufacturing-step.ts`, `task-planning.ts` | Structural | P2 | M | Med | DOM-6 after the data check |
| 35 | Thick routes: invites store reuse; SOP extract LLM half to lib (API-8) | `app/api/invites`, `app/api/sops/extract` | Structural | P2 | M | Low | Do |
| 36 | Cross-instance password-reset limit; limiter eviction (API-6) | `password-reset/request/route.ts`, `api-auth.ts:107-130` | Structural | P2 | S | Low | Do (existing index suffices) |
| 37 | Migration tooling: ledger write, repair by explicit version, delete legacy appliers (PLAT-6) | `scripts/apply-*`, `repair-migration-ledger.mjs` | Structural | P2 | S | Low | Do |
| 38 | Convention tripwires (PLAT-9) | new `scripts/check-conventions.mjs` | Structural | P2 | S | Low | (a)+(b) now; (c) validate first |
| 39 | `globals.css` ownership: layer the unlayered tail; viewer-only CSS out (PLAT-5) | `app/globals.css:307-987, 3727-3861`, `sop-print-preview.tsx:899-1122` | Structural | P2 | M | Med | Context-menu block (988-1047) stays shared |
| 40 | Browser CI paused (PLAT-3) | `.github/workflows/ci.yml:114-116, 142-144` | Structural | P2 | S | Low | Owner decision; run the 4 specs once now |
| 41 | Product-graph RLS flattening (DBP-2, DBP-4, DBP-8) | migration `20261009144351` policies | Perf | P2 | L | Med | Measure first |
| 42 | Serial hops in granular writes and hot reads (DATA-5) | `task-store.ts:207-262`, `read-store.ts:524-576`, `review-annotations.ts:77-81` | Perf | P2 | S | Med | Do with request-count tests |
| 43 | Typed mappers; vocabulary store merge (DATA-6) | `sop/store.ts:116-176`, `rasic-roles`/`job-titles` stores | Structural | P2 | M | Low | Opportunistic |
| 44 | `client?` on planner leaves; `installPlannerClient` helper (TEST-2) | `lib/planner/*` | Structural | P2 | M | Low | Opportunistic |
| 45 | `/api/sops/reviewers/nominate` dead side door (API-2, DEAD-7) | `app/api/sops/reviewers/nominate/*`, `inbox-writer.ts` | Hygiene | P2 | S | Low | Parked area: owner sign-off to delete; else record in deferred-work |
| 46 | Planner save-protocol leftovers: inert `remoteRefreshAppliedRef`, boolean shell lock, tools save outside lock (DRIFT-6, DEAD-10) | `use-workspace-saves.ts:246-257, 478-494`, `use-workspace-tools.ts:183` | Structural | P3 | S | Med | Delete flag first; lock with prior #4 |
| 47 | SOP RLS rule written twice (DBP-3); VOLATILE helpers (DBP-1); 3 duplicate indexes (DBP-7) | migrations | Perf/Hygiene | P3 | S–M | Low–Med | DBP-7 duplicates now; others after measurement |
| 48 | Server helpers: service-role client, origin, super-admin gate, error mapping (API-7, DATA-10) | 9 routes | Structural | P3 | S | Low | Migrate as touched |
| 49 | Dead exports, orphans, fixtures, inert flags (DEAD-5, DEAD-6, DOM-9, DEAD-10, TEST-9) | see §5.4 | Hygiene | P3 | S | Low | Delete; fixtures to `test-support` |
| 50 | Dead CSS selectors + blank runs (DEAD-13, PLAT-10) | `globals.css`, `line-workspace.css`, `mobile-photo-portal.css` | Hygiene | P3 | S | Low | Owner sign-off for `ui-*` deletions |
| 51 | Copies: download ×7, `formatManHours`, `isRecord`, id minters, `awiDraftStatus` (DEAD-11, DOM-8, DOM-11) | see §5.3 | Hygiene | P3 | S | Low | Do |
| 52 | Route hygiene: SOP view parser + type import (RT-8), WI print route (RT-9), proxy matcher + stale comments (RT-10), `force-dynamic` exports (API-9), phone-portal-url route (API-10) | see §6 | Hygiene | P3 | S | Low | Do; API-10 after env check |
| 53 | Dead-code tooling (DEAD-12) | `package.json`, CI | Hygiene | P3 | S | Low | Non-blocking knip report |
| 54 | Button systems one visual source (DEAD-9, SURF-10) | `ui/controls.css`, `globals.css:1710-1764`, `confirm-provider.tsx` | Hygiene | P3 | S (source) / L (migration) | Low | Single source now; migrate opportunistically |
| 55 | Other P3: DATA-8, DRIFT-7, PERF-12, SURF-12 (before pilot widens), SURF-13, PLAT-11, PLAT-12, PLAT-13, TEST-5, TEST-10 | §5–6 | Hygiene/Structural | P3 | S–M | Low | As touched |
| — | `proxy.ts` session-refresh design; no RSC mutation; request-scoped `cache()` + WeakMap dedupe | | | | | | **Leave as is** |
| — | Planner route summary seed + confirm-before-autosave | `server-data.ts:206-230` | | | | | **Leave as is** (reference implementation of recipe step 4) |
| — | SOP tab seed gating on `initialWorkspaceId`; WI print scenario guard; ProblemPilotAccessProvider | | | | | | **Leave as is** |
| — | `requireApiUser`, auth coverage of all 20 routes, service-role ordering | | | | | | **Leave as is** |
| — | `quality-wi/convert` job design; notification drain/health | | | | | | **Leave as is** (patterns to copy) |
| — | Realtime ownership (`realtime.ts`, presence) | | | | | | **Leave as is** (status handling: ERR-4) |
| — | Live allocation path (`buildOperatorAssignmentsFromIePlan`, `buildUnallocatedWorkReviews`, `computeOperatorIdleAnalysis`) | | | | | | **Leave**; test (DOM-3), index (DOM-4) |
| — | `domain/types.ts`, `notification-email-shell.ts`, joint-scheduler, `tool-registry.ts` | | | | | | **Leave as is** |
| — | Quality-WI editor controller + `use-wi-editor` | | | | | | **Leave as is** (pattern to copy) |
| — | `ModalSurface`, themed primitives, `WorkspaceWriteTracker` | | | | | | **Leave as is** (adoption is the gap) |
| — | Lazy docx, pdfjs, mammoth, read-excel-file, qrcode; SOP tab dynamic loading | | | | | | **Leave as is** |
| — | Migration history (no squash), CI checks/database jobs, ESLint config, design tokens, scrollbar pairs | | | | | | **Leave as is** |
| — | FK index coverage on planner hot tables; notifications inbox read path; transactional RPCs | | | | | | **Leave as is** |
| — | `recording-supabase` double; signedUrlCache isolation test; tripwire coverage | | | | | | **Leave as is** |
| — | React Compiler (off) | | | | | | **Leave off**: targeted state-locality fixes are cheaper and safer |

---

## 4. Structure for performance

The mechanisms below are what make speed measurable. Do §4.0 first, or none of the rest can be proven.

### 4.0 Measurement prerequisites

- **Bundle guard over every route** (PLAT-1, PERF-5). Re-running the script's own method over all 34 manifests gives:
  - sops/[sopId] 361.6 KiB and sops/new 361.0 KiB, both **over the 350 cap**
  - awi/(directory) 317.3
  - sops/work-instructions/[id] 311.6
  - Steps: iterate every `page_client-reference-manifest.js`; use per-route caps with a ratchet at today's editor value; make a missing route a warning (the hard-coded Planning route would otherwise throw once Planning is removed).
  - Lazy-loading `SopPrintPreview` needs **both** static edges made dynamic: `sop-editor.tsx:68` and `sop-quality-approval-workspace.tsx:23`. That is a loading-boundary change only; approval logic is not touched.
- **Server-seed miss visibility** (ERR-1): 14 in-scope seed catch sites log nothing; a miss looks like "slow". Promote `wiServerSeed` to one `serverSeed(name, read)` that keeps today's contract (returns undefined, never throws, no writes) and adds `logServerIssue('server-seed-miss', …)`. Optionally emit sampled `ms` on success.
- **Observability seam** (ERR-2): no reporter and no `instrumentation.ts`.
  - Reuse the existing sendBeacon → `/api/performance` transport for client issue kinds.
  - Wire it at `WorkspaceWriteTracker` settle, the procedure-save catch, realtime status, `RouteErrorState`, the stale-session branch and `useRefreshOnReturn`.
  - Replace `PROCEDURE_SAVE_DEBUG = false` (`state.ts:33`, 16 call sites) with this reporter.
  - Never log headers, cookies, tokens or emails.
- **AI conversion cost** (ERR-10): emit one completion line per request `{route, model, ms, inputTokens, outputTokens, stopReason, outcome}` on `sops/extract` and `quality-wi/convert`.
- **Vitals normalizer** (ERR-8): it currently mixes three screens into the SOP-detail bucket.

### 4.1 Bundle

| ID | Mechanism | Size | Fix |
|---|---|---|---|
| DATA-1 / DOM-1 / PERF-2 | `DisplayNamePrompt` (root layout, `app/layout.tsx:88`) imports two names from the re-export facade. Turbopack keeps every module the facade re-exports (13; `media-rows` and `query-helpers` are internal) because there is no `sideEffects` hint. Chunk `2s5po3qq5s74e.js` contains `savePlannerStateToSupabase`, `duplicate_scenario`, `planner-state-…`, `loadToolLibraryFromSupabase`, and is in 33/34 route manifests incl. `/login`, `/invite`, `/reset-password` | 98,047 B raw / 25,093 B gz; unused-store groups ≤ ~14.6 KiB gz | (1) TEST-1 first. (2) Repoint `DisplayNamePrompt` to `@/lib/planner/client` + `workspace-store` and move its mock. (3) Codemod the ~24 non-planner lib importers to `@/lib/planner/client`. (4) Move `ToolLibraryItem` into domain. (5) Lint ban for non-planner code. Optional first try: `"sideEffects": ["*.css"]` and rebuild. Exempt `src/lib/planning/*` importers (out of scope). Keep the facade for planner screens until their mocks migrate |
| DEAD-2 / PERF-3 | `planner-foundation-pages.tsx:7` `export { PfmeaWorkspace }` has no consumer, but `line-workspace.tsx:139` imports the file statically, defeating the `dynamic()` at :174 | ~38–42 KiB gz (pizzip + pako ~25, PfmeaWorkspace ~14.8) on every planner and AWI open | Delete line 7; `await import("@/domain/pfmea-export")` inside the two export handlers; confirm `3per4z9kkaoy6` leaves loader 23950 |
| PERF-6 / SURF-9 | AWI directory renders `AwiDirectoryShell` from both `loading.tsx` and the page (two client references); `nav.tsx:24` imports a constant through `app-settings-panel`, which pulls in AccountSettings, NotificationPreferences and push code | 37 duplicate module copies ≈21.9 KiB gz in the 317.3 KiB entry; settings/push module ≈5.8 KiB gz | Import from `settings-navigation`; give `loading.tsx` a server-only skeleton (simpler than a layout, which would need its own groups fetch) |
| PERF-4 | WI preview opens by building the real PDF (`wi-preview.tsx:73`) and rasterizing it with pdf.js. pdf-lib's utils barrel drags in `@pdf-lib/standard-fonts`; `render-image.tsx:4` pulls in `react-dom/server` for one SVG | ≈700 KiB gz on first preview; ≈170–200 KiB removable | `createRoot` + `flushSync` instead of `renderToStaticMarkup` (~61 KiB; also fixes the prior lib→components edge). Alias/stub standard-fonts in client builds before considering a hand-written writer for a QC-controlled document. Word export shares only the react-dom/server part |
| PERF-5 | SOP editor routes over cap | 361.6 KiB | See §4.0 |

**Leave as is:** docx (dynamic at `sop-editor.tsx:1088`), pdfjs, mammoth and read-excel-file (all lazy), the supabase-js root chunk (62.1 KiB, required).

### 4.2 Network: server first paint and client reads

| ID | Mechanism | Fix |
|---|---|---|
| RT-4 / DATA-7 | The SOP layout critical path is 5 sequential round trips (GoTrue → groups A → groups B → `is_super_admin` again → `org_tool_access`) behind the layout Suspense. `fetchInitialSopWorkspaceData` is not `cache()`'d, so Problem Solving runs the pilot RPC ×3 and org access ×2. `/sops/[sopId]` makes 2 GoTrue calls (`detail-data.server.ts:23-27`). `/sops` and the WI seed read the raw cookie and seed nothing on first visit | One cached `getSopServerContext()`: org access in parallel with groups; super-admin derived as "any group `isSuperAdmin`"; layout, page, `wiServerSeed` and `/sops` share it; `detail-data` uses `getServerAuthContext()`; settings tab reads in parallel. Read-only |
| RT-3 | Both mobile routes `await fetchInitialPlannerData` (full graph, 5 waves + signing) with no `loading.tsx`, inline it, then the portal reloads the same graph (`mobile-photo-portal.tsx:1082`) | Add `loading.tsx` ("Opening photos"); seed with the core (no media) read or the summary; the client full load stays authoritative. Measure HTML size |
| PERF-1 / DRIFT-4 | Per-link N+1 on every load + focus | §2.3 |
| DATA-3 / DBP-6 / SURF-6 / DBP-5a | The bell (in every top nav) rebuilds the review queue every 60 s while visible: `departments` read twice, a serial unscoped `replyRows` query, and one `sop_author_display_name` RPC per in-review seat SOP. The active SOP tab polls 15 s. The review tab + bell is the real overlap (only one tab polls) | Quick wins: batched `sop_author_display_names(text[])`; reuse loaded departments with `fetchDepartmentRolesForUser` + `pickMemberDepartments` (the `/sops` page already does this); `replyRows` into stage 1 and scoped; partial index on `sop_review_annotations(created_by)`. Structural: one workspace-scoped SOP snapshot owned by the provider. Product decision: should the 60 s tick refresh only the inbox? Input plumbing only; queue derivation untouched (parked) |
| DATA-4 / RT-7 | 4 identical `profiles` reads per page load (DisplayNamePrompt and UserNav each hydrate, then re-hydrate on `INITIAL_SESSION`); UserNav also on `TOKEN_REFRESHED`. Tab return emits `SIGNED_IN`; gate and SOP provider reload groups with no `sameSnapshot` guard | Quick win: ignore same-user `SIGNED_IN`, guard `setGroups`, drop the redundant explicit hydrate. Then one current-profile store keyed by user id |
| RT-6 / SURF-3 | Product spaces have no shared layout. Each navigation re-runs auth + groups on the server and remounts the gate, UserNav (2 profile reads) and NotificationBell (immediate ~12-query refresh). Loading fallbacks mount live chrome (AWI loading sidebar hydrates its own directory). e2e measured 61 directory GETs over 6 transitions (budget 72) | §5.1 |
| DATA-5 | Advisory asserts are serial (29 sites). Mobile step save is 5–7 round trips; `select("*")` of all steps to find one; `loadTaskFromSupabase` awaits the assert before reading; review annotations await profiles then replies on every 15 s poll; seats then nominations | Parallelize asserts with pre-write reads (assert still completes before any write); target-row + `max(sequence)` projection; `Promise.all` for independent reads (only `Promise.all` at the approval-roster read). Pin request counts with store tests |
| RT-12 / SURF-7 | Settings sections ignore server-seeded groups and re-run session + directory + 4 reads after hydration | Pass `groups`; settings org context |
| RT-9 | WI print route always loads Main's full graph, ignoring `scenarioId`/`blank`. The route has **no in-app entry point** (preview is an inline modal; `hrefForLayout` is a dead prop) | Delete or justify the route; if kept, pass `scenarioId` through and skip on `blank=1`; chrome-less `loading.tsx` |
| API-10 | `/api/phone-portal-url` returns a config value after an authenticated GoTrue round trip on every QR mount; `os.networkInterfaces()` candidates are unused | Plain module reading `NEXT_PUBLIC_PHONE_PORTAL_URL` after confirming prod env; delete route |
| PERF-12 | One 60 s interval + 3 listeners per mounted photo; task videos re-signed on every load although paths are immutable | Cache video signing (bucket parameter; keep the browser-only guard); one module-level ticker |

### 4.3 Render

All magnitudes are unprofiled. Profile with React Profiler before and after. The codebase has 0 `React.memo` and no compiler.

| ID | Mechanism | Fix |
|---|---|---|
| PERF-9 | Each procedure keystroke calls `setSaveState`, `setProcedureFieldDraft` (version bump) **and** `setPlannerState` with new task/step objects (`use-procedure-save-queue.ts:225-258`). That re-renders all of LineWorkspace incl. TopNav, Sidebar and Procedure, and `derivePlanner` returns a new object | Keep step text in the draft layer until debounce/save (not in coordinator `plannerState` per keystroke) and/or memoize large siblings. Moving only the draft version into a store would **not** stop the re-render |
| PERF-7 | `timerNow` in the portal coordinator (`mobile-photo-portal.tsx:277, 575-582`) re-renders everything every 1 s while timing. `setDragPreview({x,y,width})` per pointermove | Leaf `useNow` component; drag ghost via ref + transform. Fits prior #12/#17 |
| PERF-8 | `getStepPhotoAttachments(task, stepId)` sanitizes the whole task photo map per call, inside per-step render loops, and stamps `new Date()` on legacy rows | WeakMap cache keyed by the raw map object (CLAUDE.md-compatible); same for step-tools |
| PERF-10 / DOM-4 / prior #9 | Gantt group dragover commits a new `{id, placement}` per event, re-running the un-memoized layout. `getOperatorAssignmentBlockState` scans all tasks twice per (task × unselected operator) per row, with `getTaskOperatorIds` allocating each call. The planner memo builds a full audit plus O(T²) `changedTaskIds` it discards | Functional bail-out updates; `buildGanttLayout` memoized on (tasks, stations, zones, expandedGroups); domain `buildOperatorLoadIndex`; narrow `findUnassignedTaskIssues`; summary-membership Set. DOM-3 tests first |
| PERF-11 | HYPOTHESIS, see §2.6 | If confirmed, `useDeferredValue` inside `SopPrintPreview` on the sop feeding extras/segments (not on the prop; margin editors render inside) |

### 4.4 Database

Measure first. The repo itself defers query plans (`docs/performance.md:40-41`).

- **DBP-2 (P2):** product-graph read policies run 6–9 nested non-inlinable functions per row: SECURITY DEFINER or `set search_path` blocks inlining. Task-child tables cost 9 per row, though the only user-dependent input is the workspace.
  - Step 0: `EXPLAIN (ANALYZE, BUFFERS)` as `authenticated` on an isolated copy.
  - If RLS dominates: one InitPlan set `my_product_workspace_ids(min_level)` plus a flattened single-join resolver (repurpose the dead `*_workspace_id` family, DBP-8).
  - Roll out reads first. Before any rewrite, extend `product_module_access_test.sql` into a user × table visibility matrix.
  - Blanket `(select fn(column))` wrapping does nothing for column arguments, so don't do it.
- **DBP-4 (P3):** `actual_events` has two permissive SELECT policies and resolves `task_project_id` twice for Product-only viewers. Fold it into DBP-2.
- **DBP-3 (P3):** the SOP visibility rule is written twice (`sops workspace read` and `can_read_sop`), and 8 child tables use `can_read_sop` per row. Hoist the workspace sets and delegate child policies to `exists (select 1 from sops …)` (the pattern `nominations_read` already uses). Add a pgTAP equivalence check before touching seats/signatures read policies.
- **DBP-1 (P3):** `has_workspace_role`, `project_workspace_id` and `workspace_has_members` are VOLATILE. `alter function … stable` (bodies unchanged; confirm `provolatile` live first). Small, unmeasured gain.
- **DBP-5 (P3):** add `notifications(source, source_ledger_id)` for the drain stamp (UNIQUE once duplicates are ruled out). The annotations index is in DATA-3 above.
- **DBP-7 (P3):** drop the 3 exact duplicates of UNIQUE indexes (`tasks_scenario_id_wbs_idx`, `stations_scenario_id_sequence_idx`, `zones_scenario_id_sequence_idx`). Drop the 6 prefix-redundant and 4 `deleted_at` indexes only after `idx_scan = 0`.

---

## 5. Structure for maintainability

### 5.1 Ownership: one owner per piece of shared client state

- **Client session** (RT-7, SURF-4, DATA-4).
  - `AuthProjectGate` (527 lines) and `SopWorkspaceProvider` (430) carry near-identical session/recovery/invite/auth-panel blocks.
  - 8 commits changed both (9fa5da8, 971bc98, ad16fea, b0305b8, 22164c3, 2885943, f3316f4, ce31087), and they have already drifted: only the gate has the no-session fast path and the (broken) purge.
  - 10 component files subscribe to `onAuthStateChange` with different filters; `ProblemPilotAccessProvider` and `notification-bell` already show the right same-user policy.
  - Order:
    1. Quick win (RT-7).
    2. Pure auth-event decision function `(event, session, inviteSetupActive) → {mode, refresh}` with a table test (TEST-7).
    3. Extract `useSessionGate` + `<SessionGatePanels>` shared by both providers.
    4. Root-layout `SessionProvider` owns the one subscription and the profile.
- **Product spaces layout** (RT-6, SURF-3). After the session owner exists, add a `(product)` route-group layout that mounts session + directory once, seeded by a cached server read.
  - Keep `projectId` context, `renderHome` and the last-project redirect as thin page selectors.
  - The provider must hold both directory scopes (Settings/Production use `"project"`).
  - Then retire the sessionStorage project-switch protocol and `lastKnownProfile`.
  - Bootstrap writes stay client-side (CLAUDE.md read-only RSC rule).
  - L / High risk: characterize first.
- **Product directory** (SURF-5). The sidebar keeps a second copy of groups and runs its own `hydrate()` (on every auth event when `!initialGroups`). Its six lifecycle writes refresh only that copy, so the AWI directory's product context goes stale after rename/move/archive.
  - Expose `groups` + commands (create, rename, moveToCategory, reorder, archive, remove) from the single owner, consumed by both the sidebar and Settings.
  - Move the drop-target/sibling computation into `domain/product-portfolio.ts` with tests. The two sibling filters differ (`?? "uncategorized"` vs raw equality).
- **SOP read model** (DATA-3, SURF-6). The provider is already mounted once in `app/sops/layout.tsx`. Give it sops, departments, roles and queue with one visibility-aware scheduler and one `isCurrent` policy. Keep the mutation-generation retry in `shared-review-queue.ts:27-38`.
- **Settings organization** (SURF-7). Sibling sections pick the org three different ways (all manageable / `project.workspaceId` → first manager → `groups[0]` / first super-admin) with three predicates.
  - Add a `SettingsOrganizationContext` seeded from `home.groups`.
  - Move `sendInvite` (HTTP + network-failure fallback grant write) to `lib/workspace/invite-client.ts` with 200/4xx/network tests.
- **Planner save protocol** (DRIFT-6, DEAD-10).
  - `remoteRefreshAppliedRef` is inert: both branches return exactly when the editor is clean. Delete it and its plumbing through 3 option bags.
  - The boolean `saveInFlightRef` is released by whichever holder finishes first; make it a holder set (`withShellLock(key, fn)`) and route `use-workspace-tools.ts:183` through it.
  - Do this with prior candidate #4 and ERR-4.

### 5.2 Boundaries

- **Facade** (DATA-1/DOM-1, TEST-1, DOM-10, TEST-3): §4.1.
  - Also note that about 24 non-planner lib stores (sop, departments, notifications, awi, quality-wi, work-instruction, problem-solving) depend on the planner barrel only for the client accessor. That is a `lib → domain → lib` edge.
  - Two domain files import a hand-written lib type through it.
  - The 22 `src/domain/supabase-planner.*.test.*` files are real coverage of the 12 "untested" planner leaves (3,765 lines). Move them beside their leaves in the commit that retires the facade; until then, treat `lib/planner/*` as covered.
- **Domain → lib type edges** (DOM-10): there are 6, not 4. Move `ToolLibraryItem` with the facade work. Move `SopListItem`/`QueueData` shapes only when that area is next touched (it sits next to parked routing).
- **Browser → route calls** (API-4). There are 5 bearer sites with 3 token policies, 4 cookie-only sites, 4 response-parsing styles, and `review.ts:733`/`backup-settings` with `response.json()` and no catch.
  - Add one browser-only `src/lib/api-client.ts` (`apiFetch<T>`, `ApiError`): `getSession()` just before the fetch, text-then-JSON parsing with a plain-text fallback, `expectedUserId`.
  - Server side: either `createSupabaseServerClient()` in the cookie branch so rotations persist, or verify with `getUser(jwt)` so routes never refresh.
- **Server helpers** (API-7, DATA-10): the service-role client is built inline 9 times with 4 missing-config behaviors; the site origin is resolved 5 ways and 3 of them let an empty string through `??`; the super-admin gate is copied twice with different error codes.
  - `src/lib/supabase/admin.ts` with `import "server-only"`, `serviceRoleClient()` returning `| null` (response policy stays per route).
  - `trustedSiteOrigin`, `requireSuperAdmin`, `apiErrorFromPostgrest` (42501→403, P0001→429, 23505→409).
  - Move `createResendSender` and the mail-config diagnostics out of feature modules.
  - Delete the two dead sender fallbacks.
  - Leave `approvers/submit` alone (parked).
- **Thick routes** (API-8).
  - `invites/route.ts:185-224` duplicates `upsertWorkspaceAccessGrantInSupabase` (two `GRANT_EXPIRY_DAYS`). Give the store `client?` and call it from the route. The client fallback (fires only on a network rejection) skips the route's UX checks; it is not a security gap, since RLS gates.
  - `parseInviteRequest` belongs in domain.
  - SOP extract's LLM half (`:240-297`, untested) belongs in `lib/sop/extract-sop.ts`, mirroring `quality-wi/conversion/analyze.ts`.
- **Error vocabulary** (ERR-9, ERR-3, ERR-6).
  - Both `throwIfError` mechanisms drop `code` (planner copy ~195 call sites, shared ~80).
  - There are 178 `instanceof Error ? x.message : …` expressions and 8 local helpers.
  - Procedure saves classify conflicts by `message.includes("conflict")` and retry every ~3.25 s forever otherwise. That loops on CHECK/trigger raises and on the client-only "Edit these instructions in the linked master AWI." (a revoked grant does *not* loop; it surfaces as a conflict).
  - Steps:
    1. `PlannerConflictError` at the 6 task-store sites, classified by `instanceof`.
    2. `DataError {code, retryable, userMessage}` from `toDataError`, re-exported by `query-helpers.ts` so the planner call sites only gain `code` (message-compatible, so `src/lib/planning` is unaffected).
    3. Capped backoff for transient errors, stop + Retry for 4xx/42501/23xxx/P0001.
    4. One `errorMessage()` helper.
- **SolidWorks ingest** (API-5): shared `parseIngestMeta` with `typeof` checks, bounded text and `requireProjectAccess` in `src/lib/solidworks/ingest.ts` with tests. The two routes differ in 5 lines and have none.

### 5.3 Duplication with a behavioral cost

| Rule | Copies | Divergence | Fix |
|---|---|---|---|
| Permission mirrors (SURF-8, DOM-7, RT-11, DEAD-8 row 9) | 20 owner/admin predicate lines in 13 component files; 3 inline project-context builders; WI department rule ×2 (mirrors `can_edit_quality_wi_department`) | Role derivation differs (`productAuthorRole` in the gate; raw `group.role` on mobile). `PlannerProjectContext.role` **is** consumed (sidebar role state, `line-workspace.tsx:571`), so the divergence may be observable. Mobile has no view-only gate. `sop-workspace-provider` `canEdit` is dead and encodes the rule its neighbour's comment calls wrong | `domain/workspace/permissions.ts`: `projectContextFor(group, project)`, pure owner/admin checks, `canEditQualityWiDepartment`. Name the DB function each mirrors. Do **not** fold SOP four-layer or editor-inclusive policies into one `isWorkspaceManager` |
| Step-list rules (DOM-5; prior #8 + §6 row) | Duration sum ×5, renumber ×4, `removeStepScopedCustomFields` ×3 | Mobile also recomputes `plannedFinish` (a second finish policy); its cleanup omits `STEP_PART_MENTIONS_FIELD` (orphan JSON, no user-visible effect) | `domain/procedure-steps.ts` `withSteps(task, steps, {recomputeFinish})`, `removeStep`; one characterization test per policy |
| WBS ordering / hierarchy (DOM-6) | `parseFloat` sorts at pfmea, procedure, operator-allocation, joint-scheduler, calculations; `getTopLevelTasks` (parentTaskId) vs WBS-prefix summary ×3; mobile copies of process-number / station-id / next-WBS helpers | `calculateProductKpis` uses both hierarchy rules | Data check first (§2.6); route sorts through `compareWbsValues`; one hierarchy predicate; delete mobile copies |
| Navigation storage (SURF-4, DEAD-8 row 8) | `"pulse:last-project-id"` ×4 outside Planning; switch keys redeclared in gate and sidebar although `line-workspace/state.ts:37-39` exports them | Matching string literals with no compile-time link | `lib/navigation-storage.ts` (plain module); leave the Planning copy to its owner |
| Photo helpers (DEAD-8 rows 1–2) | `readBlobAsDataUrl` byte-identical ×2; `buildPhotoAttachment` ×2 | lib imports the components copy (remaining lib→components edge) | Keep `lib/step-photo-image` only; repoint mobile, `render-image`, `wi-photos` |
| Blob download (DEAD-11) | 7 sequences, 5 revoke policies; synchronous revoke in `sop-editor.tsx:1097` and `step-photo-viewer.tsx:260` (prior §4.1 D8) | Browser-dependent download failure | `lib/download-blob.ts` with a deferred revoke |
| Small helpers (DEAD-11, DOM-11, DOM-8) | `formatManHours`/`periodLabel` ×3; `isRecord` in 10 domain files; `escapeHtml` ×2 (different `'` policy); 4 domain id minters + 9 UUID fallbacks; code stamping ×2; `awiDraftStatus` in a store, stubbed in both tests | `applyTaskCode` re-stamps `codeGeneratedAt` (persisted) on every zone/component edit; normalizers not idempotent (`new Date()` fallbacks) | Import from `domain/formatting`; `domain/guards.ts`; `domain/ids.ts` with injectable `now`/`newId`; keep `codeGeneratedAt` when the code is unchanged; move `awiDraftStatus` to domain with a test |
| Settings Block/Row (DEAD-8 row 10, SURF-7) | Block ×3–4, Row ×1 live + 1 dead | — | `settings-primitives.tsx` |

### 5.4 Dead code: ~3,300 removable lines with no behavior change

- **Smart-allocation server half** (DEAD-1/API-1/DOM-2/DRIFT-5):
  - Contents: `app/api/smart-allocation/route.ts` (490, live, authenticated, calls OpenAI with `OPENAI_API_KEY`), the solver (654) + its test (141), `buildSmartOperatorAssignments` + helpers 104-127 (keep `sameOperatorIds`, live at :1068), `buildSmartAllocationReviewText` + `buildMarkdownTable`, `report.ts:49-211`, `playback.ts` + `PlaybackEvent`, `taskTone`, the smoke script (280), `smart-allocation-status.md`, its backup-script entry and the `api-auth.ts:108` comment.
  - **First re-point** `SmartAllocationResult` (`smart-allocation-report.ts:26`) to `ReturnType<typeof buildOperatorAssignmentsFromIePlan>`, because it types the live `buildUnallocatedWorkReviews`.
  - Keep `supabase/config.toml:95`, which configures Supabase Studio AI, not this route.
  - The 2462bb4 owner decision already called this code dormant; the owner confirms.
- **Planner write paths** (DEAD-3): 11 functions reached only by tests through the facade.
  - Two bypass current protections: `upsertProcedureStep` does an unversioned upsert; `removeStepPhotoAttachmentObject` hard-deletes storage.
  - e9dd1a3 spent its AWI guard on the dead `saveTaskAndManufacturingStepToSupabase`.
  - **Keep `saveTasksToSupabase`**: live via mobile `saveTaskToSupabase` (TEST-4 correction).
  - Fix the persistence-test comment so step 3 is framed as the mobile path.
  - Record that `reorder_manufacturing_steps` has no app caller.
- **Dead symbols in live files** (DEAD-5): 33 symbols, ~465 lines, 20 files (largest: `buildMarkdownReport` chain, `project-catalog` part-reference chain, `ProcedureToolRegistryTable`, `SettingsRow`, `SopTableSkeleton`, `taskTone`).
  - `listRevisions` and `departments listMembers` are fully unreferenced (DATA-8 correction).
  - The `sop/notifications.ts:12-13` re-exports of `renderSopNotificationEmail` and `SopEmailInput` are dead; **keep `SopEmailContent`** (6 importers).
  - Breaking the FACTS type cycle means repointing those importers (DOM-9).
- **Orphans and test-only modules** (DEAD-6, DOM-9, TEST-9):
  - Delete `QuietLoading` and ~13 test-only helpers (~130 lines).
  - Move 4 fixture modules (319 lines, incl. `sop/sample.ts`, which once corrupted 8 production approval rosters per `sop-editor.tsx:1140-1145`) to `src/test-support/fixtures/`, and add a `no-restricted-imports` rule.
  - `WorkspaceActivitySettings` (230 lines, hidden since dc068ff, still edited by 87ce032): owner deletes it with `loadAuditLogFromSupabase` or lists it under "Deliberate decisions".
  - `procedure-text-restructure.ts` is the test-pinned twin of the backfill script (a sync test asserts byte-identity), so deleting it is optional, not a correctness fix.
- **Inert flags** (DEAD-10): `remoteRefreshAppliedRef` (§5.1); mobile `shouldReschedule` is never true, which makes `rescheduleMobileTasksByDependencies` unreachable (owner D8 decision); the write-only `pulse:photo-portal-project` key; the `--shell-drawer` variable.
- **Prevent recurrence** (DEAD-12): 2462bb4's manual deletion left 5 transitive orphans. Add knip (or the import-graph script) as a non-blocking CI report; make unused *files* blocking after the deletions land. Don't hand-prune the 295 harmless over-exports.

### 5.5 Types

- **DATA-6:** about 77 mapper sites erase generated row types (`as unknown as Record<string, unknown>` after typed `.select(...)`), then re-coerce with `String()`/`Number()`. A renamed column becomes `""`/`0` instead of a compile error, which matters for `sop_number`/`effective_date`; `mapSopListItem` has no fallback.
  - Type mappers on `QueryData<typeof query>` or `Tables<>` one store at a time when touched, starting with `sop/store.ts` and `departments/store.ts`.
  - Fold `rasic-roles` and `job-titles` (identical but for table and messages) into `createWorkspaceVocabularyStore`.
  - Leave planner row-mappers until prior #4 lands.

### 5.6 Tests: what must exist before boundaries move

- **TEST-1** (do before any facade move): 28 files mock `@/domain/supabase-planner` by path, and only 1 mocks a leaf.
  - Once code imports a leaf directly, the real leaf calls `plannerClient()`, which throws without `NEXT_PUBLIC_*`. CI's Test step sets none, and Vitest loads only `VITE_` vars.
  - Most files then fail loudly, but about 5–7 negative-only guard tests would pass vacuously. Examples: `use-workspace-saves.test.tsx:238` flush path (refuse-before-confirmed), view-access drop, account-switch cancel. `sync.test.tsx:463` would pass for the wrong reason.
  - Steps: retarget spread mocks to leaves; mock `@/lib/planner/client` for client stubs; path-only edits for the three parked SOP tests; a positive control in every negative-only test; lint ban.
  - The leaf-mock seam is proven: `supabase-planner.client-boundary.test.ts` passes 5/5 with a two-hop-deep mock.
- **DOM-3** (supersedes prior Phase 2 #10):
  - `getOperatorAssignmentBlockState`, `validateOperatorAllocations`, `buildOperatorAssignmentsFromIePlan` and `buildUnallocatedWorkReviews` drive the Gantt operator buttons and recommendation count, and appear in 0 tests.
  - `nomenclature.ts` mints WI codes and has already drifted from its contract: `schema.ts:52` documents `Z1-A-010-WI1-010`, while the code returns `${documentCode}-S${n}`.
  - `buildStationSetupDocumentHtml` uses `toLocaleString()`, untested.
  - `sop/signature.ts` controlled-document strokes are untested.
- **TEST-6:** no test checks the CLAUDE.md-required `!sops_department_id_fkey` hint (PGRST201 for every SOP read if dropped). Add recording-client assertions, plus `writes()` empty for each read `server-data.ts` calls (READ-ONLY rule in the data layer).
- **TEST-7:**
  - `server-data.ts` and `request-context.ts`: no direct tests; failures degrade silently.
  - 9 of 20 API routes have no tests, including the SolidWorks targets route whose 403 is "the real authorization boundary".
  - `AuthProjectGate`'s event machine is untested and its helpers are private.
  - Seams exist: the `problem-solving/page.test.tsx:4` pattern and the `invites/route.test.ts:30-33` pattern. `approvers/stage` stays characterization-only.
- **TEST-2:** 47 of 67 planner leaf functions take no `client` parameter, which forces jsdom, env-before-import and a global name hard-coded in 10 tests. Add `client?` when a leaf is touched (CLAUDE.md step 3); one `installPlannerClient(fake)` helper.
- **TEST-5:** the in-memory double ignores `onConflict`/`ignoreDuplicates`, throws JS errors instead of `{code:"23505"}`, makes `or`/`order`/`limit` no-ops, and has no row cap.
  - Raise its fidelity (honor or throw, PostgREST-shaped errors, `maxRows`, `hold`/`failNext`).
  - Keep both doubles; they answer different questions.
- **PLAT-7:** migration `20261009144351` has 86 `alter policy` statements, and pgTAP asserts no direct-table writes on tasks, stations, zones, scenarios or task_dependencies, and nothing on duplicate/delete scenario. The only coverage is hand-run scripts against `DATABASE_URL` (production).
  - Port `test-rbac-boundaries` into `planner_rls_test.sql` with a 3-user cross-project write-denial matrix.
  - Retire `test-scenario-flow.mjs`.
- **TEST-10 (P3):** six `.tsx` data tests contain no JSX, 54 jsdom docblocks are redundant, and `vitest.config.ts` triggers an ESM-as-CJS warning (rename to `.mts`).

---

## 6. Platform and hygiene

**CSS**
- **PLAT-5:**
  - 45% of `globals.css` non-blank lines belong to rules used by exactly one TSX file.
  - Lines 307–987 (photo viewer) ship on every route (≈2.7 KB gz of the 22.2 KB gz root CSS).
  - 3727–3861 is an unlayered tail added by 5 commits, against the CLAUDE.md `@layer` rule.
  - SOP preview geometry has 3 owners, incl. a 223-line template literal in `sop-print-preview.tsx:899-1122` (its re-declarations are responsive/print variants tied to the pagination invariant at 1088-1094).
  - Fix: layer or move the tail. Move only 307–987 into `photo-overlay.css`; **988–1047 is the shared `.ui-context-menu` primitive and stays**. Moved rules become unlayered, so check overlap with utilities on each element and verify live.
- **PLAT-10 / DEAD-13:**
  - Dead selectors: `globals.css` has 35 rules / 26 classes; `line-workspace.css` 28 / 12; `mobile-photo-portal.css` 26 / 17.
  - 515 blank lines sit in 14 runs (the longest is 169 lines at 3500–3668).
  - The Tailwind aliases copper/teal/signal/graphite/panel have 0 uses, and the `amber`/`teal` overrides delete the default scales (the badge defect, §2.5).
  - `.ui-bento` sits inside a grouped selector; remove only that selector.
  - The auth classes are `.ui-auth-divider`, `-line`, `-label`.
  - Owner sign-off is needed for `ui-*` deletions.
- **DEAD-9 / SURF-10:**
  - Usage: `<Button>` in 4 files vs `ui-btn-*` with ~314–359 uses in 78–92 files; TextInput 3 importers vs ~125–163 raw inputs; 4 hand-rolled `showModal` dialogs; `useConfirm` (center only) vs 3 local `ThemedFeedbackLayer` confirm hosts.
  - Ghost buttons differ by system: compact height at 0.75rem vs a standard default at 0.8125rem (Button does accept `density="compact"`).
  - `confirm()` overwrites a pending resolver without settling it.
  - Fix: one visual source now (define `.ui-btn-*` via the controls variant rules, or have Button emit the legacy classes), then migrate by moving callers, never by editing global `ui-*` classes. Add `placement`/`anchorRect` to `ConfirmOptions`; settle the previous resolver.

**CI**
- PLAT-1 (bundle guard), PLAT-2 (proxy test), PLAT-4 (TZ): §2.5 and §4.0.
- **PLAT-3:** both browser jobs are `if: ${{ false }}` since 7e4ad78. That leaves 37 browser cases unrun across 23 commits, including e9dd1a3 (AWI) and 6bc115e (WI layout). The 87ce032 spec edits have never run. `test-quality-wi-ci.mjs:6` refuses to run outside GitHub. Two docs still claim active coverage.
  - Owner decision: (a) re-enable `browser`, or (b) keep it paused, add an explicit local pre-merge command to CLAUDE.md recipe step 6, and correct the docs.
  - Either way, run the 4 e2e specs once against HEAD now.
- **PLAT-9:** CLAUDE.md hard rules have no tripwires. Add `scripts/check-conventions.mjs`:
  - (a) fail on any `create (or replace) function … (enforce_sop_transition|sign_sop)(` in a migration newer than `20260710124500`
  - (b) fail on top-level rules outside `@layer` in `globals.css`, with the scrollbar selectors allow-listed
  - (c) a `gen types --local` diff, only after validating it, because `gen:types` reads the production schema
- **PLAT-13:** `relock.yml` uses floating `@v7` with no `permissions:`, which contradicts `ci-reliability.md:13`. Pin SHAs and add `contents: read`.

**Migrations and DB tooling**
- **PLAT-6:**
  - The documented production applier (`apply-migration-safely.mjs`) never writes `schema_migrations`.
  - `repair-migration-ledger.mjs` marks every unrecorded repo file applied, with no existence check.
  - Three legacy appliers would replay `20260521120000:84-96` and recreate the workspace-role-only `tasks workspace insert`, silently reverting `has_product_project_access`.
  - Fix:
    - Write the ledger row in the same transaction (copy `verify-local-migration.mjs:41-52`).
    - Refuse replays unless an override flag is passed.
    - Make the repair script take explicit versions.
    - Delete the legacy appliers.
- **DBP-7, DBP-8:** §4.4. Also check `EXECUTE` grants on the dead `*_workspace_id` resolvers, which are probably callable as RPCs.

**Routes and config**
- **API-9:** 15 `dynamic = "force-dynamic"` and 8 `runtime = "nodejs"` exports are redundant in Next 16 and **error once Cache Components is enabled** (`migrating-to-cache-components.md:75`). Remove them in one mechanical commit (13 files after API-1 and API-2), keep `maxDuration`, and drop the `targets` POST 405 stub.
- **RT-10:** the proxy matcher runs on 6 public files (push SW, signature font, 3 PDFs, license txt). Add `ttf|js|pdf|txt`. Fix `client.ts:124-127` (server `getSession` is safe because RLS verifies the JWT, not because the proxy "already ran getUser") and the two `middleware.ts` mentions in `server.ts`.
- **RT-8:**
  - Import `SopEditorInitialView` from `./sop-editor-step` and delete the re-export at `sop-editor.tsx:88`; this breaks the FACTS type cycle.
  - Use one `parseSopEditorInitialView` instead of 3 hand copies.
  - Move the 4 `/sops/*` redirect stubs into `next.config` `redirects()`. `/sops/review` is the link in digest emails and inbox items.
- **API-6:**
  - Password reset is public and throttled only per instance in memory (it bypasses Supabase mail limits via `generateLink` + Resend). Count `transactional_emails` rows per recipient in the last 15 min; the `transactional_emails_recipient_idx` index already exists.
  - Log when the extract gate fails open.
  - Add sweep-on-write eviction to `createApiRateLimiter`.
  - Keep the WI RPC limiter.
- **PLAT-13:**
  - `tsconfig` typechecks the git-ignored `scratch/` (8 files); add it to `exclude`.
  - `.env.example` lists 4 of ~37 env vars.
  - `docxtemplater` and `slot-text` are unused; remove them via the `relock.yml` workflow, per the lockfile rule.

**Scripts, docs, repo**
- **PLAT-11:** `scripts/` mixes operational tools, ~15 applied one-offs and live-DB harnesses. `build-flexboost-excel-export.mjs` imports a package that isn't in `package.json`. Two production writers (and one reader) fall back to the production URL when env is missing, and `upsert-auth-user` takes a password on argv. Archive the one-offs, add a `scripts/README.md` table, and remove the URL fallbacks.
- **PLAT-12:**
  - `docs/README.md` is stale (line counts 3,652/4,044 vs actual 2,821/3,176) and doesn't index this or the prior audit.
  - Several docs describe deleted code (drawer, smart-allocation, Excel add-in).
  - There are root strays and no root README.
  - ~10 MB of unreferenced PNGs: check `tool_library.image_url` before deleting `/tool-images`.
- **DRIFT-7:** WI letter pagination measures text with a hand-built DOM probe that differs from `PartReferencedInstruction`: marker mapping and `P{n}` citations. Card objects are mutated in place, and `JSON.stringify(instruction)` runs on every render. When the WI renderer is next touched, measure with the real renderer.
- **SURF-12:** Problem Solving hard-codes `rlopez` as signer and actor (`problem-case-form.tsx:59, 81, 82`; `problem-workspace.tsx:103`). Render `closed_by` and `actor` names **before** the pilot gate widens; this is a quality record.
- **SURF-13:**
  - Folder layout is inconsistent: AWI (5) and Settings (14) are flat; "work instruction" has three homes; Quality chrome lives in `sop/`.
  - `app-settings-panel.tsx` has 230 blank lines out of 620.
  - Do pure moves only, justified by locatability.
  - Dropped: the AWI category datalist is not a competing copy of `PRODUCT_CATEGORIES`.

---

## 7. Phased plan

Each item lands on its own branch: CI green, then verified live in the browser where the behavior is observable. Items within a phase are independent unless noted.

**Phase 0: stop the line (days)**
1. DRIFT-2: cached switch-back revalidation; flip the OBSERVED test. In the same branch, write the ERR-4 two-client test and record its result.
2. DRIFT-3:
   - exclude linked tasks from `moveTargetTasks`
   - validate the target before any write in the move
   - mobile read-only for linked tasks
   - DB trigger migration (schema first, `gen:types`)
   - read-only orphan query, with results to the owner
   - owner decision on linked duration
   - one test per path
3. PERF-1 (fatal half first): a per-link failure keeps the link marker and renders "master unavailable"; test that one failing master still loads the planner.
4. SURF-2: owner chooses retire or rebase; fix the stale copy.
5. PLAT-4/TEST-8 TZ pin (one local full run first); PLAT-2 proxy test collected.
6. PLAT-3: run the 4 e2e specs once against HEAD; owner decides re-enable vs documented local gate.

**Phase 1: deletions and local fixes (days)**
7. Owner confirms, then delete the smart-allocation surface (DEAD-1). Re-point `SmartAllocationResult` first, re-run the import graph, strike prior Phase 2 #10, and unset `OPENAI_API_KEY` if nothing else uses it.
8. Delete the 11 dead planner writers and their test cases (DEAD-3); fix the TEST-4 comment; keep `saveTasksToSupabase`.
9. One-line bundle fixes: PFMEA re-export (DEAD-2); `nav.tsx` import (SURF-9); verify with a rebuild.
10. Bundle guard over all manifests with a ratchet (PLAT-1).
11. RT-2 `retry`; RT-1 fallbacks + `loading.tsx`; RT-3 `loading.tsx` on the mobile routes.
12. RT-5/ERR-5 keep the seeded access; SURF-1 purge + user-scoped cache; SURF-11 visible-remark rule.
13. API-3 webhook order + replay test; API-4 admin console fresh token; ERR-6 wrap raw throws; ERR-7 loaded/error states; ERR-8 normalizer + route-walk test.
14. PLAT-8 CSP; amber badge; PLAT-6 ledger + replay refusal + delete legacy appliers.
15. DATA-2 `delete_project` RPC + pgTAP (schema first).
16. DBP-7 drop the 3 exact duplicate indexes; DBP-5 drain index; DBP-6 batched author names.
17. Inert flag `remoteRefreshAppliedRef` (DEAD-10/DRIFT-6 part 1); DEAD-5 dead symbols; QuietLoading and test-only helpers; fixtures to `test-support` + lint rule (TEST-9).
18. Hygiene batch: RT-8, RT-10, API-9, PLAT-13 (`tsconfig` exclude, `relock.yml` pin), PLAT-12 docs index.

**Phase 2: characterization before boundaries (days)**
19. TEST-1: retarget facade mocks to leaves, add positive controls, lint ban. No production change.
20. DOM-3: live allocation, nomenclature (then fix the `schema.ts:52` comment), station-setup HTML with injected time, signature parsing.
21. TEST-6 FK-hint and read-only assertions; TEST-7 server-data, route 403s, auth-event decision table; PLAT-7 planner RLS pgTAP matrix.
22. Prior Phase 2 #7 (mobile characterization) and #8 (Gantt layout + link-mode tests).
23. ERR-2 observability seam + ERR-1 `serverSeed` + ERR-10 AI completion lines: zero behavior change, and this produces the performance baseline.
24. Profile PERF-7, PERF-9, PERF-10, PERF-11 on a 20-step task / 15-page SOP. DBP-2 step 0: `EXPLAIN` as `authenticated` on an isolated copy.

**Phase 3: boundary changes (1–3 weeks total)**
25. Facade narrowing for non-planner importers (DATA-1/DOM-1/PERF-2/DOM-10), one importer group per commit; `check:bundles` and a grep of the root chunk after each.
26. Session owner: RT-7 quick win, then `useSessionGate` (SURF-4), then the current-profile store (DATA-4), then a root `SessionProvider`.
27. `getSopServerContext()` (RT-4/DATA-7).
28. Error vocabulary: `PlannerConflictError`, then `DataError`, then the procedure retry policy (ERR-9/ERR-3).
29. `buildGanttLayout` + `buildOperatorLoadIndex` + drag bail-outs (prior #9, DOM-4, PERF-10).
30. `useMobileWrites` (prior #3, fixes mobile D2).
31. Planner `createPlannerSaveSession()` (prior #4 step 2) with the holder-set lock, the tools save through it, and the ERR-4 status writer if the Phase 0 test confirmed it.
32. Permission mirrors module (SURF-8/DOM-7/RT-11); browser API client (API-4); server helpers (API-7/DATA-10, unparked routes only).

**Phase 4: as capacity allows**
33. `(product)` layout + Product directory owner + data-free loading fallbacks (RT-6, SURF-3, SURF-5), then lower the e2e directory-GET budget.
34. SOP read model (DATA-3/SURF-6); Settings org context (SURF-7/RT-12).
35. Render locality (PERF-7, PERF-8, PERF-9, PERF-11), as the profiles justify. WI preview payload (PERF-4). PERF-12. DATA-5 with request-count tests.
36. RLS flattening (DBP-2/DBP-4/DBP-8) if `EXPLAIN` shows RLS dominating; then DBP-3 and DBP-1.
37. Step rules (DOM-5); WBS/hierarchy after the data check (DOM-6); prior #8, #10, #12, #13, #14, #17, #18, #19.
38. API-5 before the SolidWorks plugin is built; API-6; API-8; API-10 after the env check; RT-9 decision.
39. `globals.css` ownership (PLAT-5); convention tripwires (PLAT-9); dead CSS (PLAT-10/DEAD-13); button single source (DEAD-9/SURF-10).
40. DATA-6, DATA-8, DATA-9, TEST-2, TEST-5, TEST-10, DOM-8, DOM-11, DEAD-11, DEAD-12 (knip report), DRIFT-7, SURF-12 (before the pilot widens), SURF-13, PLAT-11.

---

## 8. The three highest-value next changes

**1. Close the two planner data-loss paths (DRIFT-2, then DRIFT-3 + PERF-1's fatal half).**
- Nothing else in this report silently destroys a teammate's work. DRIFT-2 is no longer a hypothesis: the repo's own test asserts the deletion, and it passes at HEAD.
- The fix is S-sized and reuses a guard that already exists (`remoteStateConfirmedRef`), so it adds protocol only where the protocol was missing.
- DRIFT-3 is a day-old feature whose invariant lives only in client guards. Putting it in the database now, per CLAUDE.md recipe step 1, is cheapest before more orphaned rows accumulate.
- PERF-1's fatal half turns one flaky request into "the planner won't open for anyone on this product", and the fix is a contained change to one read path.

**2. Clear the deck, then narrow the facade: delete dead code, retarget test mocks, repoint the root layout (DEAD-1, DEAD-3, DEAD-2, TEST-1, DATA-1).**
- About 3,300 lines and one paid, caller-less endpoint go away with no behavior change.
- The PFMEA line alone takes ~40 KiB gz off every planner open.
- Prior Phase 2 #10 stops spending effort on dead code.
- After that, the facade can be narrowed so `/login` and every SOP route stop parsing the planner's write, realtime and task code (~25 KiB gz).
- The order matters: TEST-1 must come first. Moving imports before retargeting mocks can merge green while the refuse-before-confirmed and view-only guards stop testing anything.
- This is the cheapest structural change that both shrinks the per-route floor and makes later modules independently testable.

**3. Give the client session one owner, with a baseline first (ERR-1/ERR-2 → RT-7 → SURF-4 → RT-6/SURF-3).**
- The owner's performance goal is mostly navigation over plant Wi-Fi. Today every product-space navigation re-authenticates, reloads groups on server and client, re-reads the profile twice, and re-fires a ~12-query notification refresh.
- Each tab return reloads groups unthrottled and re-renders the 2.8k-line planner.
- Every auth-flow fix has to be made twice, and the two copies have already drifted.
- Do it in this order:
  1. The S-sized RT-7 quick win (same-user `SIGNED_IN` ignored, `sameSnapshot` guard) for immediate relief.
  2. The observability seam, so the before/after is measurable.
  3. The shared `useSessionGate`, behind the auth-event decision-table tests.
  4. Only then the `(product)` layout.
- Each step stands alone and is reversible. The last step is the one that lets navigation cost fall below auth + groups ×2.

---

## Appendix A. Verification status

| Dimension | Findings | Confirmed | Confirmed with corrections | Unverifiable | Re-checked P0/P1 |
|---|---|---|---|---|---|
| Server-first routes (RT) | 12 | 7 | 5 | 0 | — |
| API routes (API) | 10 | 2 | 8 | 0 | — |
| Data layer (DATA) | 11 | 5 | 6 | 0 | — |
| Domain (DOM) | 11 | 2 | 9 | 0 | — |
| Dead code (DEAD) | 13 | 7 | 6 | 0 | — |
| Client performance (PERF) | 12 | 6 | 6 | 0 | PERF-1: holds "likely" |
| Unaudited surfaces (SURF) | 13 | 5 | 8 | 0 | SURF-2: holds |
| Drift (DRIFT) | 7 | 5 | 2 | 0 | DRIFT-2: holds (test re-run, passes); DRIFT-3: holds |
| Platform (PLAT) | 13 | 5 | 8 | 0 | — |
| DB query performance (DBP) | 8 | 4 | 4 | 0 | — |
| Test architecture (TEST) | 10 | 4 | 6 | 0 | — |
| Error handling (ERR) | 10 | 2 | 8 | 0 | — |
| **Total** | **130** | **54** | **76** | **0** | 4 of 4 hold |

### A.1 Lead verification and independent calibration

**Lead re-trace (main session, read at HEAD):**
- DRIFT-2: re-ran `use-workspace-scenarios.test.tsx`, which passes and asserts `wouldDelete == [["task-b2-remote"]]`. Confirmed the real `savePlannerShellToSupabase` diff-deletes per `scenario_id` (`shell-store.ts:260, 336`). Confirmed the tripwire only fires at ≥5 existing rows **and** >50% stale (`shell-store.ts:88-98`), so one teammate's row passes.
- PERF-1: `read-store.ts:243` runs `Promise.all` over `resolveLinkedAwiTask` (`:574-582`). Each linked task makes a serial `awi_masters` read and then `loadTaskFromSupabase` (`:524-549`: an access RPC, `tasks`, and 7 paged child selects). There is no dedupe, and any throw rejects the whole load.
- DRIFT-3: `moveTargetTasks` filters only `rowType`/self (`procedure.tsx:339-342`). `moveProcedureStepToTask` has no link check (`line-workspace.tsx:1652-1700`). The move commits `manufacturing_steps.task_id` (`task-store.ts:646-651`) before the target-side guard throws (`:480`). The catch restores local state only. `mobile-photo-portal.tsx` has zero `awiTaskLink` references.
- SURF-2: `canCreate` includes `editor` (`project-settings.tsx:16-18`). Migration `20261009144351` rewrites `create_project_with_starter_plan` to `has_product_access(…,'edit')`. The Settings shell still passes `directoryScope="project"` (`project-route-shells.tsx:112-114`).
- PLAT-4: no `TZ` in `vitest.config.ts`, `vitest.setup.ts`, `package.json`, `ci.yml` or `formatting.test.ts`.
- PLAT-1: every route manifest was re-measured. `sops/[sopId]` is 361.6 KiB and `sops/new` 361.0 KiB, against a 350 KiB cap. `check-client-bundles.mjs` checks 5 of 34 routes.

**Independent calibration sample.** 18 P2 findings, stratified across dimensions, were re-checked by a separate model: RT-2, RT-5, API-3, API-5, DATA-1, DATA-2, DATA-4, DOM-4, DEAD-2, PERF-7, PERF-9, SURF-1, PLAT-2, PLAT-6, PLAT-8, DBP-1, TEST-1, ERR-6.
- **Result: 16 held, 2 held partly, 0 were wrong.** The core mechanism held in every case.
- The error pattern is in supporting prose, not the mechanism:
  - PLAT-2: wrong commit provenance (already corrected below).
  - DATA-1: "15 leaves" is really 13 re-exported modules, and "23 importers" is about 24.
  - TEST-1: "9 vacuous tests" is really 8 locations, several with other positive assertions.
  - ERR-6: quotes a stale RPC message.
  - PERF-9: the per-keystroke `setPlannerState`, not only the draft-version bump, drives the re-render.
- These are corrected in the body.
- **Severity skews about one notch high** in three groups, and the following are lowered in this report:
  - RT-5 and ERR-6 to P3.
  - API-3 to P3 (needs a double fault).
  - API-5 to P3 until the plugin exists.
  - PLAT-8 to P3 (Microsoft-controlled origins only).
  - DATA-4 and DOM-4 to P3 until profiled.
- PERF-7 and PERF-9 are mechanism-confirmed but **unmeasured**. §4.0's "profile first" applies to them.
- DATA-2 holds, but its trigger requires a mid-session role change or a UI bypass: both callers are gated by `canManage`.
- **How to read the rest:** treat every finding's *mechanism* as reliable. Re-check exact counts before quoting them, and profile before acting on any P2 performance item that carries no measurement.

**Severity changes made in verification:**
- Downgraded:
  - RT-6 (P1→P2)
  - SURF-1 (P1→P2)
  - API-3 (P1→P2)
  - DATA-1, DOM-1, DOM-2, PLAT-1 (→P2)
  - TEST-1, TEST-6, TEST-8 (→P2)
  - TEST-4 (→P3)
  - ERR-1, ERR-2 (P1→P2)
  - DBP-1, DBP-3, DBP-4 (→P3)
  - SURF-6 (→P3)
- Upgraded: one part of PLAT-10 was split out as a P2 visible defect (the amber badge).

**Claims checked and rejected or corrected** (one line each):
- PERF-1: "a viewer of the linking product who cannot view the master" is unreachable; product access is workspace-scoped.
- DRIFT-3 (c): only a master with at least one step locks duration at 0.
- TEST-4: `saveTasksToSupabase` is **not** dead; it is live via mobile `saveTaskToSupabase`. "Delete 8 writers" was rejected.
- DEAD-8 row 9: "no `.role` consumer, divergence latent" is false; the sidebar and `line-workspace.tsx:571` consume it.
- DRIFT-1: "state.ts switch keys imported by nobody" is false; only the redeclarations are the issue.
- DOM-9: "the tested restructure copy is not the code that ran" is refuted by a byte-identity sync test. "notifications.ts:12-13 dead" holds only for `renderSopNotificationEmail`/`SopEmailInput`.
- DOM-7: `workspace-store.ts:305` `isSuperAdmin:false` is correct by construction. Several "inline predicates" are distinct policies (SOP layers, editor-inclusive).
- ERR-3: a revoked edit grant does not loop (it surfaces as a conflict). Loops happen on CHECK/trigger/RPC raises and the client-only AWI throw.
- RT-9: in-app printing never reaches the print route; `hrefForLayout` is a dead prop.
- RT-4: the cache-key split between `()` and `("project")` is hypothetical (no caller passes `"project"`); `isSuperAdmin` is not on every group.
- RT-6: 7 gate instances, not 8. RT-7: 10 production `onAuthStateChange` subscribers, not 11.
- RT-11: the settings raw-role builder is not divergent in effect (project scope).
- PERF-9: moving the draft version into a store alone would not stop the re-render; `setPlannerState` per keystroke is the driver.
- PERF-5: lazy-loading `SopPrintPreview` in the editor alone won't remove it; the quality-approval workspace imports it statically.
- PERF-7: drag-target updates bail out (primitive strings); only `setDragPreview` objects force renders.
- PERF-4: Word export does not load pdf-lib.
- PERF-11: `useDeferredValue` must sit inside the preview, not on the prop.
- PLAT-5: 307–1076 is not viewer-only; 988–1047 is the shared context-menu primitive.
- PLAT-2: the root proxy test was born in 971bc98, not e4c84f8.
- PLAT-9: 10 migration files patch the SOP functions in place (14 occurrences), not "16 patches".
- PLAT-11: 60 tracked script files, not 61; `backup-flexboost` is a reader.
- PLAT-12: the stale counts are at `docs/README.md:23-25`.
- SURF-1: the impact is IDB residue and stale snapshots, not another user's private data.
- SURF-2: the `workspace-members-settings.tsx:71-76` copy is not stale.
- SURF-3: the gate's two calls per mount dedupe to one directory load.
- SURF-5: TOKEN_REFRESHED hydrate fires only without `initialGroups`; warming writes nothing to IDB.
- SURF-6: only the active SOP tab polls; DepartmentsAdmin is not a poller.
- SURF-7: in-flight dedupe means about one extra directory read; Row is copied once.
- SURF-10: Button supports `density="compact"`; counts are approximate.
- SURF-13: the AWI category datalist is not a `PRODUCT_CATEGORIES` copy (dropped).
- API-2: it mints a pending department-reviewer membership, not an SOP seat.
- API-3: hard bounces re-suppress on the next bounce; already inventoried as W12.
- API-7: the invites fallback is unreachable, not an empty-credentials sender; raw `.message` passthroughs are ~20–33, not exactly 33.
- API-8: the invites client fallback is not a security gap (RLS gates); it fires only on a network rejection.
- API-9: 13 files remain after API-1/2, not 12.
- API-10: the cache is sessionStorage and does not prevent the request.
- DATA-3: N is the number of in-review seat SOPs; the tick is visibility-gated.
- DATA-5: `getSop` + `getSopControl` already run in parallel.
- DATA-6: counts are approximate (35 `as unknown as` in non-planning lib; 111 `Record` occurrences).
- DATA-8: `listRevisions` and `listMembers` are wholly unused, not test-only.
- DATA-10: the differing missing-config responses are partly deliberate per-route policy.
- DOM-5: mostly a re-report; only the mobile finish-time policy is new.
- DOM-6: `row-mappers` round-trips `parentTaskId`; nothing assigns a non-null value.
- DOM-8: `codeGeneratedAt` is persisted, not reader-less.
- DOM-10: `awi-categories` imports a store module.
- DOM-11 / DEAD-11: `isRecord` is in 10 domain production files; the Gantt stamping site needs patch-form adaptation.
- DEAD-1: `SmartAllocationResult` types live code, so re-point it first; `config.toml:95` is Supabase Studio's key.
- DEAD-10: 16 `procedureDraftLog` call sites, not 18.
- DEAD-13: class names corrected; `.ui-bento` is in a grouped selector.
- DBP-1: the STABLE premise lives in auto-memory, not `db-audit-2026-06-01.md`; the original skip reason still holds.
- DBP-8: `task_workspace_id` backed storage policies until `20260701120000`.
- TEST-1: 17 full-factory / 11 spread mocks; the vacuous-test list is ~5–7, not 9 (`use-workspace-tools.test.tsx:181` has a positive check).
- TEST-5: `access-store.ts:237` conflicts on `project_id,user_id`.
- TEST-6: the PGRST201 necessity is established for `sops` only, not for `quality_work_instructions`.
- ERR-2: 43 console error/warn calls, not 41; `resolveSupabaseSession` clears an already-invalid session.
- ERR-6: the current RPC message is "Only an owner can remove an owner or admin."
- ERR-8: only Problem Solving and the WI library land in the SOP-detail bucket; WI editor ids create their own buckets.
- ERR-9: `credential-link-panel`'s helper is a deliberate translator; `PlannerConflictError` alone unblocks ERR-3.
- ERR-10: `quality-wi/convert` persists the friendly failure; only the root cause and timing are lost.

## Appendix B. Metrics

**Codebase and graph**
- 851 TS/TSX files in src/ + app/ (542 production, 309 test); 176 `"use client"`.
- Runtime import cycles: **0**; type cycles: 2.
- Production files with no test importer: 240 (197 non-planning after TEST-3's correction; the 12 planner leaves are covered through the facade).
- Domain outside Planning: 121 production files / 18,414 lines vs 130 test files / 15,406 lines.

**Coordinators (base → HEAD)**

| File | Lines | useState | useEffect | useRef | useMemo |
|---|---|---|---|---|---|
| line-workspace | 3656 → 2821 | 37 → 30 | 18 → 15 | 36 → 33 | 12 → 13 |
| mobile-photo-portal | 3176 | unchanged (43) | unchanged | unchanged | unchanged |
| sop-editor | 1992 | unchanged (45) | unchanged | unchanged | unchanged |
| gantt-timeline | 2399 | 17 | | | 0 |

- Planner hook option bags: 38 / 26 / 25 / 17.
- Planner `setSaveState`: 73 across 8 modules. Mobile: 40.

**Bundles (HEAD build)**
- 128 client chunks, 1,660 KiB gz in total.
- Shared floor on every route ≈243 KiB gz, of which the planner facade chunk is 25.1 KiB gz.
- Entries: sops/[sopId] 361.6, sops/new 361.0, awi/(directory) 317.3, WI editor 311.6, planner 291.3, sops 286.5, invite/reset-password 248.3. Cap 350; 5 of 34 routes guarded.
- LineWorkspace lazy group ≈198 KiB gz, including PFMEA + pizzip ≈41–42 KiB gz.
- First WI preview ≈700 KiB gz.
- Root CSS 126.7 KB raw / 22.2 KB gz.
- React.memo: 0. Virtualization: 0.

**Server and network**
- Routes outside Planning: 25 pages (15 server-seeded), 3 layouts, 11 `loading.tsx`, 3 `error.tsx` (all on `reset`), 0 `global-error`.
- SOP layout critical path: 5 sequential round trips. Problem Solving: ~8, with pilot RPC ×3.
- Profiles reads per full load: 4. Notification refresh: ~12–13 queries per bell mount.
- e2e AWI: 61 directory GETs across 6 transitions (budget 72).
- Linked AWI: ~12 requests per linked task per load, plus ~12 per link on each focus.

**API**
- 20 routes, 2,850 lines; 749 lines (26%) have no caller.
- 9 routes have no test; 13 have no log call.
- Service-role client built inline 9×; origin resolved 5 ways.
- 15 in-memory limiters.
- 15 `force-dynamic` exports.

**Data and DB**
- Browser-client acquisitions in non-planning lib: 174, 72 of them injectable.
- Planner leaf functions: 47 of 67 without `client`.
- ~90 unpaginated list reads; 8 with unbounded growth; `max_rows` = 1000.
- Effective RLS policies: 239 on 75 tables.
- Per-row nested calls: 6–9 for the product graph, up to 16 for `actual_events`.
- Policy helpers: 30, of which 3 are VOLATILE.
- Indexes: 130 effective, of which 13 are redundant or likely unused.
- 165 migrations, 0 out of order.

**Dead code and duplication**
- Unused exports: 337 outside Planning. 295 are harmless over-exports; 38 are genuinely dead.
- Removable without behavior change: ~3,300 lines.
- 0 TODO/FIXME; 0 commented-out code blocks.
- Owner/admin predicates: 20 lines in 13 files.
- `ui-btn-*`: ~314–359 uses, vs `<Button>` in 4 files.

**CSS**
- `globals.css`: 3,861 lines (981 blank); 45% of non-blank lines are single-consumer; ~135-line unlayered tail.
- Dead selectors: 89 rules across 3 files.

**Tests and CI**
- 299 test files outside Planning.
- 28 test files mock the facade (1 mocks a leaf).
- 37 browser cases not running in CI.
- TZ not pinned anywhere.
- Swallowing catches: 197 in scope (138 deliberate, 14 silent server seeds, 9 silent background reads, 5 false-state/silent-write).

## Appendix C. Not examined / residual blind spots

- **No runtime measurement.**
  - Nothing was run: no dev server, no profiler, no network trace.
  - Re-render magnitudes (PERF-7/9/10/11), server wave counts (RT-3/4) and request estimates (DATA-3) are derived from code.
  - The inlined mobile `PlannerState` size is unmeasured.
  - DRIFT-2 was confirmed by the repo's own test, not a two-client browser run. DRIFT-3's mobile path and ERR-4 need a device or two-client reproduction.
- **No live database or hosted environment.**
  - Not inspected: `pg_proc` volatility, live policy text, `idx_scan`, row counts, `EXPLAIN` plans, the ledger contents, hosted vs seed grant parity, Realtime RLS and publication membership.
  - Not confirmed: whether `OPENAI_API_KEY`, `NEXT_PUBLIC_PHONE_PORTAL_URL` or `RESEND_WEBHOOK_SECRET` are set in production, and GoTrue refresh-token reuse settings.
  - Not checked: `tool_library.image_url` referencing `/tool-images`.
- **Functions patched in place are not costed:** `enforce_sop_transition`, `sign_sop`, `submit_sop_review`, `reassign_sop_seat`, `enforce_seat_freeze`, and the 4 product RPCs rewritten in `20261009144351`. Their live text is not in the repo.
- **Bundle evidence comes from the existing `.next` build.** It was not rebuilt to test any proposed change. Unconfirmed:
  - whether Turbopack honours `sideEffects` for app source
  - whether `check:bundles` counts lazy groups
  - the chunk-group placement of `work-instruction-print` (dynamically and statically imported)
- **Out of scope by owner decision:** the Planning space (incl. its seeds inside `server-data.ts`, its bundle route and `scripts/planning/*`); SOP approval routing internals, approval writes and `lib/sop/list-review-data.ts` participant derivation (noted as O(SOPs × seats × signatures) per 15 s poll, not evaluated); the mobile C1 recovery-draft store and its swallowed loads (`mobile-photo-portal.tsx:1145-1162, 2466`).
- **Read lightly or not at all:**
  - notification drain internals (covered by the 2026-09-04 audit)
  - `lib/backup`, quality-wi conversion/export internals, auth-form-actions/password recovery, invite-delivery
  - `work-instruction-document.tsx`, wi-convert-dialog, the notification-admin render body, departments-admin MembersPanel
  - `themed-select`/`themed-feedback` internals
  - feature-scoped CSS beyond three files
  - `scripts/backup/*`
  - pgTAP file contents, `supabase/isolated` suites, Playwright specs, CI run history
  - the d249952 changes outside the coordinators
  - the remaining prior items mobile H1/D4–D6 and planner D7 (not re-verified)
- **Static-analysis limits:**
  - The CSS dead-selector scan can miss classes built from runtime data or stored HTML (37 spot-checked).
  - The migration replay parser is regex-based; less-trafficked tables may have parse misses.
  - About 138 "deliberate" catch sites outside the top files were classified from ±9 lines of context.
  - About 30 fire-and-forget `void write(...)` calls were sampled, not traced.
- **Critic coverage notes, not turned into findings:**
  - key-namespace inventory of client storage (~123 calls in 29 files)
  - realtime fan-out and payload volume
  - accessibility of the shared primitives (best added during the DEAD-9/SURF-10 migration)
  - i18n (no layer exists or is required)
  - the SolidWorks C# plugin (outside the repo)
- **TZ pin risk:** the full suite has not been run under `TZ=America/Los_Angeles`. Also unverified: whether Vitest's `test.env.TZ` applies before the first `Date` in each worker.

## Appendix D. Recommendations trimmed for scope or CLAUDE.md rules

- **API-2 deletion of `/api/sops/reviewers/nominate`:** parked approval area. Delete only with explicit owner sign-off; the default is DEAD-7's record-only line in `docs/deferred-work.md` plus a Vercel-log check. The `nominate_department_reviewer` RPC stays (live via `submit`).
- **DATA-10 / API-7:** `approvers/submit` is excluded from the service-role and error-mapping migration.
- **ERR-10:** `approvers/stage` is excluded from the logging rollout.
- **DATA-3:** changes to `fetchReviewQueueData` are limited to input plumbing; the queue derivation is untouched.
- **DBP-3:** policy changes on seats and signatures only behind a pgTAP equivalence check; no routing logic.
- **DATA-8:** approval reads (`getMySignatureProfile`, `loadEditorApprovalRouting`) are left alone.
- **PERF-5:** making `SopQualityApprovalWorkspace` dynamic is a loading-boundary change only.
- **TEST-1:** the three parked SOP tests get path-only mock edits.
- **DATA-1 / DOM-1:** `src/lib/planning/*` facade importers are exempt from the repoint and the lint rule.
- **PLAT-1:** the Planning route in the bundle guard becomes a warning only; no Planning work.
- **PLAT-11:** `scripts/planning/*` is not classified.
- **DRIFT-1 / prior #11:** SOP conversion out of `sop-list` touches approval-seat seeding; deferred with routing.
- **Mobile C1:** legacy unscoped recovery-draft functions are not proposed for change.
- **TEST-4:** deleting `saveTasksToSupabase` was dropped (it would break mobile saves).
- **DOM-7:** folding all inline predicates into one `isWorkspaceManager` was dropped (it conflicts with the deliberate four-layer SOP permission model).
- **RT-6 / SURF-3:** the server-side layout seed stays read-only; bootstrap membership writes remain client effects (CLAUDE.md: server reads are READ-ONLY).
- **PLAT-9 (c):** the `gen:types` diff gate is to be validated before it becomes blocking, because `gen:types` reads the production schema.
- **PLAT-10:** deleting `ui-*` selectors needs owner sign-off under the never-edit-global-`ui-*` rule; restyles are not proposed.
- **Line-count-only extractions:** none proposed. Every extraction above names an ownership, testability, correctness or performance mechanism.