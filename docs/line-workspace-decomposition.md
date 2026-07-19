# line-workspace.tsx decomposition — execution plan

Status: NOT STARTED. Parked by design after the 2026-07 refactor (no forcing
seam, no performance payoff — the file is already its own lazy chunk). This is
a maintainability-only change. Run it as a dedicated session with nothing else
in flight.

## Ground rules

1. **Pure moves only.** No behavior edits, no renames, no "while I'm here"
   improvements. If an extraction requires touching internal logic, STOP and
   leave that seam for another day.
2. **One cohesive family per commit**, typecheck + lint + tests green after
   each. Any commit can be reverted alone.
3. The typechecker is the referee: a move either compiles identically or it
   reverts. Never force a move with casts.
4. Target layout: extract into `src/components/line-workspace/` (new folder).
   `src/components/line-workspace.tsx` STAYS at its current path — the dynamic
   import in project-route-shells.tsx and the CSS import must not move.
5. Live QA after each commit: dashboard, gantt, procedure, setup views, the
   task detail drawer, and playback (`?view=` URLs). The planner CSS extraction
   proved screenshots catch what tests cannot.

## What the file contains (audit map — line numbers approximate, re-grep first)

The file is ~27 components, most of them STANDALONE top-level functions (not
closures over LineWorkspace state) — that is what makes file-by-file extraction
safe. The main `LineWorkspace` component (~5,400 lines, the second half of the
file) is a single closure and is NOT split in this plan.

Extraction order, leaf-most first:

| Order | Family | Contents (grep anchors) | Risk |
|---|---|---|---|
| 1 | analytics/ | KPI/zone/crew/readiness panels (`ZoneMetrics`, `CrewPlan`, readiness workspace — the region that contained `_StationBalance` before deletion) | Lowest: pure props-in, JSX-out |
| 2 | setup-panels/ | The 4 setup panels (`ProductSetupPanel`, document control, procedure checks, tools — anchors: `ui-product-setup`, `ui-setup-page`) | Low |
| 3 | drawer/ | Task detail drawer (~858 lines, anchor: detail drawer / `ui-workspace-content`) | Low-medium: check which callbacks it receives vs closes over |
| 4 | procedure/ | Procedure workspace family (~1,034 lines, anchor: `ui-procedure-main`) | Medium: check shared helpers with the main component |
| 5 | nav/ | Top nav + sidebar + presence UI | Medium: reads several LineWorkspace props |
| 6 | state helpers | localStorage snapshot persistence + procedure draft queue (anchors: `readWorkspaceSnapshot`, `procedureDraftLog`, `makeProcedureDraftKey`) → `line-workspace/state.ts` | Medium: module-scope, imported back |

## Traps known in advance

- **Module-scope caches move WITH their users or get imported.**
  `sopSummariesSessionCache` (+ `sopSummaryLabel`, the lazy SOP picker loader)
  is module state by design — if the drawer uses it, export it from the new
  module and import it back; do not duplicate it.
- **The server-seed machinery stays in the main file**: `initialPlannerState`
  prop, `initialPlannerStateRef`, `consumedInitialPlannerStateForRef`, and the
  load effect's `applyLoadedPlannerState` are load-bearing Stage 5 pieces.
- **The CSS import (`./line-workspace.css`) stays at the top of the main file.**
  Extracted components rely on it loading with the chunk.
- **Helpers used by both an extracted family and the main component** go to
  `line-workspace/shared.ts`, not copied.
- Props typing: extracted components keep their EXACT current prop shapes even
  where a narrower type would be "better".

## Per-family procedure

1. Re-grep the family's current line range and its top-level function names.
2. Identify every identifier the family references that is defined elsewhere in
   the file (helpers, types, module state). Classify: moves with family /
   stays and gets exported / already imported from elsewhere.
3. Create `src/components/line-workspace/<family>.tsx`, move the functions
   verbatim, add imports; in the main file, import back and delete the moved
   code.
4. `npm run typecheck` → `npm run lint` → `npm test` → live QA the affected
   view → commit (`refactor(line-workspace): extract <family>`).

## Definition of done

- line-workspace.tsx contains: imports, the CSS import, module-scope state that
  genuinely belongs to the main component, and the `LineWorkspace` component.
  Expect roughly 5,500-6,000 lines remaining — that is SUCCESS, not failure;
  the main closure is out of scope.
- No diff in behavior, bundle route sizes within noise, all planner views
  visually identical.
