import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createPlannerSupabaseClient } from "@/domain/supabase-planner";
import type { QualityWiDatabase } from "./database.types";
/** Narrow local schema extension; never bypasses caller cookies, keys or RLS. */
export function qualityWiClient(
  client?: SupabaseClient<Database>,
): SupabaseClient<QualityWiDatabase> {
  return (client ??
    createPlannerSupabaseClient()) as unknown as SupabaseClient<QualityWiDatabase>;
}
