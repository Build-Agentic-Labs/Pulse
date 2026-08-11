"use client";

import { WorkspaceListSettings } from "@/components/workspace-list-settings";
import { WorkspaceMembersSettings } from "@/components/workspace-members-settings";
import type { PlannerProjectContext } from "@/domain/types";

/** One lazily loaded organization section so Settings pays for this data UI only after selection. */
export function OrganizationSettings({ project }: { project?: PlannerProjectContext }) {
  return (
    <>
      <WorkspaceListSettings />
      <WorkspaceMembersSettings project={project} />
      {/* Keep the audit feed hidden until its activity descriptions are reliable. */}
    </>
  );
}
