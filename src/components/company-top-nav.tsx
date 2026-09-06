"use client";

import Link from "next/link";
import { UserNav } from "./user-nav";

export function CompanyTopNav({
  workspaceName,
  loading = false,
  loadingLabel,
}: {
  workspaceName?: string;
  loading?: boolean;
  loadingLabel?: string;
}) {
  return (
    <header
      className="ui-chrome ui-chrome-planner ui-company-chrome sticky top-0 z-10 h-12 shrink-0"
      aria-busy={loading || undefined}
    >
      <div className="ui-chrome-planner-brand">
        <span className="block h-8 w-8 shrink-0" aria-hidden="true" />
        <Link href="/" className="ui-brand-compact shrink-0" title="Company dashboard">
          Pulse
        </Link>
      </div>
      <div className="ui-chrome-planner-context min-w-0">
        {loading ? (
          <span className="ui-skeleton-line block h-3 w-24" aria-hidden="true" />
        ) : workspaceName ? (
          <span className="truncate text-xs font-normal text-ink-secondary">{workspaceName}</span>
        ) : null}
      </div>
      <div className="ui-chrome-planner-actions">
        {loadingLabel ? (
          <span className="ui-transition-status" role="status" aria-live="polite">
            {loadingLabel}
          </span>
        ) : null}
        <UserNav />
      </div>
    </header>
  );
}
