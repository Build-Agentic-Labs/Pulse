"use client";

import type { ReactNode } from "react";
import { AuthProjectGate } from "@/components/auth-project-gate";
import type { WorkspaceProjectGroup } from "@/domain/types";
import { PlanningAccessGate } from "./planning-shell";
import { PlanningWorkspaceProvider } from "./planning-workspace-provider";

/**
 * Shared wrapper for every Planning route: auth/workspace loading (`AuthProjectGate`), workspace
 * selection (`PlanningWorkspaceProvider`), then the space's own access check (`PlanningAccessGate`).
 * Extracted from what `PlanningRouteShell` used to build inline so every Planning sub-route (the
 * board, new-work-order, work-order detail, ...) gets identical gating with one implementation.
 */
export function PlanningRoute({
  children,
  initialGroups,
}: {
  children: ReactNode;
  /** Server-fetched workspace groups forwarded into the gate (Stage 5). */
  initialGroups?: WorkspaceProjectGroup[];
}) {
  return (
    <AuthProjectGate
      initialGroups={initialGroups}
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
