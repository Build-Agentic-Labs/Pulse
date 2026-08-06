import { ConfigurationWorkspace } from "@/components/planning/configuration-workspace";
import { PlanningShell } from "@/components/planning/planning-shell";
import { fetchInitialPlanningConfigurations } from "@/lib/supabase/server-data";

export const metadata = {
  title: "Product configuration | Pulse",
};

/** Auth, workspace and the access gate come from `app/planning/(workspace)/layout.tsx`. */
export default async function ConfigurationPage() {
  const initial = await fetchInitialPlanningConfigurations();
  return (
    <PlanningShell title="Product configuration">
      <ConfigurationWorkspace
        initialConfigs={initial?.data.configs}
        initialTrailers={initial?.data.trailers}
        initialWorkspaceId={initial?.workspaceId}
      />
    </PlanningShell>
  );
}
