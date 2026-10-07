"use client";

import { SopShell } from "@/components/sop/sop-shell";
import { SopTabNav } from "@/components/sop/sop-tab-nav";

/** Safe before the workspace provider is ready: no WI reads or builder navigation. */
export function WiRouteLoadingState() {
  return (
    <SopShell
      crumb="Quality / Work instructions"
      sidebar={<SopTabNav active="work-instructions" manage={false} />}
    >
      <div className="mx-auto max-w-6xl space-y-6" aria-busy="true">
        <div role="status" aria-label="Opening work instructions" className="text-sm text-ink-secondary">
          Opening work instructions…
        </div>
        <div className="ui-skeleton-line h-8 w-64" aria-hidden="true" />
        <div className="ui-skeleton-line h-48 w-full" aria-hidden="true" />
      </div>
    </SopShell>
  );
}
