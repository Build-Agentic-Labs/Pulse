"use client";

import { AuthProjectGate } from "./auth-project-gate";
import { ExcelGanttReadonly } from "./excel-gantt-readonly";
import { LineWorkspace } from "./line-workspace";
import { MobilePhotoPortal } from "./mobile-photo-portal";

export function PlannerRouteShell({ projectId }: { projectId?: string }) {
  return (
    <AuthProjectGate projectId={projectId} routeKind="planner">
      {(project) => <LineWorkspace projectContext={project} projectId={project.projectId} />}
    </AuthProjectGate>
  );
}

export function MobilePhotoRouteShell({ projectId }: { projectId?: string }) {
  const mobileProjectId = projectId === "project-flexboost" ? undefined : projectId;

  return <MobilePhotoPortal projectId={mobileProjectId} />;
}

export function ExcelGanttRouteShell({ projectId }: { projectId?: string }) {
  return (
    <AuthProjectGate projectId={projectId} routeKind="excel/gantt">
      {(project) => <ExcelGanttReadonly projectId={project.projectId} />}
    </AuthProjectGate>
  );
}
