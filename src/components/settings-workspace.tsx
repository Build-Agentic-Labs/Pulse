"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  AppSettingsPanel,
  settingsSections,
  type SettingsSection,
} from "@/components/app-settings-panel";
import type { DashboardHomeContext } from "@/components/auth-project-gate";
import { PlanningWorkspaceProvider } from "@/components/planning/planning-workspace-provider";
import { SopWorkspaceFromGroupsProvider } from "@/components/sop/sop-workspace-provider";
import { SpaceTopNav } from "@/components/space-top-nav";
import type { PlannerProjectContext } from "@/domain/types";

function parseSection(value: string | null): SettingsSection {
  return settingsSections.some((section) => section.id === value) ? value as SettingsSection : "account";
}

function preferredProjectContext({
  groups,
  preferredProjectId,
}: DashboardHomeContext): PlannerProjectContext | undefined {
  for (const group of groups) {
    const project = group.projects.find((candidate) => candidate.id === preferredProjectId)
      ?? group.projects.find((candidate) => candidate.status !== "archived");
    if (!project) continue;
    return {
      projectId: project.id,
      projectName: project.name,
      workspaceId: group.workspace.id,
      workspaceName: group.workspace.name,
      role: group.role,
      accessLevel: group.isSuperAdmin || group.role === "owner" || group.role === "admin" ? "edit" : project.accessLevel,
    };
  }
  return undefined;
}

export function SettingsWorkspace(home: DashboardHomeContext) {
  const searchParams = useSearchParams();
  const [section, setSection] = useState<SettingsSection>(() => parseSection(searchParams.get("section")));
  const project = useMemo(() => preferredProjectContext(home), [home]);

  useEffect(() => {
    const requested = searchParams.get("section");
    if (requested && !settingsSections.some((candidate) => candidate.id === requested)) {
      window.history.replaceState(null, "", "/settings");
    }
  }, [searchParams]);

  function selectSection(next: SettingsSection) {
    setSection(next);
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", next === "account" ? "/settings" : `/settings?section=${next}`);
    }
  }

  return (
    <PlanningWorkspaceProvider groups={home.groups}>
      <SopWorkspaceFromGroupsProvider groups={home.groups}>
        <div className="ui-settings-workspace fixed inset-0 flex h-[100dvh] flex-col overflow-hidden bg-surface text-ink">
          <SpaceTopNav context="Settings" />

          <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
            <AppSettingsPanel
              groups={home.groups}
              project={project}
              section={section}
              onSectionChange={selectSection}
            />
          </main>
        </div>
      </SopWorkspaceFromGroupsProvider>
    </PlanningWorkspaceProvider>
  );
}
