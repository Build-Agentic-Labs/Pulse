/**
 * Data access for the workspace's job-title vocabulary.
 *
 * These are only the titles someone TYPED. Each department's standard titles ship in code as
 * STANDARD_POSITION_TITLES — `jobTitleOptions` assembles both into the dropdown. Nothing here
 * knows about that assembly; this layer only reads and writes the one table.
 *
 * Distinct from sop_rasic_roles by design: a job title names a person on a roster, a RASIC role
 * names an actor in a process and may be collective.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeJobTitle } from "@/domain/departments";
import { createPlannerSupabaseClient } from "@/domain/supabase-planner";
import type { Database } from "@/lib/database.types";
import { throwIfError } from "@/lib/supabase-errors";

export interface JobTitle {
  id: string;
  name: string;
}

const COLUMNS = "id, name";

function mapRole(row: Record<string, unknown>): JobTitle {
  return { id: String(row.id), name: String(row.name ?? "") };
}

/**
 * Every role this workspace has added. The optional client is what lets the same read serve the
 * browser and a server component, per the store pattern.
 */
export async function listJobTitles(
  workspaceId: string,
  client?: SupabaseClient<Database>,
): Promise<JobTitle[]> {
  const supabase = client ?? createPlannerSupabaseClient();
  const rows = await throwIfError(
    supabase
      .from("sop_job_titles")
      .select(COLUMNS)
      .eq("workspace_id", workspaceId)
      .order("name", { ascending: true }),
  );
  return (rows ?? []).map((row) => mapRole(row as unknown as Record<string, unknown>));
}

/**
 * Add a typed job title, or return the existing one if it is already there.
 *
 * Two authors typing the same role at the same moment is the expected case, not an error: the
 * unique index over (workspace_id, lower(btrim(name))) decides who inserts, and the loser gets
 * the winner's row back rather than a failure. The same path absorbs a case variant of a title
 * that already exists.
 */
export async function addJobTitle(workspaceId: string, name: string): Promise<JobTitle> {
  const normalized = normalizeJobTitle(name);
  if (!normalized) throw new Error("Enter a job title.");

  const supabase = createPlannerSupabaseClient();
  const { data, error } = await supabase
    .from("sop_job_titles")
    .insert({ workspace_id: workspaceId, name: normalized })
    .select(COLUMNS)
    .single();

  if (!error && data) return mapRole(data as unknown as Record<string, unknown>);
  // 23505 = unique violation: someone already added this name.
  if (error && error.code !== "23505") throw new Error(error.message);

  const existing = await throwIfError(
    supabase
      .from("sop_job_titles")
      .select(COLUMNS)
      .eq("workspace_id", workspaceId)
      .ilike("name", normalized)
      .maybeSingle(),
  );
  if (!existing) throw new Error("The job title could not be added.");
  return mapRole(existing as unknown as Record<string, unknown>);
}

/** Rename a title. Owner/admin only — the database policy is the gate, not the caller. */
export async function renameJobTitle(id: string, name: string): Promise<JobTitle> {
  const normalized = normalizeJobTitle(name);
  if (!normalized) throw new Error("Enter a job title.");
  const supabase = createPlannerSupabaseClient();
  const row = await throwIfError(
    supabase.from("sop_job_titles").update({ name: normalized }).eq("id", id).select(COLUMNS).single(),
  );
  return mapRole(row as unknown as Record<string, unknown>);
}

/**
 * Remove a title from the offered list. Members already holding it keep it: the title is stored
 * on the membership row, not as a reference to this table, so nothing is rewritten.
 */
export async function deleteJobTitle(id: string): Promise<void> {
  const supabase = createPlannerSupabaseClient();
  await throwIfError(supabase.from("sop_job_titles").delete().eq("id", id));
}
