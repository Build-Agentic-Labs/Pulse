import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { Task } from "@/domain/types";
import { confirmedTaskOrder, taskReorderRequest, type TaskOrderRow } from "@/domain/task-reorder";
import { getUserFromSession, plannerClient } from "./client";

/** One authorized complete baseline read + one atomic write. No full rows/tools or unsafe fallback. */
export async function reorderTasksInSupabase(
  projectId: string, scenarioId: string, before: Task[], after: Task[],
  client?: SupabaseClient<Database>, assertCurrent: () => void = () => undefined,
): Promise<TaskOrderRow[]> {
  const supabase = client ?? plannerClient();
  const { data: { user } } = await getUserFromSession(supabase);
  if (!user) throw new Error("Sign in to reorder tasks.");
  const assertAccount = async () => {
    assertCurrent();
    const { data: { user: current } } = await getUserFromSession(supabase);
    assertCurrent();
    if (current?.id !== user.id) throw new Error("Task reorder account changed.");
  };
  await assertAccount();
  const { data, error } = await supabase.rpc("load_task_reorder_baseline", {
    p_project_id: projectId, p_scenario_id: scenarioId, p_actor_id: user.id,
  });
  if (error) throw new Error(error.message);
  if (!Array.isArray(data) || data.some((row) => !row || typeof row !== "object"))
    throw new Error("Unable to read the current task order.");
  const rows = data as TaskOrderRow[];
  assertCurrent();
  const request = { ...taskReorderRequest(projectId, scenarioId, crypto.randomUUID(), before, after, rows), p_actor_id: user.id };
  if (!request.p_order.length) return rows;
  // Retry a transport failure with the SAME operation id. Never retry a database conflict/permission error.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assertAccount();
    let result;
    try { result = await supabase.rpc("reorder_scenario_tasks", request); }
    catch (error) { if (attempt === 0) continue; throw error; }
    if (result.error) {
      if (result.error.code === "40001" || result.error.code === "23505")
        throw new Error("Task reorder conflict. Reload before reordering again.");
      // supabase-js converts failed fetches to a status-zero response, not a thrown exception.
      if (result.status === 0 && attempt === 0) continue;
      throw new Error(result.error.message);
    }
    await assertAccount();
    return confirmedTaskOrder(result.data, request);
  }
  throw new Error("Unable to confirm the saved task order.");
}
