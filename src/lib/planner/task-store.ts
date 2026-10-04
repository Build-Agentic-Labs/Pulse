// Granular task and step writes: task rows (with batched step-tool sync), custom fields, photo markup
// merge, step sets with collision-safe sequence parking, single phone-step edits, field patches and
// procedure steps under version checks, the procedure save (AWI through its single transaction;
// otherwise version-checked with one retry on the merged server state), step moves between tasks,
// and task deletion with its storage cleanup. Every write asserts the task's project first. Moved
// verbatim from supabase-planner.ts (Phase 5); the facade re-exports the public names.

import { plannerClient } from "./client";
import {
  removeStorageObjects,
  stepPhotoBucket,
  type StorageObjectPathRow,
  storageObjectPaths,
  taskVideoBucket,
} from "./media-storage";
import { assertTaskInProject, assertTaskRowInProject, throwIfError } from "./query-helpers";
import { loadTaskFromSupabase } from "./read-store";
import {
  customFieldsRow,
  jsonObject,
  manufacturingStepRow,
  manufacturingStepRows,
  mapManufacturingStepRecord,
  mapTask,
  normalizeManufacturingStepSequences,
  num,
  partReferenceRows,
  procedureTaskUpdateRow,
  taskRow,
} from "./row-mappers";
import { syncStepToolsForTask, syncStepToolsForTasks } from "./tool-store";
import { awiProcedureSaveBaseline } from "@/domain/awi-procedure-save";
import { normalizePhotoAnnotationDocument } from "@/domain/photo-annotations";
import { getTaskStepPhotoAnnotationMap } from "@/domain/step-photos";
import { STEP_TOOL_LISTS_FIELD } from "@/domain/step-tools";
import { mergeTaskPrivateMedia } from "@/domain/task-private-media";
import type { ManufacturingStep, Task } from "@/domain/types";
import { saveAwiProcedure } from "@/lib/awi/procedure-store";
import type { Json, TablesUpdate } from "@/lib/database.types";
import { mergeAnnotationDocuments } from "@/lib/photo-annotation-drafts";
import type { SupabaseClient } from "@supabase/supabase-js";

function manufacturingStepSaveNeedsCollisionSafeResequence(
  nextSteps: ManufacturingStep[],
  existingSteps: Array<{ id: unknown; sequence: unknown }>,
): boolean {
  const normalizedNext = normalizeManufacturingStepSequences(nextSteps);
  const existingById = new Map(existingSteps.map((step) => [String(step.id), num(step.sequence)]));
  const nextIds = new Set(normalizedNext.map((step) => step.id));

  if (new Set(normalizedNext.map((step) => step.sequence)).size !== normalizedNext.length) {
    return true;
  }

  for (const step of normalizedNext) {
    const previousSequence = existingById.get(step.id);

    if (previousSequence === undefined) {
      const sequenceOccupied = existingSteps.some(
        (existingStep) =>
          nextIds.has(String(existingStep.id)) &&
          num(existingStep.sequence) === step.sequence &&
          String(existingStep.id) !== step.id,
      );
      if (sequenceOccupied) {
        return true;
      }
      continue;
    }

    if (previousSequence === step.sequence) {
      continue;
    }

    const sequenceOccupied = existingSteps.some(
      (existingStep) =>
        num(existingStep.sequence) === step.sequence &&
        String(existingStep.id) !== step.id &&
        nextIds.has(String(existingStep.id)),
    );
    if (sequenceOccupied) {
      return true;
    }
  }

  return false;
}

async function bumpManufacturingStepSequences(supabase: SupabaseClient, stepIds: string[]) {
  if (stepIds.length === 0) {
    return;
  }

  const currentSteps = await throwIfError(supabase.from("manufacturing_steps").select("id,sequence").in("id", stepIds));
  const maxSequence = Math.max(
    100000,
    ...(currentSteps ?? []).map((step) => num(step.sequence)),
  );
  const temporaryBaseSequence = maxSequence + stepIds.length + 1;

  await Promise.all(
    stepIds.map((stepId, index) =>
      throwIfError(supabase.from("manufacturing_steps").update({ sequence: temporaryBaseSequence + index }).eq("id", stepId)),
    ),
  );
}

