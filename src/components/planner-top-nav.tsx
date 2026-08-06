"use client";

import Link from "next/link";
import type { PresencePeer } from "@/lib/use-planner-presence";
import { NothingStatus } from "./nothing-ui";
import { buildPlannerChromeContext } from "./planner-dashboard-panel";
import { BackToDashboardButton, UserNav } from "./user-nav";

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

export function TopNav({
  context,
  loading = false,
  chromeStatus,
  presence,
}: {
  context?: ReturnType<typeof buildPlannerChromeContext>;
  loading?: boolean;
  chromeStatus?: { message: string; error?: boolean } | null;
  presence?: PresencePeer[];
}) {
  const status = chromeStatus ?? null;

  return (
    <header className="ui-chrome ui-chrome-planner z-40 h-12 shrink-0" aria-busy={loading || undefined}>
      <div className="ui-chrome-planner-brand">
        <BackToDashboardButton />
        <Link href="/" className="ui-brand-compact shrink-0" title="Company dashboard">
          Pulse
        </Link>
      </div>

      <div className="ui-chrome-planner-context min-w-0">
        {loading ? (
          <span className="ui-skeleton-line block h-3 w-36" aria-hidden="true" />
        ) : context ? (
          <>
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
          </>
        ) : null}
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
