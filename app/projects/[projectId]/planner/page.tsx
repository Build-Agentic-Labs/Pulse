import { PlannerRouteShell } from "@/components/project-route-shells";
import { fetchInitialPlannerSummaryData } from "@/lib/supabase/server-data";

export const metadata = {
  title: "Planner | Pulse",
};

// Product always receives the same narrow server summary so route depth never
// changes the initial data cost. Deep links hold their detail workspace behind
// its local skeleton until the client's editable-core confirmation arrives.
export default async function ProjectPlannerPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { groups, plannerState } = await fetchInitialPlannerSummaryData(projectId);

  return <PlannerRouteShell projectId={projectId} initialGroups={groups} initialPlannerState={plannerState} />;
}
