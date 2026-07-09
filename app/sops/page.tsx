import { Suspense } from "react";
import { AppLoadingShell } from "@/components/app-flow-panels";
import { SopWorkspace } from "@/components/sop/sop-workspace";

export const metadata = {
  title: "SOPs | Pulse",
  description: "Create standardized SOPs and convert legacy documents.",
};

// The provider is mounted once in app/sops/layout.tsx, so the page renders the persistent
// tabbed shell directly. SopWorkspace reads the `?tab=` param via useSearchParams, which Next 15
// requires inside a Suspense boundary.
export default function SopsPage() {
  return (
    <Suspense fallback={<AppLoadingShell title="Loading SOPs" />}>
      <SopWorkspace />
    </Suspense>
  );
}
