/**
 * Store layer for SOP document control: reading control-column state, minting DEPT-TYPE-NNN
 * numbers, recording e-signatures, and driving lifecycle transitions. The database triggers
 * (enforce_sop_transition) and definer functions (next_sop_number, sign_sop) are the real gate;
 * this layer only shapes calls and surfaces the trigger's readable error messages.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { SopStatus } from "@/domain/sop/schema";
import { parseSignatureStrokes, type SignatureStrokes } from "@/domain/sop/signature";
import { createPlannerSupabaseClient } from "@/domain/supabase-planner";
import type { Database, Json, TablesUpdate } from "@/lib/database.types";
import { throwIfError } from "@/lib/supabase-errors";
import { SopConflictError } from "./store";

const CONTROL_COLUMNS =
  "id, workspace_id, department_id, status, sop_number, doc_type, version, major_version, minor_version, " +
  "submitted_by, approved_by, approved_at, effective_date, next_review_date, effective_revision_id, " +
  "rejected_reason, created_by, updated_at, content_hash, review_cycle, revision_reason, self_review_test, " +
  "final_approval_requested_at, final_approval_content_hash, final_approval_requested_by";

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
  /** sha256 of the document, stamped by the DB. Signatures bind to this. */
  contentHash: string | null;
  /** Bumps on every revision (effective → draft). Signatures bind to this too. */
  reviewCycle: number;
  revisionReason: string | null;
  /** Temporary, per-SOP flow-test bypass for a sole author/reviewer. */
  selfReviewTest: boolean;
  finalApprovalRequestedAt: string | null;
  finalApprovalContentHash: string | null;
  finalApprovalRequestedBy: string | null;
}

export type SignatureMeaning =
  | "authorship"
  | "review"
  | "dept_approval"
  | "quality_approval"
  | "rejection"
  | "objection_withdrawn"
  | "objection_sustained"
  | "objection_overruled";

/** RASIC duty a department carries on an SOP. Only responsible/accountable gate the release. */
export type SopRasic = "responsible" | "accountable" | "support" | "consulted" | "informed";

export const BLOCKING_RASIC: readonly SopRasic[] = ["responsible", "accountable"];

export function isBlockingSeat(rasic: SopRasic): boolean {
  return BLOCKING_RASIC.includes(rasic);
}

export interface SopSignature {
  id: string;
  signerId: string;
  signerName: string;
  meaning: SignatureMeaning;
  rejectedReason: string | null;
  signedAt: string;
  /** The seat this signature was made for. Null for authorship and quality_approval. */
  seatDepartmentId: string | null;
  reviewCycle: number;
  /** Set on objection_withdrawn / _sustained / _overruled: the rejection this closes. */
  resolvesSignatureId: string | null;
  /** The document hash this signature is bound to. Compare against SopControl.contentHash. */
  signedContentHash: string;
  /** Immutable snapshot of the signer's saved handwritten signature at signing time. */
  signatureStrokes: SignatureStrokes;
}

export interface UserSignatureProfile {
  strokes: SignatureStrokes;
  updatedAt: string;
}

/** One responsible department and the single person designated to sign for it. */
export interface SopReviewSeat {
  sopId: string;
  departmentId: string;
  rasic: SopRasic;
  /** Null only for `informed` seats, which are notified and never sign. */
  signerId: string | null;
}

export interface SopRevisionSummary {
  id: string;
  versionLabel: string;
  contentHash: string;
  createdAt: string;
  createdBy: string | null;
}

export interface HistoricalSopRevision {
  id: string;
  sopId: string;
  sopNumber: string;
  title: string;
  versionLabel: string;
  createdAt: string;
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
    contentHash: (row.content_hash as string | null) ?? null,
    reviewCycle: Number(row.review_cycle ?? 0),
    revisionReason: (row.revision_reason as string | null) ?? null,
    selfReviewTest: Boolean(row.self_review_test),
    finalApprovalRequestedAt: (row.final_approval_requested_at as string | null) ?? null,
    finalApprovalContentHash: (row.final_approval_content_hash as string | null) ?? null,
    finalApprovalRequestedBy: (row.final_approval_requested_by as string | null) ?? null,
  };
}

/** Enable the narrow solo-author review path after its roster has been validated by the DB. */
export async function enableSopSelfReviewTest(sopId: string): Promise<void> {
  const supabase = createPlannerSupabaseClient();
  await throwIfError(supabase.rpc("enable_sop_self_review_test", { p_sop: sopId }));
}