export async function saveTasksToSupabase(tasks: Task[], projectId?: string) {
  if (tasks.length === 0) {
    return;
  }

  const supabase = plannerClient();
  await Promise.all(tasks.map((task) => assertTaskRowInProject(supabase, task, projectId)));
  await throwIfError(supabase.from("tasks").upsert(tasks.map(taskRow)));
  await syncStepToolsForTasks(supabase, tasks);
}

export async function saveTaskRowToSupabase(task: Task, projectId?: string) {
  const supabase = plannerClient();
  await assertTaskRowInProject(supabase, task, projectId);
  await throwIfError(supabase.from("tasks").upsert(taskRow(task)));
}

export async function saveTaskToSupabase(task: Task, projectId?: string) {
  await saveTasksToSupabase([task], projectId);
}

/** Save markup without rewriting steps, parts, or unrelated task metadata. */
export async function saveTaskPhotoAnnotationsToSupabase(task: Task, base: ReturnType<typeof getTaskStepPhotoAnnotationMap>, projectId?: string, providedClient?: SupabaseClient) {
  const supabase = providedClient ?? plannerClient();
  await assertTaskInProject(supabase, task.id, projectId);
  const local = getTaskStepPhotoAnnotationMap(task);
  const empty = normalizePhotoAnnotationDocument(undefined);
  const changedIds = [...new Set([...Object.keys(base), ...Object.keys(local)])].filter(
    id => JSON.stringify(base[id]?.items ?? []) !== JSON.stringify(local[id]?.items ?? []),
  );
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await throwIfError(supabase.from("tasks").select("custom_fields,version").eq("id", task.id).single());
    if (!row) throw new Error("Photo annotation task is no longer available.");
    const fields = row.custom_fields && typeof row.custom_fields === "object" && !Array.isArray(row.custom_fields)
      ? {...row.custom_fields} : {};
    const remote = getTaskStepPhotoAnnotationMap({customFields:fields});
    for (const id of changedIds) {
      const merged = mergeAnnotationDocuments(base[id] ?? empty, local[id] ?? empty, remote[id] ?? empty);
      if (merged.items.length) remote[id] = merged;
      else delete remote[id];
    }
    if (Object.keys(remote).length) fields.stepPhotoAnnotations = remote as unknown as Json;
    else delete fields.stepPhotoAnnotations;
    const saved = await throwIfError(supabase.from("tasks").update({custom_fields:fields})
      .eq("id",task.id).eq("version",row.version).select("version").maybeSingle());
    if (saved) return mergeTaskPrivateMedia({
      ...task, version: Number(saved.version),
      customFields: {...task.customFields, ...fields, stepPhotoAnnotations: remote},
    }, task);
  }
  throw new Error("Photo annotations changed during saving. Please try again.");
}

export async function saveTaskCustomFieldsToSupabase(taskId: string, customFields: Task["customFields"], projectId?: string) {
  const supabase = plannerClient();
  await assertTaskInProject(supabase, taskId, projectId);
  await throwIfError(supabase.from("tasks").update({ custom_fields: customFieldsRow(customFields) }).eq("id", taskId));
}

export async function saveTaskWithManufacturingStepsToSupabase(task: Task, projectId?: string) {
  const supabase = plannerClient();
  await assertTaskInProject(supabase, task.id, projectId);
  await throwIfError(supabase.from("tasks").upsert(taskRow(task)));
  const existingSteps = await throwIfError(supabase.from("manufacturing_steps").select("id").eq("task_id", task.id));
  const nextStepIds = (task.manufacturingSteps ?? []).map((step) => step.id);
  const staleStepIds = (existingSteps ?? [])
    .map((step) => String(step.id))
    .filter((stepId) => !nextStepIds.includes(stepId));

  if (existingSteps?.length) {
    await bumpManufacturingStepSequences(
      supabase,
      existingSteps.map((step) => String(step.id)),
    );
  }

  const steps = manufacturingStepRows([task]);
  if (steps.length) {
    await throwIfError(supabase.from("manufacturing_steps").upsert(steps));
  }

  if (staleStepIds.length) {
    await throwIfError(supabase.from("manufacturing_steps").delete().in("id", staleStepIds));
  }

  await syncStepToolsForTask(supabase, task, { allowEmptyWipe: true });
}

