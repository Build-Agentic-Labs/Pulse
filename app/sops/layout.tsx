import { ProblemPilotAccessProvider } from "@/components/problem-solving/problem-pilot-link";
import { Suspense, type ReactNode } from "react";
import { QualityLoadingState } from "@/components/space-loading-states";
import { SopRouteLoadingState } from "@/components/sop/sop-route-loading-state";
import { SopWorkspaceProvider } from "@/components/sop/sop-workspace-provider";
import { fetchInitialSopWorkspaceData } from "@/lib/supabase/server-data";

export const metadata = {
  title: "SOPs | Pulse",
  description: "Standard operating procedures, document control and review.",
};

/**
 * One provider for the entire SOP section. Mounting it here (not per page) means it authenticates
 * and loads the workspace ONCE and stays mounted while you move between SOP screens — no
 * "Loading SOPs" flash on every navigation. The persistent tabbed shell lives in SopWorkspace.
 */
async function AuthenticatedSopWorkspace({ children }: { children: ReactNode }) {
  const initial = await fetchInitialSopWorkspaceData();
  return (
    <SopWorkspaceProvider initial={initial}>
      <ProblemPilotAccessProvider initialUserId={initial?.userId} initialAllowed={initial?.problemPilotAllowed}>{children}</ProblemPilotAccessProvider>
    </SopWorkspaceProvider>
  );
}

export default function SopsLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<SopRouteLoadingState><QualityLoadingState /></SopRouteLoadingState>}>
      <AuthenticatedSopWorkspace>{children}</AuthenticatedSopWorkspace>
    </Suspense>
  );
}
