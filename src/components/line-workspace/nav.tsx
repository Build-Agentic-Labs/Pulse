"use client";

import {
  BarChart3,
  BookOpen,
  Boxes,
  ChevronLeft,
  ClipboardCheck,
  ClipboardList,
  Factory,
  FileText,
  GitBranch,
  ListChecks,
  Package,
  PanelLeft,
  PanelLeftClose,
  Settings,
  ShieldAlert,
  Tags,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import type { PlannerProjectContext } from "@/domain/types";
import { embeddedSettingsSections, type SettingsSection } from "../app-settings-panel";
import { NavSelectionTrack } from "../nav-selection-track";
import { SidebarWorkspacePanel } from "../sidebar-workspace-panel";

export const plannerModules = [
  { id: "dashboard", label: "Dashboard", icon: Factory },
  { id: "setup", label: "Setup", icon: ClipboardList },
  { id: "gantt", label: "Gantt", icon: GitBranch },
  { id: "procedure", label: "Procedure", icon: ListChecks },
  { id: "pfmea", label: "PFMEA", icon: ShieldAlert },
  { id: "checklist", label: "Checklist", icon: ClipboardCheck },
  { id: "work-instructions", label: "Work Instructions", icon: BookOpen },
  { id: "balance", label: "Balance", icon: BarChart3 },
  { id: "reports", label: "Reports", icon: FileText },
];

export const setupSections = [
  { id: "product", label: "Product", icon: Package },
  { id: "nomenclature", label: "Document Control", icon: Tags },
  { id: "procedure-checks", label: "Procedure Checks", icon: ListChecks },
  { id: "tools", label: "Tools", icon: Wrench },
  { id: "bom", label: "BOM", icon: Boxes },
] as const;

export type SetupSection = (typeof setupSections)[number]["id"];

export const comingSoonModuleIds = new Set(["balance", "reports"]);

// Modules reachable via Alt+1..N and the command palette (coming-soon ones excluded).
export const quickSwitchModules = plannerModules.filter((module) => !comingSoonModuleIds.has(module.id));

/** Floating control that reappears when the sidebar is collapsed, so it can be reopened. */
export function SidebarReopenButton({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  if (!collapsed) {
    return null;
  }
  return (
    <button
      type="button"
      onClick={onToggle}
      className="ui-btn-ghost absolute left-2 top-2 z-30 hidden h-8 w-8 items-center justify-center bg-surface px-0 text-ink-tertiary hover:text-ink lg:inline-flex"
      title="Show sidebar"
      aria-label="Show sidebar"
    >
      <PanelLeft size={15} strokeWidth={1.75} />
    </button>
  );
}

export function Sidebar({
  activeModule,
  settingsSection,
  setupSection,
  onChange,
  onSetupSectionChange,
  onOpenSettings,
  onCollapse,
  project,
}: {
  activeModule: string;
  settingsSection: SettingsSection;
  setupSection: SetupSection;
  onChange: (moduleId: string) => void;
  onSetupSectionChange: (section: SetupSection) => void;
  onOpenSettings: (section?: SettingsSection) => void;
  onCollapse: () => void;
  project?: PlannerProjectContext;
}) {
  const isSettingsModule = activeModule === "settings";
  const isSetupModule = activeModule === "setup";

  return (
    <aside className="ui-nav-sidebar">
      <div className="flex h-9 shrink-0 items-center justify-end px-2">
        <button
          type="button"
          onClick={onCollapse}
          className="ui-btn-ghost inline-flex h-8 w-8 items-center justify-center px-0 text-ink-tertiary hover:text-ink"
          title="Hide sidebar"
          aria-label="Hide sidebar"
        >
          <PanelLeftClose size={15} strokeWidth={1.75} />
        </button>
      </div>
      <SidebarWorkspacePanel activeProject={project} />

      <nav className="flex min-h-0 flex-1 flex-col overflow-auto px-2 py-2">
        {isSettingsModule ? (
          <>
            <button
              type="button"
              onClick={() => onChange("dashboard")}
              className="ui-settings-back"
              title="Back to Product"
            >
              <ChevronLeft size={14} strokeWidth={1.75} />
              Back to Product
            </button>
            <NavSelectionTrack
              activeIndex={embeddedSettingsSections.findIndex((item) => item.id === settingsSection)}
              className="space-y-0.5"
            >
              {embeddedSettingsSections.map((item) => {
                const Icon = item.icon;
                const active = settingsSection === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    title={item.label}
                    onClick={() => onOpenSettings(item.id)}
                    className={`ui-nav-item ${active ? "ui-nav-item-active" : "ui-nav-item-idle"}`}
                  >
                    <Icon size={15} strokeWidth={1.75} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </NavSelectionTrack>
          </>
        ) : isSetupModule ? (
          <>
            <button
              type="button"
              onClick={() => onChange("dashboard")}
              className="ui-settings-back"
              title="Back to Product"
            >
              <ChevronLeft size={14} strokeWidth={1.75} />
              Back to Product
            </button>
            <div className="ui-nav-section">Setup</div>
            <NavSelectionTrack
              activeIndex={setupSections.findIndex((item) => item.id === setupSection)}
              className="space-y-0.5"
            >
              {setupSections.map((item) => {
                const Icon = item.icon;
                const active = setupSection === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    title={item.label}
                    onClick={() => onSetupSectionChange(item.id)}
                    className={`ui-nav-item ${active ? "ui-nav-item-active" : "ui-nav-item-idle"}`}
                  >
                    <Icon size={15} strokeWidth={1.75} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </NavSelectionTrack>
          </>
        ) : (
          <>
            <div className="ui-nav-section">Planner</div>
            <NavSelectionTrack
              activeIndex={plannerModules.findIndex((module) => module.id === activeModule)}
              className="space-y-0.5"
            >
              {plannerModules.map((module) => {
                const Icon = module.icon;
                const active = activeModule === module.id;
                return (
                  <button
                    key={module.id}
                    type="button"
                    title={module.label}
                    onClick={() => onChange(module.id)}
                    className={`ui-nav-item ${active ? "ui-nav-item-active" : "ui-nav-item-idle"}`}
                  >
                    <Icon size={15} strokeWidth={1.75} />
                    <span>{module.label}</span>
                  </button>
                );
              })}
            </NavSelectionTrack>
          </>
        )}
      </nav>

      <div className="mt-auto space-y-2 px-2 py-2">
        {!isSettingsModule ? (
          <Link href="/settings" className="ui-nav-footer-item">
            <Settings size={15} strokeWidth={1.75} />
            Settings
          </Link>
        ) : null}
      </div>
    </aside>
  );
}
