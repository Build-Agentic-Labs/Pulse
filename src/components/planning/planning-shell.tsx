"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { PlanningLoadingState } from "@/components/space-loading-states";
import { BackToDashboardButton, UserNav } from "@/components/user-nav";
import { usePlanningWorkspace } from "./planning-workspace-provider";

type PlanningShellProps = {
  title?: ReactNode;
  actions?: ReactNode;
  /** Where the header's back arrow leads. Omitted = dashboard (space root). */
  backHref?: string;
  backLabel?: string;
  /** Widens the content column (e.g. the detail page's side-by-side print preview). */
  wide?: boolean;
  children: ReactNode;
};

/**
 * Full-width-header shell for the Planning space. The header stays page-owned so detail pages
 * can supply their own back target and actions, but it spans the viewport above the persistent
 * sidebar just like the SOP and Settings shells. Sub-pages pass `backHref="/planning"` so the
 * arrow steps back to the board, not the dashboard.
 */
export function PlanningShell({ title, actions, backHref, backLabel = "Back to work orders", wide = false, children }: PlanningShellProps) {
  // The app disables document scrolling globally (html/body overflow:hidden — see
  // globals.css), so each space provides its own scroll container, like the SOP shell.
  // The 48px top padding reserves the fixed header in both the workspace layout and standalone
  // access-gate renderings.
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface pt-12 text-ink">
      <header className="ui-chrome fixed inset-x-0 top-0 z-40 flex h-12 shrink-0 items-center gap-3 px-3 sm:px-4">
        {backHref ? (
          <Link
            href={backHref}
            className="ui-btn-ghost inline-flex h-8 w-8 shrink-0 items-center justify-center px-0"
            title={backLabel}
            aria-label={backLabel}
          >
            <ArrowLeft size={15} strokeWidth={1.75} />
          </Link>
        ) : (
          <BackToDashboardButton />
        )}
        <Link href="/" className="ui-brand-compact shrink-0" title="Company dashboard">
          Pulse
        </Link>
        <span className="ui-chrome-divider" />
        <span className="ui-chrome-context-label truncate">
          {backHref ? (
            <Link href="/planning" className="hover:text-ink" title="Work orders">
              Planning
            </Link>
          ) : (
            "Planning"
          )}
          {title ? <> · {title}</> : null}
        </span>
        <span className="flex-1" />
        {actions}
        <UserNav />
      </header>

      <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <div className="ui-planning-space h-full overflow-y-auto bg-canvas lg:rounded-tl-2xl">
          <div className={`mx-auto px-4 py-6 md:px-6 ${wide ? "max-w-[1760px]" : "max-w-6xl"}`}>{children}</div>
        </div>
      </main>
    </div>
  );
}

/**
 * Renders `children` once the signed-in user's Planning access is confirmed; a loading
 * block while the check is in flight, and a restricted panel otherwise.
 */
export function PlanningAccessGate({ children }: { children: ReactNode }) {
  const { hasAccess } = usePlanningWorkspace();

  if (hasAccess === null) {
    return <PlanningLoadingState />;
  }

  if (!hasAccess) {
    // Rendered INSTEAD of the layout's sidebar row, so it supplies its own viewport height —
    // `PlanningShell` only fills a flex column, it no longer claims the screen.
    return (
      <div className="flex h-[100dvh] flex-col">
        <PlanningShell>
          <section className="ui-panel p-5">
            <div className="ui-mono-label">Restricted</div>
            <p className="mt-3 text-sm text-ink-secondary">
              Planning requires access. Ask a workspace admin to grant it from Settings → Members.
            </p>
            <Link href="/" className="ui-btn-ghost mt-4 inline-flex h-8 items-center px-3 text-[12px]">
              Back to dashboard
            </Link>
          </section>
        </PlanningShell>
      </div>
    );
  }

  return <>{children}</>;
}
