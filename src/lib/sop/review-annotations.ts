import type { SupabaseClient } from "@supabase/supabase-js";
import { createPlannerSupabaseClient, getUserFromSession } from "@/domain/supabase-planner";
import type { Database, TablesInsert } from "@/lib/database.types";
import { kickSopNotifications } from "./notify-kick";

export interface SopReviewAnnotation {
  id: string;
  sopId: string;
  reviewCycle: number;
  category: string;
  pageNumber: number | null;
  xPercent: number | null;
  yPercent: number | null;
  body: string;
  createdBy: string;
  authorName: string;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
}

export interface SopReviewSubmission {
  id: string;
  sopId: string;
  reviewCycle: number;
  reviewerId: string;
  reviewerName: string;
  noChanges: boolean;
  contentHash: string;
  submittedAt: string;
}

/**
 * One review round per cycle: a reviewer who has submitted for this SOP and
 * review cycle is done, even if the author later recalls and edits the draft
 * (which changes the content hash). Content integrity is enforced downstream
 * by the final-approval signatures, which do bind to the exact content hash.
 */
export function hasSubmittedSopReview(
  submissions: readonly SopReviewSubmission[],
  sopId: string,
  reviewCycle: number,
  reviewerId: string,
): boolean {
  return submissions.some(
    (submission) =>
      submission.sopId === sopId &&
      submission.reviewCycle === reviewCycle &&
      submission.reviewerId === reviewerId,
  );
}

function mapAnnotation(row: Record<string, unknown>): SopReviewAnnotation {
  return {
    id: String(row.id),
    sopId: String(row.sop_id),
    reviewCycle: Number(row.review_cycle),
    category: String(row.category || "overall"),
    pageNumber: row.page_number == null ? null : Number(row.page_number),
    xPercent: row.x_percent == null ? null : Number(row.x_percent),
    yPercent: row.y_percent == null ? null : Number(row.y_percent),
    body: String(row.body ?? ""),
    createdBy: String(row.created_by),
    authorName: String(row.author_name || "Reviewer"),
    createdAt: String(row.created_at),
    resolvedAt: (row.resolved_at as string | null) ?? null,
    resolvedBy: (row.resolved_by as string | null) ?? null,
  };
}

function mapSubmission(row: Record<string, unknown>): SopReviewSubmission {
  return {
    id: String(row.id),
    sopId: String(row.sop_id),
    reviewCycle: Number(row.review_cycle),
    reviewerId: String(row.reviewer_id),
    reviewerName: String(row.reviewer_name || "Reviewer"),
    noChanges: Boolean(row.no_changes),
    contentHash: String(row.content_hash ?? ""),
    submittedAt: String(row.submitted_at),
  };
}

export async function listSopReviewSubmissions(
  sopIds: readonly string[],
  client?: SupabaseClient<Database>,
): Promise<SopReviewSubmission[]> {
  const unique = Array.from(new Set(sopIds));
  if (unique.length === 0) return [];
  const supabase = client ?? createPlannerSupabaseClient();
  const { data, error } = await supabase
    .from("sop_review_submissions")
    .select("id, sop_id, review_cycle, reviewer_id, reviewer_name, no_changes, content_hash, submitted_at")
    .in("sop_id", unique)
    .order("submitted_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => mapSubmission(row as Record<string, unknown>));
}

/**
 * Unresolved remarks across many SOPs, reduced to what a queue decision needs.
 * RLS scopes the read to SOPs the caller may see (an author sees their own).
 */
export async function listOpenSopReviewAnnotationsFor(
  sopIds: readonly string[],
  client?: SupabaseClient<Database>,
): Promise<{ sopId: string; reviewCycle: number }[]> {
  const unique = Array.from(new Set(sopIds));
  if (unique.length === 0) return [];
  const supabase = client ?? createPlannerSupabaseClient();
  const { data, error } = await supabase
    .from("sop_review_annotations")
    .select("sop_id, review_cycle")
    .in("sop_id", unique)
    .is("resolved_at", null);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({ sopId: String(row.sop_id), reviewCycle: Number(row.review_cycle) }));
}

