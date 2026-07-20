"use client";

import type { ReactNode } from "react";
import { AuthProjectGate } from "@/components/auth-project-gate";
import { PlanningLoadingState } from "@/components/space-loading-states";
import { PlanningAccessGate } from "./planning-shell";
import { PlanningWorkspaceProvider } from "./planning-workspace-provider";

/**
 * Shared wrapper for every Planning route: auth/workspace loading (`AuthProjectGate`), workspace
 * selection (`PlanningWorkspaceProvider`), then the space's own access check (`PlanningAccessGate`).
 * Extracted from what `PlanningRouteShell` used to build inline so every Planning sub-route (the
 * board, new-work-order, work-order detail, ...) gets identical gating with one implementation.
 */
export function PlanningRoute({ children }: { children: ReactNode }) {
  return (
    <AuthProjectGate
      loadingFallback={<PlanningLoadingState />}
      renderHome={(home) => (
        <PlanningWorkspaceProvider groups={home.groups}>
          <PlanningAccessGate>{children}</PlanningAccessGate>
        </PlanningWorkspaceProvider>
      )}
    >
      {() => null}
    </AuthProjectGate>
  );
}