export async function saveTaskAndManufacturingStepToSupabase(task: Task, step: ManufacturingStep, projectId?: string) {
  const supabase = plannerClient();
  await assertTaskInProject(supabase, task.id, projectId);
  await throwIfError(supabase.from("tasks").upsert(taskRow(task)));
  await throwIfError(supabase.from("manufacturing_steps").upsert(manufacturingStepRow(task.id, step)));
}

/** Phone edits own individual step fields, never a stale copy of the entire procedure. */
export async function saveMobileStepToSupabase(
  task: Task,
  step: ManufacturingStep,
  patch: Partial<Pick<ManufacturingStep, "name" | "instruction" | "durationMinutes" | "qualityCheck">>,
  projectId?: string,
  providedClient?: ReturnType<typeof plannerClient>,
): Promise<ManufacturingStep> {
  const supabase = providedClient ?? plannerClient();
  await assertTaskRowInProject(supabase, task, projectId);
  const parent = await throwIfError(supabase.from("tasks").select("id").eq("id", task.id).maybeSingle());
  if (!parent) {
    if (task.version !== undefined) {
      throw new Error("This process is no longer available. Your draft has been kept.");
    }
    // A new local process must exist before any child write. Ignore a simultaneous
    // insert by another save, rather than replacing its metadata with our snapshot.
    await throwIfError(supabase.from("tasks").upsert(taskRow(task), { onConflict: "id", ignoreDuplicates: true }));
  }
  await assertTaskInProject(supabase, task.id, projectId);
  const fields: { name?: string; instruction?: string; duration_minutes?: number; quality_check?: string } = {};
  if (patch.name !== undefined) fields.name = patch.name;
  if (patch.instruction !== undefined) fields.instruction = patch.instruction;
  if (patch.durationMinutes !== undefined) fields.duration_minutes = patch.durationMinutes;
  if (patch.qualityCheck !== undefined) fields.quality_check = patch.qualityCheck;
  let saved: Record<string, unknown> | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const rows = await throwIfError(supabase.from("manufacturing_steps").select("*").eq("task_id", task.id));
    const existing = (rows ?? []).find((row) => String(row.id) === step.id);
    if (existing) {
      saved = Object.keys(fields).length
        ? await throwIfError(supabase.from("manufacturing_steps").update(fields).eq("id", step.id).eq("task_id", task.id).select("*").maybeSingle())
        : existing;
      break;
    }
    if (step.version !== undefined) {
      throw new Error("This step was deleted on another device. Your draft has been kept.");
    }
    const sequence = (rows ?? []).reduce((max, row) => Math.max(max, Number(row.sequence)), 0) + 1;
    const result = await supabase.from("manufacturing_steps").insert({ ...manufacturingStepRow(task.id, step), sequence }).select("*").maybeSingle();
    if (result.error?.code === "23505" && attempt < 2) continue;
    if (result.error) throw result.error;
    saved = result.data;
    break;
  }
  if (!saved) throw new Error("The step could not be saved. Your draft has been kept.");
  if (patch.durationMinutes !== undefined) {
    const rows = await throwIfError(supabase.from("manufacturing_steps").select("duration_minutes").eq("task_id", task.id));
    const minutes = (rows ?? []).reduce((total, row) => total + Math.max(Number(row.duration_minutes) || 0, 0), 0);
    await throwIfError(supabase.from("tasks").update({ planned_duration_minutes: minutes }).eq("id", task.id));
  }
  return mapManufacturingStepRecord(saved);
}

