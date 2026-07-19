import { PlanningRouteShell } from "@/components/project-route-shells";
import { fetchInitialWorkspaceGroups } from "@/lib/supabase/server-data";

export const metadata = {
  title: "Planning | Pulse",
};

export default async function PlanningPage() {
  return <PlanningRouteShell initialGroups={await fetchInitialWorkspaceGroups()} />;
}
