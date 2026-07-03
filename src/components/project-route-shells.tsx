"use client";

import { AuthProjectGate } from "./auth-project-gate";
import { CompanyDashboard } from "./company-dashboard";
import { ExcelGanttReadonly } from "./excel-gantt-readonly";
import { LineWorkspace } from "./line-workspace";
import { MobilePhotoPortal } from "./mobile-photo-portal";
import { SpacePlaceholder, TemplateRow } from "./space-placeholder";

/** The post-login landing page: company-space cards instead of an auto-redirect. */
export function HomeRouteShell() {
  return (
    <AuthProjectGate renderHome={(home) => <CompanyDashboard {...home} />}>{() => null}</AuthProjectGate>
  );
}

export function PlanningRouteShell() {
  return (
    <AuthProjectGate
      renderHome={() => (
        <SpacePlaceholder
          space="planning"
          name="Planning"
          description="Production planning for the whole line: a tool that helps the planner turn demand into scheduled, capacity-checked work orders."
          planned={[
            "Work orders — create, release and track orders through the line",
            "Schedule — orders placed against takt and station capacity",
            "Capacity — load vs. available hours per station and shift",
          ]}
        >
          <section className="ui-panel mt-4 p-5">
            <div className="flex items-baseline justify-between">
              <div className="ui-mono-label">Work orders · Template preview</div>
              <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-ink-tertiary">
                WO · Product · Qty · Due · Status
              </div>
            </div>
            <div className="mt-3">
              <TemplateRow widths={["56px", "22%", "36px", "64px", "48px"]} />
              <TemplateRow widths={["56px", "30%", "36px", "64px", "48px"]} />
              <TemplateRow widths={["56px", "18%", "36px", "64px", "48px"]} />
            </div>
          </section>
        </SpacePlaceholder>
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
