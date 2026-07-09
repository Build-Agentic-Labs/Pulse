/**
 * Supabase-backed persistence for SOPs.
 *
 * SOPs are stored in `public.sops`, scoped to a workspace and gated by RLS. The full `Sop`
 * is persisted as a single jsonb `document` (the model is still settling, so we save it
 * atomically); a few promoted columns mirror header fields for cheap listing. `Sop` stays the
 * pure export/extraction contract -- the owning workspace rides alongside it as a `SopRecord`
 * rather than being baked into `Sop`.
 */

import { createEmptySop, type Sop, type SopStatus } from "@/domain/sop/schema";
import type { ExtractedSop } from "@/domain/sop/extraction";
import { DEFAULT_DOC_TYPE, effectiveSopNumber } from "@/domain/sop/authoring";
import { createPlannerSupabaseClient, getUserFromSession } from "@/domain/supabase-planner";

const STORAGE_KEY = "pulse:sops:v1";

// Exact columns consumed by the mappers below -- avoid select('*'), matching the planner store.
const SOP_COLUMNS = "id, workspace_id, sop_number, title, version, source, status, document, created_at, updated_at";

// Slim projection for the list surface: promoted columns only, never the full jsonb document.
const SOP_LIST_COLUMNS =
  "id, sop_number, title, version, source, status, updated_at, department_id, effective_date, next_review_date";

/** A persisted SOP plus the workspace it belongs to (the persistence-boundary wrapper). */
export interface SopRecord {
  workspaceId: string;
  sop: Sop;
}

/** One row of the SOP list -- the promoted columns, cheap to fetch for every SOP at once. */
export interface SopListItem {
  id: string;
  sopNumber: string;
  title: string;
  version: string;
  source: Sop["source"];
  status: SopStatus;
  updatedAt: string;
  departmentId: string | null;
  effectiveDate: string | null;
  nextReviewDate: string | null;
}

/**
 * Thrown when a save loses the optimistic-concurrency check: the row changed (or was
 * deleted) since the caller loaded it. Callers match on `instanceof` or `code`.
 */
export class SopConflictError extends Error {
  readonly code = "SOP_CONFLICT";

  constructor() {
    super("This SOP was changed by someone else since you opened it — copy your changes and reload.");
    this.name = "SopConflictError";
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

export function newSopId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `sop_${Date.now().toString(36)}`;
}

async function throwIfError<T>(operation: PromiseLike<{ data: T; error: { message: string; code?: string } | null }>) {
  const { data, error } = await operation;
  if (error) {
    // 23505 = Postgres unique violation. Aside from the primary key, the only unique
    // constraint on `sops` is the per-workspace SOP-number index, so translate it into
    // an actionable message instead of the raw constraint name.
    if (error.code === "23505" && !error.message.includes("pkey")) {
      throw new Error("An SOP with this number already exists in this workspace.");
    }
    throw new Error(error.message);
  }
  return data;
}

// The jsonb `document` is canonical for the body; the row's own id/status/created_at/updated_at
// are overlaid on top so the columns stay authoritative for those four fields.
function mapSop(row: Record<string, unknown>): Sop {
  const document = (row.document ?? {}) as Sop;
  return {
    ...document,
    id: String(row.id),
    status: (row.status as SopStatus | null) ?? "draft",
    // The promoted `sop_number` column is authoritative (the list reads it); overlay it onto the
    // jsonb copy so the editor and list never disagree.
    meta: {
      ...document.meta,
      sopNumber: effectiveSopNumber(row.sop_number as string | null | undefined, document.meta?.sopNumber ?? ""),
    },
    createdAt: String(row.created_at ?? document.createdAt ?? ""),
    updatedAt: String(row.updated_at ?? document.updatedAt ?? ""),
  };
}

function mapSopListItem(row: Record<string, unknown>): SopListItem {
  return {
    id: String(row.id),
    sopNumber: String(row.sop_number ?? ""),
    title: String(row.title ?? ""),
    version: String(row.version ?? ""),
    source: row.source === "converted" ? "converted" : "authored",
    status: (row.status as SopStatus | null) ?? "draft",
    updatedAt: String(row.updated_at ?? ""),
    departmentId: (row.department_id as string | null) ?? null,
    effectiveDate: (row.effective_date as string | null) ?? null,
    nextReviewDate: (row.next_review_date as string | null) ?? null,
  };
}

export async function listSops(workspaceId: string): Promise<SopListItem[]> {
  const supabase = createPlannerSupabaseClient();
  const rows = await throwIfError(
    supabase
      .from("sops")
      .select(SOP_LIST_COLUMNS)
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false }),
  );
  return (rows ?? []).map(mapSopListItem);
}

export async function getSop(id: string): Promise<SopRecord | undefined> {
  const supabase = createPlannerSupabaseClient();
  // RLS scopes access: a SOP in a workspace the user can't read returns no row -> undefined.
  // Soft-deleted SOPs are treated as missing everywhere.
  const row = await throwIfError(
    supabase.from("sops").select(SOP_COLUMNS).eq("id", id).is("deleted_at", null).maybeSingle(),
  );
  if (!row) {
    return undefined;
  }
  return { workspaceId: String(row.workspace_id), sop: mapSop(row) };
}

