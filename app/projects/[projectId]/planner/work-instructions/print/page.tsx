import { WorkInstructionPrintRouteShell } from "@/components/project-route-shells";
import { fetchInitialPlannerData } from "@/lib/supabase/server-data";

export const metadata = {
  title: "Work Instruction | Pulse",
};

/**
 * Printable assembly work instructions for one or more tasks.
 *
 * `?taskIds=a,b,c` prints one document per task, in the order given.
 * `?blank=1` prints the empty fill-in template instead.
 *
 * Planner state is fetched on the server for the first paint and passed down;
 * a signed-out or failed fetch passes nothing and the client loads as a
 * fallback (server fetch is an accelerant, never a dependency).
 */
export default async function WorkInstructionPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ taskIds?: string; scenarioId?: string; blank?: string }>;
}) {
  const { projectId } = await params;
  const { taskIds = "", scenarioId, blank } = await searchParams;

  const ids = taskIds
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id !== "");

  const { groups, plannerState } = await fetchInitialPlannerData(projectId);

  return (
    <WorkInstructionPrintRouteShell
      projectId={projectId}
      initialGroups={groups}
      initialPlannerState={plannerState}
      taskIds={ids}
      scenarioId={scenarioId}
      blank={blank === "1"}
    />
  );
}