export async function saveManufacturingStepToSupabase(taskId: string, step: ManufacturingStep, projectId?: string) {
  // Merge the incoming step into the task's current step set and persist via the version-checked,
  // retry-on-conflict procedure path. The previous standalone read-then-upsert had a lost-update
  // window (audit #12): a concurrent write between the read and the upsert was silently
  // overwritten. saveProcedureTaskUpdateToSupabase performs per-step version checks and, on a
  // conflict, reloads the latest server state and re-applies -- so concurrent step edits to the
  // same task serialize instead of clobbering each other.
  const task = await loadTaskFromSupabase(taskId, projectId);
  if (!task) {
    throw new Error("Task not found or you do not have access to it.");
  }

  const existingSteps = task.manufacturingSteps ?? [];
  const mergedSteps = existingSteps.some((candidate) => candidate.id === step.id)
    ? existingSteps.map((candidate) =>
        // Apply the edit but keep the freshly-loaded server version so the optimistic check
        // (and its retry) is anchored to current state, not a stale client value.
        candidate.id === step.id ? { ...candidate, ...step, version: candidate.version } : candidate,
      )
    : [...existingSteps, step];

  await saveProcedureTaskUpdateToSupabase({ ...task, manufacturingSteps: mergedSteps }, [], projectId);
}

type TaskFieldPatch = Partial<
  Pick<
    Task,
    | "name"
    | "description"
    | "plannedStart"
    | "plannedFinish"
    | "plannedDurationMinutes"
    | "plannedOperators"
    | "plannedManHours"
    | "status"
    | "percentComplete"
    | "ownerId"
    | "ownerName"
    | "role"
    | "skillLevel"
    | "criticalPath"
    | "bottleneckFlag"
    | "qualityGate"
    | "travelerSignoffRequired"
    | "safetyNotes"
    | "qcChecklist"
    | "notes"
    | "zoneId"
    | "componentId"
    | "taskNumber"
    | "manufacturingCode"
    | "codeLocked"
    | "codeGeneratedAt"
    | "stationId"
    | "wbs"
  >
>;

function taskFieldPatchRow(patch: TaskFieldPatch) {
  const row: Record<string, unknown> = {};
  // Column names are constrained to the generated schema: a renamed or typo'd
  // column now fails to compile instead of silently no-oping at runtime.
  const setters: [keyof TaskFieldPatch, keyof TablesUpdate<"tasks"> & string][] = [
    ["name", "name"],
    ["description", "description"],
    ["plannedStart", "planned_start"],
    ["plannedFinish", "planned_finish"],
    ["plannedDurationMinutes", "planned_duration_minutes"],
    ["plannedOperators", "planned_operators"],
    ["plannedManHours", "planned_man_hours"],
    ["status", "status"],
    ["percentComplete", "percent_complete"],
    ["ownerId", "owner_id"],
    ["ownerName", "owner_name"],
    ["role", "role"],
    ["skillLevel", "skill_level"],
    ["criticalPath", "critical_path"],
    ["bottleneckFlag", "bottleneck_flag"],
    ["qualityGate", "quality_gate"],
    ["travelerSignoffRequired", "traveler_signoff_required"],
    ["safetyNotes", "safety_notes"],
    ["qcChecklist", "qc_checklist"],
    ["notes", "notes"],
    ["zoneId", "zone_id"],
    ["componentId", "component_id"],
    ["taskNumber", "task_number"],
    ["manufacturingCode", "manufacturing_code"],
    ["codeLocked", "code_locked"],
    ["codeGeneratedAt", "code_generated_at"],
    ["stationId", "station_id"],
    ["wbs", "wbs"],
  ];

  setters.forEach(([key, column]) => {
    if (patch[key] !== undefined) {
      row[column] = patch[key] ?? null;
    }
  });

  // Dynamic build above; the cast is safe because every key came from the
  // schema-constrained setters table.
  return row as TablesUpdate<"tasks">;
}

export async function updateTaskFields(taskId: string, patch: TaskFieldPatch, expectedVersion?: number, projectId?: string) {
  const supabase = plannerClient();
  const row = taskFieldPatchRow(patch);

  if (Object.keys(row).length === 0) {
    return;
  }

  await assertTaskInProject(supabase, taskId, projectId);
  let operation = supabase.from("tasks").update(row).eq("id", taskId);

  if (expectedVersion !== undefined) {
    operation = operation.eq("version", expectedVersion);
  }

  const saved = await throwIfError(operation.select("id,version").maybeSingle());
  if (!saved) {
    throw new Error("Task save conflict. Reload this task before saving again.");
  }
}