export async function submitSopReviewResult(sopId: string, noChanges: boolean): Promise<string> {
  const supabase = createPlannerSupabaseClient();
  const { data, error } = await supabase.rpc("submit_sop_review", {
    p_sop: sopId,
    p_no_changes: noChanges,
  });
  if (error) throw new Error(error.message);
  kickSopNotifications();
  return String(data);
}

export async function listSopReviewAnnotations(
  sopId: string,
  client?: SupabaseClient<Database>,
): Promise<SopReviewAnnotation[]> {
  const supabase = client ?? createPlannerSupabaseClient();
  const { data, error } = await supabase
    .from("sop_review_annotations")
    .select("*")
    .eq("sop_id", sopId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => mapAnnotation(row as Record<string, unknown>));
}

export async function addSopReviewAnnotation(input: {
  sopId: string;
  pageNumber: number;
  xPercent: number;
  yPercent: number;
  body: string;
}): Promise<SopReviewAnnotation> {
  const supabase = createPlannerSupabaseClient();
  const { data, error } = await supabase
    .from("sop_review_annotations")
    // created_by and review_cycle are stamped by the stamp_sop_review_annotation
    // BEFORE INSERT trigger (migration 20260715150000); the generated Insert type
    // cannot see triggers, hence the cast.
    .insert({
      sop_id: input.sopId,
      review_cycle: 0,
      category: "overall",
      page_number: input.pageNumber,
      x_percent: input.xPercent,
      y_percent: input.yPercent,
      body: input.body.trim(),
    } as TablesInsert<"sop_review_annotations">)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return mapAnnotation(data as Record<string, unknown>);
}

export async function saveSopReviewRemark(input: {
  sopId: string;
  category: string;
  body: string;
}): Promise<SopReviewAnnotation | null> {
  const supabase = createPlannerSupabaseClient();
  const userResult = await getUserFromSession(supabase);
  const userId = userResult.data.user?.id;
  if (!userId) throw new Error("Your session expired. Sign in again before saving remarks.");

  const { data: control, error: controlError } = await supabase
    .from("sops")
    .select("review_cycle")
    .eq("id", input.sopId)
    .single();
  if (controlError) throw new Error(controlError.message);

  const { data: existing, error: findError } = await supabase
    .from("sop_review_annotations")
    .select("id")
    .eq("sop_id", input.sopId)
    .eq("category", input.category)
    .eq("created_by", userId)
    .eq("review_cycle", Number(control.review_cycle ?? 0))
    .is("resolved_at", null)
    .maybeSingle();
  if (findError) throw new Error(findError.message);

  const body = input.body.trim();
  if (!body) {
    if (existing?.id) await deleteSopReviewAnnotation(String(existing.id));
    return null;
  }

  const operation = existing?.id
    ? supabase.from("sop_review_annotations").update({ body }).eq("id", existing.id).select("*").single()
    : supabase.from("sop_review_annotations").insert({
        sop_id: input.sopId,
        review_cycle: 0,
        category: input.category,
        body,
        // created_by/coordinates stamped or defaulted by the DB trigger — see above.
      } as TablesInsert<"sop_review_annotations">).select("*").single();
  const { data, error } = await operation;
  if (error) throw new Error(error.message);
  return mapAnnotation(data as Record<string, unknown>);
}

export async function deleteSopReviewAnnotation(annotationId: string): Promise<void> {
  const supabase = createPlannerSupabaseClient();
  const { error } = await supabase.from("sop_review_annotations").delete().eq("id", annotationId);
  if (error) throw new Error(error.message);
}

export async function resolveSopReviewAnnotation(annotationId: string): Promise<void> {
  const supabase = createPlannerSupabaseClient();
  const { error } = await supabase.rpc("resolve_sop_review_annotation", {
    p_annotation: annotationId,
    p_resolved: true,
  });
  if (error) throw new Error(error.message);
}
