"use client";

import { ChevronLeft, PanelLeft, PanelLeftClose } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type MouseEvent, type ReactNode } from "react";
import { BackToDashboardButton, UserNav } from "@/components/user-nav";

/**
 * App-shell layout for the SOP section, matching the settings page: a full-width
 * top bar, a left nav sidebar, and a rounded content panel. SOPs
 * are org-wide, so this is a standalone surface — the sidebar holds SOP
 * navigation, not the planner's project list.
 */
export function SopShell({
  sidebar,
  back,
  crumb,
  actions,
  confirmLeave,
  children,
}: {
  sidebar: ReactNode;
  back?: { href: string; label: string };
  crumb?: string;
  actions?: ReactNode;
  /**
   * Guard for the shell's own exit links (brand + back). Resolve false to cancel the
   * navigation — used by the editor to confirm leaving with unsaved changes. May be
   * async so the guard can await the themed confirm dialog before navigating.
   */
  confirmLeave?: () => boolean | Promise<boolean>;
  children: ReactNode;
}) {
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);

  // When a guard is present we can't decide synchronously (the themed confirm resolves a
  // promise), so we always intercept the click, capture the destination href, then navigate
  // programmatically once the guard resolves true. Without a guard, links behave normally.
  function guardNavigation(event: MouseEvent<HTMLAnchorElement>) {
    if (!confirmLeave) return;
    const href = event.currentTarget.getAttribute("href");
    event.preventDefault();
    void Promise.resolve(confirmLeave()).then((ok) => {
      if (ok && href) router.push(href);
    });
  }

  return (
    <div className="fixed inset-0 flex h-[100dvh] flex-col overflow-hidden bg-surface text-ink">
      <header className="ui-chrome z-40 flex h-12 shrink-0 items-center justify-between px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-3">
          <BackToDashboardButton onNavigate={guardNavigation} />
          <Link href="/" className="ui-brand-compact shrink-0" onClick={guardNavigation}>
            Pulse
          </Link>
          {crumb ? (
            <span className="hidden min-w-0 truncate ui-section-subtitle text-ink-secondary sm:inline">{crumb}</span>
          ) : null}
        </div>

        <div className="flex items-center gap-0.5 sm:gap-1">
          {actions}
          <UserNav />
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {collapsed ? (
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            className="ui-btn-ghost absolute bottom-3 left-2 z-30 hidden h-8 w-8 items-center justify-center rounded-full border border-line bg-surface px-0 text-ink-tertiary hover:text-ink lg:inline-flex"
            title="Show sidebar"
            aria-label="Show sidebar"
          >
            <PanelLeft size={15} strokeWidth={1.75} />
          </button>
        ) : null}
        <aside
          className="ui-nav-sidebar flex shrink-0 flex-col overflow-hidden transition-[width,opacity] duration-300 ease-ui"
          style={collapsed ? { width: 0, opacity: 0 } : undefined}
        >
          <nav className="flex min-h-0 flex-1 flex-col overflow-auto px-2 py-3">
            {back ? (
              <Link href={back.href} className="ui-settings-back" title={back.label} onClick={guardNavigation}>
                <ChevronLeft size={14} strokeWidth={1.75} />
                {back.label}
              </Link>
            ) : null}
            {sidebar}
          </nav>
          <div className="shrink-0 px-2 pb-3 pt-1">
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              className="ui-btn-ghost inline-flex h-8 w-8 items-center justify-center px-0 text-ink-tertiary hover:text-ink"
              title="Hide sidebar"
              aria-label="Hide sidebar"
            >
              <PanelLeftClose size={15} strokeWidth={1.75} />
            </button>
          </div>
        </aside>

        <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <div className="h-full overflow-auto rounded-l-xl bg-canvas p-4 md:p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
