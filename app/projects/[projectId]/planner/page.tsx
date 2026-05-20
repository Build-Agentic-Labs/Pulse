import { PlannerRouteShell } from "@/components/project-route-shells";

export default async function ProjectPlannerPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  return <PlannerRouteShell projectId={projectId} />;
}
