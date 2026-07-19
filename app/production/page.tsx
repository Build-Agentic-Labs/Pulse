import { ProductionRouteShell } from "@/components/project-route-shells";
import { fetchInitialWorkspaceGroups } from "@/lib/supabase/server-data";

export const metadata = {
  title: "Production | Pulse",
};

export default async function ProductionPage() {
  return <ProductionRouteShell initialGroups={await fetchInitialWorkspaceGroups()} />;
}
