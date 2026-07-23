import {
  Archive,
  ArrowLeft,
  CircleUserRound,
  ClipboardList,
  FileText,
  FileSpreadsheet,
  FolderKanban,
  Inbox,
  Library,
  Palette,
  PanelLeftClose,
  Settings,
  Settings2,
  UsersRound,
} from "lucide-react";
import type { CSSProperties } from "react";

function LoadingStatus({ label }: { label: string }) {
  return (
    <span className="ui-transition-status" role="status" aria-live="polite">
      {label}
    </span>
  );
}

function ChromePlaceholder({ space, label }: { space?: string; label: string }) {
  return (
    <header className="ui-chrome flex h-12 shrink-0 items-center gap-3 px-4">
      <span className="grid h-8 w-8 place-items-center text-ink-tertiary" aria-hidden="true">
        <ArrowLeft size={15} strokeWidth={1.75} />
      </span>
      <span className="ui-brand-compact">Pulse</span>
      {space ? (
        <>
          <span className="ui-chrome-divider" />
          <span className="ui-chrome-context-label truncate">{space}</span>
        </>
      ) : null}
      <span className="flex-1" />
      <LoadingStatus label={label} />
      <span className="h-7 w-7 rounded-full border border-line bg-surface-muted" aria-hidden="true" />
    </header>
  );
}

function SkeletonLine({ className = "" }: { className?: string }) {
  return <span className={`ui-skeleton-line block ${className}`} aria-hidden="true" />;
}