export async function requestSopFinalApproval(sopId: string): Promise<void> {
  const supabase = createPlannerSupabaseClient();
  await throwIfError(supabase.rpc("request_sop_final_approval", { p_sop: sopId }));
}

export async function getSopControl(id: string): Promise<SopControl | undefined> {
  const supabase = createPlannerSupabaseClient();
  const row = await throwIfError(
    supabase.from("sops").select(CONTROL_COLUMNS).eq("id", id).is("deleted_at", null).maybeSingle(),
  );
  return row ? mapControl(row as unknown as Record<string, unknown>) : undefined;
}

/** The system-recorded author name, exposed without granting broad colleague profile access. */
export async function getSopAuthorDisplayName(sopId: string): Promise<string> {
  const supabase = createPlannerSupabaseClient();
  const value = await throwIfError(
    supabase.rpc("sop_author_display_name", { p_sop: sopId }),
  );
  return String(value ?? "").trim();
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

export interface SignOptions {
  /** Rejection reason, or the written justification on an overrule. */
  reason?: string;
  /** Required for dept_approval / review / rejection: the seat being signed. */
  seatDepartmentId?: string;
  /** Required for objection_withdrawn / _overruled: the rejection being closed. */
  resolvesSignatureId?: string;
}

/**
 * Record a content-bound e-signature; returns its id. The DB authorizes the meaning, the seat,
 * and segregation of duties. Signing the last blocking seat advances the SOP to `approved`
 * inside the same call; signing a `rejection` sends it back to `draft`. Neither is a client
 * decision — do not follow either with a transitionSop() call.
 */
export async function signSop(
  sopId: string,
  meaning: SignatureMeaning,
  options: SignOptions = {},
): Promise<string> {
  const supabase = createPlannerSupabaseClient();
  const value = await throwIfError(
    supabase.rpc("sign_sop", {
      p_sop: sopId,
      p_meaning: meaning,
      // Omitted (undefined) args fall through to the SQL defaults, which are null —
      // same result as the explicit nulls previously passed.
      p_reason: options.reason ?? undefined,
      p_seat_department: options.seatDepartmentId ?? undefined,
      p_resolves: options.resolvesSignatureId ?? undefined,
    }),
  );
  return String(value);
}

export async function getMySignatureProfile(): Promise<UserSignatureProfile | null> {
  const supabase = createPlannerSupabaseClient();
  const row = await throwIfError(
    supabase.from("user_signature_profiles").select("signature_strokes, updated_at").maybeSingle(),
  );
  if (!row) return null;
  return {
    strokes: parseSignatureStrokes((row as Record<string, unknown>).signature_strokes),
    updatedAt: String((row as Record<string, unknown>).updated_at ?? ""),
  };
}

export async function saveMySignatureProfile(strokes: SignatureStrokes): Promise<UserSignatureProfile> {
  const supabase = createPlannerSupabaseClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw new Error(userError.message);
  const userId = userData.user?.id;
  if (!userId) throw new Error("Sign in before saving a signature.");
  const row = await throwIfError(
    supabase
      .from("user_signature_profiles")
      .upsert({ user_id: userId, signature_strokes: strokes as unknown as Json }, { onConflict: "user_id" })
      .select("signature_strokes, updated_at")
      .single(),
  );
  return {
    strokes: parseSignatureStrokes((row as Record<string, unknown>).signature_strokes),
    updatedAt: String((row as Record<string, unknown>).updated_at ?? ""),
  };
}

/** A seat this user holds, with just enough of its SOP to render a queue row. */
export interface MySeatItem {
  sopId: string;
  departmentId: string;
  rasic: SopRasic;
  title: string;
  sopNumber: string;
  version: string;
  status: SopStatus;
  contentHash: string | null;
  finalApprovalRequestedAt: string | null;
  finalApprovalContentHash: string | null;
  reviewCycle: number;
  updatedAt: string;
}

/**
 * Every seat this user is the designated signer for, in this workspace. This is the
 * "notification" — no notifications table, just the roster asked the other way round.
 * RLS already restricts the join to SOPs the user is allowed to see.
 */
export async function listMySeats(
  workspaceId: string,
  userId: string,
  client?: SupabaseClient<Database>,
): Promise<MySeatItem[]> {
  const supabase = client ?? createPlannerSupabaseClient();
  const rows = await throwIfError(
    supabase
      .from("sop_review_seats")
      .select(
        "sop_id, department_id, rasic, sops!inner(id, workspace_id, title, sop_number, version, status, content_hash, review_cycle, updated_at, deleted_at, final_approval_requested_at, final_approval_content_hash)",
      )
      .eq("signer_id", userId)
      .eq("sops.workspace_id", workspaceId)
      .is("sops.deleted_at", null),
  );
  return (rows ?? []).map((row: Record<string, unknown>) => {
    const sop = row.sops as Record<string, unknown>;
    return {
      sopId: String(row.sop_id),
      departmentId: String(row.department_id),
      rasic: row.rasic as SopRasic,
      title: String(sop.title ?? ""),
      sopNumber: String(sop.sop_number ?? ""),
      version: String(sop.version ?? ""),
      status: sop.status as SopStatus,
      contentHash: (sop.content_hash as string | null) ?? null,
      finalApprovalRequestedAt: (sop.final_approval_requested_at as string | null) ?? null,
      finalApprovalContentHash: (sop.final_approval_content_hash as string | null) ?? null,
      reviewCycle: Number(sop.review_cycle ?? 0),
      updatedAt: String(sop.updated_at ?? ""),
    };
  });
}

/** Has this user already signed for this seat, against the SOP's current content and cycle? */
export async function listMySignaturesFor(
  sopIds: readonly string[],
  userId: string,
  client?: SupabaseClient<Database>,
): Promise<SopSignature[]> {
  const unique = Array.from(new Set(sopIds));
  if (unique.length === 0) return [];
  const supabase = client ?? createPlannerSupabaseClient();
  const rows = await throwIfError(
    supabase
      .from("sop_signatures")
      .select(
        "id, signer_id, signer_printed_name, meaning, rejected_reason, signed_at, seat_department_id, review_cycle, resolves_signature_id, signed_content_hash, signature_strokes",
      )
      .in("sop_id", unique)
      .eq("signer_id", userId),
  );
  return (rows ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.id),
    signerId: String(row.signer_id),
    signerName: String(row.signer_printed_name ?? ""),
    meaning: (row.meaning as SignatureMeaning) ?? "review",
    rejectedReason: (row.rejected_reason as string | null) ?? null,
    signedAt: String(row.signed_at ?? ""),
    seatDepartmentId: (row.seat_department_id as string | null) ?? null,
    reviewCycle: Number(row.review_cycle ?? 0),
    resolvesSignatureId: (row.resolves_signature_id as string | null) ?? null,
    signedContentHash: String(row.signed_content_hash ?? ""),
    signatureStrokes: parseSignatureStrokes(row.signature_strokes),
  }));
}

