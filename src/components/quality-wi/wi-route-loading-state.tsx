"use client";

import { QualitySkeleton } from "@/components/sop/quality-skeleton";
import { SopShell } from "@/components/sop/sop-shell";
import { SopTabNav } from "@/components/sop/sop-tab-nav";

/** Safe before the workspace provider is ready: no WI reads or builder navigation. */
export function WiRouteLoadingState({ editor = false, published = false }: { editor?: boolean; published?: boolean }) {
  const title = published ? "Published Work Instructions" : "Work Instruction Builder";
  return (
    <SopShell
      crumb={`Quality / ${title}`}
      sidebar={<SopTabNav active={published ? "published-work-instructions" : "work-instructions"} manage={false} />}
    >
      <div className="mx-auto max-w-6xl space-y-6">
        {!editor ? <div>
          <h1 className="ui-section-title">{title}</h1>
          <p className="ui-section-subtitle mt-1">{published ? "Published procedures, organized by department." : "Draft work instructions, organized by department."}</p>
        </div> : null}
        <QualitySkeleton variant={editor ? "form" : "list"} label={editor ? "Opening work instruction" : "Opening work instructions"} />
      </div>
    </SopShell>
  );
}
