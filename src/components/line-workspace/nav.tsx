"use client";

import {
  BarChart3,
  BookOpen,
  Boxes,
  ChevronLeft,
  ClipboardList,
  Factory,
  FileText,
  GitBranch,
  ListChecks,
  Package,
  PanelLeft,
  PanelLeftClose,
  Settings,
  Tags,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { type SaveState } from "@/domain/supabase-planner";
import type { PlannerProjectContext } from "@/domain/types";
import { type PresencePeer } from "@/lib/use-planner-presence";
import { embeddedSettingsSections, type SettingsSection } from "../app-settings-panel";
import { NavSelectionTrack } from "../nav-selection-track";
import { NothingStatus } from "../nothing-ui";
import { buildPlannerChromeContext } from "../planner-dashboard-panel";
import { SidebarWorkspacePanel } from "../sidebar-workspace-panel";
import { BackToDashboardButton, UserNav } from "../user-nav";

export const plannerModules = [
  { id: "dashboard", label: "Dashboard", icon: Factory },
  { id: "setup", label: "Setup", icon: ClipboardList },
  { id: "gantt", label: "Gantt", icon: GitBranch },
  { id: "procedure", label: "Procedure", icon: ListChecks },
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

function presenceInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "?";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return `${first}${last}`.toUpperCase();
}

function PresenceStack({ peers }: { peers: PresencePeer[] }) {
  if (!peers.length) {
    return null;
  }

  const visible = peers.slice(0, 4);
  return (
    <div
      className="hidden items-center -space-x-1.5 sm:flex"
      title={`Also viewing this project: ${peers.map((peer) => peer.name).join(", ")}`}
    >
      {visible.map((peer) => (
        <span
          key={peer.key}
          className="flex h-6 w-6 items-center justify-center rounded-full border border-line bg-surface-active text-[10px] font-medium text-ink-secondary"
          title={peer.name}
        >
          {presenceInitials(peer.name)}
        </span>
      ))}
      {peers.length > visible.length ? (
        <span className="flex h-6 w-6 items-center justify-center rounded-full border border-line bg-surface text-[10px] text-ink-tertiary">
          +{peers.length - visible.length}
        </span>
      ) : null}
    </div>
  );
}

// Maps the persistent planner save state to the chrome status chip. Returns null for
// states that need no indicator (idle/loading/draft) so the chip only appears when it matters.
export function plannerSaveStatus(state: SaveState): { message: string; error?: boolean } | null {
  switch (state) {
    case "saving":
    case "retrying":
      return { message: "Saving…" };
    case "saved":
      return { message: "Saved" };
    case "error":
    case "conflict":
      return { message: "Save failed", error: true };
    default:
      return null;
  }
}

export function TopNav({
  context,
  chromeStatus,
  saveStatus,
  presence,
}: {
  context?: ReturnType<typeof buildPlannerChromeContext>;
  chromeStatus?: { message: string; error?: boolean } | null;
  saveStatus?: { message: string; error?: boolean } | null;
  presence?: PresencePeer[];
}) {
  // A transient chrome event (notifyFeedback) takes priority; otherwise show the
  // persistent save indicator so the planner always signals its save state.
  const status = chromeStatus ?? saveStatus ?? null;

  if (context) {
    return (
      <header className="ui-chrome ui-chrome-planner z-40 h-12 shrink-0">
        <div className="ui-chrome-planner-brand">
          <BackToDashboardButton />
          <Link href="/" className="ui-brand-compact shrink-0" title="Company dashboard">
            Pulse
          </Link>
        </div>

        <div className="ui-chrome-planner-context min-w-0">
          <span className="ui-chrome-context-title truncate">{context.title}</span>
          <span className="ui-chrome-context-meta hidden min-w-0 truncate sm:inline">
            <span className={context.statusClass}>{context.status}</span>
            {context.detail ? (
              <>
                <span aria-hidden> · </span>
                <span>{context.detail}</span>
              </>
            ) : null}
          </span>
        </div>

        <div className="ui-chrome-planner-actions">
          {presence ? <PresenceStack peers={presence} /> : null}
          {status ? (
            <div className="ui-chrome-status max-w-[min(28rem,42vw)]">
              <NothingStatus error={status.error}>{status.message}</NothingStatus>
            </div>
          ) : null}
          <UserNav />
        </div>
      </header>
    );
  }

  return (
    <header className="ui-chrome z-40 flex h-12 shrink-0 items-center justify-between gap-3 px-3 sm:px-4 lg:px-0">
      <div className="ui-chrome-brand flex min-w-0 items-center gap-1 sm:gap-2 lg:gap-0.5 lg:px-2">
        <BackToDashboardButton />
        <Link href="/" className="ui-brand-compact shrink-0" title="Company dashboard">
          Pulse
        </Link>
      </div>

      <div className="flex min-w-0 flex-1 lg:hidden" />

      <div className="flex shrink-0 items-center gap-0.5 sm:gap-1 lg:pr-4">
        {status ? (
          <div className="ui-chrome-status max-w-[min(24rem,38vw)]">
            <NothingStatus error={status.error}>{status.message}</NothingStatus>
          </div>
        ) : null}
        <UserNav />
      </div>
    </header>
  );
}

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

