"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { NothingLoadingBlock } from "@/components/nothing-ui";
import { BackToDashboardButton, UserNav } from "@/components/user-nav";
import { usePlanningWorkspace } from "./planning-workspace-provider";

type PlanningShellProps = {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
};

/**
 * Sticky-header shell for the Planning space. Header idiom copied verbatim from
 * space-placeholder.tsx so Planning matches every other space's chrome.
 */
export function PlanningShell({ title, actions, children }: PlanningShellProps) {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <header className="sticky top-0 z-10 flex h-12 items-center gap-3 border-b border-line bg-surface px-4">
        <BackToDashboardButton />
        <Link href="/" className="ui-brand-compact shrink-0" title="Company dashboard">
          Pulse
        </Link>
        <span className="h-4 w-px bg-border-strong" />
        <span className="ui-mono-label">Planning{title ? <> · {title}</> : null}</span>
        <span className="flex-1" />
        {actions}
        <UserNav />
      </header>

      <main className="mx-auto max-w-[1100px] px-8 py-8">{children}</main>
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
    return (
      <PlanningShell>
        <NothingLoadingBlock title="Checking access" />
      </PlanningShell>
    );
  }

  if (!hasAccess) {
    return (
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
    );
  }

  return <>{children}</>;
}
