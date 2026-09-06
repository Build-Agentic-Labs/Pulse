"use client";

import {
  BookOpen,
  Boxes,
  ChevronLeft,
  ChevronDown,
  ClipboardCheck,
  ClipboardList,
  Factory,
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
import { useEffect, useState } from "react";
import type { PlannerProjectContext } from "@/domain/types";
import { embeddedSettingsSections, type SettingsSection } from "../app-settings-panel";
import { NavSelectionTrack } from "../nav-selection-track";
import { SidebarWorkspacePanel } from "../sidebar-workspace-panel";

export const plannerModules = [
  { id: "dashboard", label: "Dashboard", icon: Factory },
  { id: "gantt", label: "Gantt", icon: GitBranch },
  { id: "procedure", label: "Procedure", icon: ListChecks },
  { id: "pfmea", label: "PFMEA", icon: ShieldAlert },
  { id: "checklist", label: "Checklist", icon: ClipboardCheck },
  { id: "work-instructions", label: "Work Instructions", icon: BookOpen },
  { id: "setup", label: "Setup", icon: ClipboardList },
];

export const setupSections = [
  { id: "product", label: "Product", icon: Package },
  { id: "nomenclature", label: "Document Control", icon: Tags },
  { id: "procedure-checks", label: "Procedure Checks", icon: ListChecks },
  { id: "tools", label: "Tools", icon: Wrench },
  { id: "bom", label: "BOM", icon: Boxes },
] as const;

export type SetupSection = (typeof setupSections)[number]["id"];

const mainModules = plannerModules.filter(module => module.id !== "setup");
export const quickSwitchModules = plannerModules;

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
  const [setupExpanded, setSetupExpanded] = useState(isSetupModule);
  useEffect(() => { if (isSetupModule) setSetupExpanded(true); }, [isSetupModule]);

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
        ) : (
          <>
            <div className="ui-nav-section">Planner</div>
            <NavSelectionTrack
              activeIndex={mainModules.findIndex((module) => module.id === activeModule)}
              className="space-y-0.5"
            >
              {mainModules.map((module) => {
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
            <div className="mt-3 border-t border-line pt-2">
              <button type="button" className="ui-nav-item ui-nav-item-idle w-full" aria-expanded={setupExpanded} aria-controls="planner-setup-sections" onClick={() => setSetupExpanded(value => !value)}>
                <ClipboardList size={15} strokeWidth={1.75} /><span>Setup</span>
                <ChevronDown size={13} className={`ml-auto transition-transform duration-200 motion-reduce:transition-none ${setupExpanded ? "rotate-180" : ""}`} />
              </button>
              <div id="planner-setup-sections" className="ui-setup-accordion" data-open={setupExpanded} inert={!setupExpanded} aria-hidden={!setupExpanded}>
                <div className="min-h-0 overflow-hidden">
                  <NavSelectionTrack activeIndex={isSetupModule ? setupSections.findIndex(item => item.id === setupSection) : -1} className="ml-3 space-y-0.5 border-l border-line pl-2 pt-1">
                    {setupSections.map(item => <button key={item.id} type="button" title={item.label} onClick={() => { if (!isSetupModule) onChange("setup"); onSetupSectionChange(item.id); }} className={`ui-nav-item ${isSetupModule && setupSection === item.id ? "ui-nav-item-active" : "ui-nav-item-idle"}`}><span>{item.label}</span></button>)}
                  </NavSelectionTrack>
                </div>
              </div>
            </div>
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
