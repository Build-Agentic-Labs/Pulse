import type { SupabaseClient } from "@supabase/supabase-js";
import { createPlannerSupabaseClient } from "@/domain/supabase-planner";
import type { Database } from "@/lib/database.types";
import { throwIfError } from "@/lib/supabase-errors";

export type AwiMaster = Database["public"]["Tables"]["awi_masters"]["Row"];
export function awiDraftStatus(master: AwiMaster) {
  if (!master.published_at) return "Draft";
  return new Date(master.draft_updated_at).getTime() > new Date(master.published_at).getTime() ? "Published · draft changes" : "Published";
}
export async function listAwiMasters(workspaceId: string, client?: SupabaseClient<Database>): Promise<AwiMaster[]> {
  const rows = await throwIfError((client ?? createPlannerSupabaseClient()).from("awi_masters").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }));
  return rows ?? [];
}
export async function getAwiMaster(id: string, client?: SupabaseClient<Database>): Promise<AwiMaster | null> {
  return await throwIfError((client ?? createPlannerSupabaseClient()).from("awi_masters").select("*").eq("id", id).maybeSingle());
}
export async function createAwiMaster(workspaceId: string, title: string, documentNumber: string): Promise<AwiMaster> {
  const client = createPlannerSupabaseClient();
  const id = await throwIfError(client.rpc("create_awi_master", { p_workspace_id: workspaceId, p_title: title.trim(), p_document_number: documentNumber.trim() }));
  if (!id) throw new Error("Unable to create AWI.");
  const master = await getAwiMaster(id, client);
  if (!master) throw new Error("Your AWI was created but could not be opened. Reload the master list to resume it.");
  return master;
}
