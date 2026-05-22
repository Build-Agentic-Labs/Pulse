"use client";

import { AuthProjectGate } from "./auth-project-gate";
import { ExcelGanttReadonly } from "./excel-gantt-readonly";
import { LineWorkspace } from "./line-workspace";
import { MobilePhotoPortal } from "./mobile-photo-portal";

export function PlannerRouteShell({ projectId }: { projectId?: string }) {
  return (
    <AuthProjectGate projectId={projectId} routeKind="planner">
      {(project, onReady) => (
        <LineWorkspace
          projectContext={project}
          projectId={project?.projectId ?? projectId}
          onReady={onReady}
        />
      )}
    </AuthProjectGate>
  );
}

export function MobilePhotoRouteShell({ projectId }: { projectId?: string }) {
  return (
    <AuthProjectGate projectId={projectId} routeKind="mobile-photos">
      {(project, onReady) => (
        <MobilePhotoPortal
          projectContext={project}
          projectId={project?.projectId ?? projectId}
          onReady={onReady}
        />
      )}
    </AuthProjectGate>
  );
}

export function ExcelGanttRouteShell({ projectId }: { projectId?: string }) {
  return (
    <AuthProjectGate projectId={projectId} routeKind="excel/gantt">
      {(project, onReady) => (
        <ExcelGanttReadonly
          projectId={project?.projectId ?? projectId}
          onReady={onReady}
        />
      )}
    </AuthProjectGate>
  );
}
