import type { ReactNode } from "react";
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
export default async function SopsLayout({ children }: { children: ReactNode }) {
  return (
    <SopWorkspaceProvider initial={await fetchInitialSopWorkspaceData()}>
      {children}
    </SopWorkspaceProvider>
  );
}
