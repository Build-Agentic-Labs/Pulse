import type { SupabaseClient } from "@supabase/supabase-js";
import { createPlannerSupabaseClient } from "@/domain/supabase-planner";
import type { Database } from "@/lib/database.types";
import type { SopListItem } from "./store";

export interface CarriedApproval {
  id: string; sop_id: string; signer_id: string; seat_department_id: string;
  carried_to_cycle: number; carried_to_hash: string; source_version: string;
  signer_printed_name: string; meaning: string; signed_at: string; review_cycle: number;
  signed_content_hash: string; signature_strokes: unknown;
}
export interface ControlledChange {
  review_cycle: number; kind: "MINOR" | "MAJOR"; from_version: string; to_version: string;
  closed_at?: string | null; closed_reason?: string | null;
  reason: string; requested_at: string; requested_by: string;
  released_at: string | null; released_by: string | null;
  requested_by_name: string; released_by_name: string;
  original_roster: { userId: string; departmentId: string; name: string; department: string }[] | null;
  release_roster: { userId: string; departmentId: string; name: string; department: string }[] | null;
  approval_handling: { name: string; department: string; carriedForward: boolean; sourceVersion: string | null }[] | null;
}
export async function listCarriedApprovals(ids: string[], client?: SupabaseClient<Database>): Promise<CarriedApproval[]> {
  if (!ids.length) return [];
  const db = client ?? createPlannerSupabaseClient();
  const { data, error } = await db.rpc("list_sop_carried_approvals", { p_sops: [...new Set(ids)] });
  // Allows the additive migration and application to roll out independently.
  if (error?.code === "PGRST202") return [];
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data as unknown as CarriedApproval[] : [];
}
export async function listControlledChanges(id: string): Promise<ControlledChange[]> {
  const { data, error } = await createPlannerSupabaseClient().rpc("list_sop_controlled_changes", { p_sop: id });
  if (error?.code === "PGRST202") return [];
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data as unknown as ControlledChange[] : [];
}
export async function listEffectiveLibrary(workspaceId: string, client?: SupabaseClient<Database>): Promise<SopListItem[]> {
  const db = client ?? createPlannerSupabaseClient();
  const { data, error } = await db.rpc("list_sop_effective_library", { p_workspace: workspaceId });
  if (error?.code === "PGRST202") {
    const { listSops } = await import("./store");
    return (await listSops(workspaceId, db)).filter((sop) => sop.status === "effective");
  }
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data as unknown as SopListItem[] : [];
}