/** Printed names for a set of users, so a pending seat can show who it is waiting on. */
export async function listProfileNames(userIds: readonly string[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(userIds));
  if (unique.length === 0) return new Map();
  const supabase = createPlannerSupabaseClient();
  const rows = await throwIfError(supabase.from("profiles").select("id, full_name").in("id", unique));
  return new Map(
    (rows ?? []).map((row: Record<string, unknown>) => [String(row.id), String(row.full_name ?? "")]),
  );
}

/** The roster: every seated department, its RASIC duty, and its designated signer. */
export async function listSeats(sopId: string): Promise<SopReviewSeat[]> {
  const supabase = createPlannerSupabaseClient();
  const rows = await throwIfError(
    supabase.from("sop_review_seats").select("sop_id, department_id, rasic, signer_id").eq("sop_id", sopId),
  );
  return (rows ?? []).map((row: Record<string, unknown>) => ({
    sopId: String(row.sop_id),
    departmentId: String(row.department_id),
    rasic: row.rasic as SopRasic,
    signerId: (row.signer_id as string | null) ?? null,
  }));
}

/** Add or update a seat. Only legal while the SOP is a draft; the DB enforces the freeze. */
export async function upsertSeat(seat: SopReviewSeat): Promise<void> {
  const supabase = createPlannerSupabaseClient();
  await throwIfError(
    supabase.from("sop_review_seats").upsert(
      {
        sop_id: seat.sopId,
        department_id: seat.departmentId,
        rasic: seat.rasic,
        signer_id: seat.signerId,
      },
      { onConflict: "sop_id,department_id" },
    ),
  );
}

export async function removeSeat(sopId: string, departmentId: string): Promise<void> {
  const supabase = createPlannerSupabaseClient();
  await throwIfError(
    supabase.from("sop_review_seats").delete().eq("sop_id", sopId).eq("department_id", departmentId),
  );
}

/**
 * Move a seat to another member of the same department when its reviewer is unavailable.
 * Admin-only, never to yourself, never a seat that has already signed. Logged to audit_log.
 */
export async function reassignSeat(sopId: string, departmentId: string, newSignerId: string): Promise<void> {
  const supabase = createPlannerSupabaseClient();
  await throwIfError(
    supabase.rpc("reassign_sop_seat", {
      p_sop: sopId,
      p_department: departmentId,
      p_new_signer: newSignerId,
    }),
  );
}

