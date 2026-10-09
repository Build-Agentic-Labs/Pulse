// Shared query helpers for the planner persistence code: Supabase error unwrapping, scoped id generation,
// missing-relation detection, PostgREST or-filter construction for document-type and custom-column scope,
// and the task/project assertions every scoped write runs before touching data (task_project_id /
// scenario_project_id). Moved verbatim from supabase-planner.ts (Phase 4).

import { plannerClient } from "./client";
import type { Product, Task } from "@/domain/types";

// PostgREST/Postgres error codes meaning "this table or function isn't in the schema yet"
// (i.e. a migration hasn't been applied). Callers use this to degrade gracefully.
const MISSING_RELATION_CODES = ["42P01", "PGRST205", "PGRST202"];

export function isMissingRelationError(error: { code?: string } | null): boolean {
  return Boolean(error && error.code && MISSING_RELATION_CODES.includes(error.code));
}

// PostgREST `.or()` filters are raw strings where comma, parens, and whitespace are
// structural. App IDs are UUIDs / safeStorageSegment output and never contain these, so any
// occurrence means a malformed or hostile value -- reject it rather than let it alter the query.
function assertSafeOrFilterValue(value: string): string {
  if (!value || /[(),\s]/.test(value)) {
    throw new Error(`Unsafe identifier in query filter: ${JSON.stringify(value)}`);
  }
  return value;
}

// Build a PostgREST `.or()` disjunction from column/value pairs, validating every value.
function buildOrFilter(...pairs: ReadonlyArray<readonly [column: string, value: string]>): string {
  return pairs.map(([column, value]) => `${column}.eq.${assertSafeOrFilterValue(value)}`).join(",");
}

export function documentTypeScopeFilter(product: Pick<Product, "id" | "projectId">) {
  return product.projectId
    ? buildOrFilter(["project_id", product.projectId], ["product_id", String(product.id)])
    : buildOrFilter(["product_id", String(product.id)]);
}

export function customColumnScopeFilter(productId: string, scenarioId: string): string {
  return buildOrFilter(["product_id", productId], ["scenario_id", scenarioId]);
}

// Project-membership assertions are advisory UX guards -- the real enforcement is RLS, which
// gates Product writes on has_product_project_access(). These resolve a task/scenario's project in ONE
// round-trip via the SECURITY DEFINER resolver functions (was 3 sequential queries each).
export async function assertTaskInProject(supabase: ReturnType<typeof plannerClient>, taskId: string, projectId?: string) {
  if (!projectId) {
    return;
  }

  const resolvedProjectId = await throwIfError(supabase.rpc("task_project_id", { target_task_id: taskId }));
  if (!resolvedProjectId || String(resolvedProjectId) !== projectId) {
    throw new Error("This task does not belong to the active workspace.");
  }
}

export async function assertTaskRowInProject(supabase: ReturnType<typeof plannerClient>, task: Task, projectId?: string) {
  if (!projectId) {
    return;
  }

  // A task's project is determined by its scenario; this works for both new (not-yet-saved)
  // and existing tasks. RLS still independently blocks any cross-project write.
  const resolvedProjectId = await throwIfError(
    supabase.rpc("scenario_project_id", { target_scenario_id: task.scenarioId }),
  );
  if (!resolvedProjectId || String(resolvedProjectId) !== projectId) {
    throw new Error("This task does not belong to the active workspace.");
  }
}

export async function throwIfError<T>(operation: PromiseLike<{ data: T; error: { message: string } | null }>) {
  const { data, error } = await operation;
  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export function newScopedId(prefix: string) {
  const randomId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${randomId}`;
}
