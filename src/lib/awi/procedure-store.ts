import type { SupabaseClient } from "@supabase/supabase-js";
import { createPlannerSupabaseClient } from "@/lib/planner/client";
import type { Database } from "@/lib/database.types";

export type AwiProcedureSave = Database["public"]["Functions"]["save_awi_procedure"]["Args"];

/** One transaction; deliberately no fallback to the previous partial-write path. */
export async function saveAwiProcedure(payload: AwiProcedureSave, client?: SupabaseClient<Database>) {
  const { data, error } = await (client ?? createPlannerSupabaseClient()).rpc("save_awi_procedure", payload);
  if (!error) return data;
  if (error.code === "40001" || error.code === "23505") {
    throw new Error("AWI save conflict. Your local draft is preserved; reload this AWI before saving again.");
  }
  throw new Error(error.message);
}