export interface SaveSopOptions {
  /**
   * Optimistic-concurrency token for SOPs that already exist server-side: the `updatedAt`
   * loaded when the editor opened (or returned by the previous save). Present -> guarded
   * UPDATE that throws `SopConflictError` if the row moved; absent -> plain INSERT.
   */
  expectedUpdatedAt?: string;
  /**
   * Owning department + document type, written only on the initial INSERT (the DB trigger freezes
   * `department_id` once the SOP leaves draft, and it is never changed on later saves).
   */
  departmentId?: string;
  docType?: string;
}

export async function saveSop(sop: Sop, workspaceId: string, options: SaveSopOptions = {}): Promise<Sop> {
  const supabase = createPlannerSupabaseClient();
  const { data: userData } = await getUserFromSession(supabase);
  const userId = userData.user?.id ?? null;
  const next: Sop = { ...sop, updatedAt: nowIso() };

  // `status` lives in its own column (promoted, like the header fields) and is stripped
  // from the jsonb document so the column stays the single source of truth for it.
  const { status, ...documentBody } = next;

  // created_at/updated_at are omitted so the DB stays authoritative (default now() on
  // insert; the sops_set_updated_at trigger maintains updated_at on every write).
  const row = {
    sop_number: next.meta.sopNumber || null,
    title: next.meta.title || null,
    version: next.meta.version || null,
    source: next.source,
    status,
    document: documentBody,
    updated_by: userId,
  };

  if (options.expectedUpdatedAt) {
    // Optimistic concurrency: only touch the row if it still carries the updated_at the
    // caller loaded. Zero rows back means someone else saved (or deleted) it since ->
    // conflict; never silently overwrite their work.
    const updated = await throwIfError(
      supabase
        .from("sops")
        .update(row)
        .eq("id", next.id)
        .eq("updated_at", options.expectedUpdatedAt)
        .is("deleted_at", null)
        .select(SOP_COLUMNS)
        .maybeSingle(),
    );
    if (!updated) {
      throw new SopConflictError();
    }
    return mapSop(updated as Record<string, unknown>);
  }

  // First save: a plain INSERT so created_by is written exactly once and never rewritten. The
  // owning department + doc type ride along here (frozen afterwards) when the builder supplies them.
  const inserted = await throwIfError(
    supabase
      .from("sops")
      .insert({
        ...row,
        id: next.id,
        workspace_id: workspaceId,
        created_by: userId,
        ...(options.departmentId
          ? { department_id: options.departmentId, doc_type: options.docType ?? DEFAULT_DOC_TYPE }
          : {}),
      })
      .select(SOP_COLUMNS)
      .single(),
  );
  return mapSop(inserted as Record<string, unknown>);
}

/** How many production tasks link to this SOP (the "where-used" back-reference). */
export async function countTasksUsingSop(sopId: string): Promise<number> {
  const supabase = createPlannerSupabaseClient();
  const { count, error } = await supabase
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("sop_id", sopId);
  if (error) {
    throw new Error(error.message);
  }
  return count ?? 0;
}

/**
 * Soft delete: the row is kept (deleted_at set, which also frees the SOP number for reuse
 * via the partial unique index) and filtered out of every read path above. Blocked while any
 * production task still links to the SOP, so a delete can't silently orphan a task's reference
 * (the DB trigger separately blocks deleting a non-draft/obsolete controlled document).
 */
export async function deleteSop(id: string): Promise<void> {
  const supabase = createPlannerSupabaseClient();
  const linked = await countTasksUsingSop(id);
  if (linked > 0) {
    throw new Error(
      `This SOP is used by ${linked} production task${linked === 1 ? "" : "s"} — unlink it there before deleting.`,
    );
  }
  await throwIfError(supabase.from("sops").update({ deleted_at: nowIso() }).eq("id", id).is("deleted_at", null));
}

/**
 * The pre-Supabase localStorage SOPs, for the one-time import on the list. Deliberately does
 * NOT clear localStorage -- it stays as a safety net; the import is id-deduped so re-running
 * it is a no-op.
 */
export function readLegacyLocalSops(): Sop[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Sop[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Build a full, persistable `Sop` from a Claude extraction result. */
export function sopFromExtraction(extracted: ExtractedSop): Sop {
  const base = createEmptySop(newSopId(), nowIso());
  // The model output is trusted but not guaranteed; fall back to base values so a
  // partial/malformed payload can't throw while we build the Sop.
  const procedure = extracted.procedure ?? base.procedure;
  const approvals = extracted.approvals ?? [];
  return {
    ...base,
    ...extracted,
    // Keep app-managed fields from the base; never let the model set them.
    id: base.id,
    source: "converted",
    status: base.status,
    createdAt: base.createdAt,
    updatedAt: base.updatedAt,
    procedure: {
      ...base.procedure,
      ...procedure,
      activities: (procedure.activities ?? []).map((activity, index) => ({
        id: `${base.id}-act-${index}`,
        step: activity.step || index + 1,
        shape: activity.shape,
        input: activity.input ?? "",
        description: activity.description,
        detail: activity.detail ?? "",
        output: activity.output ?? "",
        assignments: activity.assignments ?? {},
      })),
    },
    // If the legacy doc had no approval rows, keep the standard template rows.
    approvals: approvals.length > 0 ? approvals : base.approvals,
  };
}
