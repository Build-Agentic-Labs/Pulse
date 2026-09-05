/**
 * Per-user notification preferences (notification_preferences). Own rows only
 * under RLS; the drain reads them with the service role.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PreferenceRow } from "@/domain/notifications/channels";
import { createPlannerSupabaseClient } from "@/domain/supabase-planner";
import type { Database } from "@/lib/database.types";

export async function loadPreferences(userId: string, client?: SupabaseClient<Database>): Promise<PreferenceRow[]> {
  const supabase = client ?? createPlannerSupabaseClient();
  const { data, error } = await supabase
    .from("notification_preferences")
    .select("user_id, workspace_id, kind, channel, mode")
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    workspaceId: String(row.workspace_id ?? ""),
    kind: String(row.kind),
    channel: String(row.channel),
    mode: String(row.mode),
  }));
}

export async function savePreference(
  userId: string,
  row: PreferenceRow,
  client?: SupabaseClient<Database>,
): Promise<void> {
  const supabase = client ?? createPlannerSupabaseClient();
  const { error } = await supabase.from("notification_preferences").upsert(
    {
      user_id: userId,
      workspace_id: row.workspaceId,
      kind: row.kind,
      channel: row.channel,
      mode: row.mode,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,workspace_id,kind,channel" },
  );
  if (error) throw new Error(error.message);
}