export async function upsertProcedureStep(taskId: string, step: ManufacturingStep, expectedVersion?: number, projectId?: string) {
  const supabase = plannerClient();
  await assertTaskInProject(supabase, taskId, projectId);

  if (expectedVersion === undefined) {
    await throwIfError(supabase.from("manufacturing_steps").upsert(manufacturingStepRow(taskId, step)));
    return;
  }

  const row = manufacturingStepRow(taskId, step);
  const saved = await throwIfError(
    supabase.from("manufacturing_steps").update(row).eq("id", step.id).eq("version", expectedVersion).select("id,version").maybeSingle(),
  );

  if (!saved) {
    throw new Error("Procedure step save conflict. Reload this task before saving again.");
  }
}

export async function reorderProcedureSteps(taskId: string, orderedStepIds: string[], projectId?: string) {
  if (orderedStepIds.length === 0) {
    return;
  }

  const supabase = plannerClient();
  await assertTaskInProject(supabase, taskId, projectId);
  // Atomic, single round-trip: the RPC does the two-phase sequence swap server-side inside one
  // transaction, so a partial failure can no longer leave steps with duplicate sequences.
  await throwIfError(
    supabase.rpc("reorder_manufacturing_steps", { p_task_id: taskId, p_step_ids: orderedStepIds }),
  );
}

export async function deletePlannerTask(taskId: string, projectId?: string) {
  const supabase = plannerClient();
  await assertTaskInProject(supabase, taskId, projectId);
  // Snapshot the task's storage object paths BEFORE the row delete: the FK cascade removes the
  // step_photos/step_exploded_views/task_videos rows, after which the paths are unrecoverable and
  // the objects would be orphaned in Storage. Soft-deleted rows are included on purpose -- the
  // cascade removes them too, so their objects would otherwise orphan as well.
  const [photoRows, explodedViewRows, videoRows] = await Promise.all([
    throwIfError(supabase.from("step_photos").select("storage_path,thumbnail_storage_path").eq("task_id", taskId)),
    throwIfError(supabase.from("step_exploded_views").select("storage_path,thumbnail_storage_path").eq("task_id", taskId)),
    throwIfError(supabase.from("task_videos").select("storage_path,thumbnail_storage_path").eq("task_id", taskId)),
  ]);
  // task_dependencies (both endpoints), manufacturing_steps, part_references, actual_events and
  // step_tools all FK to tasks ON DELETE CASCADE, so deleting the task atomically removes them.
  // The previous manual dependency deletes were redundant and opened a split-brain window
  // (edges gone, task still present) if the task delete then failed.
  await throwIfError(supabase.from("tasks").delete().eq("id", taskId));
  // Best-effort storage cleanup once the delete has committed (photos and exploded views share the
  // step-photos bucket; videos live in their own). Failures are logged, not thrown.
  await removeStorageObjects(
    supabase,
    stepPhotoBucket,
    storageObjectPaths([...((photoRows ?? []) as StorageObjectPathRow[]), ...((explodedViewRows ?? []) as StorageObjectPathRow[])]),
  );
  await removeStorageObjects(supabase, taskVideoBucket, storageObjectPaths((videoRows ?? []) as StorageObjectPathRow[]));
}

function mergeTaskWithServerVersions(localTask: Task, serverTask: Task): Task {
  const serverStepById = new Map((serverTask.manufacturingSteps ?? []).map((step) => [step.id, step]));
  const localStepIds = new Set((localTask.manufacturingSteps ?? []).map((step) => step.id));
  const mergedSteps = [
    ...(localTask.manufacturingSteps ?? []).map((step) => {
      const serverStep = serverStepById.get(step.id);
      return serverStep ? { ...serverStep, ...step, version: serverStep.version } : step;
    }),
    ...(serverTask.manufacturingSteps ?? []).filter((step) => !localStepIds.has(step.id)),
  ];

  return {
    ...serverTask,
    ...localTask,
    version: serverTask.version,
    manufacturingSteps: normalizeManufacturingStepSequences(
      mergedSteps.length > 0 ? mergedSteps : (serverTask.manufacturingSteps ?? []),
    ),
  };
}

