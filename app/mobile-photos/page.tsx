import type { Metadata } from "next";
import { MobilePhotoRouteShell } from "@/components/project-route-shells";
import { fetchInitialPlannerData, fetchInitialWorkspaceGroups } from "@/lib/supabase/server-data";

export const metadata: Metadata = {
  title: "Step Photo Capture | Pulse",
  description: "Mobile manufacturing step photo capture portal",
};

export default async function MobilePhotosPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { project } = await searchParams;
  if (project) {
    const { groups, plannerState } = await fetchInitialPlannerData(project);
    return <MobilePhotoRouteShell projectId={project} initialGroups={groups} initialPlannerState={plannerState} />;
  }
  return <MobilePhotoRouteShell initialGroups={await fetchInitialWorkspaceGroups()} />;
}
