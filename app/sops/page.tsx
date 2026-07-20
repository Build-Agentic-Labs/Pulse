import { Suspense } from "react";
import { QualityLoadingState } from "@/components/space-loading-states";
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
    <Suspense fallback={<QualityLoadingState />}>
      <SopWorkspace />
    </Suspense>
  );
}
