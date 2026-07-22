"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import type { PlannerState, WorkspaceProjectGroup } from "@/domain/types";
import { AppLoadingShell } from "./app-flow-panels";
import { AuthProjectGate } from "./auth-project-gate";
import {
  DashboardLoadingState,
  PlanningLoadingState,
  ProductLoadingState,
  ProductionLoadingState,
  SettingsLoadingState,
} from "./space-loading-states";

/** Server-fetched workspace groups forwarded into the gate (Stage 5). */
type ShellProps = { initialGroups?: WorkspaceProjectGroup[] };

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
// `PlanningRoute` is no longer imported here — `app/planning/layout.tsx` mounts it once for the
// whole space instead of each route wrapping itself in it.
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
export function HomeRouteShell({ initialGroups }: ShellProps = {}) {
  return (
    <AuthProjectGate
      initialGroups={initialGroups}
      loadingFallback={<DashboardLoadingState />}
      renderHome={(home) => <CompanyDashboard {...home} />}
    >
      {() => null}
    </AuthProjectGate>
  );
}

/**
 * The Planning board. Auth, workspace and the access gate are provided once by
 * `app/planning/layout.tsx`, so this shell no longer wraps itself in `PlanningRoute` — doing so
 * would re-run the gate on every navigation, which is the flash the layout exists to remove.
 * The dynamic import stays: it keeps the board out of the initial bundle.
 */
export function PlanningRouteShell() {
  return <WorkOrderBoard />;
}

export function SettingsRouteShell({ initialGroups }: ShellProps = {}) {
  return (
    <AuthProjectGate
      initialGroups={initialGroups}
      loadingFallback={<SettingsLoadingState />}
      renderHome={(home) => <SettingsWorkspace {...home} />}
    >
      {() => null}
    </AuthProjectGate>
  );
}

export function ProductionRouteShell({ initialGroups }: ShellProps = {}) {
  return (
    <AuthProjectGate
      initialGroups={initialGroups}
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

export function PlannerRouteShell({
  projectId,
  initialGroups,
  initialPlannerState,
}: { projectId?: string; initialPlannerState?: PlannerState } & ShellProps) {
  const searchParams = useSearchParams();
  const loadingFallback = searchParams.get("view") === "settings" ? <SettingsLoadingState /> : <ProductLoadingState />;

  return (
    <AuthProjectGate
      projectId={projectId}
      routeKind="planner"
      initialGroups={initialGroups}
      loadingFallback={loadingFallback}
    >
      {(project, onReady) => (
        <LineWorkspace
          projectContext={project}
          projectId={project?.projectId ?? projectId}
          onReady={onReady}
          initialPlannerState={initialPlannerState}
        />
      )}
    </AuthProjectGate>
  );
}

export function MobilePhotoRouteShell({
  projectId,
  initialGroups,
  initialPlannerState,
}: { projectId?: string; initialPlannerState?: PlannerState } & ShellProps) {
  return (
    <AuthProjectGate projectId={projectId} routeKind="mobile-photos" initialGroups={initialGroups}>
      {(project, onReady) => (
        <MobilePhotoPortal
          projectContext={project}
          projectId={project?.projectId ?? projectId}
          onReady={onReady}
          initialPlannerState={initialPlannerState}
        />
      )}
    </AuthProjectGate>
  );
}
