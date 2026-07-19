import { PlannerRouteShell } from "@/components/project-route-shells";
import { fetchInitialWorkspaceGroups } from "@/lib/supabase/server-data";

export const metadata = {
  title: "Planner | Pulse",
};

export default async function ProjectPlannerPage({ params }: { params: Promise<{ projectId: string }> }) {
  const [{ projectId }, initialGroups] = await Promise.all([params, fetchInitialWorkspaceGroups()]);

  return <PlannerRouteShell projectId={projectId} initialGroups={initialGroups} />;
}