export async function saveProcedureTaskUpdateToSupabase(
  task: Task,
  _scheduledTasks: Task[],
  projectId?: string,
  allowVersionRetry = true,
  client?: ReturnType<typeof plannerClient>,
) {
  const supabase = client ?? plannerClient();
  const normalizedSteps = normalizeManufacturingStepSequences(task.manufacturingSteps ?? []);
  const taskToSave = { ...task, manufacturingSteps: normalizedSteps };
  const taskProcedurePatch = procedureTaskUpdateRow(taskToSave);
  if (typeof task.customFields?.awiDocumentNumber === "string") {
    const baseline = task.procedureSaveBaseline ?? awiProcedureSaveBaseline(task);
    const awiProjectId = projectId ?? await throwIfError(supabase.rpc("task_project_id", { target_task_id: task.id }));
    if (!awiProjectId) throw new Error("This AWI does not belong to an active workspace.");
    const confirmed = jsonObject(await saveAwiProcedure({
      p_task_id: task.id,
      p_project_id: awiProjectId,
      p_expected_version: task.version ?? 0,
      p_expected_step_versions: baseline.stepVersions,
      p_expected_parts: partReferenceRows([{ ...task, partReferences: baseline.partReferences }]),
      p_task_patch: taskProcedurePatch,
      p_steps: manufacturingStepRows([taskToSave]),
      p_parts: partReferenceRows([taskToSave]),
    }, supabase));
    const confirmedRow = jsonObject(confirmed.task);
    if (confirmedRow.id !== task.id || typeof confirmedRow.version !== "number" ||
        !Array.isArray(confirmed.steps) || !Array.isArray(confirmed.parts)) {
      throw new Error("Unable to confirm the saved AWI. Your local draft is preserved; try saving again.");
    }
    const savedTask = mapTask({ ...confirmedRow, manufacturing_steps: confirmed.steps, part_references: confirmed.parts });
    // Media/tools are independently normalized rows; retain the snapshot's signed assets without
    // another read that might acknowledge a different edit committed after this transaction.
    const withMedia = mergeTaskPrivateMedia(savedTask, taskToSave);
    if (STEP_TOOL_LISTS_FIELD in taskToSave.customFields) {
      withMedia.customFields[STEP_TOOL_LISTS_FIELD] = taskToSave.customFields[STEP_TOOL_LISTS_FIELD];
    }
    return withMedia;
  }
  await assertTaskInProject(supabase, task.id, projectId);
  let taskUpdate = supabase.from("tasks").update(taskProcedurePatch).eq("id", task.id);

  if (taskToSave.version !== undefined) {
    taskUpdate = taskUpdate.eq("version", taskToSave.version);
  }

  const savedTask = await throwIfError(taskUpdate.select("id,version").maybeSingle());
  if (!savedTask) {
    if (allowVersionRetry && taskToSave.version !== undefined) {
      const latestTask = await loadTaskFromSupabase(taskToSave.id, projectId, supabase);
      if (latestTask) {
        return saveProcedureTaskUpdateToSupabase(
          mergeTaskWithServerVersions(taskToSave, latestTask),
          _scheduledTasks,
          projectId,
          false,
          client,
        );
      }
    }

    throw new Error("Task save conflict. Reload this task before saving again.");
  }

  const [existingSteps, existingParts] = await Promise.all([
    throwIfError(supabase.from("manufacturing_steps").select("id,sequence,version").eq("task_id", taskToSave.id)),
    throwIfError(supabase.from("part_references").select("id").eq("task_id", taskToSave.id)),
  ]);
  const existingStepById = new Map((existingSteps ?? []).map((step) => [String(step.id), step]));
  const nextStepIds = normalizedSteps.map((step) => step.id);
  const staleStepIds = (existingSteps ?? [])
    .map((step) => String(step.id))
    .filter((stepId) => !nextStepIds.includes(stepId));
  const nextPartIds = (taskToSave.partReferences ?? []).map((part) => part.id);
  const stalePartIds = (existingParts ?? [])
    .map((part) => String(part.id))
    .filter((partId) => !nextPartIds.includes(partId));

  const needsCollisionSafeResequence = manufacturingStepSaveNeedsCollisionSafeResequence(
    normalizedSteps,
    existingSteps ?? [],
  );

  if (staleStepIds.length) {
    await throwIfError(supabase.from("manufacturing_steps").delete().in("id", staleStepIds));
  }

  if (needsCollisionSafeResequence && existingSteps?.length) {
    await bumpManufacturingStepSequences(
      supabase,
      (existingSteps ?? []).map((step) => String(step.id)),
    );
  }

  for (const step of normalizedSteps) {
    const row = manufacturingStepRow(taskToSave.id, step);
    const existingStep = existingStepById.get(step.id);

    if (!existingStep || needsCollisionSafeResequence) {
      await throwIfError(supabase.from("manufacturing_steps").upsert(row));
      continue;
    }

    let stepUpdate = supabase.from("manufacturing_steps").update(row).eq("id", step.id);
    if (step.version !== undefined) {
      stepUpdate = stepUpdate.eq("version", step.version);
    }

    const savedStep = await throwIfError(stepUpdate.select("id,version").maybeSingle());
    if (!savedStep) {
      if (allowVersionRetry && step.version !== undefined) {
        const latestTask = await loadTaskFromSupabase(taskToSave.id, projectId, supabase);
        if (latestTask) {
          return saveProcedureTaskUpdateToSupabase(
            mergeTaskWithServerVersions(taskToSave, latestTask),
            _scheduledTasks,
            projectId,
            false,
            client,
          );
        }
      }

      throw new Error("Procedure step save conflict. Reload this task before saving again.");
    }
  }

  const parts = partReferenceRows([taskToSave]);
  if (parts.length) {
    await throwIfError(supabase.from("part_references").upsert(parts));
  }

  if (stalePartIds.length) {
    await throwIfError(supabase.from("part_references").delete().in("id", stalePartIds));
  }

  return loadTaskFromSupabase(taskToSave.id, projectId, supabase);
}

