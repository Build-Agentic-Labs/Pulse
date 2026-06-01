"use client";

import { ChevronLeft, Moon, Sun } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { SidebarUserPanel } from "@/components/sidebar-user-panel";
import { useTheme } from "@/components/theme-provider";

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
  children,
}: {
  sidebar: ReactNode;
  back?: { href: string; label: string };
  crumb?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { theme, toggleTheme } = useTheme();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="fixed inset-0 flex h-[100dvh] flex-col overflow-hidden bg-surface text-ink">
      <header className="ui-chrome z-40 flex h-12 shrink-0 items-center justify-between px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            className="ui-btn-ghost hidden h-8 w-8 shrink-0 items-center justify-center px-0 lg:inline-flex"
            title={collapsed ? "Show sidebar" : "Hide sidebar"}
            aria-label={collapsed ? "Show sidebar" : "Hide sidebar"}
            aria-expanded={!collapsed}
          >
            <ChevronLeft
              size={14}
              strokeWidth={1.75}
              className={`transition-transform duration-300 ease-ui ${collapsed ? "rotate-180" : ""}`}
            />
          </button>
          <Link href="/" className="ui-brand-compact shrink-0">
            Pulse
          </Link>
          {crumb ? (
            <span className="hidden min-w-0 truncate ui-section-subtitle text-ink-secondary sm:inline">{crumb}</span>
          ) : null}
        </div>

        <div className="flex items-center gap-0.5 sm:gap-1">
          {actions}
          <button type="button" onClick={toggleTheme} className="ui-btn-ghost h-10" title="Toggle theme">
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside
          className="ui-nav-sidebar shrink-0 overflow-hidden transition-[width,opacity] duration-300 ease-ui"
          style={collapsed ? { width: 0, opacity: 0 } : undefined}
        >
          <nav className="flex min-h-0 flex-1 flex-col overflow-auto px-2 py-2">
            {back ? (
              <Link href={back.href} className="ui-settings-back" title={back.label}>
                <ChevronLeft size={14} strokeWidth={1.75} />
                {back.label}
              </Link>
            ) : null}
            {sidebar}
          </nav>
          <div className="mt-auto px-2 py-2">
            <SidebarUserPanel />
          </div>
        </aside>

        <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <div className="h-full overflow-auto rounded-l-xl bg-canvas p-4 md:p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
