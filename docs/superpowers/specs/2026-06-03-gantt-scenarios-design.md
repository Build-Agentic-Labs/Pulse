# Gantt Scenarios — Design Spec

**Date:** 2026-06-03
**Status:** Reviewed — safeguards incorporated; ready for implementation plan
**Author:** Rosendo Lopez (with Claude)

> **Changelog (2026-06-03 review):** Added 7 safeguards from review — clearer tab labels, "copied from" traceability, auto-name-then-rename, **abort-switch-on-save-failure**, **photo storage reference guard**, **DB-level Main-delete guard**, and **progress/actuals reset on duplicate**. Documented "Main = earliest-created" as a temporary convention. Resolved the three implementation questions (§11).

## 1. Goal

Let a user maintain **multiple scenarios** for one product and toggle between them with a **tab strip inside the Gantt area** — no new page. Each scenario organizes the line for a different production target (e.g. *Main Plan = 2 units/week*, *500/yr Projection*). Switching tabs reflows the entire Gantt (tasks, layout, takt flagging) to the selected scenario.

**Two locked product decisions:**
1. **Independent snapshot.** Duplicating Main produces a complete, independent copy. Later edits to Main do **not** flow into the copy; edits to the copy never touch Main.
2. **Per-scenario target drives takt.** The active scenario's target (units + period) computes the takt the Gantt flags against. Main falls back to the existing product-level demand (zero regression).

## 2. Background — current state (verified in code)

- **Schema already supports scenarios.** `stations`, `zones`, `tasks`, `manufacturing_components` each carry a `scenario_id` FK; `manufacturing_steps`/`step_tools`/`step_photos`/`part_references`/`task_dependencies` hang off tasks. Each scenario already physically owns its data — isolation is guaranteed by the model.
- **App is hardwired to one scenario.** `supabase-planner.ts` loads scenarios `.eq("product_id", …).limit(1)` (~line 1889). No switcher, no create/duplicate/delete code.
- **Takt is product-scoped.** `calculateTaktMinutes(product)` (`calculations.ts` ~82–93) uses `product.demandQuantity`/`demandPeriod`/`manualTaktMinutes`. `scenario.targetOutput`/`targetOutputPeriod` columns **already exist, unused**.
- **Gantt is scenario-agnostic.** `gantt-timeline.tsx` receives already-filtered arrays from `line-workspace.tsx` (~line 9453). **No changes needed.**
- **Photos hard-delete storage by path.** `removeStepPhotoAttachmentObject()` (`supabase-planner.ts` 3164–3172) calls `storage.remove(paths)`. Row deletion elsewhere is a soft delete (`deleted_at`). This is the shared-storage landmine (§7.5).

## 3. Non-goals (YAGNI)

- No re-sync/merge from Main into a copy. No shared-procedure model. No URL routing in v1. No cross-product scenarios. No projection-only "read-only" mode in v1 (copies are fully editable — see §11). No table/column migration (only new RPC **functions**).

## 4. Architecture

