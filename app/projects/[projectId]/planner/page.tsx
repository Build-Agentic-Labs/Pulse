import { PlannerRouteShell } from "@/components/project-route-shells";
import { fetchInitialPlannerData } from "@/lib/supabase/server-data";

export const metadata = {
  title: "Planner | Pulse",
};

// Stage 5 (refactor plan): the shell's workspace groups AND the project's
// planner state are fetched on the server in one pass and arrive with the
// document. Signed-out or failed fetches pass undefined and the client loads
// exactly as before.
export default async function ProjectPlannerPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { groups, plannerState } = await fetchInitialPlannerData(projectId);

  return <PlannerRouteShell projectId={projectId} initialGroups={groups} initialPlannerState={plannerState} />;
}
