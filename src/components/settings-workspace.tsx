"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import {
  AppSettingsPanel,
  settingsSections,
  type SettingsSection,
} from "@/components/app-settings-panel";
import type { DashboardHomeContext } from "@/components/auth-project-gate";
import { PlanningWorkspaceProvider } from "@/components/planning/planning-workspace-provider";
import { SopWorkspaceFromGroupsProvider } from "@/components/sop/sop-workspace-provider";
import { BackToDashboardButton, UserNav } from "@/components/user-nav";
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

  function selectSection(next: SettingsSection) {
    setSection(next);
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", next === "account" ? "/settings" : `/settings?section=${next}`);
    }
  }

  return (
    <PlanningWorkspaceProvider groups={home.groups}>
      <SopWorkspaceFromGroupsProvider groups={home.groups}>
        <div className="ui-settings-workspace ui-sop-shell fixed inset-0 flex h-[100dvh] flex-col overflow-hidden bg-surface text-ink">
          <header className="ui-chrome z-40 flex h-12 shrink-0 items-center justify-between px-3 sm:px-4">
            <div className="flex min-w-0 items-center gap-3">
              <BackToDashboardButton />
              <Link href="/" className="ui-brand-compact shrink-0">Pulse</Link>
              <span className="ui-chrome-divider hidden sm:block" />
              <span className="ui-chrome-context-label hidden truncate sm:inline">Settings</span>
            </div>
            <UserNav />
          </header>

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
