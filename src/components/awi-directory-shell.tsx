"use client";

import { PanelLeftClose } from "lucide-react";
import { useState, type CSSProperties, type ReactNode } from "react";
import type { PlannerProjectContext, WorkspaceProjectGroup } from "@/domain/types";
import { SpaceTopNav } from "./space-top-nav";
import { SidebarWorkspacePanel } from "./sidebar-workspace-panel";
import { SidebarReopenButton } from "./line-workspace/nav";

/** Shared geometry for the streamed list fallback and the ready directory. */
export function AwiDirectoryShell({ project, groups, workspaceId, loading = false, children }: {
  project?: PlannerProjectContext;
  groups?: WorkspaceProjectGroup[];
  workspaceId?: string;
  loading?: boolean;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  return <div className="fixed inset-0 h-[100dvh] overflow-hidden bg-canvas text-ink"
    style={{ "--workspace-sidebar-width": collapsed ? "0px" : "var(--shell-sidebar)" } as CSSProperties}>
    <SpaceTopNav context="AWI Master List" />
    <div className="relative ui-workspace-shell">
      <SidebarReopenButton collapsed={collapsed} onToggle={() => setCollapsed(false)} />
      <div className={`ui-workspace-sidebar-slot ${collapsed ? "ui-workspace-sidebar-slot-collapsed" : ""}`}>
        <aside className="ui-nav-sidebar">
          <div className="flex h-9 shrink-0 items-center justify-end px-2">
            <button type="button" className="ui-btn-ghost inline-flex h-8 w-8 items-center justify-center px-0 text-ink-tertiary hover:text-ink"
              aria-label="Hide sidebar" title="Hide sidebar" onClick={() => setCollapsed(true)}><PanelLeftClose size={15} strokeWidth={1.75} /></button>
          </div>
          <SidebarWorkspacePanel activeProject={project} initialGroups={groups} preferredWorkspaceId={workspaceId} />
        </aside>
      </div>
      <main aria-busy={loading || undefined} className="min-h-0 min-w-0 overflow-auto rounded-l-xl bg-canvas p-6 transition-[border-radius] duration-300 ease-out sm:p-8">
        {children}
      </main>
    </div>
  </div>;
}
