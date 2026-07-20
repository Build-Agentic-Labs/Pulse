"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { AppLoadingShell } from "./app-flow-panels";
import { AuthProjectGate } from "./auth-project-gate";
import {
  DashboardLoadingState,
  PlanningLoadingState,
  ProductLoadingState,
  ProductionLoadingState,
  SettingsLoadingState,
} from "./space-loading-states";

function ProjectRouteLoading() {
  const searchParams = useSearchParams();
  return searchParams.get("view") === "settings" ? <SettingsLoadingState /> : <ProductLoadingState />;
}

const CompanyDashboard = dynamic(
  () => import("./company-dashboard").then((module) => module.CompanyDashboard),
  { loading: () => <DashboardLoadingState /> },
);
const LineWorkspace = dynamic(
  () => import("./line-workspace").then((module) => module.LineWorkspace),
  { loading: ProjectRouteLoading },
);
const MobilePhotoPortal = dynamic(
  () => import("./mobile-photo-portal").then((module) => module.MobilePhotoPortal),
  { loading: () => <AppLoadingShell title="Opening photos" /> },
);
const PlanningRoute = dynamic(
  () => import("./planning/planning-route").then((module) => module.PlanningRoute),
  { loading: () => <PlanningLoadingState /> },
);
const WorkOrderBoard = dynamic(
  () => import("./planning/work-order-board").then((module) => module.WorkOrderBoard),
  { loading: () => <PlanningLoadingState /> },
);
const SpacePlaceholder = dynamic(
  () => import("./space-placeholder").then((module) => module.SpacePlaceholder),
  { loading: () => <ProductionLoadingState /> },
);
const SettingsWorkspace = dynamic(
  () => import("./settings-workspace").then((module) => module.SettingsWorkspace),
  { loading: () => <SettingsLoadingState /> },
);

/** The post-login landing page: company-space cards instead of an auto-redirect. */
export function HomeRouteShell() {
  return (
    <AuthProjectGate
      loadingFallback={<DashboardLoadingState />}
      renderHome={(home) => <CompanyDashboard {...home} />}
    >
      {() => null}
    </AuthProjectGate>
  );
}

export function PlanningRouteShell() {
  return (
    <PlanningRoute>
      <WorkOrderBoard />
    </PlanningRoute>
  );
}

export function SettingsRouteShell() {
  return (
    <AuthProjectGate
      loadingFallback={<SettingsLoadingState />}
      renderHome={(home) => <SettingsWorkspace {...home} />}
    >
      {() => null}
    </AuthProjectGate>
  );
}

export function ProductionRouteShell() {
  return (
    <AuthProjectGate
      loadingFallback={<ProductionLoadingState />}
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
  const searchParams = useSearchParams();
  const loadingFallback = searchParams.get("view") === "settings" ? <SettingsLoadingState /> : <ProductLoadingState />;

  return (
    <AuthProjectGate projectId={projectId} routeKind="planner" loadingFallback={loadingFallback}>
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
