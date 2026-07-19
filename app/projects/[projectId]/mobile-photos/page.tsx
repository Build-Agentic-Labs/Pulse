import type { Metadata } from "next";
import { MobilePhotoRouteShell } from "@/components/project-route-shells";
import { fetchInitialPlannerData } from "@/lib/supabase/server-data";

export const metadata: Metadata = {
  title: "Step Photo Capture | Pulse",
  description: "Mobile manufacturing step photo capture portal",
};

// Stage 5 pattern: workspace groups AND this project's planner state arrive with
// the document, so the capture list paints on the first frame — the flow that
// runs on phones over plant wifi, where the round trips hurt most.
export default async function ProjectMobilePhotosPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { groups, plannerState } = await fetchInitialPlannerData(projectId);

  return <MobilePhotoRouteShell projectId={projectId} initialGroups={groups} initialPlannerState={plannerState} />;
}
