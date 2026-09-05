/**
 * The user's notification inbox (notifications table). Reads ride RLS (own rows
 * only); read-state writes go through the SECURITY DEFINER RPCs, never a direct
 * update, so a client can only ever flip its own read_at.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createPlannerSupabaseClient } from "@/domain/supabase-planner";
import type { Database } from "@/lib/database.types";

export interface InboxItem {
  id: number;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  createdAt: string;
  readAt: string | null;
  workspaceId: string | null;
}

export async function listInbox(limit = 8, client?: SupabaseClient<Database>): Promise<InboxItem[]> {
  const supabase = client ?? createPlannerSupabaseClient();
  const { data, error } = await supabase
    .from("notifications")
    .select("id, kind, title, body, link, created_at, read_at, workspace_id")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: Number(row.id),
    kind: String(row.kind),
    title: String(row.title),
    body: String(row.body ?? ""),
    link: (row.link as string | null) ?? null,
    createdAt: String(row.created_at),
    readAt: (row.read_at as string | null) ?? null,
    workspaceId: (row.workspace_id as string | null) ?? null,
  }));
}

export async function markInboxRead(ids: readonly number[], client?: SupabaseClient<Database>): Promise<number> {
  if (ids.length === 0) return 0;
  const supabase = client ?? createPlannerSupabaseClient();
  const { data, error } = await supabase.rpc("mark_notifications_read", { p_ids: [...ids] });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

export async function markAllInboxRead(client?: SupabaseClient<Database>): Promise<number> {
  const supabase = client ?? createPlannerSupabaseClient();
  const { data, error } = await supabase.rpc("mark_all_notifications_read", {});
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}
