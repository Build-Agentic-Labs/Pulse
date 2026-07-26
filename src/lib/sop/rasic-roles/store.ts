/**
 * Data access for the workspace's RASIC role vocabulary.
 *
 * These are only the roles authors TYPED. The eight cross-department roles ship in code as
 * GENERAL_RASIC_ROLES, and department position titles come from STANDARD_POSITION_TITLES —
 * `rasicRoleOptions` assembles all three into the dropdown. Nothing here knows about that
 * assembly; this layer only reads and writes the one table.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeRasicRoleName } from "@/domain/departments";
import { createPlannerSupabaseClient } from "@/domain/supabase-planner";
import type { Database } from "@/lib/database.types";
import { throwIfError } from "@/lib/supabase-errors";

export interface RasicRole {
  id: string;
  name: string;
}

const COLUMNS = "id, name";

function mapRole(row: Record<string, unknown>): RasicRole {
  return { id: String(row.id), name: String(row.name ?? "") };
}

/**
 * Every role this workspace has added. The optional client is what lets the same read serve the
 * browser and a server component, per the store pattern.
 */
export async function listRasicRoles(
  workspaceId: string,
  client?: SupabaseClient<Database>,
): Promise<RasicRole[]> {
  const supabase = client ?? createPlannerSupabaseClient();
  const rows = await throwIfError(
    supabase
      .from("sop_rasic_roles")
      .select(COLUMNS)
      .eq("workspace_id", workspaceId)
      .order("name", { ascending: true }),
  );
  return (rows ?? []).map((row) => mapRole(row as unknown as Record<string, unknown>));
}

/**
 * Add a typed role, or return the existing one if it is already there.
 *
 * Two authors typing the same role at the same moment is the expected case, not an error: the
 * unique index over (workspace_id, lower(btrim(name))) decides who inserts, and the loser gets
 * the winner's row back rather than a failure. The same path absorbs a case variant of a role
 * that already exists.
 */
export async function addRasicRole(workspaceId: string, name: string): Promise<RasicRole> {
  const normalized = normalizeRasicRoleName(name);
  if (!normalized) throw new Error("Enter a role name.");

  const supabase = createPlannerSupabaseClient();
  const { data, error } = await supabase
    .from("sop_rasic_roles")
    .insert({ workspace_id: workspaceId, name: normalized })
    .select(COLUMNS)
    .single();

  if (!error && data) return mapRole(data as unknown as Record<string, unknown>);
  // 23505 = unique violation: someone already added this name.
  if (error && error.code !== "23505") throw new Error(error.message);

  const existing = await throwIfError(
    supabase
      .from("sop_rasic_roles")
      .select(COLUMNS)
      .eq("workspace_id", workspaceId)
      .ilike("name", normalized)
      .maybeSingle(),
  );
  if (!existing) throw new Error("The role could not be added.");
  return mapRole(existing as unknown as Record<string, unknown>);
}

/** Rename a role. Owner/admin only — the database policy is the gate, not the caller. */
export async function renameRasicRole(id: string, name: string): Promise<RasicRole> {
  const normalized = normalizeRasicRoleName(name);
  if (!normalized) throw new Error("Enter a role name.");
  const supabase = createPlannerSupabaseClient();
  const row = await throwIfError(
    supabase.from("sop_rasic_roles").update({ name: normalized }).eq("id", id).select(COLUMNS).single(),
  );
  return mapRole(row as unknown as Record<string, unknown>);
}

/**
 * Remove a role from the offered list. Documents that already use it keep their text — the name
 * lives on the SOP as free text and renders through the editor's "Current role" fallback, so
 * nothing is rewritten and no signature is disturbed.
 */
export async function deleteRasicRole(id: string): Promise<void> {
  const supabase = createPlannerSupabaseClient();
  await throwIfError(supabase.from("sop_rasic_roles").delete().eq("id", id));
}
