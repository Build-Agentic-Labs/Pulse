"use client";

import dynamic from "next/dynamic";
import { AppLoadingShell } from "./app-flow-panels";
import { AuthProjectGate } from "./auth-project-gate";

function RouteChunkLoading() {
  return <AppLoadingShell title="Loading workspace" />;
}

const CompanyDashboard = dynamic(
  () => import("./company-dashboard").then((module) => module.CompanyDashboard),
  { loading: RouteChunkLoading },
);
const LineWorkspace = dynamic(
  () => import("./line-workspace").then((module) => module.LineWorkspace),
  { loading: RouteChunkLoading },
);
const MobilePhotoPortal = dynamic(
  () => import("./mobile-photo-portal").then((module) => module.MobilePhotoPortal),
  { loading: RouteChunkLoading },
);
const PlanningRoute = dynamic(
  () => import("./planning/planning-route").then((module) => module.PlanningRoute),
  { loading: RouteChunkLoading },
);
const WorkOrderBoard = dynamic(
  () => import("./planning/work-order-board").then((module) => module.WorkOrderBoard),
  { loading: RouteChunkLoading },
);
const SpacePlaceholder = dynamic(
  () => import("./space-placeholder").then((module) => module.SpacePlaceholder),
  { loading: RouteChunkLoading },
);

/** The post-login landing page: company-space cards instead of an auto-redirect. */
export function HomeRouteShell() {
  return (
    <AuthProjectGate renderHome={(home) => <CompanyDashboard {...home} />}>{() => null}</AuthProjectGate>
  );
}

export function PlanningRouteShell() {
  return (
    <PlanningRoute>
      <WorkOrderBoard />
    </PlanningRoute>
  );
}

export function ProductionRouteShell() {
  return (
    <AuthProjectGate
      renderHome={() => (
        <SpacePlaceholder
          space="production"
          name="Production"
          description="The MES view of the line: what every station is doing right now, with the documents, targets and records that follow each order."
          planned={[
            "Stations — live status, current work order and assigned documents",
            "Capacity & throughput — actual vs. target per station and shift",
            "Target setting — rates and goals the floor works against",
            "Data collection — details captured at each step as work happens",
            "Travelers — the record that moves with every work order",
          ]}
        />
      )}
    >
      {() => null}
    </AuthProjectGate>
  );
}

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
