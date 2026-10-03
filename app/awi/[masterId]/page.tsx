import { notFound } from "next/navigation";
import { PlannerRouteShell } from "@/components/project-route-shells";
import { getAwiMaster } from "@/lib/awi/store";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fetchInitialWorkspaceGroups } from "@/lib/supabase/server-data";

export const metadata = { title: "AWI Builder | Pulse" };
export default async function AwiEditorPage({ params }: { params: Promise<{ masterId: string }> }) {
  const { masterId } = await params;
  const client = await createSupabaseServerClient();
  const groupsPromise = fetchInitialWorkspaceGroups();
  const master = await getAwiMaster(masterId, client);
  if (!master) notFound();
  // The Procedure editor needs its editable core, not a dashboard summary.
  // Mount it as soon as identity/access are known; its existing cache paints
  // returning drafts while its own core confirmation protects writes.
  const groups = await groupsPromise;
  return <PlannerRouteShell projectId={master.project_id} awiMaster={master} initialGroups={groups} />;
}
