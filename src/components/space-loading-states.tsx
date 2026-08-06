import { PanelLeftClose } from "lucide-react";
import { CompanyTopNav } from "@/components/company-top-nav";
import { PlanningNav } from "@/components/planning/planning-nav";
import { TopNav } from "@/components/planner-top-nav";
import { SettingsNavigation } from "@/components/settings-navigation";
import { SpaceTopNav } from "@/components/space-top-nav";
import { SopTabNav } from "@/components/sop/sop-tab-nav";

function LoadingStatus({ label }: { label: string }) {
  return (
    <span className="ui-transition-status" role="status" aria-live="polite">
      {label}
    </span>
  );
}

function SkeletonLine({ className = "" }: { className?: string }) {
  return <span className={`ui-skeleton-line block ${className}`} aria-hidden="true" />;
}

export function DashboardLoadingState({ label = "Opening dashboard" }: { label?: string }) {
  return (
    <div className="h-[100dvh] overflow-hidden bg-canvas text-ink" aria-busy="true">
      <CompanyTopNav loading loadingLabel={label} />
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
    <main
      className="min-h-0 min-w-0 overflow-auto rounded-l-xl bg-canvas transition-[border-radius] duration-300 ease-out"
      aria-busy="true"
    >
      <div className="space-y-4 p-4 pb-2">
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
    <div className="fixed inset-0 h-[100dvh] overflow-hidden bg-canvas text-ink" aria-busy="true">
      <TopNav loading />
      <div className="grid h-[calc(100dvh-48px)] min-h-0 grid-cols-1 overflow-hidden bg-surface lg:grid-cols-[var(--shell-sidebar)_minmax(0,1fr)]">
        <aside className="hidden h-full w-[var(--shell-sidebar)] shrink-0 flex-col bg-surface lg:flex">
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
        <PlannerWorkspaceSkeleton label={label} />
      </div>
    </div>
  );
}

export function SettingsLoadingState({ label = "Opening Settings" }: { label?: string }) {
  return (
    <div
      className="ui-settings-workspace fixed inset-0 flex h-[100dvh] flex-col overflow-hidden bg-surface text-ink"
      aria-busy="true"
    >
      <SpaceTopNav context="Settings" loading loadingLabel={label} />
      <div className="ui-settings-layout flex min-h-0 flex-1 flex-col overflow-hidden bg-surface md:flex-row">
        <SettingsNavigation activeSection="account" />

        <div className="ui-settings-content">
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
        </div>
      </div>
    </div>
  );
}

/** Section-only Settings fallback; navigation and previously visited sections remain mounted. */
export function SettingsSectionLoadingContent() {
  return (
    <div className="space-y-5 py-3" aria-busy="true">
      {[0, 1, 2].map((row) => (
        <section key={row} className="ui-settings-section">
          <SkeletonLine className="h-3 w-36" />
          <div className="ui-settings-group mt-3">
            {[0, 1].map((item) => (
              <div key={item} className="ui-settings-group-row">
                <div className="ui-settings-group-row-copy">
                  <SkeletonLine className="h-3 w-28" />
                  <SkeletonLine className="mt-2 h-2 w-48 max-w-full" />
                </div>
                <SkeletonLine className="h-8 w-36" />
              </div>
            ))}
          </div>
        </section>
      ))}
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
  return (
    <div className="fixed inset-0 flex h-[100dvh] flex-col overflow-hidden bg-surface text-ink" aria-busy="true">
      <SpaceTopNav context="Planning" loading loadingLabel={label} />
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <aside className="ui-nav-sidebar shrink-0 flex-col overflow-hidden">
          <nav className="flex min-h-0 flex-1 flex-col overflow-auto px-2 py-3">
            <PlanningNav />
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

/** Content-only Planning fallback; the persistent top bar and sidebar remain mounted. */
export function PlanningContentLoadingState({ label }: { label: string }) {
  return (
    <section className="space-y-5" aria-busy="true" aria-label={label}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <SkeletonLine className="h-4 w-36" />
          <SkeletonLine className="mt-3 h-2 w-72 max-w-full" />
        </div>
        <SkeletonLine className="h-9 w-32" />
      </div>
      <SkeletonLine className="h-2 w-28" />
      <section className="ui-panel overflow-hidden">
        <WorkOrderTableSkeleton />
      </section>
    </section>
  );
}

export function ProductionLoadingState({ label = "Opening Production" }: { label?: string }) {
  return (
    <div className="h-[100dvh] overflow-hidden bg-canvas text-ink" aria-busy="true">
      <SpaceTopNav context="Production" loading loadingLabel={label} />
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
  return (
    <div className="ui-sop-shell fixed inset-0 flex h-[100dvh] flex-col overflow-hidden bg-surface text-ink" aria-busy="true">
      <SpaceTopNav
        context="Quality / SOPs"
        contextLeading={<span className="block h-8 w-8 shrink-0 lg:hidden" aria-hidden="true" />}
        loading
        loadingLabel={label}
      />
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <aside className="ui-nav-sidebar">
          <nav className="flex min-h-0 flex-1 flex-col overflow-hidden px-2 py-3">
            <SopTabNav active="all" manage={false} />
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
