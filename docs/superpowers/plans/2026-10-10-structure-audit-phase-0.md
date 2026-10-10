# Structure audit 2026-10-10: Phase 0 and owner decisions, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the planner data-loss paths and the AWI-link defects found by the 2026-10-10 audit, apply the owner's three decisions (Settings lifecycle removal, linked duration from the master, dead smart-allocation deletion), and add the CI safety net that makes the date and proxy regressions catchable.

**Architecture:** The work lands as five stacked branches, each small enough to verify on its own:
- **A, test safety net.** Pin the timezone for Vitest and collect the orphaned proxy test.
- **B, scenario switch-back (P0).** Evict the left scenario's cache entry so every switch-back reloads from the database.
- **C, AWI link integrity (P1).** The "a linked task owns no procedure" rule moves into one domain module, and the client write paths, a database trigger, and a batched, failure-tolerant read path all enforce it. Duration derives from the master.
- **D, Settings phone portal.** The Projects section becomes Phone portal and moves to Product-scope groups.
- **E, dead code.** The caller-less smart-allocation surface is deleted after characterization tests of the live allocation path land.

No new save paths. Every fix narrows or guards an existing one.

**Tech Stack:** Next.js 16 (App Router, Turbopack), React 19, Supabase (Postgres + RLS + pgTAP), Vitest 4.1 (node `unit` + jsdom `components` projects), TypeScript 5.7.

**Spec:** `docs/audits/2026-10-10-structure-audit.md` (§2.1 DRIFT-2, §2.2 DRIFT-3, §2.3 PERF-1, §2.4 SURF-2, §2.5 PLAT-2/PLAT-4, §3 rows 1-5 and 12, §5.4 DEAD-1). Owner decisions of 2026-10-10:
- (1) Remove the project lifecycle controls from Settings, because the sidebar owns them.
- (2) A linked task's time comes from the AWI master.
- (3) Delete the dead smart-allocation code.
- (4) Browser CI jobs stay off.

## Global Constraints

- CLAUDE.md hard rules apply in full:
  - Never full-state save. Do not weaken `assertSaneStateDeletion`.
  - Server reads are read-only.
  - Store functions take `client?` (`client ?? plannerClient()`).
  - Module-level state must be keyed by client. No module-level master cache: a per-call `Map` is fine.
  - Never rewrite `enforce_sop_transition`/`sign_sop`.
  - Do not touch `package-lock.json`.
- Out of scope (owner): the Planning space (`src/lib/planning`, `src/components/planning`, `app/planning`, `src/domain/planning`), SOP approval routing, mobile C1 recovery drafts, and line-count-only extractions.
- Browser CI jobs in `.github/workflows/ci.yml` stay `if: ${{ false }}`. Do not edit them. Manual live verification (CLAUDE.md step 6) is still required before each merge.
- Hooks and components import planner data functions through the facade `@/domain/supabase-planner`, never from a `@/lib/planner/*` leaf. Tests mock the facade path (audit TEST-1). Every new data export is added to the facade.
- The linked-task error text is exactly `Edit these instructions in the linked master AWI.` (client and database).
- The Vitest timezone is exactly `America/Los_Angeles`.
- Commit messages: `<type>: <description>` (fix, feat, refactor, test, chore, docs). End every commit message with the attribution line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Gate per branch:
  - `npm run typecheck`
  - `npm run lint`
  - `npm test`
  - `npm run build`
  - `npm run check:bundles`
  - Finish the build before a standalone typecheck. If a deleted root file or route confuses dev, stop the server and delete `.next-dev`.
- Production migrations are applied by hand, and only with explicit owner approval in chat. Never run `supabase db push`.

## Review Focus

1. **A teammate edits while you sit on another scenario, then you switch back.** You must see their rows, and your next edit must not delete them. Task 2 pins this with the flipped D5 test plus a delete-fallback regression.
2. **A product that links three tasks to one master, then loses access to (or the network for) that master.** The planner must still open, show those three tasks as "master unavailable", and keep their stored schedule. Task 7 pins this with planner-level tests for the failing-master and three-tasks-one-master cases. Single-task reads stay strict, so opening that task's media reports the failure and retries instead of showing empty media as loaded (Task 7's hydration test).
3. **A phone user opens a linked task from the process list.** They must not be able to add, time, edit, delete, or photograph steps, and no write may reach Supabase. This includes a phone that reopens with a recovered draft, an open new-step form, or a running or parked timer for that task: drafts are kept and shown read-only (never "saved"), and timers are frozen with their elapsed time kept, never shown running or resumed. Task 5 pins this with a component test asserting absent controls and zero `saveMobileStepToSupabase` calls, plus recovery-draft and active/parked timer-restore tests.
4. **A desktop user moves a step into a linked task, from the menu or by racing an old menu open.** Nothing may be written. Task 4 pins this with store tests asserting zero requests, and the domain filter test asserts linked targets are not offered.
5. **The master AWI's steps change while the planner tab sits in the background.** On return, the linked task shows the new steps and the new derived duration, with no request storm on rapid focus/visibility events. If the user switches scenario, or a fresher load lands while the refresh is in flight, the late response is dropped. Task 8 pins this with domain tests for `refreshLinkedAwiTasks` and delayed-response hook tests. `useRefreshOnReturn` already pins the throttle and in-flight behaviour.

---

## Branch A: `fix/test-safety-net` (from `main`)

### Task 1: Commit the audit, pin the Vitest timezone, collect the root proxy test

**Files:**
- Add (commit only): `docs/audits/2026-10-10-structure-audit.md`, `docs/superpowers/plans/2026-10-10-structure-audit-phase-0.md`
- Modify: `vitest.config.ts` (add root `test.env`)
- Modify: `src/domain/formatting.test.ts:87-91` (comment) and add a canary `describe`
- Move: `proxy.test.ts` → `src/lib/proxy-host.test.ts` (change one import)
- Modify: `package.json:9` (lint paths)

**Interfaces:**
- Consumes: nothing.
- Produces: every later test run executes in `America/Los_Angeles`.

- [ ] **Step 1: Branch and commit the audit and this plan**

