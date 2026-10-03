import { notFound } from "next/navigation";
import { PlannerRouteShell } from "@/components/project-route-shells";
import { getAwiMaster } from "@/lib/awi/store";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fetchInitialPlannerData } from "@/lib/supabase/server-data";

export const metadata = { title: "AWI Builder | Pulse" };
export default async function AwiEditorPage({ params }: { params: Promise<{ masterId: string }> }) {
  const { masterId } = await params;
  const master = await getAwiMaster(masterId, await createSupabaseServerClient());
  if (!master) notFound();
  const { groups, plannerState } = await fetchInitialPlannerData(master.project_id);
  return <PlannerRouteShell projectId={master.project_id} awiMaster={master} initialGroups={groups} initialPlannerState={plannerState} />;
}