export function DashboardLoadingState({ label = "Opening dashboard" }: { label?: string }) {
  return (
    <div className="h-[100dvh] overflow-hidden bg-canvas text-ink" aria-busy="true">
      <ChromePlaceholder label={label} />
      <main className="mx-auto max-w-[940px] px-8 py-16">
        <div className="mb-10">
          <SkeletonLine className="h-2 w-44" />
          <SkeletonLine className="mt-4 h-7 w-64" />
          <SkeletonLine className="mt-3 h-3 w-40" />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="flex min-h-[172px] flex-col rounded-sm border border-line bg-surface p-6">
              <span className="h-11 w-11 rounded-sm border border-line bg-surface-muted" aria-hidden="true" />
              <div className="mt-auto">
                <SkeletonLine className="h-3 w-24" />
                <SkeletonLine className="mt-3 h-2 w-full max-w-52" />
                <SkeletonLine className="mt-2 h-2 w-36" />
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

export function PlannerWorkspaceSkeleton({ label = "Opening workspace" }: { label?: string }) {
  const metricWidths = ["w-28", "w-24", "w-32", "w-24", "w-28"];

  return (
    <main className="ui-workspace-content p-0 pb-6" aria-busy="true">
      <div className="ui-planner-dashboard">
        <section className="flex items-start justify-between gap-6 border-b border-line px-6 py-4">
          <div>
            <SkeletonLine className="h-3 w-40" />
            <SkeletonLine className="mt-3 h-2 w-72 max-w-full" />
          </div>
          <LoadingStatus label={label} />
        </section>

        <section className="grid grid-cols-2 gap-6 border-b border-line px-6 py-4 md:grid-cols-5">
          {metricWidths.map((width, index) => (
            <div key={index} className="space-y-2">
              <SkeletonLine className={`h-2 ${width}`} />
              <SkeletonLine className="h-5 w-20" />
              <SkeletonLine className="h-2 w-28" />
            </div>
          ))}
        </section>

        <section className="grid min-h-0 flex-1 grid-cols-1 gap-0 lg:grid-cols-[minmax(0,1fr)_240px]">
          <div className="px-6 py-6">
            <SkeletonLine className="h-4 w-32" />
            <SkeletonLine className="mt-2 h-2 w-48" />
            <div className="mt-8 grid grid-cols-2 gap-5 md:grid-cols-4">
              {[0, 1, 2, 3].map((item) => (
                <div key={item} className="space-y-2">
                  <SkeletonLine className="h-2 w-24" />
                  <SkeletonLine className="h-5 w-12" />
                  <SkeletonLine className="h-2 w-28 max-w-full" />
                </div>
              ))}
            </div>
            <div className="mt-8 space-y-4">
              {[0, 1, 2].map((item) => (
                <div key={item} className="border-t border-line pt-4">
                  <SkeletonLine className="h-3 w-48" />
                  <SkeletonLine className="mt-2 h-2 w-80 max-w-full" />
                  <SkeletonLine className="mt-2 h-2 w-[28rem] max-w-full" />
                </div>
              ))}
            </div>
          </div>
          <aside className="hidden border-l border-line px-5 py-6 lg:block">
            <SkeletonLine className="h-4 w-28" />
            <div className="mt-6 space-y-4">
              {[0, 1, 2, 3, 4].map((item) => (
                <div key={item} className="border-b border-line pb-3">
                  <SkeletonLine className="h-2 w-24" />
                  <SkeletonLine className="mt-2 h-3 w-32" />
                </div>
              ))}
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}

export function ProductLoadingState({ label = "Opening workspace" }: { label?: string }) {
  return (
    <div
      className="fixed inset-0 h-[100dvh] overflow-hidden bg-canvas text-ink"
      style={{ "--workspace-sidebar-width": "var(--shell-sidebar)" } as CSSProperties}
    >
      <header className="ui-chrome ui-chrome-planner z-40 h-12 shrink-0">
        <div className="ui-chrome-planner-brand">
          <span className="grid h-8 w-8 place-items-center text-ink-tertiary" aria-hidden="true">
            <ArrowLeft size={15} strokeWidth={1.75} />
          </span>
          <span className="ui-brand-compact">Pulse</span>
        </div>
        <div className="ui-chrome-planner-context">
          <SkeletonLine className="h-3 w-36" />
        </div>
        <div className="ui-chrome-planner-actions">
          <span className="h-7 w-7 rounded-full border border-line bg-surface-muted" aria-hidden="true" />
        </div>
      </header>
      <div className="relative ui-workspace-shell">
        <div className="ui-workspace-sidebar-slot">
          <aside className="ui-nav-sidebar">
            <div className="flex h-9 shrink-0 items-center justify-end px-2 text-ink-tertiary">
              <PanelLeftClose size={15} strokeWidth={1.75} aria-hidden="true" />
            </div>
            <div className="space-y-3 border-b border-line px-4 pb-4 pt-2">
              <SkeletonLine className="h-3 w-32" />
              <SkeletonLine className="h-2 w-24" />
            </div>
            <div className="space-y-4 px-4 py-5">
              {["w-24", "w-32", "w-28", "w-20", "w-28"].map((width, index) => (
                <SkeletonLine key={index} className={`h-2 ${width}`} />
              ))}
            </div>
          </aside>
        </div>
        <PlannerWorkspaceSkeleton label={label} />
      </div>
    </div>
  );
}

export function SettingsLoadingState({ label = "Opening Settings" }: { label?: string }) {
  const settingsItems = [
    { label: "Account", icon: CircleUserRound },
    { label: "Appearance", icon: Palette },
    { label: "Organization", icon: UsersRound },
    { label: "Projects", icon: FolderKanban },
    { label: "Planning", icon: Settings },
  ];

  return (
    <div
      className="ui-settings-workspace fixed inset-0 flex h-[100dvh] flex-col overflow-hidden bg-surface text-ink"
      aria-busy="true"
    >
      <ChromePlaceholder space="Settings" label={label} />
      <div className="ui-settings-layout flex min-h-0 flex-1 flex-col overflow-hidden bg-surface md:flex-row">
        <aside className="ui-settings-subnav">
          <div className="ui-nav-section px-4">Settings</div>
          <nav className="mt-1 flex flex-col gap-0.5">
            {settingsItems.map((item, index) => {
              const Icon = item.icon;
              return (
                <span key={item.label} className={`ui-settings-subnav-item ${index === 0 ? "ui-settings-subnav-item-active" : "ui-settings-subnav-item-idle"}`}>
                  <Icon size={14} strokeWidth={1.75} aria-hidden="true" />
                  <span>{item.label}</span>
                </span>
              );
            })}
          </nav>
        </aside>

        <main className="ui-settings-content">
          <div className="ui-settings-page">
            <h2 className="ui-settings-page-title">Account</h2>
            <p className="ui-settings-page-desc">Your profile and sign-in credentials.</p>

            <section className="ui-settings-section">
              <h3 className="ui-settings-section-title">Account</h3>
              <div className="ui-settings-group">
                {[0, 1, 2].map((row) => (
                  <div key={row} className="ui-settings-group-row">
                    <div className="ui-settings-group-row-copy">
                      <SkeletonLine className="h-3 w-28" />
                      <SkeletonLine className="mt-2 h-2 w-48" />
                    </div>
                    <SkeletonLine className="h-8 w-44" />
                  </div>
                ))}
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}

/** Backward-compatible alias for older project settings deep links. */
export const PeopleLoadingState = SettingsLoadingState;

export function WorkOrderTableSkeleton() {
  return (
    <div className="ui-table-scroll" aria-hidden="true">
      <table className="w-full min-w-[1000px] border-collapse text-sm">
        <thead>
          <tr>
            <th className="w-10 border-b border-line px-4 py-2.5" />
            {["Order", "Customer", "Model", "Type", "Status", "Set", "Order date", "A#"].map((heading) => (
              <th key={heading} className="ui-mono-label border-b border-line px-3 py-2.5 text-left">
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[0, 1, 2, 3, 4].map((row) => (
            <tr key={row} className="border-b border-line/60 last:border-b-0">
              <td className="px-4 py-3"><SkeletonLine className="h-3 w-3" /></td>
              {["w-24", "w-28", "w-24", "w-16", "w-20", "w-12", "w-20", "w-12"].map((width, column) => (
                <td key={column} className="px-3 py-3"><SkeletonLine className={`h-2 ${width}`} /></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PlanningLoadingState({ label = "Opening Planning" }: { label?: string }) {
  const navItems = [
    { label: "Sales orders", icon: FileSpreadsheet },
    { label: "Work orders", icon: ClipboardList },
  ];

  return (
    <div className="fixed inset-0 flex h-[100dvh] flex-col overflow-hidden bg-surface text-ink" aria-busy="true">
      <ChromePlaceholder space="Planning" label={label} />
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <aside className="ui-nav-sidebar shrink-0 flex-col overflow-hidden">
          <nav className="flex min-h-0 flex-1 flex-col overflow-hidden px-2 py-3">
            <div className="ui-nav-section">Planning</div>
            <div className="space-y-0.5">
              {navItems.map(({ label: itemLabel, icon: Icon }, index) => (
                <span
                  key={itemLabel}
                  className={`ui-nav-item ${index === 1 ? "ui-nav-item-active" : "ui-nav-item-idle"}`}
                >
                  <Icon size={15} strokeWidth={1.75} />
                  <span>{itemLabel}</span>
                </span>
              ))}
            </div>
            <div className="ui-nav-section mt-3">Setup</div>
            <span className="ui-nav-item ui-nav-item-idle">
              <Settings2 size={15} strokeWidth={1.75} />
              <span>Product configuration</span>
            </span>
          </nav>
        </aside>
        <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <div className="ui-planning-space h-full overflow-hidden bg-canvas lg:rounded-tl-2xl">
            <div className="mx-auto max-w-6xl px-4 py-6 md:px-6">
              <div className="mb-5 flex items-center gap-2">
                <SkeletonLine className="h-3 w-24" />
                <SkeletonLine className="h-8 w-32" />
                <SkeletonLine className="h-8 w-32" />
                <span className="flex-1" />
                <SkeletonLine className="h-8 w-28" />
              </div>
              <section className="ui-panel overflow-hidden">
                <WorkOrderTableSkeleton />
              </section>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

export function ProductionLoadingState({ label = "Opening Production" }: { label?: string }) {
  return (
    <div className="h-[100dvh] overflow-hidden bg-canvas text-ink" aria-busy="true">
      <ChromePlaceholder space="Production" label={label} />
      <main className="mx-auto max-w-[760px] px-8 py-16">
        <span className="block h-11 w-11 rounded-sm border border-line bg-surface-muted" aria-hidden="true" />
        <SkeletonLine className="mt-5 h-5 w-40" />
        <SkeletonLine className="mt-4 h-3 w-full max-w-lg" />
        <SkeletonLine className="mt-2 h-3 w-4/5 max-w-md" />
        <section className="mt-8 border-y border-line bg-surface px-5 py-5">
          <SkeletonLine className="h-2 w-44" />
          <div className="mt-5 space-y-4">
            {["w-4/5", "w-3/4", "w-5/6", "w-2/3", "w-3/4"].map((width, index) => (
              <div key={index} className="flex items-center gap-4">
                <SkeletonLine className="h-2 w-5" />
                <SkeletonLine className={`h-2 ${width}`} />
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

export function SopTableSkeleton() {
  return (
    <div className="ui-data-table-frame ui-data-table-frame-canvas" aria-hidden="true">
      <div className="ui-table-scroll">
        <table className="w-full min-w-[680px] border-collapse text-left">
          <thead>
            <tr className="border-b border-line">
              <th className="w-36 px-5 py-3 text-[11px] font-medium text-ink-secondary">Number</th>
              <th className="px-5 py-3 text-[11px] font-medium text-ink-secondary">Title</th>
              <th className="w-32 px-5 py-3 text-[11px] font-medium text-ink-secondary">Status</th>
              <th className="w-28 px-5 py-3 text-[11px] font-medium text-ink-secondary">Updated</th>
              <th className="w-24 px-3 py-3" />
            </tr>
          </thead>
          <tbody>
            {[0, 1, 2, 3].map((row) => (
              <tr key={row} className="border-b border-line last:border-b-0">
                <td className="px-5 py-4"><SkeletonLine className="h-2 w-20" /></td>
                <td className="px-5 py-4"><SkeletonLine className={`h-3 ${row % 2 ? "w-64" : "w-48"}`} /></td>
                <td className="px-5 py-4"><SkeletonLine className="h-5 w-14" /></td>
                <td className="px-5 py-4"><SkeletonLine className="h-2 w-16" /></td>
                <td className="px-3 py-4"><SkeletonLine className="h-5 w-8" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function QualityListLoadingContent() {
  return (
    <div className="mx-auto max-w-6xl" aria-busy="true">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <SkeletonLine className="h-5 w-20" />
          <SkeletonLine className="mt-3 h-2 w-80 max-w-full" />
        </div>
        <SkeletonLine className="h-9 w-24" />
      </div>
      <SkeletonLine className="mb-5 h-9 w-72 max-w-full" />
      <SopTableSkeleton />
    </div>
  );
}

export function QualityLoadingState({ label = "Opening Quality" }: { label?: string }) {
  const navItems = [
    { label: "All SOPs", icon: FileText },
    { label: "Review queue", icon: Inbox },
    { label: "Effective library", icon: Library },
    { label: "Retired", icon: Archive },
  ];

  return (
    <div className="ui-sop-shell fixed inset-0 flex h-[100dvh] flex-col overflow-hidden bg-surface text-ink" aria-busy="true">
      <ChromePlaceholder space="Quality" label={label} />
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <aside className="ui-nav-sidebar">
          <nav className="flex min-h-0 flex-1 flex-col overflow-hidden px-2 py-3">
            <div className="space-y-0.5">
              {navItems.map(({ label: itemLabel, icon: Icon }, index) => (
                <span
                  key={itemLabel}
                  className={`ui-nav-item ${index === 0 ? "ui-nav-item-active" : "ui-nav-item-idle"}`}
                >
                  <Icon size={15} strokeWidth={1.75} />
                  <span>{itemLabel}</span>
                </span>
              ))}
            </div>
          </nav>
        </aside>
        <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <div className="h-full overflow-hidden bg-canvas p-4 md:p-6 lg:rounded-tl-2xl">
            <QualityListLoadingContent />
          </div>
        </main>
      </div>
    </div>
  );
}