```bash
git switch -c fix/test-safety-net main
git add docs/audits/2026-10-10-structure-audit.md docs/superpowers/plans/2026-10-10-structure-audit-phase-0.md
git commit -m "docs: 2026-10-10 structure audit and phase 0 plan

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 2: Write the failing canary test**

In `src/domain/formatting.test.ts`, replace the comment block at lines 87-90 with:

```ts
// A bare YYYY-MM-DD is a calendar day, not an instant. `new Date("2026-07-15")` parses as UTC
// midnight, which renders as 07/14 anywhere west of Greenwich. vitest.config.ts pins every test to
// America/Los_Angeles, so these expectations fail on the old parse on every machine, CI included.
```

Directly above `describe("date-only input parses as a local calendar day", ...)`, add:

```ts
describe("test timezone pin", () => {
  it("runs every test in America/Los_Angeles so date-only regressions fail on UTC CI runners", () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("America/Los_Angeles");
    expect(new Date(2026, 6, 15).getTimezoneOffset()).toBe(420);
  });
});
```

- [ ] **Step 3: Run it under UTC to see RED**

Run: `TZ=UTC npx vitest run src/domain/formatting.test.ts`
Expected: FAIL. `test timezone pin` reports `expected 'UTC' to be 'America/Los_Angeles'`. The shell prefix is for this demonstration only. Never add it to `package.json`.

- [ ] **Step 4: Pin the timezone**

In `vitest.config.ts`, change the `test:` object so `env` sits beside `projects`:

```ts
  test: {
    // Every worker runs in a zone west of UTC, so date-only parsing regressions (f186348) fail on
    // CI's UTC runners too. Works with the default forks pool; the threads pool ignores TZ.
    env: { TZ: "America/Los_Angeles" },
    projects: [
```

- [ ] **Step 5: Run under UTC again to see GREEN**

Run: `TZ=UTC npx vitest run src/domain/formatting.test.ts`
Expected: PASS (all tests, including the canary).

- [ ] **Step 6: Prove the date test now has teeth**

Temporarily make `parseIsoDateInput` in `src/domain/formatting.ts` `return new Date(iso);` as its first line. Run `TZ=UTC npx vitest run src/domain/formatting.test.ts`.
Expected: 3 FAIL (`formatDateControlled renders the chosen day`, `formatDate renders the chosen day`, `formatDateTime renders the chosen day at local midnight`).
Then revert the temporary line (`git checkout src/domain/formatting.ts`) and re-run. Expected: PASS.

- [ ] **Step 7: Move the root proxy test so a project collects it**

```bash
git mv proxy.test.ts src/lib/proxy-host.test.ts
```

In `src/lib/proxy-host.test.ts`, change `import { proxy } from "./proxy";` to `import { proxy } from "../../proxy";`.

Run: `npx vitest run src/lib/proxy-host.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 8: Prove the moved test has teeth**

Temporarily delete line 24 of `proxy.ts` (the canonical-host / `x-forwarded-host` handling line added in f01b66b). Run `npx vitest run src/lib/proxy-host.test.ts`.
Expected: 2 FAIL with `expected 200 to be 308`. Revert with `git checkout proxy.ts`, then re-run. Expected: PASS.

- [ ] **Step 9: Lint `proxy.ts`**

In `package.json:9` set:

```json
    "lint": "eslint app src e2e proxy.ts playwright.config.ts scripts/test-browser.mjs --max-warnings=0",
```

Run: `npx eslint proxy.ts --max-warnings=0`
Expected: no output, exit 0. If it reports problems, fix them in `proxy.ts` without changing behaviour, and re-run Steps 7-8.

- [ ] **Step 10: Full suite and commit**

Run: `npm test`
Expected: PASS. The file count goes up by 1 (the moved proxy test) and the test count by 5 (4 proxy cases + 1 canary).

```bash
git add vitest.config.ts src/domain/formatting.test.ts src/lib/proxy-host.test.ts package.json
git commit -m "test: pin vitest to America/Los_Angeles and collect the proxy host test

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Branch B: `fix/scenario-switch-back` (from the tip of A)

### Task 2: Evict the left scenario's cache entry so switching back reloads it

**Context:**
- `useWorkspaceScenarios.loadScenarioIntoView` applies `scenarioCacheRef.current.get(id)` with no reload. LineWorkspace's mirror effect keeps every visited scenario in that cache.
- A teammate's rows written while you were elsewhere are therefore missing, and the next shell diff-save deletes them.
- Fix: when `applyScenarioSwitch` swaps scenarios, delete the cache entry of the scenario being left. The cache then only ever holds the active scenario plus freshly written seeds (the optimizer), so every switch-back takes the existing cache-miss path. That path is a fresh `loadPlannerStateFromSupabase` with a working failure path (toast, stay on the old scenario, stay confirmed).
- Do NOT implement "paint from cache, then revalidate". Unconfirmed state renders a skeleton over the Gantt, and a failed revalidation dead-ends.

**Files:**
- Modify: `src/components/line-workspace/use-workspace-scenarios.ts:89-90` (`applyScenarioSwitch`), `:137-138` (comment)
- Modify: `src/components/line-workspace.tsx:233-236`, `:339-340` (comments only)
- Test: `src/components/line-workspace/use-workspace-scenarios.test.tsx`

**Interfaces:**
- Consumes: none from earlier tasks.
- Produces: no signature changes. `scenarioCacheRef` semantics become "active scenario + fresh seeds".

- [ ] **Step 1: Branch**

```bash
git switch -c fix/scenario-switch-back
```

- [ ] **Step 2: Rewrite the D5 characterization as the regression test (RED)**

In `use-workspace-scenarios.test.tsx`:

1. Replace the header comment (`// CHARACTERIZATION ONLY (structure audit D5)...`) with:

```ts
// DRIFT-2 regression (structure audit 2026-10-10): switching back to a scenario reloads it from the
// database, so a teammate's rows written while another scenario was open survive the next shell save.
```

2. Extend the facade mock and its handles:

```ts
vi.mock("@/domain/supabase-planner", async (original) => ({
  ...await original<typeof import("@/domain/supabase-planner")>(),
  loadPlannerStateFromSupabase: vi.fn(),
  savePlannerShellToSupabase: vi.fn(),
  deleteScenario: vi.fn(async () => undefined),
  loadScenariosForProduct: vi.fn(),
}));
```

and change the import line to:

```ts
import { deleteScenario, loadPlannerStateFromSupabase, loadScenariosForProduct, savePlannerShellToSupabase, type SaveState } from "@/domain/supabase-planner";
```

3. Add a module-level confirm handle next to `loadScenario`/`saveShell`:

```ts
const feedbackConfirm = vi.fn();
```

In `renderScenarioWorkspace`, pass `setFeedbackConfirm: feedbackConfirm,` (replacing `setFeedbackConfirm: vi.fn(),`). Then return the cache and the list setter too: change `return { plannerState, setPlannerState, saves, scenarioActions };` to:

```ts
    return { plannerState, setPlannerState, saves, scenarioActions, scenarioCacheRef, setScenarios };
```

4. In `beforeEach`, add after `saveShell.mockReset();`:

```ts
  feedbackConfirm.mockReset();
  vi.mocked(deleteScenario).mockClear();
  vi.mocked(loadScenariosForProduct).mockReset();
```

5. Replace the whole `describe("switching back to a cached scenario (D5 characterization)", ...)` block with:

```tsx
describe("switching back to a scenario that was left (DRIFT-2)", () => {
  it("reloads it, so the first edit's shell save keeps a task a teammate inserted meanwhile", async () => {
    const { result } = renderScenarioWorkspace();

    await switchTo(result, SCENARIO_B); // A -> B: B loaded (1), A evicted on leave.
    await switchTo(result, SCENARIO_A); // B -> A: A reloaded (2), B evicted on leave.
    expect(result.current.plannerState.scenario.id).toBe(SCENARIO_A);

    // While A is open, a teammate inserts a task into B. A's realtime scope does not cover B.
    serverTaskIds = { ...serverTaskIds, [SCENARIO_B]: [...serverTaskIds[SCENARIO_B]!, "task-b2-remote"] };

    await switchTo(result, SCENARIO_B); // A -> B: B reloaded (3) and includes the teammate's task.
    expect(loadScenario).toHaveBeenCalledTimes(3);
    expect(result.current.plannerState.tasks.map((task) => task.id)).toEqual(["task-b1", "task-b2-remote"]);

    act(() => {
      result.current.saves.markDirty();
      result.current.setPlannerState((current) => ({
        ...current,
        tasks: current.tasks.map((task) => ({ ...task, name: "Renamed on B" })),
      }));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(900); });

    expect(saveShell).toHaveBeenCalledTimes(1);
    expect(saveShell.mock.calls[0]?.[0].tasks.map((task) => task.id)).toEqual(["task-b1", "task-b2-remote"]);
    expect(wouldDelete).toEqual([[]]);
  });

  it("keeps only the active scenario cached after a switch", async () => {
    const { result } = renderScenarioWorkspace();
    await switchTo(result, SCENARIO_B);
    expect([...result.current.scenarioCacheRef.current.keys()]).toEqual([SCENARIO_B]);
  });

  it("still applies a freshly written cache entry without a reload (optimizer seeds rely on it)", async () => {
    const { result } = renderScenarioWorkspace();
    const seeded = scenarioState("scenario-seeded", [scenarioTask("task-s1", "scenario-seeded")]);
    result.current.scenarioCacheRef.current.set("scenario-seeded", seeded);
    await switchTo(result, "scenario-seeded");
    expect(loadScenario).not.toHaveBeenCalled();
    expect(result.current.plannerState.scenario.id).toBe("scenario-seeded");
  });

  it("reloads Main when the active scenario is deleted, instead of applying a stale Main", async () => {
    const list = [{ id: SCENARIO_A, name: "Main" }, { id: SCENARIO_B, name: "Copy" }] as ScenarioSummary[];
    vi.mocked(loadScenariosForProduct).mockResolvedValue([list[0]!]);
    const { result } = renderScenarioWorkspace();
    act(() => { result.current.setScenarios(list); });
    await switchTo(result, SCENARIO_B); // load 1; A evicted on leave.
    serverTaskIds = { ...serverTaskIds, [SCENARIO_A]: [...serverTaskIds[SCENARIO_A]!, "task-a2-remote"] };

    // The delete goes through the real confirm flow: requestDeleteScenario -> confirm.onConfirm -> delete.
    act(() => { result.current.scenarioActions.requestDeleteScenario(SCENARIO_B); });
    const confirm = feedbackConfirm.mock.calls.at(-1)?.[0] as { onConfirm: () => void };
    await act(async () => {
      confirm.onConfirm();
      await vi.advanceTimersByTimeAsync(240);
    });

    expect(deleteScenario).toHaveBeenCalledWith(SCENARIO_B);
    expect(loadScenario).toHaveBeenCalledTimes(2); // Main reloaded, not applied from a stale cache.
    expect(result.current.plannerState.tasks.map((task) => task.id)).toEqual(["task-a1", "task-a2-remote"]);
  });
});
```

`requestDeleteScenario` (returned by the hook) looks the scenario up in `scenarios` and opens a confirm via `setFeedbackConfirm`, and the confirm's `onConfirm` runs the delete. If its signature differs from `(scenarioId: string)`, read it at `use-workspace-scenarios.ts` (just above `deleteScenarioById`) and match it. Do not export a new function just for the test.

- [ ] **Step 3: Run to see RED**

Run: `npx vitest run src/components/line-workspace/use-workspace-scenarios.test.tsx`
Expected: FAIL.
- The first test: `expected 1 to be called 3 times` (switch-back used the cache).
- The second test: the cache holds both A and B.
- The fourth test: one load.
- The third test passes already (positive control).

- [ ] **Step 4: Evict on leave**

In `src/components/line-workspace/use-workspace-scenarios.ts`, change the start of `applyScenarioSwitch` to:

```ts
  function applyScenarioSwitch(loaded: PlannerState) {
    const normalized = ensureNomenclatureCollections(loaded);
    // DRIFT-2: never keep a scenario we are leaving. Its rows can change while another scenario is
    // open (realtime only covers the active one), and a later switch-back that applied the stale
    // copy would let the next shell diff-save delete a teammate's rows. Switch-backs reload instead.
    const leavingScenarioId = latestDerivedStateRef.current.scenario.id;
    if (leavingScenarioId !== normalized.scenario.id) {
      scenarioCacheRef.current.delete(leavingScenarioId);
    }
    resetProcedureDrafts(latestDerivedStateRef.current.tasks.map((task) => task.id));
```

Replace the comment above `loadScenarioIntoView` (lines 137-138) with:

```ts
  // Load a scenario into the active view. The cache only ever holds the active scenario and entries
  // written moments ago (the optimizer seeds its new scenario), because applyScenarioSwitch evicts the
  // scenario being left; anything else is loaded from the database. Throws if it can't be loaded.
```

- [ ] **Step 5: Update the stale LineWorkspace comments (no behaviour change)**

In `src/components/line-workspace.tsx`, replace lines 233-235 with:

```ts
  // In-memory cache of scenario states keyed by scenario id. It holds the active scenario (mirrored by
  // the effect below) and freshly written seeds; a scenario is evicted when it is left (DRIFT-2), so a
  // switch back reloads from the database instead of applying a copy that may be stale.
```

Replace the two-line comment above the mirror effect (lines 339-340) with:

```ts
  // Keep the active scenario's latest state mirrored in the cache, so a duplicate or optimize of the
  // active scenario starts from what is on screen. Left scenarios are evicted on switch (DRIFT-2).
```

- [ ] **Step 6: Run to see GREEN, plus the neighbours**

Run: `npx vitest run src/components/line-workspace/use-workspace-scenarios.test.tsx src/components/line-workspace/use-workspace-saves.test.tsx src/components/line-workspace.sync.test.tsx src/components/line-workspace.lifecycle.test.tsx`
Expected: PASS. If a sync or lifecycle test asserted an instant (no-load) switch-back, update its expected load count. Note it in the commit body: it pinned the defect.

- [ ] **Step 7: Commit**

```bash
git add src/components/line-workspace/use-workspace-scenarios.ts src/components/line-workspace/use-workspace-scenarios.test.tsx src/components/line-workspace.tsx
git commit -m "fix: reload a scenario on switch-back so its stale copy cannot delete a teammate's rows

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Branch C: `fix/awi-link-integrity` (from the tip of B)

### Task 3: One domain owner for the linked-task rules, with duration from the master

**Files:**
- Create: `src/domain/step-duration.ts`
- Modify: `src/domain/awi-task-link.ts` (whole file)
- Modify: `src/domain/types.ts` (`Task` gains a runtime-only field)
- Test: `src/domain/awi-task-link.test.ts` (rewrite), `src/domain/step-duration.test.ts` (new)

**Interfaces:**
- Produces (exact names, used by Tasks 4, 5, 7, 8):
  - `sumStepDurationMinutes(steps: ManufacturingStep[]): number` from `@/domain/step-duration`
  - From `@/domain/awi-task-link`:
    - `LINKED_AWI_EDIT_MESSAGE: string`
    - `type LinkedAwiMaster = { projectId: string; taskId: string; source?: Task }`
    - `taskOwnsProcedure(task: Task): boolean`
    - `assertTaskOwnsProcedure(task: Task): void`
    - `stepMoveTargets(tasks: Task[], sourceTaskId: string | undefined): Task[]`
    - `linkedAwiDurationMinutes(master: Task): number`
    - `withLinkedAwiProcedure(task: Task, master: Task): Task`
    - `withUnavailableLinkedAwi(task: Task): Task`
    - `applyLinkedAwiMasters(tasks: Task[], masters: ReadonlyMap<string, LinkedAwiMaster>): Task[]`
    - `refreshLinkedAwiTasks(tasks: Task[], masters: ReadonlyMap<string, LinkedAwiMaster>, startedFrom: readonly Task[]): { tasks: Task[]; changed: boolean }`. It only replaces a task that existed in `startedFrom` with an unchanged procedure, so a response that lost a race to a fresher load or a navigation is dropped.
  - `Task.awiMasterStatus?: "unavailable"`

- [ ] **Step 1: Branch**

```bash
git switch -c fix/awi-link-integrity
```

- [ ] **Step 2: Write the failing domain tests**

Create `src/domain/step-duration.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { sumStepDurationMinutes } from "./step-duration";
import type { ManufacturingStep } from "./types";

const step = (durationMinutes?: number) => ({ id: "s", sequence: 1, name: "s", instruction: "", durationMinutes }) as ManufacturingStep;

describe("sumStepDurationMinutes", () => {
  it("adds step times, treating missing and negative times as zero", () => {
    expect(sumStepDurationMinutes([step(5), step(7.5), step(undefined), step(-3)])).toBe(12.5);
    expect(sumStepDurationMinutes([])).toBe(0);
  });
});
```

Replace `src/domain/awi-task-link.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import {
  applyLinkedAwiMasters, assertTaskOwnsProcedure, awiTaskLink, AWI_TASK_LINK_FIELD, LINKED_AWI_EDIT_MESSAGE,
  linkedAwiDurationMinutes, refreshLinkedAwiTasks, stepMoveTargets, taskOwnsProcedure, withLinkedAwiProcedure,
  withUnavailableLinkedAwi, type LinkedAwiMaster,
} from "./awi-task-link";
import { emptyPlannerState } from "./empty-planner-state";
import { manufacturingStepRows, partReferenceRows, taskRow } from "@/lib/planner/row-mappers";
import type { ManufacturingStep, Task } from "./types";

const START = "2026-10-01T08:00:00.000Z";
const base = { ...emptyPlannerState.tasks[0], id: "product-task", rowType: "task", plannedStart: START, plannedFinish: START,
  customFields: {}, manufacturingSteps: [], partReferences: [], plannedDurationMinutes: 30, plannedOperators: 2 } as Task;
const link = { masterId: "master", projectId: "master-project", taskId: "master-task", documentNumber: "AWI-0001" };
const fitStep = { id: "step1", name: "Fit", sequence: 1, instruction: "Fit the part", durationMinutes: 5 } as ManufacturingStep;
const linkedTask = { ...base, customFields: { [AWI_TASK_LINK_FIELD]: link } } as Task;
const master = { ...base, id: "master-task", description: "Current master", plannedDurationMinutes: 90,
  customFields: { stepToolLists: { step1: ["Wrench"] } }, manufacturingSteps: [fitStep] } as Task;
const masters = (source?: Task): Map<string, LinkedAwiMaster> =>
  new Map([["master", { projectId: "master-project", taskId: "master-task", source }]]);

describe("master AWI task links", () => {
  it("keeps the link and operators while showing the current master content", () => {
    const linked = withLinkedAwiProcedure(linkedTask, master);
    expect(linked.plannedOperators).toBe(2);
    expect(linked.manufacturingSteps).toEqual(master.manufacturingSteps);
    expect(awiTaskLink(linked)).toEqual(link);
    expect(withLinkedAwiProcedure(linked, { ...master, description: "Edited master" }).description).toBe("Edited master");
    expect(manufacturingStepRows([linked])).toEqual([]);
    expect(partReferenceRows([linked])).toEqual([]);
    expect(taskRow(linked).custom_fields).toHaveProperty(AWI_TASK_LINK_FIELD, link);
  });

  it("takes the task's time from the master's steps and moves the finish with it", () => {
    const linked = withLinkedAwiProcedure(linkedTask, master);
    expect(linked.plannedDurationMinutes).toBe(5);
    expect(linked.plannedFinish).toBe("2026-10-01T08:05:00.000Z");
    expect(taskRow(linked).planned_duration_minutes).toBe(5);
  });

  it("falls back to the master's own duration only when the master has no steps", () => {
    expect(linkedAwiDurationMinutes({ ...master, manufacturingSteps: [] })).toBe(90);
    expect(linkedAwiDurationMinutes(master)).toBe(5);
  });

  it("ignores incomplete references", () => {
    expect(awiTaskLink({ ...base, customFields: { [AWI_TASK_LINK_FIELD]: { masterId: "master" } } })).toBeUndefined();
  });
});

describe("a linked task owns no procedure", () => {
  it("refuses procedure writes with the shared message", () => {
    expect(taskOwnsProcedure(base)).toBe(true);
    expect(taskOwnsProcedure(linkedTask)).toBe(false);
    expect(() => assertTaskOwnsProcedure(linkedTask)).toThrow(LINKED_AWI_EDIT_MESSAGE);
    expect(() => assertTaskOwnsProcedure(base)).not.toThrow();
    expect(LINKED_AWI_EDIT_MESSAGE).toBe("Edit these instructions in the linked master AWI.");
  });

  it("offers only other plain tasks as step-move targets", () => {
    const other = { ...base, id: "other" } as Task;
    const group = { ...base, id: "group", rowType: "group" } as Task;
    const linkedOther = { ...linkedTask, id: "linked-other" } as Task;
    expect(stepMoveTargets([base, other, group, linkedOther], base.id).map((task) => task.id)).toEqual(["other"]);
  });
});

describe("resolving and refreshing links", () => {
  it("marks a task unavailable, keeping its link and stored schedule, when its master cannot be used", () => {
    const [unavailable] = applyLinkedAwiMasters([{ ...linkedTask, manufacturingSteps: [fitStep] }], new Map());
    expect(unavailable.awiMasterStatus).toBe("unavailable");
    expect(awiTaskLink(unavailable)).toEqual(link);
    expect(unavailable.plannedDurationMinutes).toBe(30);
    expect(unavailable.manufacturingSteps).toEqual([]);
    expect(withUnavailableLinkedAwi(linkedTask).partReferences).toEqual([]);
  });

  it("rejects a master row that does not match the link, a self-link, or a chained master", () => {
    const wrongTask = new Map([["master", { projectId: "master-project", taskId: "other-task", source: master }]]);
    const chained = masters({ ...master, customFields: { [AWI_TASK_LINK_FIELD]: link } } as Task);
    const selfLinked = { ...linkedTask, id: "master-task" } as Task;
    expect(applyLinkedAwiMasters([linkedTask], wrongTask)[0].awiMasterStatus).toBe("unavailable");
    expect(applyLinkedAwiMasters([linkedTask], chained)[0].awiMasterStatus).toBe("unavailable");
    expect(applyLinkedAwiMasters([selfLinked], masters(master))[0].awiMasterStatus).toBe("unavailable");
  });

  it("resolves usable links and leaves plain tasks untouched", () => {
    const [resolved, plain] = applyLinkedAwiMasters([linkedTask, base], masters(master));
    expect(resolved.manufacturingSteps).toEqual([fitStep]);
    expect(resolved.awiMasterStatus).toBeUndefined();
    expect(plain).toBe(base);
  });

  const longer = { ...master, manufacturingSteps: [fitStep, { ...fitStep, id: "step2", sequence: 2, durationMinutes: 10 }] } as Task;

  it("refresh keeps the current copy when a master is missing, and reports no change when nothing moved", () => {
    const current = withLinkedAwiProcedure(linkedTask, master);
    const unchanged = refreshLinkedAwiTasks([current, base], masters(master), [current, base]);
    expect(unchanged.changed).toBe(false);
    const missing = refreshLinkedAwiTasks([current], masters(undefined), [current]);
    expect(missing).toEqual({ tasks: [current], changed: false });
  });

  it("refresh replaces a linked task when its master changed, including the derived duration", () => {
    const current = withLinkedAwiProcedure(linkedTask, master);
    const refreshed = refreshLinkedAwiTasks([current], masters(longer), [current]);
    expect(refreshed.changed).toBe(true);
    expect(refreshed.tasks[0].plannedDurationMinutes).toBe(15);
    expect(refreshed.tasks[0].manufacturingSteps).toHaveLength(2);
  });

  it("refresh drops an older response when a fresher load replaced the task's procedure meanwhile", () => {
    const startedAs = withLinkedAwiProcedure(linkedTask, master);
    const fresher = withLinkedAwiProcedure(linkedTask, longer); // e.g. a realtime full reload landed first
    const stale = refreshLinkedAwiTasks([fresher], masters(master), [startedAs]);
    expect(stale).toEqual({ tasks: [fresher], changed: false });
  });

  it("refresh drops a late duration-only response from a master with no steps", () => {
    const noSteps = (plannedDurationMinutes: number) => ({ ...master, manufacturingSteps: [], plannedDurationMinutes }) as Task;
    const startedAs = withLinkedAwiProcedure(linkedTask, noSteps(5));
    const fresher = withLinkedAwiProcedure(linkedTask, noSteps(20)); // a fresher load already shows 20 minutes
    expect(fresher.plannedDurationMinutes).toBe(20);
    const late = refreshLinkedAwiTasks([fresher], masters(noSteps(5)), [startedAs]);
    expect(late).toEqual({ tasks: [fresher], changed: false });
  });

  it("refresh never touches tasks that were not on screen when it started (another scenario or project)", () => {
    const startedAs = withLinkedAwiProcedure(linkedTask, master);
    const otherScenarioTask = { ...withLinkedAwiProcedure(linkedTask, master), id: "other-scenario-task" } as Task;
    const result = refreshLinkedAwiTasks([otherScenarioTask], masters(longer), [startedAs]);
    expect(result).toEqual({ tasks: [otherScenarioTask], changed: false });
  });
});
```

- [ ] **Step 3: Run to see RED**

Run: `npx vitest run src/domain/awi-task-link.test.ts src/domain/step-duration.test.ts`
Expected: FAIL: `Cannot find module './step-duration'`, and the missing exports from `./awi-task-link`.

- [ ] **Step 4: Implement**

Create `src/domain/step-duration.ts`:

```ts
import type { ManufacturingStep } from "./types";

/** A task's planned time is the sum of its step times; missing and negative times count as zero. */
export function sumStepDurationMinutes(steps: readonly ManufacturingStep[]): number {
  return steps.reduce((total, step) => total + Math.max(step.durationMinutes ?? 0, 0), 0);
}
```

In `src/domain/types.ts`, inside `export interface Task {`, directly after the `procedureStepDeletions?: Record<string, number>;` line, add:

```ts
  /**
   * Runtime only, never persisted (taskRow enumerates its columns): set when a task linked to a master
   * AWI could not resolve its master on this load. The link itself stays in customFields.
   */
  awiMasterStatus?: "unavailable";
```

Replace `src/domain/awi-task-link.ts` with:

```ts
import { sumStepDurationMinutes } from "./step-duration";
import type { Task } from "./types";

export const AWI_TASK_LINK_FIELD = "awiMasterLink";
/** Raised by every write path that would give a linked task its own procedure. The database guard uses the same text. */
export const LINKED_AWI_EDIT_MESSAGE = "Edit these instructions in the linked master AWI.";

export type AwiTaskLink = { masterId: string; projectId: string; taskId: string; documentNumber: string };
/** One awi_masters row as read for a set of links, with the master task when it could be loaded. */
export type LinkedAwiMaster = { projectId: string; taskId: string; source?: Task };

// Procedure content a linked task shows from its master and never owns itself.
const LINKED_PROCEDURE_FIELDS = ["stepToolLists", "stepPhotoAttachments", "stepPhotoAnnotations", "taskExplodedViews", "taskVideos"] as const;

export function awiTaskLink(task: Task): AwiTaskLink | undefined {
  const value = task.customFields?.[AWI_TASK_LINK_FIELD] as Partial<AwiTaskLink> | undefined;
  return value && typeof value.masterId === "string" && typeof value.projectId === "string" && typeof value.taskId === "string" && typeof value.documentNumber === "string" ? value as AwiTaskLink : undefined;
}

/** A Product task linked to a master AWI owns no procedure: its steps, parts, tools and media are the master's. */
export function taskOwnsProcedure(task: Task): boolean {
  return !awiTaskLink(task);
}

export function assertTaskOwnsProcedure(task: Task): void {
  if (!taskOwnsProcedure(task)) throw new Error(LINKED_AWI_EDIT_MESSAGE);
}

/** Tasks a step may be moved into: other plain task rows that own their procedure. */
export function stepMoveTargets(tasks: Task[], sourceTaskId: string | undefined): Task[] {
  return tasks.filter((candidate) => candidate.rowType === "task" && candidate.id !== sourceTaskId && taskOwnsProcedure(candidate));
}

/** A linked task's planned time comes from its master: the sum of the master's step times, or its own duration when it has no steps. */
export function linkedAwiDurationMinutes(master: Task): number {
  const steps = master.manufacturingSteps ?? [];
  return steps.length > 0 ? sumStepDurationMinutes(steps) : Math.max(master.plannedDurationMinutes ?? 0, 0);
}

export function withLinkedAwiProcedure(task: Task, master: Task): Task {
  const fields = { ...task.customFields };
  for (const key of LINKED_PROCEDURE_FIELDS) {
    delete fields[key];
    if (master.customFields[key] !== undefined) fields[key] = master.customFields[key];
  }
  const plannedDurationMinutes = linkedAwiDurationMinutes(master);
  const startMs = Date.parse(task.plannedStart);
  const plannedFinish = Number.isFinite(startMs) ? new Date(startMs + plannedDurationMinutes * 60_000).toISOString() : task.plannedFinish;
  const { awiMasterStatus: _resolved, ...planning } = task;
  return { ...planning, description: master.description, safetyNotes: master.safetyNotes, toolsRequired: master.toolsRequired,
    manufacturingSteps: master.manufacturingSteps, partReferences: master.partReferences, customFields: fields,
    plannedDurationMinutes, plannedFinish };
}

/** A linked task whose master could not be resolved: keep the link and the stored schedule, show no procedure. */
export function withUnavailableLinkedAwi(task: Task): Task {
  const fields = { ...task.customFields };
  for (const key of LINKED_PROCEDURE_FIELDS) delete fields[key];
  return { ...task, manufacturingSteps: [], partReferences: [], customFields: fields, awiMasterStatus: "unavailable" };
}

function usableMasterSource(task: Task, master: LinkedAwiMaster | undefined): Task | undefined {
  const link = awiTaskLink(task);
  if (!link || !master?.source) return undefined;
  if (master.taskId !== link.taskId || master.projectId !== link.projectId || master.taskId === task.id) return undefined;
  return awiTaskLink(master.source) ? undefined : master.source;
}

/** Load-time resolution: every linked task shows its master, or is marked unavailable. Plain tasks pass through. */
export function applyLinkedAwiMasters(tasks: Task[], masters: ReadonlyMap<string, LinkedAwiMaster>): Task[] {
  return tasks.map((task) => {
    const link = awiTaskLink(task);
    if (!link) return task;
    const source = usableMasterSource(task, masters.get(link.masterId));
    return source ? withLinkedAwiProcedure(task, source) : withUnavailableLinkedAwi(task);
  });
}

// The content a link refresh owns: the master's procedure AND the time derived from it. Duration must be
// included: a master with no steps contributes only its own duration, so without it a late response could
// overwrite a fresher duration. Planning fields (name, operators, start, finish) are deliberately excluded so a
// planning edit during the refresh does not block it; linked durations are not user-editable (Task 4).
function linkedProcedureKey(task: Task): string {
  const media = LINKED_PROCEDURE_FIELDS.map((key) => task.customFields?.[key]);
  return JSON.stringify([task.manufacturingSteps, task.partReferences, task.description, task.safetyNotes, task.toolsRequired, media, task.plannedDurationMinutes]);
}

/**
 * Background refresh: replace a linked task only when a usable master changed it AND the task still shows the
 * procedure it showed when the refresh started (`startedFrom`). A task that is new since then (another
 * scenario or project) or whose procedure was replaced meanwhile (a fresher load won the race) is kept as is;
 * the next refresh will see it. A missing master keeps the current copy.
 */
export function refreshLinkedAwiTasks(
  tasks: Task[],
  masters: ReadonlyMap<string, LinkedAwiMaster>,
  startedFrom: readonly Task[],
): { tasks: Task[]; changed: boolean } {
  const baseline = new Map(startedFrom.map((task) => [task.id, linkedProcedureKey(task)]));
  let changed = false;
  const next = tasks.map((task) => {
    const link = awiTaskLink(task);
    const source = link ? usableMasterSource(task, masters.get(link.masterId)) : undefined;
    if (!source || baseline.get(task.id) !== linkedProcedureKey(task)) return task;
    const refreshed = withLinkedAwiProcedure(task, source);
    if (JSON.stringify(refreshed) === JSON.stringify(task)) return task;
    changed = true;
    return refreshed;
  });
  return { tasks: changed ? next : tasks, changed };
}
```

- [ ] **Step 5: Run to see GREEN**

Run: `npx vitest run src/domain/awi-task-link.test.ts src/domain/step-duration.test.ts`
Expected: PASS.

Then run: `npx vitest run src/domain/supabase-planner.task-read.test.ts`
Expected: the linked test FAILS on `expected 0 to be 30`. That is correct, because the duration now comes from the master and that fixture's master step has no duration. Task 7 rewrites this test. Leave it red only until Task 7. Do not commit a red suite: run `npm test` before this task's commit, and if that test is the only failure, add `.skip` with the comment `// Rewritten in Task 7 (linked duration from master).` Task 7 Step 2 removes the skip.

- [ ] **Step 6: Commit**

```bash
git add src/domain/step-duration.ts src/domain/step-duration.test.ts src/domain/awi-task-link.ts src/domain/awi-task-link.test.ts src/domain/types.ts src/domain/supabase-planner.task-read.test.ts
git commit -m "feat: give linked AWI tasks one domain owner and derive their time from the master

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: Desktop and store write guards for linked tasks

**Files:**
- Modify: `src/lib/planner/task-store.ts` (`saveMobileStepToSupabase` ~207-215, guards at 169/199/480, `moveManufacturingStepToTaskInSupabase` ~620-630)
- Modify: `src/components/line-workspace/procedure.tsx:339-342`
- Modify: `src/components/line-workspace.tsx` (`moveProcedureStepToTask` ~1652-1665)
- Modify: `src/domain/task-mutations.ts` (`enforceStepDerivedDuration` ~50-55)
- Modify: `src/components/gantt-timeline.tsx` (group duration input ~1474-1636)
- Test: `src/domain/supabase-planner.task-writes.test.tsx`, `src/domain/task-mutations.test.ts`

**Interfaces:**
- Consumes (Task 3): `assertTaskOwnsProcedure`, `stepMoveTargets`, `awiTaskLink`, `LINKED_AWI_EDIT_MESSAGE` from `@/domain/awi-task-link`.
- Produces: no new exports.

- [ ] **Step 1: Write the failing store tests**

In `src/domain/supabase-planner.task-writes.test.tsx`, add `saveMobileStepToSupabase` to the import list from `./supabase-planner`. Append:

```tsx
describe("linked master AWI tasks own no procedure", () => {
  const link = { masterId: "m", projectId: "mp", taskId: "mt", documentNumber: "AWI-1" };
  const linked = (id: string, steps: ManufacturingStep[] = []) => task({ id, customFields: { awiMasterLink: link }, manufacturingSteps: steps });

  it("refuses to move a step into a linked task before sending any request", async () => {
    const db = install();
    const source = task({ id: "task-1", manufacturingSteps: [] });
    const target = linked("task-2", [step("moved", 1)]);
    await expect(moveManufacturingStepToTaskInSupabase(source, target, "moved", [], PROJECT))
      .rejects.toThrow("Edit these instructions in the linked master AWI.");
    expect(db.requests).toEqual([]);
  });

  it("refuses to move a step out of a linked task before sending any request", async () => {
    const db = install();
    const target = task({ id: "task-2", manufacturingSteps: [step("moved", 1)] });
    await expect(moveManufacturingStepToTaskInSupabase(linked("task-1"), target, "moved", [], PROJECT))
      .rejects.toThrow("Edit these instructions in the linked master AWI.");
    expect(db.requests).toEqual([]);
  });

  it("refuses a phone step save on a linked task before sending any request", async () => {
    const db = install();
    await expect(saveMobileStepToSupabase(linked("task-1"), step("s1", 1), { name: "Renamed" }, PROJECT))
      .rejects.toThrow("Edit these instructions in the linked master AWI.");
    expect(db.requests).toEqual([]);
  });
});
```

In `src/domain/task-mutations.test.ts`, add (import `enforceStepDerivedDuration` if it is not already imported, and `AWI_TASK_LINK_FIELD` from `./awi-task-link`):

```ts
describe("enforceStepDerivedDuration for linked master AWI tasks", () => {
  it("strips a typed duration from a linked task even when its master has no steps", () => {
    const linked = { id: "t", manufacturingSteps: [], plannedStart: "2026-10-01T08:00:00.000Z",
      customFields: { [AWI_TASK_LINK_FIELD]: { masterId: "m", projectId: "p", taskId: "mt", documentNumber: "AWI-1" } } } as unknown as Task;
    expect(enforceStepDerivedDuration(linked, { plannedDurationMinutes: 45, name: "Kept" })).toEqual({ name: "Kept" });
  });

  it("still lets a plain task with no steps take a typed duration", () => {
    const plain = { id: "t", manufacturingSteps: [], customFields: {} } as unknown as Task;
    expect(enforceStepDerivedDuration(plain, { plannedDurationMinutes: 45 })).toEqual({ plannedDurationMinutes: 45 });
  });
});
```

- [ ] **Step 2: Run to see RED**

Run: `npx vitest run src/domain/supabase-planner.task-writes.test.tsx src/domain/task-mutations.test.ts`
Expected:
- The move-into test FAILS with recorded requests (`rpc:task_project_id`, ...), then the late throw.
- The move-out test FAILS with requests recorded.
- The phone test FAILS because it does not throw.
- The linked `enforceStepDerivedDuration` test FAILS (the duration is kept).

- [ ] **Step 3: Implement the store guards**

In `src/lib/planner/task-store.ts`:
1. Add `assertTaskOwnsProcedure` to the existing `@/domain/awi-task-link` import (keep `awiTaskLink`; line 117 still uses it).
2. Replace each of the three inline throws (`if (awiTaskLink(task)) throw new Error("Edit these instructions in the linked master AWI.");` at ~169, ~199, ~480) with `assertTaskOwnsProcedure(task);`.
3. In `saveMobileStepToSupabase`, immediately after `assertCurrent?.();`, add `assertTaskOwnsProcedure(task);`.
4. Make the first two statements of `moveManufacturingStepToTaskInSupabase`, before `const supabase = plannerClient();`:

```ts
  // Both ends must own their procedure; refuse before the reparent commits anything (DRIFT-3).
  assertTaskOwnsProcedure(sourceTask);
  assertTaskOwnsProcedure(targetTask);
```

- [ ] **Step 4: Implement the duration rule**

In `src/domain/task-mutations.ts`, import `awiTaskLink` from `./awi-task-link`, and change the guard in `enforceStepDerivedDuration` to:

```ts
  if (
    patch.plannedDurationMinutes === undefined ||
    patch.manufacturingSteps !== undefined ||
    ((task.manufacturingSteps ?? []).length === 0 && !awiTaskLink(task))
  ) {
    return patch;
  }
```

(A linked task's time always comes from its master, so a typed duration is stripped even when the master is unavailable and the task shows no steps.)

- [ ] **Step 5: Run to see GREEN**

Run: `npx vitest run src/domain/supabase-planner.task-writes.test.tsx src/domain/task-mutations.test.ts src/domain/awi-task-link.test.ts`
Expected: PASS.

- [ ] **Step 6: Wire the UI guards (no new tests: the domain and store tests above own the rules)**

`src/components/line-workspace/procedure.tsx`: import `stepMoveTargets` from `@/domain/awi-task-link`, and replace the `moveTargetTasks` memo with:

```ts
  const moveTargetTasks = useMemo(() => stepMoveTargets(tasks, task?.id), [task?.id, tasks]);
```

`src/components/line-workspace.tsx`, in `moveProcedureStepToTask`, right after the two `const sourceTask`/`const targetTask` lookups and before `moveManufacturingStepBetweenTasks`:

```ts
    if ((sourceTask && awiTaskLink(sourceTask)) || (targetTask && awiTaskLink(targetTask))) {
      notifyFeedback({ title: "Step move failed", body: LINKED_AWI_EDIT_MESSAGE, tone: "danger" });
      return;
    }
```

Add `LINKED_AWI_EDIT_MESSAGE` to the existing `@/domain/awi-task-link` import on line 4.

`src/components/gantt-timeline.tsx`: import `awiTaskLink` from `@/domain/awi-task-link`. In the group-row branch, after `const stepCount = groupManufacturingStepCount(row.group);`, add:

```ts
                const durationFromMaster = row.group.tasks.some((task) => Boolean(awiTaskLink(task)));
                const durationLocked = stepCount > 0 || durationFromMaster;
```

In the duration `ClearableNumberInput`:
- set `readOnly={durationLocked}`
- in the className, replace `: stepCount > 0` with `: durationLocked`
- change the `onValueChange` guard to `if (!durationLocked) {`

- [ ] **Step 7: Typecheck, lint and focused tests**

Run: `npm run typecheck && npx eslint src/components/gantt-timeline.tsx src/components/line-workspace.tsx src/components/line-workspace/procedure.tsx src/lib/planner/task-store.ts src/domain --max-warnings=0 && npx vitest run src/domain src/components/line-workspace`
Expected: PASS. If `npm run typecheck` complains about `.next/types`, run `npm run build` first (see Global Constraints).

- [ ] **Step 8: Commit**

```bash
git add src/lib/planner/task-store.ts src/domain/task-mutations.ts src/domain/task-mutations.test.ts src/domain/supabase-planner.task-writes.test.tsx src/components/line-workspace/procedure.tsx src/components/line-workspace.tsx src/components/gantt-timeline.tsx
git commit -m "fix: refuse step moves and phone saves on linked AWI tasks before any write

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5: Phone portal treats linked tasks as read-only

**Context:** `mobile-photo-portal.tsx` has no link awareness today.
- A phone user can add steps, start the timer, edit master steps, upload photos and delete steps on a linked task.
- Everything they write lands under the planning task and disappears on reload.
- Deleting a master step fires soft-deletes against the master's photos.

Make the selected linked task read-only:
- Summaries only, with no expand control.
- A notice naming the master.
- No Add step and no timer.
- The new-step editor itself is gated, not just the Add step button. Three restore paths can set `showNewStepForm` without a click: `restoreOwnedDraft` (IndexedDB recovery), the session restore in `applySavedState`, and `restoreTimedStepDraft`.
- A recovered draft for a task that is now linked is **kept** on the phone. It is neither saved nor acknowledged nor deleted, and it is shown read-only so its text can be carried into the master. Without this, recovery would announce "Saving it now" while the persistence guard silently refused the save.
- **Restored timers are reconciled against task ownership once tasks are loaded.** The session hydration effect (~490) and `applySavedState` restore the active timer and every parked timer as running before link ownership is known. Then:
  - Any timer bound to a linked task is **frozen**: it stops counting, and its elapsed time, step binding and parked draft fields are kept and keep persisting.
  - Linked tasks are excluded from the header timer chips. `isActiveHeaderCaptureTimer` also shows stopped timers that are bound and have elapsed time, so freezing alone is not enough.
  - `restoreParkedTaskCapture` never resumes a linked task's parked capture.
  - A parked draft's text is shown read-only, like a recovered draft.
- Every write entry point returns early as defence in depth.

**Files:**
- Modify: `src/components/mobile-photo-portal/mobile-step-summary.tsx` (optional `readOnly`)
- Modify: `src/components/mobile-photo-portal.tsx` (gating points listed below)
- Modify: `src/components/mobile-photo-portal/capture-session.ts` (two pure timer helpers)
- Test: `src/components/mobile-photo-portal.test.tsx`, `src/components/mobile-photo-portal.recovery-draft.test.tsx`, `src/components/mobile-photo-portal/capture-session.test.ts`, `src/components/mobile-photo-portal.capture-session.test.tsx`

**Interfaces:**
- Consumes (Task 3): `awiTaskLink` from `@/domain/awi-task-link`.
- Produces:
  - `MobileStepSummary` accepts `readOnly?: boolean`.
  - From `mobile-photo-portal/capture-session.ts`:
    - `settleLinkedCaptureTimer(timer: CaptureTimerState, isLinkedTask: (taskId: string) => boolean, now: number): CaptureTimerState`
    - `settleLinkedParkedCaptures(parked: Record<string, ParkedTaskCaptureState>, isLinkedTask: (taskId: string) => boolean, now: number): Record<string, ParkedTaskCaptureState>`
    - Both return the same reference when nothing changed.

- [ ] **Step 1: Write the failing test**

Append to `src/components/mobile-photo-portal.test.tsx`:

```tsx
describe("tasks linked to a master AWI", () => {
  const masterStep = { id: "master-step", sequence: 1, name: "Fit bracket", instruction: "From the master", durationMinutes: 5 } as ManufacturingStep;
  const linkedTask: Task = { ...task, manufacturingSteps: [masterStep],
    customFields: { awiMasterLink: { masterId: "m", projectId: "mp", taskId: "mt", documentNumber: "AWI-0007" } } };
  const linkedState: PlannerState = { ...state, tasks: [linkedTask] };

  it("shows the master's steps read-only, with no way to add, time, expand or edit them", async () => {
    vi.mocked(loadPlannerStateFromSupabase).mockResolvedValue(linkedState);
    render(<MobilePhotoPortal projectId="p" initialPlannerState={linkedState} />);
    fireEvent.click(await screen.findByRole("button", { name: /Test process 1 steps?/ }));

    expect(await screen.findByText(/master AWI AWI-0007/)).toBeInTheDocument();
    expect(screen.getByText("Fit bracket")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add step" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Expand step 1" })).toBeNull();
    expect(screen.queryByTitle(/Start timer/)).toBeNull();
    expect(saveMobileStepToSupabase).not.toHaveBeenCalled();
  });

  it("keeps Add step and expansion for ordinary tasks", async () => {
    const plainState: PlannerState = { ...state, tasks: [{ ...task, manufacturingSteps: [masterStep] }] };
    vi.mocked(loadPlannerStateFromSupabase).mockResolvedValue(plainState);
    render(<MobilePhotoPortal projectId="p" initialPlannerState={plainState} />);
    fireEvent.click(await screen.findByRole("button", { name: /Test process 1 steps?/ }));
    expect(await screen.findByRole("button", { name: "Add step" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand step 1" })).toBeInTheDocument();
  });
});
```

Append to the `describe("recovery draft: restoring on load", ...)` block in `src/components/mobile-photo-portal.recovery-draft.test.tsx`:

```tsx
  it("keeps a stored draft for a task now linked to a master AWI, read-only, without opening the editor or saving", async () => {
    const linkedState: PlannerState = { ...state, tasks: [{ ...taskA,
      manufacturingSteps: [{ id: "master-step", sequence: 1, name: "Master step", instruction: "", durationMinutes: 5 }] as Task["manufacturingSteps"],
      customFields: { awiMasterLink: { masterId: "m", projectId: "mp", taskId: "mt", documentNumber: "AWI-0007" } } }] };
    vi.mocked(loadPlannerStateFromSupabase).mockResolvedValue(linkedState);
    seedRecord({ taskId: "task-a", stepId: "step-r", name: "Recovered step", instruction: "Do it", durationText: "7", tools: [], photos: [], checks: [], updatedAt: "2026-10-04T10:00:00.000Z" });
    render(<MobilePhotoPortal projectId="p" initialPlannerState={linkedState} />);
    fireEvent.click(await screen.findByRole("button", { name: /Alpha process 1 steps?/ }));

    expect(await screen.findByText(/Recovered step/)).toBeInTheDocument();
    expect(screen.getByText(/master AWI AWI-0007/)).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 400)); // past the 250 ms recovery re-save delay
    expect(screen.queryByRole("textbox", { name: "New step name" })).toBeNull();
    expect(screen.queryByText(RECOVERY_MESSAGE)).toBeNull();
    expect(saveMobileStepToSupabase).not.toHaveBeenCalled();
    expect(records()).toHaveLength(1); // kept, not acknowledged or deleted
  });
```

Add the two timer helpers' unit tests to `src/components/mobile-photo-portal/capture-session.test.ts`. Add `settleLinkedCaptureTimer`, `settleLinkedParkedCaptures`, `type CaptureTimerState` and `type ParkedTaskCaptureState` to its existing `./capture-session` import, then append:

```ts
describe("timers restored for tasks linked to a master AWI", () => {
  const NOW = 1_700_000_000_000;
  const running = (taskId: string, storedElapsedMs: number): CaptureTimerState =>
    ({ running: true, startedAt: NOW - 10_000, storedElapsedMs, lapMarkerMs: 0, activeStepId: "step-1", taskId, taskName: taskId });
  const isLinked = (taskId: string) => taskId === "linked";

  it("freezes a running timer bound to a linked task, keeping its elapsed time and step binding", () => {
    expect(settleLinkedCaptureTimer(running("linked", 30_000), isLinked, NOW)).toEqual(
      { running: false, startedAt: null, storedElapsedMs: 40_000, lapMarkerMs: 0, activeStepId: "step-1", taskId: "linked", taskName: "linked" });
  });

  it("returns other timers unchanged (same reference)", () => {
    const plain = running("plain", 30_000);
    expect(settleLinkedCaptureTimer(plain, isLinked, NOW)).toBe(plain);
  });

  it("freezes linked parked captures, keeps their draft fields, and returns the same map when nothing is linked", () => {
    const parked: Record<string, ParkedTaskCaptureState> = {
      linked: { timer: running("linked", 120_000), showNewStepForm: true, newStepId: "step-1", draftName: "Parked draft",
        draftInstruction: "Keep me", draftDurationText: "5", draftTools: ["Wrench"], draftPhotos: [], draftChecks: [] },
      plain: { timer: running("plain", 60_000), showNewStepForm: false, newStepId: null,
        draftInstruction: "", draftDurationText: "5", draftTools: [], draftPhotos: [], draftChecks: [] },
    };
    const settled = settleLinkedParkedCaptures(parked, isLinked, NOW);
    expect(settled.linked).toEqual({ ...parked.linked, timer: { ...parked.linked!.timer, running: false, startedAt: null, storedElapsedMs: 130_000 } });
    expect(settled.plain).toBe(parked.plain);
    const onlyPlain = { plain: parked.plain! };
    expect(settleLinkedParkedCaptures(onlyPlain, isLinked, NOW)).toBe(onlyPlain);
  });
});
```

Append the portal-level reconciliation tests to `src/components/mobile-photo-portal.capture-session.test.tsx`. Its `Date.now` is mocked, so no time passes unless `advance()` is called:

```tsx
describe("capture session: tasks linked to a master AWI", () => {
  const LINK = { awiMasterLink: { masterId: "m", projectId: "mp", taskId: "mt", documentNumber: "AWI-0007" } };
  const masterStep = { id: "master-step", sequence: 1, name: "Master step", instruction: "", durationMinutes: 5 } as NonNullable<Task["manufacturingSteps"]>[number];
  const linkedState = (linkedId: string): PlannerState => ({ ...state,
    tasks: state.tasks.map((task) => (task.id === linkedId ? { ...task, manufacturingSteps: [masterStep], customFields: LINK } : task)) });

  it("freezes a restored active timer on a linked task: no running timer or editor, elapsed and binding kept", async () => {
    const linked = linkedState("task-a");
    vi.mocked(loadPlannerStateFromSupabase).mockResolvedValue(linked);
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      captureTimer: { running: true, startedAt: null, storedElapsedMs: 30_000, lapMarkerMs: 0, activeStepId: "step-x", taskId: "task-a", taskName: "Alpha process" },
      parkedCaptureByTaskId: {}, activeScreen: "detail", selectedTaskId: "task-a", showNewStepForm: true, newStepId: "step-x",
    }));
    render(<MobilePhotoPortal projectId="p" initialPlannerState={linked} />);
    expect(await screen.findByText(/master AWI AWI-0007/)).toBeInTheDocument();
    await act(async () => {});
    expect(screen.queryByTitle(/^Stop timer for Alpha process/)).toBeNull();
    expect(screen.queryByTitle(/Open Alpha process/)).toBeNull();
    expect(screen.queryByRole("textbox", { name: "New step name" })).toBeNull();
    advance(5_000); // a frozen timer does not count
    fireEvent(window, new Event("pagehide"));
    expect(session().captureTimer).toMatchObject({ running: false, storedElapsedMs: 30_000, activeStepId: "step-x", taskId: "task-a" });
  });

  it("freezes a restored parked timer on a linked task, hides its chip, keeps its draft and never resumes it", async () => {
    const linked = linkedState("task-b");
    vi.mocked(loadPlannerStateFromSupabase).mockResolvedValue(linked);
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      captureTimer: { running: false, startedAt: null, storedElapsedMs: 0, lapMarkerMs: 0, activeStepId: null, taskId: null, taskName: "" },
      parkedCaptureByTaskId: { "task-b": {
        timer: { running: true, startedAt: null, storedElapsedMs: 120_000, lapMarkerMs: 0, activeStepId: "step-y", taskId: "task-b", taskName: "Beta process" },
        showNewStepForm: true, newStepId: "step-y", draftName: "Parked draft", draftInstruction: "Keep me", draftDurationText: "5",
        draftTools: [], draftPhotos: [], draftChecks: [] } },
      activeScreen: "list", selectedTaskId: "task-a", showNewStepForm: false, newStepId: null,
    }));
    render(<MobilePhotoPortal projectId="p" initialPlannerState={linked} />);
    await screen.findByRole("button", { name: /Beta process 1 steps?/ });
    await act(async () => {});
    expect(screen.queryByTitle(/Open Beta process/)).toBeNull();
    advance(5_000);
    await openTask(/Beta process 1 steps?/);
    expect(await screen.findByText(/Parked draft/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "New step name" })).toBeNull();
    expect(screen.queryByTitle(/^Stop timer for Beta process/)).toBeNull();
    fireEvent(window, new Event("pagehide"));
    expect(session().parkedCaptureByTaskId["task-b"]).toMatchObject({
      draftName: "Parked draft", draftInstruction: "Keep me", timer: { running: false, storedElapsedMs: 120_000 } });
  });
});
```

- [ ] **Step 2: Run to see RED**

Run: `npx vitest run src/components/mobile-photo-portal.test.tsx src/components/mobile-photo-portal.recovery-draft.test.tsx src/components/mobile-photo-portal/capture-session.test.ts src/components/mobile-photo-portal.capture-session.test.tsx`
Expected:
- The linked portal test FAILS (no notice; Add step and Expand are present). The plain test PASSES.
- The linked recovery test FAILS (the editor opens with the recovery message and `saveMobileStepToSupabase` is called).
- The helper tests FAIL (`settleLinkedCaptureTimer` is not exported).
- Both linked timer tests FAIL (the restored timer is running, and its chip or Stop control shows).

- [ ] **Step 3: Read-only summary**

In `src/components/mobile-photo-portal/mobile-step-summary.tsx`:
- Add `readOnly = false` to the destructured props and `readOnly?: boolean;` to the props type.
- Move the existing `<span className="ui-photo-mobile-step-summary-main">…</span>` into a local `const content = (…)`.
- Return:

```tsx
  if (readOnly) {
    return (
      <article key={step.id} className="overflow-hidden ui-panel">
        <div className="ui-photo-mobile-step-summary">{content}</div>
      </article>
    );
  }
  return (
    <article key={step.id} className="overflow-hidden ui-panel">
      <button
        type="button"
        onClick={() => toggleStepExpanded(step.id)}
        className="ui-photo-mobile-step-summary"
        aria-expanded={false}
        aria-label={`Expand step ${step.sequence}`}
      >
        {content}
        <ChevronDown size={16} className="ui-photo-mobile-step-summary-chevron" />
      </button>
    </article>
  );
```

- [ ] **Step 4: Gate the portal**

In `src/components/mobile-photo-portal.tsx`:

1. Add `import { awiTaskLink } from "@/domain/awi-task-link";` with the other `@/domain` imports.
2. After the `selectedTaskSteps` memo (~line 376), add:

```tsx
  // A task linked to a master AWI shows the master's procedure and owns none of its own (DRIFT-3).
  const selectedTaskLink = selectedTask ? awiTaskLink(selectedTask) : undefined;
```

3. `canStartCaptureTimer` (~440): add `!selectedTaskLink &&` as the first operand inside `Boolean(`.
4. Gate the editor itself. At ~3035 change `{showNewStepForm ? (` to `{showNewStepForm && !selectedTaskLink ? (`, so no restore path can show the editor on a linked task. Then replace the `Add step` `<button>` branch (the `) : (` arm after `MobileNewStepEditor`, ~3071-3079) with:

```tsx
                ) : selectedTaskLink ? (
                  <div role="note" className="ui-photo-mobile-body-secondary order-last space-y-2">
                    <p>
                      {selectedTask?.awiMasterStatus === "unavailable"
                        ? `These steps come from master AWI ${selectedTaskLink.documentNumber}, which is unavailable right now.`
                        : `These steps come from master AWI ${selectedTaskLink.documentNumber}. Edit them in the AWI.`}
                    </p>
                    {keptDraftText ? (
                      <p>
                        {`An unsaved step from this phone is kept here: "${keptDraftText.name || "Untitled step"}"`}
                        {keptDraftText.instruction.trim() ? ` (${keptDraftText.instruction.trim()})` : ""}
                        {". Add it in the master AWI; it stays on this phone until then."}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={openNewStepForm}
                    className="ui-photo-mobile-btn-secondary order-last h-11 w-full"
                  >
                    <Plus size={16} />
                    Add step
                  </button>
                )}
```

5. The empty-state block condition (~3081): `selectedTaskSteps.length === 0 && !showNewStepForm && !selectedTaskLink`.
6. In the step map (~3102): `const isExpanded = !selectedTaskLink && (expandedStepIds.has(step.id) || confirmingDelete);`, and pass `readOnly={Boolean(selectedTaskLink)}` to `MobileStepSummary`.
7. Defence in depth: add a link check as the first statement after each function's existing early-return null checks:
   - `openNewStepForm` (~2459): `if (awiTaskLink(selectedTask)) return;` after `if (!selectedTask) { return; }`
   - `persistNewStepDraft` (~1377): `if (awiTaskLink(currentTask)) return null;` after `if (!currentTask) { return null; }`
   - `updateManufacturingStepOnTask` (~2061): `if (awiTaskLink(currentTask)) return;` after `if (!currentTask) { return; }`
   - `deleteManufacturingStep` (~2325): `if (awiTaskLink(selectedTask)) return;` after the `!plannerState || !selectedTask` guard
   - `handlePhotoFiles` (~1886): `if (awiTaskLink(selectedTask)) return;` after its first guard
   - `removePhoto` (~1924): `if (awiTaskLink(selectedTask)) return;` after its first guard
   - `addManufacturingStepToolFromLibrary` (~1970): `if (selectedTask && awiTaskLink(selectedTask)) return;` as the first statement
   - `removeManufacturingStepTool` (~1998): `if (awiTaskLink(selectedTask)) return;` after its first guard
   - `startCaptureTimerForCurrentTask` (~2534): `if (awiTaskLink(selectedTask)) return;` after its first guard
8. Restored drafts. Next to `const [showNewStepForm, setShowNewStepForm] = useState(false);` (~247), add:

```tsx
  // A recovered new-step draft for a task that is now linked to a master AWI: kept on the phone, shown read-only.
  const [keptLinkedDraft, setKeptLinkedDraft] = useState<{ taskId: string; name: string; instruction: string } | null>(null);
```

   - `restoreOwnedDraft` (~1121): directly after the line `if (!hasDraftStepContentRef.current(snapshot)) return false; // Preserve even empty records.` (so empty records stay silent, as today), add:

```tsx
    const draftTask = plannerStateRef.current?.tasks.find((task) => task.id === draft.taskId);
    if (draftTask && awiTaskLink(draftTask)) {
      // DRIFT-3: a linked task takes no steps of its own. Keep the record (never save, acknowledge or delete it)
      // and show its text read-only, instead of opening the editor and announcing a save that cannot happen.
      setKeptLinkedDraft({ taskId: draft.taskId, name: draft.name ?? "", instruction: draft.instruction ?? "" });
      return false;
    }
```

   - The session restore in `applySavedState` (~1053): change `if (session?.showNewStepForm && resolvedTaskId === preferredTaskId) {` to:

```tsx
        const sessionFormTask = savedState.tasks.find((task) => task.id === resolvedTaskId);
        if (session?.showNewStepForm && resolvedTaskId === preferredTaskId && !(sessionFormTask && awiTaskLink(sessionFormTask))) {
```

     (The draft's content lives in the IndexedDB recovery record, which `restoreOwnedDraft` keeps. Skipping the form flag discards nothing.)
   - `restoreTimedStepDraft` (~2274): add as its first statement:

```tsx
    const timedTask = plannerStateRef.current?.tasks.find((candidate) => candidate.id === taskId);
    if (timedTask && awiTaskLink(timedTask)) return;
```

9. Restored timers. First add the two pure helpers to `src/components/mobile-photo-portal/capture-session.ts`, after `freezeCaptureTimer`:

```ts
/**
 * A timer restored from a saved session for a task that now follows a master AWI: stop it counting.
 * Its elapsed time and step binding are kept (and keep persisting); nothing is discarded.
 */
export function settleLinkedCaptureTimer(
  timer: CaptureTimerState,
  isLinkedTask: (taskId: string) => boolean,
  now: number,
): CaptureTimerState {
  return timer.running && timer.taskId && isLinkedTask(timer.taskId) ? freezeCaptureTimer(timer, now) : timer;
}

/** Freeze every parked capture whose task now follows a master AWI, keeping its draft fields. */
export function settleLinkedParkedCaptures(
  parked: Record<string, ParkedTaskCaptureState>,
  isLinkedTask: (taskId: string) => boolean,
  now: number,
): Record<string, ParkedTaskCaptureState> {
  let changed = false;
  const next = Object.fromEntries(Object.entries(parked).map(([taskId, entry]) => {
    if (!entry.timer.running || !isLinkedTask(taskId)) return [taskId, entry];
    changed = true;
    return [taskId, { ...entry, timer: freezeCaptureTimer(entry.timer, now) }];
  }));
  return changed ? next : parked;
}
```

Then, in `src/components/mobile-photo-portal.tsx`:
   - Add `settleLinkedCaptureTimer` and `settleLinkedParkedCaptures` to the `@/components/mobile-photo-portal/capture-session` import (line 40).
   - Next to `selectedTaskLink` (item 2), add the linked-task set, the by-id check used by the guards below, and the kept-draft text shown in item 4's notice:

```tsx
  const linkedTaskIds = useMemo(
    () => new Set((plannerState?.tasks ?? []).filter((task) => Boolean(awiTaskLink(task))).map((task) => task.id)),
    [plannerState?.tasks],
  );
  function isLinkedTaskId(taskId: string | null | undefined) {
    const task = taskId ? plannerStateRef.current?.tasks.find((candidate) => candidate.id === taskId) : undefined;
    return Boolean(task && awiTaskLink(task));
  }
  // A recovered (IndexedDB) or parked (session) new-step draft for the selected linked task, shown read-only.
  const keptParkedDraft = selectedTask && selectedTaskLink ? parkedCaptureByTaskId[selectedTask.id] : undefined;
  const keptDraftText = keptLinkedDraft && keptLinkedDraft.taskId === selectedTask?.id
    ? keptLinkedDraft
    : keptParkedDraft && ((keptParkedDraft.draftName ?? "").trim() || keptParkedDraft.draftInstruction.trim())
      ? { taskId: keptParkedDraft.timer.taskId ?? "", name: keptParkedDraft.draftName ?? "", instruction: keptParkedDraft.draftInstruction }
      : null;
```

   - `headerCaptureTimers` (~416): filter the collected entries before sorting with `const entries = collectHeaderCaptureTimers(captureTimer, parkedCaptureByTaskId).filter((entry) => !linkedTaskIds.has(entry.taskId));`, and add `linkedTaskIds` to that memo's dependency list. (`isActiveHeaderCaptureTimer` also shows stopped timers that are bound and have elapsed time, so freezing alone would leave a chip.)
   - `applySavedState` (~1019): directly after the parked-capture restore block (the `if (session?.parkedCaptureByTaskId && …) { … }` ending ~1046), add:

```tsx
        // Reconcile restored timers with task ownership: a task that follows a master AWI never runs a timer.
        // Functional updates see the timers the session hydration effect queued in this same pass.
        const linkedIds = new Set(savedState.tasks.filter((task) => Boolean(awiTaskLink(task))).map((task) => task.id));
        if (linkedIds.size > 0) {
          const isLinked = (taskId: string) => linkedIds.has(taskId);
          const settledAt = Date.now();
          setCaptureTimer((current) => settleLinkedCaptureTimer(current, isLinked, settledAt));
          setParkedCaptureByTaskId((current) => settleLinkedParkedCaptures(current, isLinked, settledAt));
        }
```

   - Never resume a linked task's capture. Add `if (isLinkedTaskId(taskId)) return false;` as the first statement of `restoreParkedTaskCapture` (~2190). This keeps the parked entry, and with it the draft. Add `if (isLinkedTaskId(taskId)) return;` as the first statement of `resumeCaptureTimerForTask` (~2212). (`restoreTimedStepDraft` is already guarded by item 8.) These three cover task selection, the header chip (`openCaptureTaskFromHeader`) and the Timer button.

- [ ] **Step 5: Run to see GREEN, plus the other mobile suites**

Run: `npx vitest run src/components/mobile-photo-portal.test.tsx src/components/mobile-photo-portal.capture-session.test.tsx src/components/mobile-photo-portal.recovery-draft.test.tsx src/components/mobile-photo-portal`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/mobile-photo-portal.tsx src/components/mobile-photo-portal/mobile-step-summary.tsx src/components/mobile-photo-portal.test.tsx src/components/mobile-photo-portal.recovery-draft.test.tsx src/components/mobile-photo-portal/capture-session.ts src/components/mobile-photo-portal/capture-session.test.ts src/components/mobile-photo-portal.capture-session.test.tsx
git commit -m "fix: make linked AWI tasks read-only on the phone portal and keep their recovered drafts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: Database guard: no procedure rows under a linked task

**Files:**
- Create: `supabase/migrations/20261010190000_awi_link_child_guard.sql` (if `ls supabase/migrations | tail -1` sorts after this name, use a later UTC timestamp)
- Create: `supabase/tests/awi_task_link_guard_test.sql`

**Interfaces:**
- Consumes: the exact message `Edit these instructions in the linked master AWI.` (Task 3).
- Produces: trigger `awi_link_child_guard` on `manufacturing_steps`, `part_references`, `step_tools`, `step_photos`, `step_exploded_views` and `task_videos`.

- [ ] **Step 1: Write the pgTAP test (RED in CI until the migration exists)**

Create `supabase/tests/awi_task_link_guard_test.sql`:

```sql
-- A task linked to a master AWI owns no procedure rows. New rows and moves onto it are refused;
-- soft-deletes and deletes of rows already there stay possible so earlier orphans can be cleaned up.
begin;
select plan(12);
insert into public.workspaces(id,name) values('ws_link_guard','Link guard');
insert into public.projects(id,workspace_id,name) values('lg-project','ws_link_guard','Pilot');
insert into public.products(id,project_id,name) values('lg-product','lg-project','Pilot');
insert into public.scenarios(id,product_id,name) values('lg-scenario','lg-product','Main');
insert into public.stations(id,scenario_id,sequence,name) values('lg-station','lg-scenario',1,'Station');
insert into public.tasks(id,scenario_id,station_id,wbs,name,planned_start,planned_finish,custom_fields) values
 ('lg-plain','lg-scenario','lg-station','1','Plain',now(),now(),'{}'::jsonb),
 ('lg-linked','lg-scenario','lg-station','2','Linked',now(),now(),
  '{"awiMasterLink":{"masterId":"m","projectId":"mp","taskId":"mt","documentNumber":"AWI-0001"}}'::jsonb),
 ('lg-later','lg-scenario','lg-station','3','Linked later',now(),now(),'{}'::jsonb);

select lives_ok($$insert into public.manufacturing_steps(id,task_id,sequence,name,instruction,duration_minutes)
  values('lg-step','lg-plain',1,'Step','Plain step',1)$$, 'a plain task still takes new steps');
select throws_ok($$insert into public.manufacturing_steps(id,task_id,sequence,name,instruction,duration_minutes)
  values('lg-step-2','lg-linked',1,'Step','Orphan',1)$$, '23514', 'Edit these instructions in the linked master AWI.',
  'a linked task refuses a new step');
select throws_ok($$update public.manufacturing_steps set task_id='lg-linked' where id='lg-step'$$,
  '23514', 'Edit these instructions in the linked master AWI.', 'a step cannot be moved onto a linked task');
select lives_ok($$insert into public.step_tools(id,step_id,task_id,tool_name,sequence) values('lg-tool','lg-step','lg-plain','Wrench',1)$$,
  'a plain task still takes tools');
select throws_ok($$insert into public.step_tools(id,step_id,task_id,tool_name,sequence) values('lg-tool-2','lg-step','lg-linked','Hammer',1)$$,
  '23514', 'Edit these instructions in the linked master AWI.', 'a linked task refuses a tool');
select throws_ok($$insert into public.step_photos(id,step_id,task_id,storage_path,public_url,file_name)
  values('lg-photo-2','lg-step','lg-linked','ci/x.png','ci/x.png','x')$$,
  '23514', 'Edit these instructions in the linked master AWI.', 'a linked task refuses a photo');

-- Rows that existed before the task was linked (the orphans this guard stops creating) stay manageable.
insert into public.manufacturing_steps(id,task_id,sequence,name,instruction,duration_minutes) values('lg-old-step','lg-later',1,'Old','Old',1);
insert into public.step_photos(id,step_id,task_id,storage_path,public_url,file_name) values('lg-old-photo','lg-old-step','lg-later','ci/o.png','ci/o.png','o');
update public.tasks set custom_fields='{"awiMasterLink":{"masterId":"m","projectId":"mp","taskId":"mt","documentNumber":"AWI-0001"}}'::jsonb where id='lg-later';
select lives_ok($$update public.step_photos set deleted_at=now() where id='lg-old-photo'$$, 'an existing photo under a linked task can still be soft-deleted');
select lives_ok($$delete from public.manufacturing_steps where id='lg-old-step'$$, 'an existing step under a linked task can still be deleted');

select ok(exists(select 1 from pg_trigger where tgname='awi_link_child_guard' and tgrelid='public.part_references'::regclass), 'part references are guarded');
select ok(exists(select 1 from pg_trigger where tgname='awi_link_child_guard' and tgrelid='public.step_exploded_views'::regclass), 'exploded views are guarded');
select ok(exists(select 1 from pg_trigger where tgname='awi_link_child_guard' and tgrelid='public.task_videos'::regclass), 'task videos are guarded');
select ok(not has_function_privilege('authenticated','private.refuse_linked_awi_task_child()','EXECUTE'), 'clients cannot call the guard directly');
select * from finish();
rollback;
```

If an insert fails on a NOT NULL column that this fixture omits, copy that column's value from `supabase/tests/task_reorder_test.sql:4-33`. That file inserts the same tables and is known to pass.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/20261010190000_awi_link_child_guard.sql`:

```sql
-- DRIFT-3 (structure audit 2026-10-10). A Product task linked to a master AWI owns no procedure: its
-- steps, parts, tools and media are read from the master (src/domain/awi-task-link.ts). Client guards
-- covered only some write paths, so a step move or a phone capture could write rows under a linked
-- task that then vanished on reload. Refuse new rows, and moves of existing rows, onto a linked task.
-- UPDATE is limited to task_id so soft-deletes and other edits of rows created before this guard keep
-- working; DELETE is never blocked. The predicate mirrors awiTaskLink(): an object under awiMasterLink.
create or replace function private.refuse_linked_awi_task_child() returns trigger
language plpgsql set search_path = '' as $$
begin
  if exists (
    select 1 from public.tasks t
    where t.id = new.task_id and jsonb_typeof(t.custom_fields -> 'awiMasterLink') = 'object'
  ) then
    raise exception 'Edit these instructions in the linked master AWI.' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function private.refuse_linked_awi_task_child() from public, anon, authenticated;

create trigger awi_link_child_guard before insert or update of task_id on public.manufacturing_steps
  for each row execute function private.refuse_linked_awi_task_child();
create trigger awi_link_child_guard before insert or update of task_id on public.part_references
  for each row execute function private.refuse_linked_awi_task_child();
create trigger awi_link_child_guard before insert or update of task_id on public.step_tools
  for each row execute function private.refuse_linked_awi_task_child();
create trigger awi_link_child_guard before insert or update of task_id on public.step_photos
  for each row execute function private.refuse_linked_awi_task_child();
create trigger awi_link_child_guard before insert or update of task_id on public.step_exploded_views
  for each row execute function private.refuse_linked_awi_task_child();
create trigger awi_link_child_guard before insert or update of task_id on public.task_videos
  for each row execute function private.refuse_linked_awi_task_child();
```

- [ ] **Step 3: Run pgTAP locally when a local stack is available (CI's database job is authoritative)**

Target the retained **`pulse-e2e`** stack explicitly, every time.
- It is workdir `scratch/browser-db`, API port 56321, DB port 56322.
- Never run a bare `--local` command from the repo root. That resolves `supabase/config.toml`, which is the separate `pulse` project on 55322, and it is off limits.
- Never `db reset` the retained stack.

```bash
# 0. Confirm the identity before any CLI call (expect pulse-e2e, 56321, 56322; no 553xx port).
grep -E '^project_id|^port = ' scratch/browser-db/supabase/config.toml
# 1. Start it without a reset (note whether it was already running, to restore that state at the end).
npx --yes supabase@2.119.0 start --workdir scratch/browser-db -x studio,postgres-meta,edge-runtime,logflare,vector,supavisor,imgproxy,mailpit
# 2. Apply the one migration plus its ledger row in one transaction; this script is hard-wired to 127.0.0.1:56322.
node scripts/verify-local-migration.mjs supabase/migrations/20261010190000_awi_link_child_guard.sql
# 3. Run pgTAP against the same database by URL (the test rolls back; nothing persists).
npx --yes supabase@2.119.0 test db --db-url "postgresql://postgres:postgres@127.0.0.1:56322/postgres" supabase/tests/awi_task_link_guard_test.sql
# 4. Only if it was stopped before step 1: plain stop keeps its volumes.
npx --yes supabase@2.119.0 stop --workdir scratch/browser-db
```

Expected: step 2 reports every pre-existing table unchanged, and step 3 prints `ok 1` through `ok 12`. If the stack cannot be started, record that the pgTAP run is deferred to CI's database job (authoritative), and say so in the hand-off.

- [ ] **Step 4: Types**

This migration adds no columns or functions in `public`, so `src/lib/database.types.ts` does not change. Do not run `npm run gen:types` now: it reads the production schema. Task 11 handles the post-apply check.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261010190000_awi_link_child_guard.sql supabase/tests/awi_task_link_guard_test.sql
git commit -m "fix: refuse procedure rows under linked AWI tasks in the database

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 7: Batched, failure-tolerant link resolution on every planner load

**Context:** `read-store.ts:243` runs `Promise.all(tasks.map(resolveLinkedAwiTask))`, which has three problems:
- Each linked task costs an `awi_masters` read plus a full single-task load with media signing (~11-13 requests), even on the media-less core load.
- Nothing is shared between tasks that link the same master.
- One failure rejects the whole planner load for every viewer.

Replace it with:
- One `awi_masters` read for all links.
- One graph load per distinct master, with media only when `includeTaskMedia`.
- On the **planner graph load only**, a per-link failure marks just that task unavailable (Task 3's `applyLinkedAwiMasters`). That load is where one failure took the whole planner down.

The single-task `loadTaskFromSupabase` stays **strict**: an unresolvable link throws, exactly as today. Its callers already own a failure path, and a tolerant result would defeat it:
- **Media hydration** (`use-workspace-data.ts:420`, through `loadTaskPrivateMediaFromSupabase`) would mark an unavailable master's media `"loaded"`. That skips the error notice and the focus/online/visibility retry.
- **The realtime per-task refresh** (`use-workspace-realtime.ts:121`) and **the phone refresh** (`mobile-photo-portal.tsx:840`) would replace a good linked task with an empty "unavailable" copy on a transient error. Today they keep the current copy.
- **The AWI picker** (`line-workspace.tsx:2746`) needs the error text.

**Files:**
- Modify: `src/lib/planner/read-store.ts` (extract `loadTaskGraph`, add `loadLinkedAwiMasters`, replace `resolveLinkedAwiTask`, line 243, `loadTaskFromSupabase`)
- Modify: `src/domain/supabase-planner.ts` (facade: re-export `loadLinkedAwiMasters`)
- Modify: `src/components/line-workspace.tsx:2568` (`publishAction`: unavailable notice)
- Test: `src/domain/supabase-planner.task-read.test.ts` (rewrite the linked describe), `src/domain/supabase-planner.reads.test.ts` (new describe)

**Interfaces:**
- Consumes (Task 3): `applyLinkedAwiMasters`, `awiTaskLink`, `type LinkedAwiMaster`.
- Produces:
  - `loadLinkedAwiMasters(tasks: Task[], client?: ReturnType<typeof plannerClient>, options?: { includeTaskMedia?: boolean }): Promise<Map<string, LinkedAwiMaster>>`, exported from `@/lib/planner/read-store` and re-exported by `@/domain/supabase-planner`.
  - `loadTaskFromSupabase` loses its unused fourth parameter and keeps throwing `The linked master AWI is unavailable. Check the master list and your access.` for an unresolvable link.

- [ ] **Step 1: Rewrite the single-task linked tests (RED)**

In `src/domain/supabase-planner.task-read.test.ts`, replace the whole `describe("linked master AWI reads", ...)` block (and remove the Task 3 `.skip` if one was added) with:

```ts
describe("linked master AWI reads", () => {
  const LINK = { masterId: "master", projectId: "master-project", taskId: "master-task", documentNumber: "AWI-001" };
  function linkedWorld() {
    let text = "First master instruction";
    let mastersFail = false;
    const db = createRecordingSupabase({ reply: (r) => {
      if (r.target === "task_project_id") return { data: PROJECT };
      if (r.kind === "storage") return { data: [] };
      if (r.target === "awi_masters") return mastersFail
        ? { error: { message: "masters offline" } }
        : { data: [{ id: "master", project_id: "master-project", task_id: "master-task" }] };
      // The linking row also answers the private-media hydrate's JSONB projection (awi_link).
      if (r.target === "tasks") return { data: r.filters.includes("id=master-task")
        ? { ...TASK, id: "master-task", description: "Master scope", custom_fields: {}, planned_duration_minutes: 90 }
        : { ...TASK, planned_start: "2026-10-01T08:00:00.000Z", planned_finish: "2026-10-01T08:30:00.000Z", planned_duration_minutes: 30, custom_fields: { awiMasterLink: LINK }, awi_link: LINK } };
      if (r.target === "manufacturing_steps") return { data: r.filters.includes("task_id=master-task")
        ? [{ ...STEP, id: "master-step", task_id: "master-task", instruction: text, duration_minutes: 12 }] : [] };
      return { data: [] };
    } });
    return {
      db, client: db.client as unknown as Client,
      setText: (next: string) => { text = next; },
      failMasters: () => { mastersFail = true; },
    };
  }

  it("shows the current master procedure and takes the task's time from the master", async () => {
    const { db, client, setText } = linkedWorld();
    const loaded = await loadTaskFromSupabase("task-1", PROJECT, client);
    expect(loaded?.plannedDurationMinutes).toBe(12);
    expect(loaded?.plannedFinish).toBe("2026-10-01T08:12:00.000Z");
    expect(loaded?.manufacturingSteps?.[0].instruction).toBe("First master instruction");
    setText("Updated master instruction");
    expect((await loadTaskFromSupabase("task-1", PROJECT, client))?.manufacturingSteps?.[0].instruction).toBe("Updated master instruction");
    expect(db.requests.filter((r) => r.kind === "from" && r.op !== "select")).toEqual([]);
    // The master is read straight from awi_masters (insert-only for clients), with no per-master project RPC.
    expect(db.requests.filter((r) => r.target === "task_project_id")).toHaveLength(2);
  });

  it("still rejects a single-task read whose master cannot be read, so callers keep their copy and retry", async () => {
    const { client, failMasters } = linkedWorld();
    failMasters();
    await expect(loadTaskFromSupabase("task-1", PROJECT, client))
      .rejects.toThrow("The linked master AWI is unavailable. Check the master list and your access.");
  });

  it("fails master-media hydration after a successful load, instead of reporting empty media as loaded", async () => {
    const world = linkedWorld();
    expect((await loadTaskFromSupabase("task-1", PROJECT, world.client))?.manufacturingSteps?.[0].id).toBe("master-step");
    world.failMasters();
    await expect(loadTaskPrivateMediaFromSupabase("task-1", PROJECT, world.client))
      .rejects.toThrow("The linked master AWI is unavailable");
  });
});
```

(`task_project_id` is called once per `loadTaskFromSupabase` call, twice in total in the first test, for the linking task only.)

The second test is the boundary the review flagged. `use-workspace-data.ts:420-445` marks media `"loaded"` for any non-null result, so a rejection is what keeps its error notice and focus/online/visibility retry working.

- [ ] **Step 2: Add the planner-level tests (RED)**

Append to `src/domain/supabase-planner.reads.test.ts`:

```ts
describe("linked master AWIs", () => {
  const LINK = { masterId: "master-1", projectId: "awi-project", taskId: "master-task", documentNumber: "AWI-001" };
  const linkedGraph = { ...graph, tasks: ["task-1", "task-2", "task-3"].map((id, index) => (
    { id, scenario_id: "scenario-1", wbs: String(index + 1), name: id, planned_start: NOW, planned_finish: NOW, custom_fields: { awiMasterLink: LINK }, version: 1 })) };
  const masters = (options: { fail?: boolean } = {}) => (r: RecordedRequest): ScriptedReply | undefined => {
    if (r.target === "awi_masters") return options.fail
      ? { error: { message: "masters offline" } }
      : { data: [{ id: "master-1", project_id: "awi-project", task_id: "master-task" }] };
    if (r.target === "tasks" && r.filters.includes("id=master-task")) return { data: { id: "master-task", scenario_id: "awi-scenario", wbs: "1", name: "Master", custom_fields: {}, version: 1 } };
    if (r.target === "manufacturing_steps" && r.filters.includes("task_id=master-task")) return { data: [{ id: "master-step", task_id: "master-task", sequence: 1, name: "Fit", duration_minutes: 7, version: 1 }] };
    if (r.filters.includes("task_id=master-task") || r.filters.includes("successor_task_id=master-task")) return { data: [] };
    return undefined;
  };

  it("reads the masters once and each distinct master once, for three tasks linking one master", async () => {
    const db = createRecordingSupabase({ userId: "user-1", reply: replyFrom(linkedGraph, masters()) });
    const state = await loadPlannerStateFromSupabase("proj-1", undefined, client(db));
    expect(db.lines().filter((line) => line.startsWith("awi_masters."))).toHaveLength(1);
    expect(db.lines().filter((line) => line.startsWith("tasks.select(*) id=master-task"))).toHaveLength(1);
    expect(state?.tasks.map((task) => task.plannedDurationMinutes)).toEqual([7, 7, 7]);
    expect(state?.tasks.every((task) => task.manufacturingSteps?.[0]?.id === "master-step")).toBe(true);
  });

  it("still loads the planner when the masters cannot be read, marking only the linked tasks", async () => {
    const db = createRecordingSupabase({ userId: "user-1", reply: replyFrom(linkedGraph, masters({ fail: true })) });
    const state = await loadPlannerStateFromSupabase("proj-1", undefined, client(db));
    expect(state?.tasks).toHaveLength(3);
    expect(state?.tasks.every((task) => task.awiMasterStatus === "unavailable")).toBe(true);
  });

  it("reads and signs no master media on the editable-core load", async () => {
    const db = createRecordingSupabase({ userId: "user-1", reply: replyFrom(linkedGraph, masters()) });
    await loadPlannerCoreStateFromSupabase("proj-1", undefined, client(db));
    expect(db.lines().filter((line) => line.includes("master-task")).some((line) => /step_photos|step_exploded_views|task_videos/.test(line))).toBe(false);
    expect(db.lines().some((line) => line.startsWith("storage:"))).toBe(false);
  });
});
```

The existing `full planner load` test in this file has no linked tasks. It pins that a product without links sends no `awi_masters` request. Do not edit it.

- [ ] **Step 3: Run to see RED**

Run: `npx vitest run src/domain/supabase-planner.task-read.test.ts src/domain/supabase-planner.reads.test.ts`
Expected:
- The planner-level masters-fail test FAILS (the whole load rejects with `masters offline`).
- The three-tasks test FAILS (3 `awi_masters` reads).
- The core-load test FAILS (master media read).
- The linked single-task test FAILS (an RPC for the master task; the old `.maybeSingle()` read cannot use the batched array reply).
- The two strict single-task tests FAIL (wrong error text: `masters offline` instead of the unavailable message, or the first load already throwing).

- [ ] **Step 4: Implement in `read-store.ts`**

1. Change the import on line 1 to `import { applyLinkedAwiMasters, awiTaskLink, type LinkedAwiMaster } from "@/domain/awi-task-link";`.
2. Replace `loadTaskFromSupabase` and `resolveLinkedAwiTask` (lines 524-582) with:

```ts
export async function loadTaskFromSupabase(
  taskId: string,
  projectId?: string,
  client?: ReturnType<typeof plannerClient>,
): Promise<Task | null> {
  const supabase = client ?? plannerClient();
  await assertTaskInProject(supabase, taskId, projectId);
  const task = await loadTaskGraph(supabase, taskId, true);
  if (!task) {
    return null;
  }
  const [resolved] = await resolveLinkedAwiTasks([task], supabase, { includeTaskMedia: true });
  // Single-task reads stay strict: media hydration, realtime/phone task refreshes and the AWI picker all
  // keep their current copy and retry on a rejection, and must never receive an "unavailable" placeholder.
  if (!resolved || resolved.awiMasterStatus === "unavailable") {
    throw new Error("The linked master AWI is unavailable. Check the master list and your access.");
  }
  return resolved;
}

/**
 * One task row with its children. Private media (photos, exploded views, videos) is read and signed only
 * when includeTaskMedia is true. No project assertion and no link resolution; callers own both.
 */
async function loadTaskGraph(
  supabase: ReturnType<typeof plannerClient>,
  taskId: string,
  includeTaskMedia: boolean,
): Promise<Task | null> {
  const task = await throwIfError(supabase.from("tasks").select("*").eq("id", taskId).maybeSingle());

  if (!task) {
    return null;
  }

  // Every child collection is paged and ordered with an `id` tiebreaker, the same shape the full planner
  // load and the private-media hydrate use for these tables: a collection above the API row cap is read
  // completely, and rows sharing a sort key (photos captured in one batch) come back in one stable order.
  const [dependencies, manufacturingSteps, partReferences, stepPhotos, stepTools, explodedViews, taskVideos] = await Promise.all([
    readAllPages((from, to) => throwIfError(supabase.from("task_dependencies").select("*").eq("successor_task_id", taskId).order("id").range(from, to))),
    readAllPages((from, to) => throwIfError(supabase.from("manufacturing_steps").select("*").eq("task_id", taskId).order("sequence").order("id").range(from, to))),
    readAllPages((from, to) => throwIfError(supabase.from("part_references").select("*").eq("task_id", taskId).order("created_at").order("id").range(from, to))),
    includeTaskMedia
      ? readAllPages((from, to) => throwIfError(supabase.from("step_photos").select("*").eq("task_id", taskId).is("deleted_at", null).order("captured_at").order("id").range(from, to)))
      : Promise.resolve([]),
    readAllPages((from, to) => throwIfError(supabase.from("step_tools").select("*").eq("task_id", taskId).order("sequence").order("id").range(from, to))),
    includeTaskMedia
      ? readAllPages((from, to) => throwIfError(supabase.from("step_exploded_views").select("*").eq("task_id", taskId).is("deleted_at", null).order("captured_at").order("id").range(from, to)))
      : Promise.resolve([]),
    includeTaskMedia
      ? readAllPages((from, to) => throwIfError(supabase.from("task_videos").select("*").eq("task_id", taskId).is("deleted_at", null).order("captured_at").order("id").range(from, to)))
      : Promise.resolve([]),
  ]);

  const mappedTask = mapTask({
    ...task,
    // Same lazy-media boundary as the core planner load: legacy denormalized media stays out of core reads.
    custom_fields: includeTaskMedia ? task.custom_fields : customFieldsRow(jsonObject(task.custom_fields)),
    dependency_ids: (dependencies ?? []).map((dependency) => String(dependency.predecessor_task_id)),
    manufacturing_steps: normalizeManufacturingStepSequences((manufacturingSteps ?? []).map(mapManufacturingStepRecord)),
    part_references: (partReferences ?? []).map(mapPartReferenceRecord),
  });

  const [signedStepPhotos, signedExplodedViews, signedTaskVideos] = await Promise.all([
    withSignedStepPhotoRows(supabase, (stepPhotos ?? []) as StepPhotoRow[]),
    withSignedExplodedViewRows(supabase, (explodedViews ?? []) as StepExplodedViewRow[]),
    withSignedTaskVideoRows(supabase, (taskVideos ?? []) as TaskVideoRow[]),
  ]);

  return withNormalizedStepAssets(
    mappedTask,
    indexStepPhotos(signedStepPhotos),
    indexStepTools((stepTools ?? []) as StepToolRow[]),
    indexExplodedViews(signedExplodedViews),
    indexTaskVideos(signedTaskVideos),
  );
}

/**
 * The master AWI behind every link in `tasks`: one awi_masters read for all links, then one graph load per
 * distinct master, so N tasks linking one master cost the same as one. Read-only. A master that cannot be
 * read or loaded is returned without a source (or omitted), and applyLinkedAwiMasters marks only the tasks
 * that use it unavailable; it never fails the caller. awi_masters is insert-only for clients and its insert
 * policy ties task_id to project_id, so no per-master project RPC is needed.
 */
export async function loadLinkedAwiMasters(
  tasks: Task[],
  client?: ReturnType<typeof plannerClient>,
  options: { includeTaskMedia?: boolean } = {},
): Promise<Map<string, LinkedAwiMaster>> {
  const masters = new Map<string, LinkedAwiMaster>();
  const masterIds = [...new Set(tasks.flatMap((task) => awiTaskLink(task)?.masterId ?? []))];
  if (masterIds.length === 0) {
    return masters;
  }
  const supabase = client ?? plannerClient();
  const includeTaskMedia = options.includeTaskMedia !== false;
  const rows = await readRowsByIds(masterIds, (ids, from, to) =>
    throwIfError(supabase.from("awi_masters").select("id,project_id,task_id").in("id", ids).order("id").range(from, to)),
  ).catch(() => null);
  if (!rows) {
    return masters;
  }
  const sourceTaskIds = [...new Set(rows.map((row) => String(row.task_id)))];
  const sources = new Map<string, Task | undefined>();
  await Promise.all(sourceTaskIds.map(async (taskId) => {
    const source = await loadTaskGraph(supabase, taskId, includeTaskMedia).catch(() => null);
    sources.set(taskId, source ?? undefined);
  }));
  for (const row of rows) {
    masters.set(String(row.id), { projectId: String(row.project_id), taskId: String(row.task_id), source: sources.get(String(row.task_id)) });
  }
  return masters;
}

async function resolveLinkedAwiTasks(
  tasks: Task[],
  client: ReturnType<typeof plannerClient>,
  options: { includeTaskMedia: boolean },
): Promise<Task[]> {
  if (!tasks.some((task) => awiTaskLink(task))) {
    return tasks;
  }
  return applyLinkedAwiMasters(tasks, await loadLinkedAwiMasters(tasks, client, options));
}
```

3. Replace line 243 (`state.tasks = await Promise.all(...)`) with:

```ts
  state.tasks = await resolveLinkedAwiTasks(state.tasks, supabase, { includeTaskMedia });
```

4. `loadTaskPrivateMediaFromSupabase`'s `awi_link` branch keeps calling `loadTaskFromSupabase(taskId, projectId, supabase)`. Because that loader stays strict, an unavailable master rejects here, and the hydration caller's error and retry path runs. Do not catch it in this function.

- [ ] **Step 5: Re-export through the facade**

In `src/domain/supabase-planner.ts`, add `loadLinkedAwiMasters` to the existing re-export list for `@/lib/planner/read-store`.

- [ ] **Step 6: Show "master unavailable" on desktop**

In `src/components/line-workspace.tsx:2568`, replace the linked branch of `publishAction` (`selectedTask && awiTaskLink(selectedTask) ? <a …>Open master AWI</a> : …`) with:

```tsx
              publishAction={selectedTask && awiTaskLink(selectedTask) ? <>
                {selectedTask.awiMasterStatus === "unavailable" ? <span role="status" className="text-xs text-danger">Master AWI unavailable. Reload to retry.</span> : null}
                <a className="ui-btn-ghost h-9" href={`/awi/${awiTaskLink(selectedTask)!.masterId}?view=procedure&task=${encodeURIComponent(awiTaskLink(selectedTask)!.taskId)}`}>Open master AWI</a>
              </> : awiMaster ? <WorkInstructionsPanel compact isAwiMaster
```

(The rest of the expression is unchanged.)

- [ ] **Step 7: Run to see GREEN, plus every planner read test**

Run: `npx vitest run src/domain/supabase-planner.task-read.test.ts src/domain/supabase-planner.reads.test.ts src/domain/supabase-planner.core-load.test.ts src/domain src/components/line-workspace.sync.test.tsx`
Expected: PASS. The `full planner load` request list is unchanged. The sync "read counts" snapshot is unchanged.

Then: `npm run typecheck`. Expected: PASS. If a caller passed a fourth argument to `loadTaskFromSupabase`, remove it.

- [ ] **Step 8: Commit**

```bash
git add src/lib/planner/read-store.ts src/domain/supabase-planner.ts src/domain/supabase-planner.task-read.test.ts src/domain/supabase-planner.reads.test.ts src/components/line-workspace.tsx
git commit -m "perf: resolve linked AWI masters in one batch and stop one failure from failing the planner

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 8: Coalesced, navigation-safe linked-master refresh on return, and the picker copy

**Context:** `line-workspace.tsx:1252-1273` re-fetches every link on every window focus. It has no in-flight guard and no visibility check, makes one full load per link, and always replaces the task objects. Replace it with a small hook built on the existing `useRefreshOnReturn` (throttled, visibility-gated, in-flight guarded). It loads every master in one batched `loadLinkedAwiMasters` call and applies the result through `refreshLinkedAwiTasks`.

Applying is navigation-safe:
- **Scope check.** The response is discarded when the project or scenario on screen changed while it was in flight. This is the same contract as `isRefreshTargetCurrent` in `use-workspace-realtime.ts:106`.
- **Per-task baseline.** `refreshLinkedAwiTasks` only replaces a task whose procedure and master-derived duration are still the ones it showed when the refresh started. A fresher load (scenario switch-back, realtime full reload) that landed first always wins.
- **Same source on both sides.** The baseline is taken from the raw `plannerState` (the hook keeps its own ref), the same state `setPlannerState`'s updater compares against, so the derived-state calculations can never make the two sides disagree.

The hook lives in its own file because the race needs a delayed-response test, and the LineWorkspace coordinator cannot be driven that precisely.

Successor tasks are not rescheduled on refresh, which is the same as on load: the next schedule edit cascades. That is a recorded limitation, not part of this fix.

**Files:**
- Create: `src/components/line-workspace/use-linked-awi-refresh.ts`
- Test: `src/components/line-workspace/use-linked-awi-refresh.test.tsx`
- Modify: `src/components/line-workspace.tsx:1252-1273`, imports
- Modify: `src/components/line-workspace/add-task-menu.tsx:31` (copy)

**Interfaces:**
- Consumes: `loadLinkedAwiMasters` (Task 7, via the facade `@/domain/supabase-planner`), `awiTaskLink` and `refreshLinkedAwiTasks` (Task 3), `useRefreshOnReturn` from `@/lib/use-refresh-on-return`.
- Produces: `useLinkedAwiRefresh(options: { plannerState: PlannerState; setPlannerState: Dispatch<SetStateAction<PlannerState>> }): { refreshLinkedAwi: () => Promise<void> }`.

- [ ] **Step 1: Write the failing hook tests**

Create `src/components/line-workspace/use-linked-awi-refresh.test.tsx`:

```tsx
import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AWI_TASK_LINK_FIELD, withLinkedAwiProcedure, type LinkedAwiMaster } from "@/domain/awi-task-link";
import { emptyPlannerState } from "@/domain/empty-planner-state";
import { loadLinkedAwiMasters } from "@/domain/supabase-planner";
import type { ManufacturingStep, PlannerState, Task } from "@/domain/types";
import { useLinkedAwiRefresh } from "./use-linked-awi-refresh";

vi.mock("@/domain/supabase-planner", async (original) => ({
  ...await original<typeof import("@/domain/supabase-planner")>(),
  loadLinkedAwiMasters: vi.fn(),
}));

const START = "2026-10-01T08:00:00.000Z";
const LINK = { masterId: "master", projectId: "master-project", taskId: "master-task", documentNumber: "AWI-0001" };
const step = (id: string, durationMinutes: number) => ({ id, sequence: 1, name: id, instruction: id, durationMinutes }) as ManufacturingStep;
const masterWith = (steps: ManufacturingStep[]) =>
  ({ ...emptyPlannerState.tasks[0], id: "master-task", rowType: "task", customFields: {}, manufacturingSteps: steps, partReferences: [] }) as Task;
const linked = (id: string, master: Task) => withLinkedAwiProcedure(
  { ...emptyPlannerState.tasks[0], id, rowType: "task", plannedStart: START, plannedFinish: START, customFields: { [AWI_TASK_LINK_FIELD]: LINK } } as Task,
  master,
);
const stateFor = (scenarioId: string, tasks: Task[]): PlannerState => ({
  ...emptyPlannerState,
  product: { ...emptyPlannerState.product, projectId: "project-1" },
  scenario: { ...emptyPlannerState.scenario, id: scenarioId },
  tasks,
});
const mastersMap = (source: Task) => new Map<string, LinkedAwiMaster>([["master", { projectId: "master-project", taskId: "master-task", source }]]);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const oldMaster = masterWith([step("old", 5)]);
const newMaster = masterWith([step("new", 20)]);

function renderRefresh(initial: PlannerState) {
  return renderHook(() => {
    const [plannerState, setPlannerState] = useState(initial);
    const { refreshLinkedAwi } = useLinkedAwiRefresh({ plannerState, setPlannerState });
    return { plannerState, setPlannerState, refreshLinkedAwi };
  });
}

beforeEach(() => { vi.mocked(loadLinkedAwiMasters).mockReset(); });

describe("useLinkedAwiRefresh", () => {
  it("applies a changed master, with its derived time, in one batched read", async () => {
    vi.mocked(loadLinkedAwiMasters).mockResolvedValue(mastersMap(newMaster));
    const { result } = renderRefresh(stateFor("scenario-a", [linked("task-1", oldMaster), linked("task-2", oldMaster)]));
    await act(async () => { await result.current.refreshLinkedAwi(); });
    expect(loadLinkedAwiMasters).toHaveBeenCalledTimes(1);
    expect(result.current.plannerState.tasks.map((task) => task.plannedDurationMinutes)).toEqual([20, 20]);
  });

  it("drops a delayed response when the user switched scenario while it was in flight", async () => {
    const pending = deferred<Map<string, LinkedAwiMaster>>();
    vi.mocked(loadLinkedAwiMasters).mockReturnValue(pending.promise);
    const { result } = renderRefresh(stateFor("scenario-a", [linked("task-1", oldMaster)]));
    let refreshing!: Promise<void>;
    act(() => { refreshing = result.current.refreshLinkedAwi(); });
    // A switch lands first and shows freshly loaded master content for the other scenario.
    const switched = stateFor("scenario-b", [linked("task-1", newMaster)]);
    act(() => { result.current.setPlannerState(switched); });
    await act(async () => { pending.resolve(mastersMap(oldMaster)); await refreshing; });
    expect(result.current.plannerState).toBe(switched);
  });

  it("drops a delayed response when a fresher load replaced the linked procedure on the same scenario", async () => {
    const pending = deferred<Map<string, LinkedAwiMaster>>();
    vi.mocked(loadLinkedAwiMasters).mockReturnValue(pending.promise);
    const { result } = renderRefresh(stateFor("scenario-a", [linked("task-1", oldMaster)]));
    let refreshing!: Promise<void>;
    act(() => { refreshing = result.current.refreshLinkedAwi(); });
    const reloaded = stateFor("scenario-a", [linked("task-1", newMaster)]); // e.g. a realtime full reload
    act(() => { result.current.setPlannerState(reloaded); });
    await act(async () => { pending.resolve(mastersMap(oldMaster)); await refreshing; });
    expect(result.current.plannerState.tasks[0].manufacturingSteps?.[0]?.id).toBe("new");
  });

  it("drops a late duration-only response from a master with no steps", async () => {
    const noSteps = (plannedDurationMinutes: number) => ({ ...masterWith([]), plannedDurationMinutes }) as Task;
    const pending = deferred<Map<string, LinkedAwiMaster>>();
    vi.mocked(loadLinkedAwiMasters).mockReturnValue(pending.promise);
    const { result } = renderRefresh(stateFor("scenario-a", [linked("task-1", noSteps(5))]));
    let refreshing!: Promise<void>;
    act(() => { refreshing = result.current.refreshLinkedAwi(); });
    act(() => { result.current.setPlannerState(stateFor("scenario-a", [linked("task-1", noSteps(20))])); });
    await act(async () => { pending.resolve(mastersMap(noSteps(5))); await refreshing; });
    expect(result.current.plannerState.tasks[0].plannedDurationMinutes).toBe(20);
  });

  it("makes no request when no task is linked", async () => {
    const plain = { ...emptyPlannerState.tasks[0], id: "plain", rowType: "task", customFields: {} } as Task;
    const { result } = renderRefresh(stateFor("scenario-a", [plain]));
    await act(async () => { await result.current.refreshLinkedAwi(); });
    expect(loadLinkedAwiMasters).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to see RED**

Run: `npx vitest run src/components/line-workspace/use-linked-awi-refresh.test.tsx`
Expected: FAIL with `Cannot find module './use-linked-awi-refresh'`.

- [ ] **Step 3: Implement the hook**

Create `src/components/line-workspace/use-linked-awi-refresh.ts`:

```ts
"use client";

import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { awiTaskLink, refreshLinkedAwiTasks } from "@/domain/awi-task-link";
import { loadLinkedAwiMasters } from "@/domain/supabase-planner";
import type { PlannerState } from "@/domain/types";
import { useRefreshOnReturn } from "@/lib/use-refresh-on-return";

export type UseLinkedAwiRefreshOptions = {
  plannerState: PlannerState;
  setPlannerState: Dispatch<SetStateAction<PlannerState>>;
};

// Linked tasks show their master AWI's current procedure and time. When the user returns to the tab, reload
// every master in one batch (throttled, visibility-gated and never overlapping, via useRefreshOnReturn) and
// replace only linked tasks whose master changed. A response that lost a race is dropped: the project or
// scenario changed while it was in flight (same contract as isRefreshTargetCurrent in the realtime hook), or
// a fresher load replaced the task's procedure (refreshLinkedAwiTasks compares against `startedFrom`).
// A failed refresh keeps the current copy; the next return tries again. The baseline is the RAW planner
// state (this hook's own ref), the same state the setPlannerState updater compares against.
export function useLinkedAwiRefresh({ plannerState, setPlannerState }: UseLinkedAwiRefreshOptions) {
  const latestPlannerStateRef = useRef(plannerState);
  useEffect(() => {
    latestPlannerStateRef.current = plannerState;
  }, [plannerState]);

  async function refreshLinkedAwi() {
    const startedFrom = latestPlannerStateRef.current;
    const linkedTasks = startedFrom.tasks.filter((task) => Boolean(awiTaskLink(task)));
    if (linkedTasks.length === 0) return;
    const masters = await loadLinkedAwiMasters(linkedTasks);
    const now = latestPlannerStateRef.current;
    if (now.product.projectId !== startedFrom.product.projectId || now.scenario.id !== startedFrom.scenario.id) return;
    setPlannerState((current) => {
      const refreshed = refreshLinkedAwiTasks(current.tasks, masters, linkedTasks);
      return refreshed.changed ? { ...current, tasks: refreshed.tasks } : current;
    });
  }

  useRefreshOnReturn(refreshLinkedAwi, plannerState.tasks.some((task) => Boolean(awiTaskLink(task))));
  return { refreshLinkedAwi };
}
```

- [ ] **Step 4: Run to see GREEN**

Run: `npx vitest run src/components/line-workspace/use-linked-awi-refresh.test.tsx src/domain/awi-task-link.test.ts`
Expected: PASS.

- [ ] **Step 5: Replace the focus effect in LineWorkspace**

Delete the `linkedAwiSources` memo, `linkedAwiSourceKey` and the `useEffect` at `line-workspace.tsx:1253-1273`. Insert in their place:

```tsx
  useLinkedAwiRefresh({ plannerState, setPlannerState });
```

Add `import { useLinkedAwiRefresh } from "./line-workspace/use-linked-awi-refresh";` next to the other `./line-workspace/use-*` imports. Remove any import that is now unused. Lint will name it: `withLinkedAwiProcedure` stays (creation path), and `loadTaskFromSupabase` stays (picker).

- [ ] **Step 6: Update the picker copy**

In `src/components/line-workspace/add-task-menu.tsx:31`, change the paragraph text to:

```tsx
      <p className="mt-2 text-xs text-ink-secondary">Instructions and timing come from the master. Plan this task’s operators here.</p>
```

- [ ] **Step 7: Verify**

Run: `npx vitest run src/components/line-workspace src/components/line-workspace.sync.test.tsx src/components/line-workspace.lifecycle.test.tsx src/domain/awi-task-link.test.ts && npm run typecheck && npx eslint src/components/line-workspace.tsx src/components/line-workspace --max-warnings=0`
Expected: PASS. The sync test's focus and visibility call counts for media retry are unchanged, because a planner with no linked tasks registers no listener (`useRefreshOnReturn` is disabled).

- [ ] **Step 8: Commit**

```bash
git add src/components/line-workspace/use-linked-awi-refresh.ts src/components/line-workspace/use-linked-awi-refresh.test.tsx src/components/line-workspace.tsx src/components/line-workspace/add-task-menu.tsx
git commit -m "perf: refresh linked AWI masters once per return and drop responses that lost a race

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Branch D: `fix/settings-phone-portal` (from the tip of C)

### Task 9: Settings → Projects becomes Phone portal, on Product-scope groups

**Context:** Owner decision (1). `ProjectSettings` (create, rename, archive, remove) uses a stale pre-RBAC role rule and the legacy project-scope directory. The sidebar's Product Library owns the product lifecycle. Delete the lifecycle UI, keep `PhonePhotoPortalPanel`, and flip Settings to the `"product"` directory scope that the sidebar uses.
- There is no restore UI anywhere. Do not add or promise one.
- Keep the section at position 4: `embeddedSettingsSections = settingsSections.slice(0, 3)` must stay account / appearance / organization.

**Files:**
- Delete: `src/components/project-settings.tsx`
- Modify: `src/components/settings-navigation.tsx:3,10`
- Modify: `src/components/app-settings-panel.tsx:34-37, 571, 582-594`
- Modify: `src/components/workspace-invite-composer.tsx:170`
- Modify: `src/components/project-route-shells.tsx:114`, `app/settings/page.tsx:12`
- Test: `src/components/settings-navigation.test.ts` (new), `src/components/project-route-shells.test.tsx` (new), `app/settings/page.test.tsx` (new)

**Interfaces:**
- Produces: `SettingsSection` id `"phone-portal"` replaces `"projects"`.

- [ ] **Step 1: Branch and write the failing tests**

```bash
git switch -c fix/settings-phone-portal
```

`src/components/settings-navigation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { embeddedSettingsSections, settingsSections } from "./settings-navigation";

describe("settings sections", () => {
  it("offers a phone portal section and no project lifecycle section", () => {
    const ids = settingsSections.map((section) => section.id);
    expect(ids).toContain("phone-portal");
    expect(ids).not.toContain("projects");
  });

  it("keeps the planner's embedded settings to account, appearance and organization", () => {
    expect(embeddedSettingsSections.map((section) => section.id)).toEqual(["account", "appearance", "organization"]);
  });
});
```

`src/components/project-route-shells.test.tsx`:

```tsx
import { render } from "@testing-library/react";
import { expect, it, vi } from "vitest";

const gateProps = vi.hoisted(() => [] as Array<{ directoryScope?: string }>);
vi.mock("@/components/auth-project-gate", () => ({
  AuthProjectGate: (props: { directoryScope?: string }) => { gateProps.push(props); return null; },
}));

import { SettingsRouteShell } from "./project-route-shells";

it("loads Settings with the Product-scope directory the sidebar uses", () => {
  render(<SettingsRouteShell />);
  expect(gateProps.at(-1)?.directoryScope).toBe("product");
});
```

`app/settings/page.test.tsx`:

```tsx
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ groups: vi.fn(async () => undefined) }));
vi.mock("@/lib/supabase/server-data", () => ({ fetchInitialWorkspaceGroups: mocks.groups }));
vi.mock("@/components/project-route-shells", () => ({ SettingsRouteShell: () => null }));

import SettingsPage from "./page";

it("seeds Settings with the Product-scope directory", async () => {
  await SettingsPage();
  expect(mocks.groups).toHaveBeenCalledWith("product");
});
```

- [ ] **Step 2: Run to see RED**

Run: `npx vitest run src/components/settings-navigation.test.ts src/components/project-route-shells.test.tsx app/settings/page.test.tsx`
Expected: all three FAIL (`projects` is present; scope is `"project"`; called with no argument).

- [ ] **Step 3: Implement**

`src/components/settings-navigation.tsx`:
- In the lucide import, replace `FolderKanban` with `Smartphone`.
- Replace the `projects` entry with `{ id: "phone-portal", label: "Phone portal", icon: Smartphone },`, keeping its position.

`src/components/app-settings-panel.tsx`:
1. Replace the `ProjectSettings` dynamic import (lines 34-37) with:

```tsx
const PhonePhotoPortalPanel = dynamic(
  () => import("@/components/phone-photo-portal-panel").then((module) => module.PhonePhotoPortalPanel),
  { loading: () => <SettingsSectionLoadingContent /> },
);
```

2. Line 571, the Organization description: `description="Rename the organization, manage members, and control who can access each module."`.
3. Replace the Projects block (lines 582-594) with:

```tsx
        {mountedSections.has("phone-portal") ? (
          <div hidden={activeSection !== "phone-portal"} aria-hidden={activeSection !== "phone-portal"}>
          <SettingsPage title="Phone portal" description="Scan or share the link that opens photo capture on a phone.">
            <PhonePhotoPortalPanel />
          </SettingsPage>
          </div>
        ) : null}
```

`src/components/workspace-invite-composer.tsx:170`: change the sentence to `Choose an organization role, then grant only the modules and SOP duties they need.`

`src/components/project-route-shells.tsx:114`: `directoryScope="product"` in `SettingsRouteShell` only. Leave `ProductionRouteShell` alone.

`app/settings/page.tsx:12`: `return <SettingsRouteShell initialGroups={await fetchInitialWorkspaceGroups("product")} />;`.

Delete the lifecycle component:

```bash
git rm src/components/project-settings.tsx
```

- [ ] **Step 4: Verify**

Run: `npx vitest run src/components/settings-navigation.test.ts src/components/project-route-shells.test.tsx app/settings/page.test.tsx && npm run typecheck && npx eslint src/components app/settings --max-warnings=0`
Expected: PASS. Typecheck flags every leftover `"projects"` section reference. Fix each by switching it to `"phone-portal"`.

- [ ] **Step 5: Commit**

```bash
git add -A src/components/settings-navigation.tsx src/components/settings-navigation.test.ts src/components/app-settings-panel.tsx src/components/workspace-invite-composer.tsx src/components/project-route-shells.tsx src/components/project-route-shells.test.tsx app/settings/page.tsx app/settings/page.test.tsx src/components/project-settings.tsx
git commit -m "fix: replace Settings project lifecycle with the phone portal on Product-scope groups

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Branch E: `chore/delete-smart-allocation` (from the tip of D)

### Task 10: Characterize the live allocation path, then delete the dead smart-allocation surface

**Context:** Owner decision (3). The LLM allocation's client half was deleted in 2462bb4. The server half (route, IE solver, report-text builder, markdown report, playback, smoke script) has no caller, about 2,540 lines. The live path is untouched: `buildOperatorAssignmentsFromIePlan` feeds `buildUnallocatedWorkReviews`, and "Optimize line" uses `joint-scheduler`. Today the live path's only checks are two hand-run asserts in the smoke script being deleted, so port them first. Leave the names `smartAllocationPending`, `onSmartAllocate` and `isAllocating` alone.

**Files:**
- Create: `src/domain/operator-allocation.test.ts`
- Delete: `app/api/smart-allocation/route.ts`, `src/domain/ie-smart-allocation-solver.ts`, `src/domain/ie-smart-allocation-solver.test.ts`, `src/domain/playback.ts`, `src/domain/playback.test.ts`, `scripts/smart-allocation-smoke.ts`, `smart-allocation-status.md`
- Trim:
  - `src/domain/operator-allocation.ts`: `getTaskSuccessorCount`/`getTaskPriorityScore`/`compareTasksBySmartPriority` 104-128, `getOperatorScheduleContext` 155-203, `buildSmartOperatorAssignments` 655-887
  - `src/domain/smart-allocation-report.ts`: head 1-26, and 165-372
  - `src/domain/report.ts`: 49-212
  - `src/domain/ie-smart-allocation.ts`: keep only `IeSmartAllocationAssignment`
  - `src/domain/types.ts`: `PlaybackEvent` 429-435
  - `src/theme/chart-tokens.ts`: `taskTone` 49-72
  - `src/domain/formatting.ts`: `markdownCell`/`formatSignedMinutes` 36-51, plus their tests
  - `src/domain/smart-allocation-report.test.ts`: the `buildMarkdownTable` block
- Modify: `src/lib/api-auth.ts:108` (comment), `.env.example:3-4`, `scripts/backup-complete-app.mjs:34`, `src/components/line-workspace/analytics.tsx:501` (copy)
- Docs: strike prior Phase 2 #10 in `docs/audits/2026-10-08-structure-audit.md` (lines ~72, ~218, ~240), and one-line notes in `docs/edit-operation-inventory.md:1048` and `docs/tool-catalog-consistency-design.md:310`

Line numbers are at `e9dd1a3`. Earlier branches do not touch these files, but re-locate each block by its symbol before deleting.

- [ ] **Step 1: Branch and port the characterization tests (GREEN first: they describe live code)**

```bash
git switch -c chore/delete-smart-allocation
```

Create `src/domain/operator-allocation.test.ts`:

```ts
import { describe, expect, expectTypeOf, it } from "vitest";
import type { calculateProductKpis } from "./calculations";
import { buildOperatorAssignmentsFromIePlan } from "./operator-allocation";
import { buildUnallocatedWorkReviews, type SmartAllocationResult } from "./smart-allocation-report";
import type { Product, Task } from "./types";

const BASE = "2026-01-01T00:00:00.000Z";
const iso = (offsetMinutes: number) => new Date(Date.parse(BASE) + offsetMinutes * 60_000).toISOString();

function makeTask(id: string, opts: { dur: number; start?: number; operatorIds?: string[] }): Task {
  const start = opts.start ?? 0;
  return {
    id, scenarioId: "s1", stationId: "st1", rowType: "task", wbs: id, name: id,
    plannedStart: iso(start), plannedFinish: iso(start + opts.dur), plannedDurationMinutes: opts.dur,
    plannedOperators: (opts.operatorIds ?? []).length, plannedManHours: 0, status: "not_started", percentComplete: 0,
    dependencyIds: [], criticalPath: false, bottleneckFlag: false, qualityGate: false, travelerSignoffRequired: false,
    customFields: { operatorIds: opts.operatorIds ?? [] },
  };
}

describe("buildOperatorAssignmentsFromIePlan (live Gantt audit path)", () => {
  it("reports overlapping A/A assignments as a schedule_conflict", () => {
    const tasks = [makeTask("left", { dur: 120, start: 0 }), makeTask("right", { dur: 120, start: 60 })];
    const allocation = buildOperatorAssignmentsFromIePlan({
      assignments: [
        { taskId: "left", operatorIds: ["A"], rationale: "x" },
        { taskId: "right", operatorIds: ["A"], rationale: "x" },
      ],
      availableOperatorIds: ["A", "B"], demandQuantity: 1, operatorCapacityMinutes: 480, taktMinutes: 480, tasks,
    });
    expect(allocation.issues.some((issue) => issue.kind === "schedule_conflict")).toBe(true);
  });

  it("staffs non-overlapping work with no conflicts", () => {
    const tasks = [makeTask("first", { dur: 60, start: 0 }), makeTask("second", { dur: 60, start: 0 }), makeTask("third", { dur: 60, start: 60 })];
    const allocation = buildOperatorAssignmentsFromIePlan({
      assignments: [
        { taskId: "first", operatorIds: ["A"], rationale: "x" },
        { taskId: "second", operatorIds: ["B"], rationale: "x" },
        { taskId: "third", operatorIds: ["A"], rationale: "x" },
      ],
      availableOperatorIds: ["A", "B"], demandQuantity: 1, operatorCapacityMinutes: 480, taktMinutes: 480, tasks,
    });
    expect(allocation.issues.filter((issue) => issue.kind === "schedule_conflict")).toEqual([]);
  });

  it("turns an unstaffable 600-minute task into a Physically infeasible review", () => {
    const allocation = buildOperatorAssignmentsFromIePlan({
      assignments: [], availableOperatorIds: ["A"], demandQuantity: 1, operatorCapacityMinutes: 480, taktMinutes: 480,
      tasks: [makeTask("long", { dur: 600 })],
    });
    const reviews = buildUnallocatedWorkReviews({
      allocation,
      kpis: { taktMinutes: 0 } as unknown as ReturnType<typeof calculateProductKpis>,
      operatorCapacityMinutes: 480,
      product: { demandQuantity: 1, demandPeriod: "day" } as unknown as Product,
    });
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({ taskId: "long", classification: "Physically infeasible",
      condition: "Exceeds one-operator period capacity", action: "Split task / add capacity" });
  });

  it("types the review input as the live allocation result", () => {
    expectTypeOf<SmartAllocationResult>().toEqualTypeOf<ReturnType<typeof buildOperatorAssignmentsFromIePlan>>();
  });
});
```

Run: `npx vitest run src/domain/operator-allocation.test.ts && npm run typecheck`
Expected:
- The three runtime tests PASS. If one does not, read `buildUnassignedTaskIssue` (`operator-allocation.ts` ~442-450) and `buildUnallocatedWorkReviews` (`smart-allocation-report.ts` ~105-115), and correct the expectation to the live behaviour. These tests characterize the code; they do not change it.
- The `expectTypeOf` line fails typecheck only if the two result types differ today. If it fails, it turns green in Step 2, which is the point of the re-point.

- [ ] **Step 2: Re-point `SmartAllocationResult` before deleting its source**

Replace `src/domain/smart-allocation-report.ts` lines 1-26 with:

```ts
import {
  calculateProductKpis,
  formatMinutes,
  getTimelineBounds,
} from "./calculations";
import { formatRelativeFromBounds, periodLabel } from "./formatting";
import type { buildOperatorAssignmentsFromIePlan } from "./operator-allocation";
import type { Product } from "./types";

/**
 * Pure builder for the "unallocated required work" planning recommendations.
 */
export type SmartAllocationResult = ReturnType<typeof buildOperatorAssignmentsFromIePlan>;
```

Then delete lines 165-372 (`buildMarkdownTable` and `buildSmartAllocationReviewText`). In `src/domain/smart-allocation-report.test.ts`, change the import to `import { issueReviewLabel } from "./smart-allocation-report";` and delete the `describe("buildMarkdownTable", ...)` block.

Run: `npm run typecheck`. Expected: errors only in files this task deletes next (the route, the solver, the smoke script).

- [ ] **Step 3: Delete the dead files and blocks**

```bash
git rm app/api/smart-allocation/route.ts src/domain/ie-smart-allocation-solver.ts src/domain/ie-smart-allocation-solver.test.ts src/domain/playback.ts src/domain/playback.test.ts scripts/smart-allocation-smoke.ts smart-allocation-status.md
```

Then edit:
- `src/domain/operator-allocation.ts`:
  - Delete `getTaskSuccessorCount`, `getTaskPriorityScore`, `compareTasksBySmartPriority` (104-128).
  - Delete `getOperatorScheduleContext` (155-203).
  - Delete `buildSmartOperatorAssignments` (655-887).
  - Keep `sameOperatorIds` (129) and everything else. Imports are unchanged.
- `src/domain/report.ts`: delete `stationRows`, `taskRows`, `taskReferenceSections` and `buildMarkdownReport` (49-212). Imports are unchanged.
- `src/domain/ie-smart-allocation.ts`: replace the file with:

```ts
export interface IeSmartAllocationAssignment {
  taskId: string;
  operatorIds: string[];
  rationale: string;
}
```

- `src/domain/types.ts`: delete `export interface PlaybackEvent { … }` (429-435).
- `src/theme/chart-tokens.ts`: delete `taskTone` (49-72). Keep `groupTone` and the palette keys.
- `src/domain/formatting.ts`: delete `markdownCell` and `formatSignedMinutes` (36-51). In `src/domain/formatting.test.ts`, remove those two names from the import list and delete their two `describe` blocks.
- `src/lib/api-auth.ts:108`: reword the comment to `* Per-instance in-memory limiter. Good enough` (drop the route reference; keep the rest of the sentence).
- `.env.example`: delete the `OPENAI_API_KEY=` and `OPENAI_MODEL=` lines. Leave `supabase/config.toml` alone: its `openai_api_key` is Supabase Studio's.
- `scripts/backup-complete-app.mjs:34`: delete the `"smart-allocation-status.md",` entry.
- `src/components/line-workspace/analytics.tsx:501`: change `{hiddenCount} more in the Smart Allocation audit packet.` to `{hiddenCount} more not shown.`

- [ ] **Step 4: Prove nothing dead remains and nothing live broke**

Run:

```bash
grep -rInE "smart-allocation/|ie-smart-allocation-solver|buildSmartOperatorAssignments|buildSmartAllocationReviewText|buildPlaybackEvents|PlaybackEvent|taskTone|buildMarkdownReport|buildMarkdownTable|markdownCell|formatSignedMinutes|IeSmartAllocation(Plan|Request|Constraints|ReviewItem|OperatorSchedule)\b" src app scripts e2e tests
```

Expected: no output.
Then: `rm -rf .next tsconfig.tsbuildinfo && npm run typecheck && npm run lint && npm test`. Expected: PASS.

- [ ] **Step 5: Docs**

- `docs/audits/2026-10-08-structure-audit.md`: strike Phase 2 item 10 and the §2 row 20 "golden tests" text with `~~…~~`, and add `(obsolete 2026-10-10: targets deleted; see 2026-10-10 audit DOM-3)`.
- `docs/edit-operation-inventory.md:1048` and `docs/tool-catalog-consistency-design.md:310`: append ` (deleted 2026-10-10)` to the smart-allocation mention.
- Leave dated history docs (`docs/nextjs-refactor-plan.md`, `docs/history/*`, earlier plans) unchanged.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: delete the caller-less smart-allocation surface after characterizing the live path

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 11: Gate, live verification, merge, production migration

**Files:** none (verification and release).

- [ ] **Step 1: Full gate on the tip of E**

Run: `npm run build && npm run typecheck && npm run lint && npm test && npm run check:bundles`
Expected:
- All PASS.
- `check:bundles` still reports the 5 gated routes under 350 KiB. The SOP editor overage (PLAT-1) is a known, separate item.
- The planner entry should not grow. Note its size against the audit's 291.3 KiB.

- [ ] **Step 2: Live verification on a local stack (CLAUDE.md step 6; owner said browser CI stays off, not manual checks)**

Use the retained **`pulse-e2e`** stack exactly as in Task 6 Step 3 (identity check, start without reset, `verify-local-migration.mjs`, then `test db --db-url postgresql://postgres:postgres@127.0.0.1:56322/postgres`). Skip the apply if Task 6 already applied it, since the script refuses an applied version. Never a bare `--local` from the repo root (that is the separate `pulse` project on 55322).
1. Point the app at the same stack:
   - `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:56321`.
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` from `npx --yes supabase@2.119.0 status --workdir scratch/browser-db -o json`. Read it into the environment without printing it.
   - Fixtures need a `workspace_auto_join_domains` row and `user_metadata.full_name` (see memory `pulse-workspace-structure-refactor`).
2. Start the dev server through the Browser preview (`preview_start`), and drive:
   1. **Scenario switch-back.** Duplicate Main, switch to the copy, insert a task into Main from a second session (or SQL), switch back. The new task is visible. Rename any task, wait 1 s, reload: the inserted task is still there.
   2. **Link an AWI.** Link a master with steps into a product. The Gantt duration equals the master's step sum, its input is read-only, and the bar has width. The Procedure step "Move" menu does not list the linked task.
   3. **Phone.** Open `/projects/<id>/mobile-photos`, select the linked task. Notice shown; no Add step, no timer, no expand.
   4. **Master change.** Edit a master step's time in the AWI builder, return to the planner tab: the linked duration updates once (Network: one `awi_masters` request per return).
   5. **Unavailable.** Temporarily revoke your access to the master's AWI project, or simulate with SQL on the local stack, then reload. The planner opens, the linked task shows "Master AWI unavailable. Reload to retry.", and other tasks are editable.
   6. **Settings.** On `/settings`, the nav shows Phone portal (no Projects), and the portal QR renders. `/settings?section=projects` falls back to Account. The planner's embedded Settings is unchanged.

Capture a screenshot per check, and record any failure as a fix commit on the owning branch. Afterwards, return `pulse-e2e` to the running or stopped state it was in before (a plain `stop --workdir scratch/browser-db` keeps its volumes).

- [ ] **Step 3: Push and merge (owner approval required in chat before the first push)**

Push each branch (the push account note is in memory `pulse-github-push-account`). Let CI run, and fast-forward `main` through A → B → C → D → E, only on green (`checks` and `database` jobs). Delete each merged branch.

- [ ] **Step 4: Production (each sub-step needs explicit owner approval in chat)**

1. Read-only orphan query, so the owner sees rows written under linked tasks since 2026-10-09:

```sql
select 'manufacturing_steps' as child, count(*) from public.manufacturing_steps c join public.tasks t on t.id = c.task_id where jsonb_typeof(t.custom_fields->'awiMasterLink') = 'object'
union all select 'part_references', count(*) from public.part_references c join public.tasks t on t.id = c.task_id where jsonb_typeof(t.custom_fields->'awiMasterLink') = 'object'
union all select 'step_tools', count(*) from public.step_tools c join public.tasks t on t.id = c.task_id where jsonb_typeof(t.custom_fields->'awiMasterLink') = 'object'
union all select 'step_photos', count(*) from public.step_photos c join public.tasks t on t.id = c.task_id where c.deleted_at is null and jsonb_typeof(t.custom_fields->'awiMasterLink') = 'object';
```

Run via `npx supabase db query --linked`. Any cleanup is a separate, owner-approved step (`step_photos` is soft-delete).

2. Apply the migration with `node scripts/apply-migration-safely.mjs supabase/migrations/20261010190000_awi_link_child_guard.sql`. Then add its ledger row (the applier does not write it; audit PLAT-6). Confirm with `npx supabase db query --linked "select tgname, tgrelid::regclass from pg_trigger where tgname = 'awi_link_child_guard'"`. Expected: 6 rows.

3. Run `npm run gen:types`. Expected: no diff in `src/lib/database.types.ts`, because the migration adds nothing to `public`.

4. After the Vercel deploy of E: the owner unsets `OPENAI_API_KEY` and `OPENAI_MODEL` in Vercel if nothing else uses them.

- [ ] **Step 5: Record**

Update memory `pulse-structure-audit-2026-10` with the merge commits, the production apply, and the orphan-query result.

---

## Deliberately not in this plan (recorded so nobody re-derives them)

- **ERR-4 (realtime channel status ignored).** It folds into the planner save-session work (audit rows 31/46). The DRIFT-2 fix does not depend on it.
- **Batching master children across several distinct masters.** One graph load per distinct master is enough for today's counts. Revisit only if a product links many different masters.
- **Successor rescheduling when a master's duration changes.** It needs a separate owner decision; load and refresh do not cascade.
- **DEAD-3 (11 dead planner writers), PFMEA re-export (DEAD-2), bundle-guard coverage (PLAT-1), session ownership (RT-7/SURF-4).** These are the next candidates in the audit's Phase 1-3.
