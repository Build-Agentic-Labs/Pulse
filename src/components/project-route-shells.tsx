"use client";

import { AuthProjectGate } from "./auth-project-gate";
import { CompanyDashboard } from "./company-dashboard";
import { LineWorkspace } from "./line-workspace";
import { MobilePhotoPortal } from "./mobile-photo-portal";
import { NothingLoadingBlock } from "./nothing-ui";
import { PlanningAccessGate, PlanningShell } from "./planning/planning-shell";
import { PlanningWorkspaceProvider } from "./planning/planning-workspace-provider";
import { SpacePlaceholder } from "./space-placeholder";

/** The post-login landing page: company-space cards instead of an auto-redirect. */
export function HomeRouteShell() {
  return (
    <AuthProjectGate renderHome={(home) => <CompanyDashboard {...home} />}>{() => null}</AuthProjectGate>
  );
}

export function PlanningRouteShell() {
  return (
    <AuthProjectGate
      renderHome={(home) => (
        <PlanningWorkspaceProvider groups={home.groups}>
          <PlanningAccessGate>
            <PlanningShell>
              {/* WorkOrderBoard arrives in Task 7 — compiling stub until then. */}
              <div className="ui-panel p-5">
                <NothingLoadingBlock title="Work orders" body="The work-order board is coming together." />
              </div>
            </PlanningShell>
          </PlanningAccessGate>
        </PlanningWorkspaceProvider>
      )}
    >
      {() => null}
    </AuthProjectGate>
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