export async function moveManufacturingStepToTaskInSupabase(
  sourceTask: Task,
  targetTask: Task,
  stepId: string,
  scheduledTasks: Task[],
  projectId?: string,
) {
  const supabase = plannerClient();
  await assertTaskInProject(supabase, sourceTask.id, projectId);
  await assertTaskInProject(supabase, targetTask.id, projectId);

  const movedStep = targetTask.manufacturingSteps?.find((step) => step.id === stepId);
  if (!movedStep) {
    throw new Error("Unable to find the manufacturing step to move.");
  }

  const targetExistingSteps =
    (await throwIfError(supabase.from("manufacturing_steps").select("id").eq("task_id", targetTask.id))) ?? [];

  if (targetExistingSteps.length > 0) {
    await bumpManufacturingStepSequences(
      supabase,
      targetExistingSteps.map((step) => String(step.id)),
    );
  }

  await throwIfError(
    supabase
      .from("manufacturing_steps")
      .update({ task_id: targetTask.id, sequence: 200000 })
      .eq("id", stepId),
  );

  await throwIfError(supabase.from("step_tools").update({ task_id: targetTask.id }).eq("step_id", stepId));
  await throwIfError(
    supabase.from("step_photos").update({ task_id: targetTask.id }).eq("step_id", stepId).is("deleted_at", null),
  );
  // Exploded views are task-level (step_id is null), so a step move does not carry them.

  await saveProcedureTaskUpdateToSupabase(sourceTask, scheduledTasks, projectId);
  await saveProcedureTaskUpdateToSupabase(targetTask, scheduledTasks, projectId);
}

export async function mergeLatestTaskToSupabase(taskId: string, updateTask: (task: Task) => Task, projectId?: string): Promise<Task | null> {
  const latestTask = await loadTaskFromSupabase(taskId, projectId);
  if (!latestTask) {
    return null;
  }

  const nextTask = updateTask(latestTask);
  await saveTaskToSupabase(nextTask, projectId);
  return nextTask;
}
