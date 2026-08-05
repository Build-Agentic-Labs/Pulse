"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import type { PlannerState, WorkspaceProjectGroup } from "@/domain/types";
import { WORK_INSTRUCTION_LAYOUTS } from "@/domain/work-instruction/schema";
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
const WorkInstructionPrintPreview = dynamic(
  () => import("./work-instruction/work-instruction-print").then((module) => module.WorkInstructionPrintPreview),
  { loading: () => <ProductLoadingState /> },
);
const LineWorkspace = dynamic(
  () => import("./line-workspace").then((module) => module.LineWorkspace),
  { loading: ProjectRouteLoading },
);
const MobilePhotoPortal = dynamic(
  () => import("./mobile-photo-portal").then((module) => module.MobilePhotoPortal),
  { loading: () => <AppLoadingShell title="Opening photos" /> },
);
// `app/planning/(workspace)/layout.tsx` mounts this once for the whole space, so in-space routes
// do not wrap themselves in it. It is still needed for `GatedPlanningRouteShell` below, which
// renders the board from OUTSIDE that layout.
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
 * The Planning board, for routes UNDER `app/planning/(workspace)/` — that layout provides auth,
 * the workspace provider and the access gate once, so wrapping again here would re-run the gate
 * on every navigation, which is the flash the layout exists to remove. The dynamic import stays:
 * it keeps the board out of the initial bundle.
 */
export function PlanningRouteShell() {
  return <WorkOrderBoard />;
}

/**
 * The same board WITH its own gate, for rendering outside the Planning layout — specifically
 * `/login?returnTo=/planning`, which renders the destination in place so an unauthenticated
 * visitor gets the sign-in panel and lands where they were headed. Without the gate the board
 * would call `usePlanningWorkspace()` with no provider above it and throw, turning a sign-in
 * into an error screen.
 */
export function GatedPlanningRouteShell({ initialGroups }: ShellProps = {}) {
  return (
    <PlanningRoute initialGroups={initialGroups}>
      <div className="flex h-[100dvh] flex-col">
        <WorkOrderBoard />
      </div>
    </PlanningRoute>
  );
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

/**
 * Print sub-route of the planner. Same access requirements as the planner
 * itself, so it reuses `routeKind: "planner"`; the print view deliberately
 * renders without workspace chrome.
 */
export function WorkInstructionPrintRouteShell({
  projectId,
  initialGroups,
  initialPlannerState,
  taskIds,
  scenarioId,
  blank,
  layoutId,
}: {
  projectId: string;
  initialPlannerState?: PlannerState;
  taskIds: string[];
  scenarioId?: string;
  blank?: boolean;
  /** Already validated by the route; undefined means the app default. */
  layoutId?: string;
} & ShellProps) {
  return (
    <AuthProjectGate projectId={projectId} routeKind="planner" initialGroups={initialGroups}>
      {(project, onReady) => (
        <WorkInstructionPrintPreview
          projectId={project?.projectId ?? projectId}
          scenarioId={scenarioId}
          taskIds={taskIds}
          blank={blank}
          initialPlannerState={initialPlannerState}
          layout={layoutId ? WORK_INSTRUCTION_LAYOUTS[layoutId] : undefined}
          onReady={onReady}
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
