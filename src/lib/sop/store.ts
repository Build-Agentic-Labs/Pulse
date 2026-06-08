/**
 * Supabase-backed persistence for SOPs.
 *
 * SOPs are stored in `public.sops`, scoped to a workspace and gated by RLS. The full `Sop`
 * is persisted as a single jsonb `document` (the model is still settling, so we save it
 * atomically); a few promoted columns mirror header fields for cheap listing. `Sop` stays the
 * pure export/extraction contract -- the owning workspace rides alongside it as a `SopRecord`
 * rather than being baked into `Sop`.
 */

import { createEmptySop, type Sop } from "@/domain/sop/schema";
import type { ExtractedSop } from "@/domain/sop/extraction";
import { createPlannerSupabaseClient } from "@/domain/supabase-planner";

const STORAGE_KEY = "pulse:sops:v1";

// Exact columns consumed by the mappers below -- avoid select('*'), matching the planner store.
const SOP_COLUMNS = "id, workspace_id, sop_number, title, version, source, document, created_at, updated_at";

/** A persisted SOP plus the workspace it belongs to (the persistence-boundary wrapper). */
export interface SopRecord {
  workspaceId: string;
  sop: Sop;
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

async function throwIfError<T>(operation: PromiseLike<{ data: T; error: { message: string } | null }>) {
  const { data, error } = await operation;
  if (error) {
    throw new Error(error.message);
  }
  return data;
}

// The jsonb `document` is canonical for the body; the row's own id/created_at/updated_at are
// overlaid on top so the columns stay authoritative for those three fields.
function mapSop(row: Record<string, unknown>): Sop {
  const document = (row.document ?? {}) as Sop;
  return {
    ...document,
    id: String(row.id),
    createdAt: String(row.created_at ?? document.createdAt ?? ""),
    updatedAt: String(row.updated_at ?? document.updatedAt ?? ""),
  };
}

export async function listSops(workspaceId: string): Promise<Sop[]> {
  const supabase = createPlannerSupabaseClient();
  const rows = await throwIfError(
    supabase
      .from("sops")
      .select(SOP_COLUMNS)
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false }),
  );
  return (rows ?? []).map(mapSop);
}

export async function getSop(id: string): Promise<SopRecord | undefined> {
  const supabase = createPlannerSupabaseClient();
  // RLS scopes access: a SOP in a workspace the user can't read returns no row -> undefined.
  const row = await throwIfError(supabase.from("sops").select(SOP_COLUMNS).eq("id", id).maybeSingle());
  if (!row) {
    return undefined;
  }
  return { workspaceId: String(row.workspace_id), sop: mapSop(row) };
}

export async function saveSop(sop: Sop, workspaceId: string): Promise<Sop> {
  const supabase = createPlannerSupabaseClient();
  const { data: userData } = await supabase.auth.getUser();
  const next: Sop = { ...sop, updatedAt: nowIso() };

  // created_at is omitted so updates never rewrite it (default now() on insert; the
  // sops_set_updated_at trigger maintains updated_at server-side either way).
  const row = {
    id: next.id,
    workspace_id: workspaceId,
    sop_number: next.meta.sopNumber || null,
    title: next.meta.title || null,
    version: next.meta.version || null,
    source: next.source,
    document: next,
    created_by: userData.user?.id ?? null,
    updated_at: next.updatedAt,
  };

  const saved = await throwIfError(
    supabase.from("sops").upsert(row, { onConflict: "id" }).select(SOP_COLUMNS).single(),
  );
  return mapSop(saved as Record<string, unknown>);
}

export async function deleteSop(id: string): Promise<void> {
  const supabase = createPlannerSupabaseClient();
  await throwIfError(supabase.from("sops").delete().eq("id", id));
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
