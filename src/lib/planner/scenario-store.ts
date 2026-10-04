// Planner scenarios and the task SOP picker: a product's scenario list (earliest = Main), duplicate
// through the RPC, retarget, rename, guarded delete through the RPC, and the read-gated SOP summary
// list that degrades every failure to an empty picker. Moved verbatim from supabase-planner.ts
// (Phase 5); the facade re-exports the public names.

import { plannerClient } from "./client";
import { isMissingRelationError, throwIfError } from "./query-helpers";
import { mapScenarioSummary, maybeText } from "./row-mappers";
import type { ScenarioSummary } from "@/domain/types";

// Lightweight list of a product's scenarios for the switcher tabs (earliest first = "Main").
export async function loadScenariosForProduct(productId: string): Promise<ScenarioSummary[]> {
  const supabase = plannerClient();
  const rows = await throwIfError(
    supabase
      .from("scenarios")
      .select("id,name,target_output,target_output_period,notes,created_at")
      .eq("product_id", productId)
      .order("created_at", { ascending: true }),
  );
  return ((rows ?? []) as Record<string, unknown>[]).map(mapScenarioSummary);
}

export type SopSummary = {
  id: string;
  sopNumber?: string;
  title?: string;
  status?: string;
};

// Lightweight list of SOPs for the task SOP picker. The sops table is read-gated by org-tools
// access, so a planner user without that access simply gets zero rows back -- callers treat an
// empty list as "hide the picker" rather than an error. Real errors also degrade to [] (with a
// console.warn) so a broken SOP lookup can never break the planner.
export async function listSopSummariesFromSupabase(): Promise<SopSummary[]> {
  try {
    const supabase = plannerClient();
    const { data, error } = await supabase
      .from("sops")
      .select("id,sop_number,title,status")
      .is("deleted_at", null)
      .order("sop_number", { ascending: true, nullsFirst: false })
      .order("title", { ascending: true });

    if (error) {
      if (!isMissingRelationError(error)) {
        console.warn(`Failed to load SOP summaries for the task picker: ${error.message}`);
      }
      return [];
    }

    return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
      id: String(row.id),
      sopNumber: maybeText(row.sop_number),
      title: maybeText(row.title),
      status: maybeText(row.status),
    }));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.warn(`Failed to load SOP summaries for the task picker: ${detail}`);
    return [];
  }
}

// Deep-copy a scenario into a new independent "projection" scenario (high-level Gantt only -- stations,
// zones, components, tasks with planned time + manpower, dependencies; no procedures/tools/photos/parts)
// via the duplicate_scenario RPC. Returns the new scenario id.
export async function duplicateScenario(sourceScenarioId: string, newName: string): Promise<string> {
  const supabase = plannerClient();
  const newId = await throwIfError(
    supabase.rpc("duplicate_scenario", {
      p_source_scenario_id: sourceScenarioId,
      p_new_name: newName,
    }),
  );
  return String(newId);
}

// Update a scenario's projection target (units + period). This drives the active-scenario takt for
// non-main scenarios (see calculateActiveTaktMinutes).
export async function updateScenarioTarget(
  scenarioId: string,
  targetOutput: number,
  targetOutputPeriod: string,
): Promise<void> {
  const supabase = plannerClient();
  await throwIfError(
    supabase
      .from("scenarios")
      .update({ target_output: targetOutput, target_output_period: targetOutputPeriod })
      .eq("id", scenarioId),
  );
}

// Rename a scenario (used for projection tabs; the UI prevents renaming Main).
export async function renameScenario(scenarioId: string, name: string): Promise<void> {
  const supabase = plannerClient();
  await throwIfError(supabase.from("scenarios").update({ name }).eq("id", scenarioId));
}

// Delete a scenario via the guarded RPC (refuses the Main/earliest scenario and the only scenario).
// Children cascade. The UI also hides delete for Main; this is the DB-level half of that guard.
export async function deleteScenario(scenarioId: string): Promise<void> {
  const supabase = plannerClient();
  await throwIfError(supabase.rpc("delete_scenario", { p_scenario_id: scenarioId }));
}
