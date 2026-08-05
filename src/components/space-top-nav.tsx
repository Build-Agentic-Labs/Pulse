"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { MouseEvent, ReactNode } from "react";
import { BackToDashboardButton, UserNav } from "./user-nav";

type SpaceTopNavProps = {
  context: ReactNode;
  actions?: ReactNode;
  contextLeading?: ReactNode;
  backHref?: string;
  backLabel?: string;
  onNavigate?: (event: MouseEvent<HTMLAnchorElement>) => void;
  fixed?: boolean;
  loading?: boolean;
  loadingLabel?: string;
};

/**
 * Product-style chrome for every top-level space. The three shared rails keep
 * the back affordance, Pulse wordmark, context and actions at the same
 * coordinates while route content or loading fallbacks resolve.
 */
export function SpaceTopNav({
  context,
  actions,
  contextLeading,
  backHref,
  backLabel = "Back",
  onNavigate,
  fixed = false,
  loading = false,
  loadingLabel,
}: SpaceTopNavProps) {
  return (
    <header
      className={`ui-chrome ui-chrome-planner z-40 h-12 shrink-0 ${fixed ? "fixed inset-x-0 top-0" : ""}`}
      aria-busy={loading || undefined}
    >
      <div className="ui-chrome-planner-brand">
        {backHref ? (
          <Link
            href={backHref}
            onClick={onNavigate}
            className="ui-btn-ghost inline-flex h-8 w-8 shrink-0 items-center justify-center px-0"
            title={backLabel}
            aria-label={backLabel}
          >
            <ArrowLeft size={15} strokeWidth={1.75} />
          </Link>
        ) : (
          <BackToDashboardButton onNavigate={onNavigate} />
        )}
        <Link
          href="/"
          className="ui-brand-compact shrink-0"
          title="Company dashboard"
          onClick={onNavigate}
        >
          Pulse
        </Link>
      </div>

      <div className="ui-chrome-planner-context min-w-0">
        {contextLeading}
        {loading ? (
          <span className="ui-skeleton-line block h-3 w-28" aria-hidden="true" />
        ) : (
          <span className="ui-chrome-context-title min-w-0 truncate">{context}</span>
        )}
      </div>

      <div className="ui-chrome-planner-actions">
        {loadingLabel ? (
          <span className="sr-only" role="status" aria-live="polite">
            {loadingLabel}
          </span>
        ) : null}
        {actions}
        <UserNav />
      </div>
    </header>
  );
}
