/**
 * Store layer for SOP document control: reading control-column state, minting DEPT-TYPE-NNN
 * numbers, recording e-signatures, and driving lifecycle transitions. The database triggers
 * (enforce_sop_transition) and definer functions (next_sop_number, sign_sop) are the real gate;
 * this layer only shapes calls and surfaces the trigger's readable error messages.
 */

import type { SopStatus } from "@/domain/sop/schema";
import { createPlannerSupabaseClient } from "@/domain/supabase-planner";
import { SopConflictError } from "./store";

const CONTROL_COLUMNS =
  "id, workspace_id, department_id, status, sop_number, doc_type, version, major_version, minor_version, " +
  "submitted_by, approved_by, approved_at, effective_date, next_review_date, effective_revision_id, " +
  "rejected_reason, created_by, updated_at";

export interface SopControl {
  id: string;
  workspaceId: string;
  departmentId: string | null;
  status: SopStatus;
  sopNumber: string;
  docType: string;
  version: string;
  submittedBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  effectiveDate: string | null;
  nextReviewDate: string | null;
  effectiveRevisionId: string | null;
  rejectedReason: string | null;
  createdBy: string | null;
  updatedAt: string;
}

export type SignatureMeaning = "authorship" | "review" | "dept_approval" | "quality_approval" | "rejection";

export interface SopSignature {
  id: string;
  signerId: string;
  signerName: string;
  meaning: SignatureMeaning;
  rejectedReason: string | null;
  signedAt: string;
}

export interface SopRevisionSummary {
  id: string;
  versionLabel: string;
  contentHash: string;
  createdAt: string;
  createdBy: string | null;
}

async function throwIfError<T>(
  operation: PromiseLike<{ data: T; error: { message: string; code?: string } | null }>,
): Promise<T> {
  const { data, error } = await operation;
  if (error) throw new Error(error.message);
  return data;
}

function mapControl(row: Record<string, unknown>): SopControl {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    departmentId: (row.department_id as string | null) ?? null,
    status: (row.status as SopStatus | null) ?? "draft",
    sopNumber: String(row.sop_number ?? ""),
    docType: String(row.doc_type ?? "SOP"),
    version: String(row.version ?? ""),
    submittedBy: (row.submitted_by as string | null) ?? null,
    approvedBy: (row.approved_by as string | null) ?? null,
    approvedAt: (row.approved_at as string | null) ?? null,
    effectiveDate: (row.effective_date as string | null) ?? null,
    nextReviewDate: (row.next_review_date as string | null) ?? null,
    effectiveRevisionId: (row.effective_revision_id as string | null) ?? null,
    rejectedReason: (row.rejected_reason as string | null) ?? null,
    createdBy: (row.created_by as string | null) ?? null,
    updatedAt: String(row.updated_at ?? ""),
  };
}

export async function getSopControl(id: string): Promise<SopControl | undefined> {
  const supabase = createPlannerSupabaseClient();
  const row = await throwIfError(
    supabase.from("sops").select(CONTROL_COLUMNS).eq("id", id).is("deleted_at", null).maybeSingle(),
  );
  return row ? mapControl(row as unknown as Record<string, unknown>) : undefined;
}

/** Mint the next DEPT-TYPE-NNN number for a department (transactional, DB-authorized). */
export async function mintSopNumber(workspaceId: string, departmentId: string, docType: string): Promise<string> {
  const supabase = createPlannerSupabaseClient();
  const value = await throwIfError(
    supabase.rpc("next_sop_number", {
      p_workspace: workspaceId,
      p_department: departmentId,
      p_doc_type: docType,
    }),
  );
  return String(value);
}

/** Record a content-bound e-signature; returns its id. The DB authorizes the meaning + SoD. */
export async function signSop(sopId: string, meaning: SignatureMeaning, reason?: string): Promise<string> {
  const supabase = createPlannerSupabaseClient();
  const value = await throwIfError(
    supabase.rpc("sign_sop", { p_sop: sopId, p_meaning: meaning, p_reason: reason ?? null }),
  );
  return String(value);
}

export interface TransitionPatch {
  rejectedReason?: string;
  effectiveDate?: string;
  departmentId?: string;
  reviewIntervalMonths?: number;
}

/**
 * Move an SOP to a new status (and any fields the transition needs, in one guarded UPDATE so the
 * trigger sees them together). Optimistic concurrency on updated_at; trigger rejections surface
 * as readable errors. Sign first (signSop) where the target requires a signature.
 */
export async function transitionSop(
  id: string,
  to: SopStatus,
  expectedUpdatedAt: string,
  patch: TransitionPatch = {},
): Promise<SopControl> {
  const supabase = createPlannerSupabaseClient();
  const row: Record<string, unknown> = { status: to };
  if (patch.rejectedReason !== undefined) row.rejected_reason = patch.rejectedReason;
  if (patch.effectiveDate !== undefined) row.effective_date = patch.effectiveDate;
  if (patch.departmentId !== undefined) row.department_id = patch.departmentId;
  if (patch.reviewIntervalMonths !== undefined) row.review_interval_months = patch.reviewIntervalMonths;

  const updated = await throwIfError(
    supabase
      .from("sops")
      .update(row)
      .eq("id", id)
      .eq("updated_at", expectedUpdatedAt)
      .is("deleted_at", null)
      .select(CONTROL_COLUMNS)
      .maybeSingle(),
  );
  if (!updated) throw new SopConflictError();
  return mapControl(updated as unknown as Record<string, unknown>);
}

export async function listSignatures(sopId: string): Promise<SopSignature[]> {
  const supabase = createPlannerSupabaseClient();
  const rows = await throwIfError(
    supabase
      .from("sop_signatures")
      .select("id, signer_id, signer_printed_name, meaning, rejected_reason, signed_at")
      .eq("sop_id", sopId)
      .order("signed_at", { ascending: true }),
  );
  return (rows ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.id),
    signerId: String(row.signer_id),
    signerName: String(row.signer_printed_name ?? ""),
    meaning: (row.meaning as SignatureMeaning) ?? "review",
    rejectedReason: (row.rejected_reason as string | null) ?? null,
    signedAt: String(row.signed_at ?? ""),
  }));
}

export async function listRevisions(sopId: string): Promise<SopRevisionSummary[]> {
  const supabase = createPlannerSupabaseClient();
  const rows = await throwIfError(
    supabase
      .from("sop_revisions")
      .select("id, version_label, content_hash, created_at, created_by")
      .eq("sop_id", sopId)
      .order("created_at", { ascending: false }),
  );
  return (rows ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.id),
    versionLabel: String(row.version_label ?? ""),
    contentHash: String(row.content_hash ?? ""),
    createdAt: String(row.created_at ?? ""),
    createdBy: (row.created_by as string | null) ?? null,
  }));
}
