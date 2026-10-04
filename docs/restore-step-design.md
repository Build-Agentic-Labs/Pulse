# Restore Step: data-preservation fix (proposal)

Status (2026-10-03): **Stage 1 implemented in the isolated database only** (`2277e69`, migration `20261003210000_step_recovery_and_tool_changes.sql`). It is not deployed to production and no client calls it yet. The client stage waits for approval of the messages in `docs/tool-catalog-consistency-design.md` §5c. No data has been changed or cleaned up.

### Stage 1 as built (differences from the proposal below)

- **Renumbering is kept.** Steps are labelled `Step {sequence}` in the portal, so a gap would be visible. Delete moves later steps up one and restore moves them back. Their content is untouched; their `version` changes with the position, as it always has on delete.
- **No foreign keys on the recovery table,** so a record outlives the step, task or project it describes. Nothing deletes or expires records:
  - clients can read them (project view access) and cannot change them (RLS, revoked grants, guard triggers for insert, update, delete and truncate);
  - only the two SECURITY DEFINER functions write them.
- **Part mentions are captured, and merged back on restore only if missing.** Delete does not edit the task row (unchanged from today's mobile behavior).
- **Deferred to the write-protocol proposal (§5b of the catalog design), not enabled:** the guard on `replace_task_children`. Guarding it alone would still let old phones write stale task rows before the refusal.

### Verification of stage 1 (retained isolated database, not reset)

- **Records preserved by the migration:** `scripts/verify-local-migration.mjs` applied the migration with its ledger row in one transaction. 9,588 pre-existing rows in 78 tables were unchanged, including 342 `auth.users` and 72 `storage.objects`. The only new table is the recovery table.
- **pgTAP `supabase/tests/step_recovery_test.sql`, 48/48:**
  - authorization on all three functions (anon, viewer, other organization);
  - delete removes exactly the step and its tool, photo and exploded view, and the record holds all four plus part mentions;
  - every other row is unchanged except later steps' positions; stale versions are refused; a delete retry returns the same record;
  - clients cannot alter records;
  - a teammate's interleaved edits, new step and tools survive a restore; the restored rows are identical to the originals;
  - a second restore changes nothing; restoring into a deleted process is refused and the record is kept;
  - tool diff semantics and ids.

  Seven targeted mutations are each caught. All 23 pgTAP files pass (446 assertions).
- **Two real sessions** (disposable fixtures):
  - a teammate's edit waits for a running delete, then lands on the moved step;
  - a restore and a teammate's appended step both survive;
  - a teammate who picks the position a restore just took gets a duplicate-position error (`23505`), with nothing partial;
  - two simultaneous restores of one record give one restore and one "already restored".
- **App gate:** 1,927 unit tests, lint, build, typecheck, and 20/20 browser cases.

### Original proposal (for reference)

This is a separate, focused fix, independent of the tool catalog work. The catalog rollout (`docs/tool-catalog-consistency-design.md` §5b) depends on it, because the old Restore path is one of the writers that wipes tool assignments.

## 1. What the current path does (verified on the real database)

### Method

The real functions ran with a signed-in user client against the retained isolated database (`scratch/browser-db`, not reset), using disposable fixtures:
- a fresh workspace, an editor user, and a product from `create_project_with_starter_plan`
- task A with steps A1 and A2; task B with step B1
- on each step: a tool, a photo (a real storage object) and an exploded view
- on each task: a part reference and an actual event
- a dependency A→B

The phone loaded the planner with `loadPlannerStateWithProjectFromSupabase`, as the portal does. Then **a teammate** added step B2 (with a tool) and edited A1's instruction.

The phone then:
1. deleted A2 exactly as `mobile-photo-portal.tsx:2858-2902` does (`saveTaskWithManufacturingStepsToSupabase`, after the portal's own `removeStepScopedCustomFields`);
2. pressed **Restore Step** (`restoreDeletedSnapshot`, `:2078`), which calls `savePlannerStateToSupabase(previousState)` and then re-saves every snapshot photo.

Rows were diffed by id before and after. The temporary test was not committed.

### Delete A2 (before Restore)

| Table | Effect |
|---|---|
| manufacturing_steps | A2 removed (intended). **A1 reverted from "Teammate edit" to the phone's stale text.** The task's full step list is upserted from the phone's copy. |
| step_tools / step_photos / step_exploded_views | A2's rows removed by FK cascade (intended) |
| others | unchanged |

### Restore Step, compared with the state before the delete

| Table | Effect |
|---|---|
| manufacturing_steps | **Teammate's B2 (a different task) deleted.** A1's teammate edit reverted. A1, A2 and B1 were deleted and re-inserted (`version` reset to 1, `created_at` reset). |
| step_tools | **Every assignment in both tasks deleted, none re-created** (A1, A2, B1 and the teammate's B2). This contradicts the prompt: "Restore will bring this manufacturing step back with its saved tools, part links, and available photos." |
| step_exploded_views | **All deleted** (A1, A2, B1); nothing restores them |
| step_photos | Deleted by cascade, then re-created from the phone's snapshot (`uploaded_by` becomes the restoring user). A photo a teammate added after the phone loaded would be lost. |
| part_references / actual_events / task_dependencies | Deleted and re-inserted from the snapshot. Anything added since the phone loaded would be lost. |
| tasks | Rows upserted from the snapshot (any teammate edits to task rows are lost too) |

### Why

`savePlannerStateToSupabase` is the full-state save. Its `replace_task_children` RPC (`20260601128000`) deletes **every** step, part, event and dependency of **every task in the scenario**. It then re-inserts the snapshot's copies. The live FKs `step_tools.step_id`, `step_photos.step_id` and `step_exploded_views.step_id` are `ON DELETE CASCADE` (checked in `pg_constraint`), and nothing re-creates tools or exploded views. The save also deletes tasks, zones and stations that are absent from the snapshot (behind the tripwire). CLAUDE.md already forbids new paths of this kind.

### Related

Desktop's `restoreTaskProcedureSnapshot` (`line-workspace.tsx:3617`) puts the whole task procedure back through the procedure save, which never writes tools or exploded views. It likely loses the restored step's tools as well. It was not exercised here and is **out of scope** for this fix; it can adopt the same RPC in a follow-up.

## 2. Proposed fix: a server-held deleted-step record and two RPCs

### Why the server holds the record

A client-held snapshot can be stale (that is today's bug). It can also be forged: a `step_photos.storage_path` pointing at another project's object would grant read access through the storage policy, which authorizes by that column. So the server records exactly what it deleted, in the same transaction, and Restore takes only that record's id.

### Database changes (need approval)

**1. New table `public.deleted_manufacturing_steps`:**
- columns: `id`, `project_id`, `task_id`, `step` (jsonb row), `children` (jsonb: `step_tools`, `step_photos` and `step_exploded_views` rows), `step_custom_fields` (jsonb: the step's entries in `tasks.custom_fields`, e.g. part mentions), `deleted_by`, `deleted_at`, `restored_at`
- RLS: select, insert and update with `has_project_access(project_id, 'edit')`; no delete policy
- no cleanup job (retention is a separate decision)

**2. `public.delete_manufacturing_step(p_step_id text, p_expected_version int) returns jsonb`**
- `SECURITY INVOKER`, `search_path ''`; `auth.uid()` must be set and `has_project_access(task_project_id(task), 'edit')` must hold (`42501`)
- locks the task's steps `for update`
- refuses a version mismatch (`40001`), so a stale phone cannot delete a step someone changed
- captures the step, its child rows and its custom-field entries into the new table, then deletes **only that step** (the cascade removes its children)
- renumbers only the later siblings' `sequence` (two-phase, avoiding `UNIQUE(task_id, sequence)`); never rewrites their content
- returns `{ deleted_step_id, record_id, siblings: [{id, sequence, version}] }`
- photo `deleted_at` handling stays as today; storage objects are not removed by a step delete (as today), so they are still there to restore

**3. `public.restore_manufacturing_step(p_record_id text) returns jsonb`**
- same access checks
- **idempotent:** if `restored_at` is set, or the step id already exists, return success with no change
- refuses if the task no longer exists (`P0002`, "This process was deleted")
- re-inserts the step at its original `sequence`, shifting only later siblings' `sequence`
- re-inserts exactly the captured `step_tools`, `step_photos` and `step_exploded_views` rows (same ids, names and storage paths)
- merges the step's `custom_fields` entries back only where absent
- sets `restored_at`; returns the restored step and its children for the client to apply
- does **not** touch other steps' content, other tasks, parts, events or dependencies

**4. Guard on `replace_task_children`.** It has one definition (`20260601128000`; `20260605130000` only mentions it in a comment) and no in-place patches. The migration still compares the live `pg_get_functiondef` against the checked-in body, and raises if they differ, before replacing it.
- raise `42501` "This page is out of date. Reload to keep editing." when it would delete any `step_tools`, `step_photos` or `step_exploded_views` row
- the only remaining caller after this fix is the desktop optimizer, which writes a freshly duplicated scenario; `duplicate_scenario` copies no steps or step media, so it is unaffected
- this enforces the fix for **old phones** that still run the old Restore

Writes to `step_tools` inside these RPCs set the tool-write flag from the catalog design (§5b), so they pass the step_tools fence.

### Client changes

- **`mobile-photo-portal.tsx` step delete:** call `delete_manufacturing_step` instead of `saveTaskWithManufacturingStepsToSupabase`. Apply the returned sibling sequences and versions locally, and keep the returned `record_id` in the restore prompt.
- **`restoreDeletedSnapshot`:** replace it with `restoreDeletedStep(recordId)`, which calls `restore_manufacturing_step` and merges only the returned step into local state. No `savePlannerStateToSupabase`, and no photo re-upload loop (the rows come back from the record).
- **`src/domain/supabase-planner.ts`:** wrappers for both RPCs, with error mapping.
- **`savePlannerStateToSupabase`:** no remaining mobile caller.

### Visible UI impact

- The prompt text stays as is (it becomes true).
- Restore of a step whose process was deleted shows "This process was deleted" instead of silently re-creating partial data.
- A delete refused for a version mismatch shows "This step changed on another device. Reload and try again." (new wording; **needs approval**).

## 3. Tests (database-backed)

### pgTAP: `supabase/tests/restore_manufacturing_step_test.sql`
- Delete captures exactly the step, its tools, photos and exploded views, and its custom-field entries. Sibling steps keep content and versions (only later sequences change). Other tasks are untouched.
- Restore re-creates the same rows (same ids and storage paths) at the original position. A sibling step added after the delete, a teammate's tool on another step, and another task's steps, parts, events and dependencies are all unchanged. Restoring twice is a no-op. Restoring into a deleted task raises `P0002`.
- Version mismatch on delete raises `40001`. Anonymous, view-only and other-workspace callers raise `42501`.
- The `replace_task_children` guard raises when step media exists and still works on a fresh duplicated scenario (optimizer).

### e2e on the retained database (disposable fixtures, durable rows checked)
- The exact sequence above: a phone loads, a teammate adds a step and tool and edits a sibling, the phone deletes a step and restores it. Assert every row, as the verification did, and that nothing else changed.
- After a reload the restored step shows its tools, photos and exploded views.

### Vitest
- The portal's delete and restore use the RPCs and never call the full-state save; local state merge keeps unrelated edits.

## 4. Deployment order and acceptance criteria

1. **Migration R1:** table, two RPCs, `replace_task_children` guard, pgTAP green in CI; then `gen:types`.
   *Acceptance:* pgTAP covers every case above; the optimizer e2e and the existing browser suite still pass.
2. **Client R2:** portal delete and restore through the RPCs.
   *Acceptance:* the e2e reproduction shows no row changes outside the deleted and restored step. Before the fix, the same e2e fails on B2, the tools and the exploded views.
3. **Old phones:** once R1 is live, an old Restore is refused by the guard with the reload message instead of wiping data. An old delete still uses the old save path, and its sibling-overwrite remains until the phone reloads. The step_tools fence in the catalog design (§5b) makes its tool sync fail loudly.

## 5. Not included

- No cleanup or backfill of data already lost by past restores.
- No retention or expiry job for deleted-step records.
- No change to desktop restore (follow-up).
- No change to the full-state save beyond removing its mobile caller.
