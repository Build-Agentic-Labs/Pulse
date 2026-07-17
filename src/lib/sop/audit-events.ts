import { createPlannerSupabaseClient } from "@/domain/supabase-planner";

export interface SopAuditEvent {
  id: number;
  sopId: string;
  reviewCycle: number;
  eventType: string;
  actorId: string | null;
  actorName: string;
  details: Record<string, unknown>;
  createdAt: string;
}

function mapAuditEvent(row: Record<string, unknown>): SopAuditEvent {
  return {
    id: Number(row.id),
    sopId: String(row.sop_id),
    reviewCycle: Number(row.review_cycle ?? 0),
    eventType: String(row.event_type),
    actorId: (row.actor_id as string | null) ?? null,
    actorName: String(row.actor_name || "System"),
    details: (row.details as Record<string, unknown> | null) ?? {},
    createdAt: String(row.created_at),
  };
}

export async function listSopAuditEvents(sopId: string): Promise<SopAuditEvent[]> {
  const supabase = createPlannerSupabaseClient();
  const { data, error } = await supabase
    .from("sop_event_log")
    .select("id, sop_id, review_cycle, event_type, actor_id, actor_name, details, created_at")
    .eq("sop_id", sopId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => mapAuditEvent(row as Record<string, unknown>));
}
