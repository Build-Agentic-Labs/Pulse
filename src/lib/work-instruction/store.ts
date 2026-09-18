/**
 * Work instruction document control — data access.
 *
 * Releases are immutable rows written granularly (one INSERT per release); nothing here goes near
 * the planner's full-state save. Every function takes an optional client so the same read can
 * serve the browser and a server component.
 *
 * Spec: docs/superpowers/specs/2026-09-18-work-instruction-release-design.md
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createPlannerSupabaseClient } from "@/domain/supabase-planner";
import {
  normalizeReferenceInput,
  type ReferenceInput,
  type WorkInstructionReferenceRecord,
} from "@/domain/work-instruction/references";
import {
  fingerprintWorkInstruction,
  frozenPhotoPath,
  snapshotForRelease,
  validateReleaseInput,
  type ReleaseInput,
  type WorkInstructionRelease,
  type WorkInstructionReleaseSummary,
} from "@/domain/work-instruction/release";
import type { WorkInstruction, WorkInstructionReferenceKind } from "@/domain/work-instruction/schema";
import type { Database, Json } from "@/lib/database.types";
import { throwIfError } from "@/lib/supabase-errors";

const STEP_PHOTO_BUCKET = "step-photos";

const RELEASE_SUMMARY_COLUMNS =
  "id, task_id, revision_index, revision, document_number, title, change_description, effective_date, content_hash, text_hash, released_by, released_by_name, released_at";

type ReleaseSummaryRow = Pick<
  Database["public"]["Tables"]["work_instruction_releases"]["Row"],
  | "id"
  | "task_id"
  | "revision_index"
  | "revision"
  | "document_number"
  | "title"
  | "change_description"
  | "effective_date"
  | "content_hash"
  | "text_hash"
  | "released_by"
  | "released_by_name"
  | "released_at"
>;

function mapReleaseSummary(row: ReleaseSummaryRow): WorkInstructionReleaseSummary {
  return {
    id: row.id,
    taskId: row.task_id,
    revisionIndex: row.revision_index,
    revision: row.revision,
    documentNumber: row.document_number,
    title: row.title,
    changeDescription: row.change_description,
    effectiveDate: row.effective_date,
    contentHash: row.content_hash,
    textHash: row.text_hash,
    releasedBy: row.released_by,
    releasedByName: row.released_by_name,
    releasedAt: row.released_at,
  };
}

/**
 * Every release of every work instruction in a project, WITHOUT the frozen documents — enough to
 * show revision state and history for a whole line in one small read.
 */
export async function listWorkInstructionReleases(
  projectId: string,
  client?: SupabaseClient<Database>,
): Promise<WorkInstructionReleaseSummary[]> {
  const supabase = client ?? createPlannerSupabaseClient();
  const rows = await throwIfError(
    supabase
      .from("work_instruction_releases")
      .select(RELEASE_SUMMARY_COLUMNS)
      .eq("project_id", projectId)
      .order("task_id")
      .order("revision_index"),
  );
  return (rows ?? []).map(mapReleaseSummary);
}

/** One release with its frozen document, for viewing or printing it exactly as released. */
export async function getWorkInstructionRelease(
  releaseId: string,
  client?: SupabaseClient<Database>,
): Promise<WorkInstructionRelease | null> {
  const supabase = client ?? createPlannerSupabaseClient();
  const row = await throwIfError(
    supabase.from("work_instruction_releases").select(`${RELEASE_SUMMARY_COLUMNS}, content`).eq("id", releaseId).maybeSingle(),
  );
  if (!row) return null;
  return { ...mapReleaseSummary(row), content: row.content as unknown as WorkInstruction };
}

function newBatchId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `batch-${Date.now().toString(36)}`;
}

/**
 * Give the release its own copy of each step photo (a server-side Storage copy — no bytes cross
 * the network), so removing a photo from the step later cannot break the released document.
 * A copy that fails is not fatal: that photo is referenced in place instead.
 */
async function freezePhotos(
  supabase: SupabaseClient<Database>,
  instruction: WorkInstruction,
): Promise<{ frozen: Map<string, string>; copiedPaths: string[] }> {
  const frozen = new Map<string, string>();
  const copiedPaths: string[] = [];
  const batchId = newBatchId();
  for (const card of instruction.cards) {
    const photo = card.photo;
    if (!photo?.storagePath || frozen.has(photo.id)) continue;
    const destination = frozenPhotoPath(photo.storagePath, instruction.taskId, batchId, photo.id);
    if (!destination) continue;
    const { error } = await supabase.storage.from(STEP_PHOTO_BUCKET).copy(photo.storagePath, destination);
    if (error) {
      console.warn(`Work instruction release: could not freeze photo ${photo.id}: ${error.message}`);
      continue;
    }
    frozen.set(photo.id, destination);
    copiedPaths.push(destination);
  }
  return { frozen, copiedPaths };
}

/**
 * Release the instruction as its next revision. `instruction` MUST be the live DEFAULT-LAYOUT
 * build (the fingerprint and the frozen cards both depend on it). The database assigns the
 * revision letter, the releaser and the timestamp; nothing the client sends can override them.
 */