export interface TransitionPatch {
  rejectedReason?: string;
  effectiveDate?: string;
  departmentId?: string;
  reviewIntervalMonths?: number;
  /** Required to leave `effective` (Gate D): why this revision is being opened. */
  revisionReason?: string;
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
  const row: TablesUpdate<"sops"> = { status: to };
  if (patch.rejectedReason !== undefined) row.rejected_reason = patch.rejectedReason;
  if (patch.effectiveDate !== undefined) row.effective_date = patch.effectiveDate;
  if (patch.departmentId !== undefined) row.department_id = patch.departmentId;
  if (patch.reviewIntervalMonths !== undefined) row.review_interval_months = patch.reviewIntervalMonths;
  if (patch.revisionReason !== undefined) row.revision_reason = patch.revisionReason;

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
      // Must stay a single string literal: supabase-js parses it at the type level, and a
      // concatenated expression degrades the row type to GenericStringError.
      .select(
        "id, signer_id, signer_printed_name, meaning, rejected_reason, signed_at, seat_department_id, review_cycle, resolves_signature_id, signed_content_hash, signature_strokes",
      )
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
    seatDepartmentId: (row.seat_department_id as string | null) ?? null,
    reviewCycle: Number(row.review_cycle ?? 0),
    resolvesSignatureId: (row.resolves_signature_id as string | null) ?? null,
    signedContentHash: String(row.signed_content_hash ?? ""),
    signatureStrokes: parseSignatureStrokes(row.signature_strokes),
  }));
}

/**
 * A signature counts only while it is bound to the SOP's current content AND review cycle.
 * An edit re-hashes the document; a revision bumps the cycle. Either one voids it.
 *
 * Both values are DB-stamped — the hash is sha256 over Postgres's `jsonb::text` rendering,
 * which JavaScript cannot reproduce, so we compare the server's hash rather than recompute it.
 */
export function isSignatureCurrent(signature: SopSignature, control: SopControl): boolean {
  if (!control.contentHash) return false;
  return signature.reviewCycle === control.reviewCycle && signature.signedContentHash === control.contentHash;
}

/**
 * Objections still standing against the document as it is now. A rejection is open until
 * something resolves it — withdrawn by the objector, sustained by an edit, or overruled.
 */
export function openObjections(signatures: SopSignature[], control: SopControl): SopSignature[] {
  const resolved = new Set(
    signatures.map((s) => s.resolvesSignatureId).filter((id): id is string => id !== null),
  );
  return signatures.filter(
    (s) => s.meaning === "rejection" && isSignatureCurrent(s, control) && !resolved.has(s.id),
  );
}

/** Has this seat's designated signer signed their department approval for the current content? */
export function hasSeatSigned(
  seat: SopReviewSeat,
  signatures: SopSignature[],
  control: SopControl,
): boolean {
  return signatures.some(
    (s) =>
      s.meaning === "dept_approval" &&
      s.signerId === seat.signerId &&
      s.seatDepartmentId === seat.departmentId &&
      isSignatureCurrent(s, control),
  );
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

/**
 * Frozen versions superseded by a later release. The current effective revision is excluded;
 * only list metadata crosses this boundary, so the Retired surface cannot open or download the
 * immutable document payload.
 */
export async function listHistoricalRevisions(
  workspaceId: string,
  client?: SupabaseClient<Database>,
): Promise<HistoricalSopRevision[]> {
  const supabase = client ?? createPlannerSupabaseClient();
  const rows = await throwIfError(
    supabase
      .from("sop_revisions")
      .select(
        "id, sop_id, version_label, created_at, parent:sops!sop_revisions_sop_id_fkey!inner(sop_number, title, effective_revision_id, deleted_at)",
      )
      .eq("workspace_id", workspaceId)
      .is("parent.deleted_at", null)
      .order("created_at", { ascending: false }),
  );

  return (rows ?? []).flatMap((row: Record<string, unknown>) => {
    const relation = row.parent;
    const parent = (Array.isArray(relation) ? relation[0] : relation) as Record<string, unknown> | undefined;
    if (!parent || String(parent.effective_revision_id ?? "") === String(row.id)) return [];
    return [{
      id: String(row.id),
      sopId: String(row.sop_id),
      sopNumber: String(parent.sop_number ?? ""),
      title: String(parent.title ?? ""),
      versionLabel: String(row.version_label ?? ""),
      createdAt: String(row.created_at ?? ""),
    }];
  });
}