### 4.1 "Main" scenario — temporary convention
Main = the **earliest-created** scenario for the product (matches today's `.limit(1)`). **This is a deliberate temporary convention to avoid a migration.** It is fragile if data is imported/restored/backfilled out of order.
- **Future hardening (not v1):** add an explicit `scenarios.is_main boolean` or `products.main_scenario_id`. Documented here so we replace the convention later rather than relying on `created_at` forever.
- UI labels it **"Main Plan"** and it is **undeletable at both UI and DB layers** (§7.6).

### 4.2 Switch behavior — reload-on-switch, **abort on save failure**
`plannerState` stays single-scenario and unchanged. We add `scenarios: ScenarioSummary[]` (`{id,name,targetOutput,targetOutputPeriod,createdAt,notes}`) and `activeScenarioId`.

Switch sequence (hard rules):
1. If current scenario is dirty → **save first**.
2. **If the save fails, ABORT the switch.** Show an error, stay on the current scenario, keep `activeScenarioId` unchanged. Never switch on a failed/partial save. *(Review safeguard #4 — must-have.)*
3. On save success (or not dirty) → reload full planner state for the chosen `scenarioId` via the existing load path.
4. Realtime subscription **unsubscribes + resubscribes** for the new scenario's task scope.
A brief loading state covers the reload.

### 4.3 Duplicate — server-side atomic RPC
`duplicate_scenario(p_source_scenario_id uuid, p_new_name text) returns uuid`, one transaction, `SECURITY DEFINER`, `search_path=''` (repo hardening pattern). Deep-copies in FK order with old→new ID maps:

1. New `scenarios` row — copy source fields, new id, `name=p_new_name`, copy `targetOutput`/`targetOutputPeriod`; set **`notes = 'Copied from ' || <source.name> || ' on ' || to_char(now(),'FMMonth DD, YYYY')`** *(traceability, safeguard #2)*.
2. `stations` → new ids, `scenario_id=new`, **keep `sequence`** (unique per scenario). Map.
3. `zones` → new ids. Map.
4. `manufacturing_components` → new ids, remap `zone_id`. Map.
5. `tasks` → new ids, `scenario_id=new`, remap `station_id`/`zone_id`/`component_id`/`parent_task_id`; keep `wbs`/`task_number`/`manufacturing_code` (unique per scenario). **Reset progress/actuals** *(safeguard #7):* `actual_start`, `actual_finish`, `actual_duration_minutes`, `actual_operators`, `actual_man_hours` → `null`; `percent_complete` → `0`; `status` → planned default. **Keep all `planned_*` baseline fields.** Map.
6. `manufacturing_steps` → new ids, remap `task_id`. Map.
7. `step_tools` → new ids, remap `task_id`+`step_id`.
8. `step_photos` → new ids, remap `task_id`+`step_id`. **Rows copied; `storage_path`/`thumbnail_storage_path` reused (no file copy)** → both scenarios reference the same images. See §7.5 for the deletion guard that makes this safe.
9. `task_dependencies` → new ids, remap predecessor/successor.
10. `part_references` → new ids, remap `task_id`.
11. **`actual_events` NOT copied** — a copy is a clean projection plan.
12. Scenario-scoped `custom_columns` copied with remapped `scenario_id`; product-scoped columns shared.

Returns the new `scenario_id`.

### 4.4 Delete — guarded RPC
`delete_scenario(p_scenario_id uuid)` (or guarded delete) **refuses if the target is the product's earliest-created (Main) or the only scenario** *(safeguard #6 — enforced at the DB layer, not just UI)*. On allowed delete, cascades remove the scenario's stations/zones/tasks/etc. Photo storage objects are handled by the §7.5 reference guard.

### 4.5 Takt wiring
`calculateActiveTaktMinutes(product, scenario)` in `calculations.ts`:
- `scenario.targetOutput > 0 && targetOutputPeriod` → `availabilityMinutesFor(product, scenario.targetOutputPeriod) / scenario.targetOutput`.
- else → `calculateTaktMinutes(product)` (Main's path; unchanged).
Generalize `calculateAvailabilityMinutesForDemandPeriod(product)` to accept an explicit `period` (default `product.demandPeriod`). Wire into KPI computation in `line-workspace.tsx` (~5389) so the existing `taktMinutes` Gantt prop reflects the active scenario. No Gantt change.

## 5. Components & data flow

```
LineWorkspace
 ├─ state: scenarios[] (summaries)         ← loadScenariosForProduct(productId)  [new]
 ├─ state: activeScenarioId
 ├─ state: plannerState (one scenario, UNCHANGED shape)
 ├─ kpis.taktMinutes = calculateActiveTaktMinutes(product, plannerState.scenario)  [changed]
 ├─ <ScenarioTabs                          [new]
 │     scenarios, activeScenarioId,
 │     onSwitch(id) /* abort-on-save-fail */, onDuplicate(),
 │     onRename(id,name), onDelete(id), onEditTarget(id,{units,period}) />
 └─ <GanttTimeline ... taktMinutes={kpis.taktMinutes} />   [UNCHANGED]
```

**New/changed files:**
| File | Change |
|---|---|
| `supabase/migrations/<ts>_scenario_rpcs.sql` | **new** — `duplicate_scenario()` + `delete_scenario()` guarded functions |
| `src/domain/supabase-planner.ts` | param `loadPlannerStateFromSupabase(projectId, scenarioId?)`; add `loadScenariosForProduct()`, `duplicateScenario()`, `renameScenario()`, `deleteScenario()`; realtime resubscribe; **reference guard in photo storage removal (§7.5)** |
| `src/domain/calculations.ts` | `calculateActiveTaktMinutes()`; generalize availability-by-period |
| `src/components/line-workspace.tsx` | scenarios state, activeScenarioId, switch (abort-on-fail)/duplicate/rename/delete/target handlers, takt wiring, render `<ScenarioTabs>` |
| `src/components/scenario-tabs.tsx` | **new** — tab strip UI |
| `src/domain/types.ts` | add `ScenarioSummary` |

## 6. UI

```
┌──────────────────────────────────────────────────────────────────┐
│ [ Main Plan ✓ ]  [ 500/yr Projection ▾ ]  [ + Duplicate ]         │
│                    └ "Copied from Main Plan on June 3, 2026"       │
│                                            Target: ▢▢▢ units /[yr▾]│
└──────────────────────────────────────────────────────────────────┘
```
- **Main Plan** pinned first, highlighted when active, **not deletable**. Non-main tabs carry a **"Projection"** badge and show the "Copied from … on …" note (from `scenario.notes`) on hover/subtitle. *(Labels per safeguard #1 — never bare "Scenario 2".)*
- **+ Duplicate** duplicates the **active** scenario, **auto-names it immediately** (`"<source> copy"`), switches to it, and puts the tab label into **inline-rename** so the user can retitle without a blocking modal. *(Safeguard #3.)*
- **Target** control (units + period dropdown) on the active non-main tab → updates `targetOutput`/`targetOutputPeriod`, recomputes takt live. Main shows **"from product"** (read-only) to keep the canonical link explicit.
- Rename via inline edit / small menu; delete via small menu (disabled for Main; confirm dialog).

## 7. Edge cases & safeguards

| # | Item | Handling |
|---|---|---|
| 1 | Users confuse copy with Main | Labels: "Main Plan" / "<name> · Projection"; copies never auto-update |
| 2 | "Why doesn't this match Main?" | Store `notes = "Copied from <Main> on <date>"`; show it in UI |
| 3 | Naming friction | Auto-name on duplicate → inline rename; no upfront prompt |
| 4 | **Switch after failed save** | **Abort switch on save failure; show error; stay on current scenario** |
| 5 | **Shared photo storage deletion** | Deletion stays row-scoped (soft `deleted_at`). Before `removeStepPhotoAttachmentObject` calls `storage.remove(paths)`, **check no other live `step_photos` row references the same `storage_path`/`thumbnail_storage_path`; only remove unreferenced paths.** Prevents a copy from deleting Main's image |
| 6 | **Deleting Main** | Blocked in UI **and** in `delete_scenario` RPC (refuses earliest/only scenario) |
| 7 | **Copied fake progress** | Duplicate resets `actual_*`, `percent_complete→0`, `status→planned`; keeps `planned_*` baseline. `actual_events` not copied |
| 8 | `.limit(1)` single-scenario assumption | Load path takes explicit `scenarioId`; absence → earliest (back-compat) |
| 9 | `UNIQUE(scenario_id, sequence)` stations | Sequences kept under new scenario_id (no cross-scenario clash) |
| 10 | FK remap (station/zone/component/parent) | old→new maps inside the RPC |
| 11 | Realtime stuck on old scenario | Unsubscribe + resubscribe on switch |
| 12 | Main convention fragility | Documented temporary; future `is_main`/`main_scenario_id` |

## 8. Test plan

- **Unit** (`calculations.test.ts`): `calculateActiveTaktMinutes` scenario-target vs product-fallback; period generalization.
- **Integration / domain:**
  - Load-by-`scenarioId` returns the correct isolated set.
  - **Isolation guarantee:** after `duplicateScenario` + editing a step in the copy, Main's `manufacturing_steps` rows are byte-identical; per-table copy counts match source; no cross-scenario FK references.
  - **Progress reset:** duplicated tasks have null actuals, `percent_complete=0`, planned baseline intact; no `actual_events` copied.
  - **Main-delete guard:** `delete_scenario` on the earliest/only scenario raises and deletes nothing.
  - **Photo ref guard:** deleting a copy's photo whose `storage_path` is still referenced by Main does **not** remove the storage object; deleting the last referencing row does.
  - **Save-fail-no-switch:** simulated save failure leaves `activeScenarioId` and loaded data unchanged.
- **Regression:** single-scenario product behaves exactly as today (load/save/takt).
- **Manual/E2E:** duplicate Main → "<name> Projection" tab → switch → same layout, zero progress → set target 500/yr → flagging changes → edit a step in copy → switch to Main → Main unchanged.

## 9. Rollout / risk

Additive only; no destructive schema change. New RPCs are `SECURITY DEFINER` + `search_path=''`. With one scenario, the app path is unchanged; the feature is gated behind the new tab strip.

## 10. Recommended implementation order (switch before duplicate)

1. `loadScenariosForProduct(productId)`.
2. Parameterize `loadPlannerStateFromSupabase(projectId, scenarioId?)`.
3. **Tab strip with read-only scenario switching first** (abort-on-save-fail) — prove clean load/switch.
4. `calculateActiveTaktMinutes(product, scenario)` + takt wiring.
5. Per-scenario target editing.
6. `duplicate_scenario` RPC + `duplicateScenario()` + photo ref guard.
7. `delete_scenario` (guarded) + rename — last.

## 11. Resolved decisions (from review questions)

1. **Does a duplicate copy task progress/status?** → **No — reset.** A copy is a clean projection: actuals/progress reset, planned baseline copied (§4.3 step 5, §7.7).
2. **Pure capacity projection, or a real plan later?** → **It is a full, editable, independent scenario.** Nothing technically locks it to projection; it can be promoted to a real plan later. "Projection" is a label/intent, not a constraint.
3. **Editable inside the copy, or projection-only mode?** → **Fully editable in v1**, visually badged **"Projection"** so it's never mistaken for the master plan. A read-only/projection-only toggle is a possible future addition, not v1.