export async function releaseWorkInstruction(
  input: { projectId: string; instruction: WorkInstruction } & ReleaseInput,
  client?: SupabaseClient<Database>,
): Promise<WorkInstructionReleaseSummary> {
  const invalid = validateReleaseInput(input);
  if (invalid) throw new Error(invalid);

  const supabase = client ?? createPlannerSupabaseClient();
  const { frozen, copiedPaths } = await freezePhotos(supabase, input.instruction);
  const content = snapshotForRelease(input.instruction, frozen);

  try {
    const row = await throwIfError(
      supabase
        .from("work_instruction_releases")
        .insert({
          project_id: input.projectId,
          task_id: input.instruction.taskId,
          document_number: input.instruction.meta.documentNumber,
          title: input.instruction.meta.title,
          change_description: input.changeDescription.trim(),
          effective_date: input.effectiveDate,
          content: content as unknown as Json,
          content_hash: fingerprintWorkInstruction(input.instruction),
          text_hash: fingerprintWorkInstruction(input.instruction, { photos: false }),
        })
        .select(RELEASE_SUMMARY_COLUMNS)
        .single(),
    );
    if (!row) throw new Error("The release was not saved. Try again.");
    return mapReleaseSummary(row);
  } catch (caught) {
    // The release did not happen, so its photo copies reference nothing.
    if (copiedPaths.length > 0) {
      await supabase.storage.from(STEP_PHOTO_BUCKET).remove(copiedPaths).catch(() => undefined);
    }
    throw caught;
  }
}

const REFERENCE_COLUMNS = "id, task_id, kind, sop_id, document_number, title, url, position";

type ReferenceRow = Pick<
  Database["public"]["Tables"]["work_instruction_references"]["Row"],
  "id" | "task_id" | "kind" | "sop_id" | "document_number" | "title" | "url" | "position"
>;

function mapReference(row: ReferenceRow): WorkInstructionReferenceRecord {
  return {
    id: row.id,
    taskId: row.task_id,
    kind: row.kind as WorkInstructionReferenceKind,
    sopId: row.sop_id,
    documentNumber: row.document_number,
    title: row.title,
    url: row.url,
    position: row.position,
  };
}

/**
 * Every reference in a project, with SOP references resolved to the SOP's CURRENT number, title
 * and version (two queries total, however many references). An SOP the caller can no longer read
 * simply stays unresolved and the row's stored label is used.
 */
export async function listWorkInstructionReferences(
  projectId: string,
  client?: SupabaseClient<Database>,
): Promise<WorkInstructionReferenceRecord[]> {
  const supabase = client ?? createPlannerSupabaseClient();
  const rows = await throwIfError(
    supabase.from("work_instruction_references").select(REFERENCE_COLUMNS).eq("project_id", projectId).order("position").order("id"),
  );
  const records = (rows ?? []).map(mapReference);
  const sopIds = [...new Set(records.map((record) => record.sopId).filter((id): id is string => Boolean(id)))];
  if (sopIds.length === 0) return records;

  const { data: sops } = await supabase.from("sops").select("id, sop_number, title, version, status").in("id", sopIds).is("deleted_at", null);
  const sopById = new Map((sops ?? []).map((sop) => [sop.id, sop]));
  return records.map((record) => {
    const sop = record.sopId ? sopById.get(record.sopId) : undefined;
    return sop
      ? { ...record, sop: { number: sop.sop_number ?? "", title: sop.title ?? "", version: sop.version ?? "", status: sop.status } }
      : record;
  });
}

export async function addWorkInstructionReference(
  target: { projectId: string; taskId: string; position: number },
  input: ReferenceInput,
  client?: SupabaseClient<Database>,
): Promise<void> {
  const normalized = normalizeReferenceInput(input);
  if ("error" in normalized) throw new Error(normalized.error);
  const supabase = client ?? createPlannerSupabaseClient();
  await throwIfError(
    supabase.from("work_instruction_references").insert({
      project_id: target.projectId,
      task_id: target.taskId,
      position: target.position,
      kind: normalized.value.kind,
      sop_id: normalized.value.sopId,
      document_number: normalized.value.documentNumber,
      title: normalized.value.title,
      url: normalized.value.url,
    }),
  );
}

export async function removeWorkInstructionReference(referenceId: string, client?: SupabaseClient<Database>): Promise<void> {
  const supabase = client ?? createPlannerSupabaseClient();
  await throwIfError(supabase.from("work_instruction_references").delete().eq("id", referenceId));
}

/** SOPs a work instruction in this project may reference: its own organization's, newest first. */
export async function listReferenceableSops(
  projectId: string,
  client?: SupabaseClient<Database>,
): Promise<Array<{ id: string; number: string; title: string; version: string; status: string }>> {
  const supabase = client ?? createPlannerSupabaseClient();
  const project = await throwIfError(supabase.from("projects").select("workspace_id").eq("id", projectId).maybeSingle());
  if (!project?.workspace_id) return [];
  const rows = await throwIfError(
    supabase
      .from("sops")
      .select("id, sop_number, title, version, status")
      .eq("workspace_id", project.workspace_id)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(500),
  );
  return (rows ?? []).map((sop) => ({
    id: sop.id,
    number: sop.sop_number ?? "",
    title: sop.title ?? "Untitled SOP",
    version: sop.version ?? "",
    status: sop.status,
  }));
}
