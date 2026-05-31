"use client";

import { Moon, Sun } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useTheme } from "@/components/theme-provider";

/** Top chrome bar for the SOP section, matching the planner/account header. */
export function SopChrome({ crumb, actions }: { crumb?: string; actions?: ReactNode }) {
  const { theme, toggleTheme } = useTheme();

  return (
    <header className="ui-chrome z-40 flex h-12 shrink-0 items-center justify-between px-3 sm:px-4">
      <div className="flex min-w-0 items-center gap-3">
        <Link href="/" className="ui-brand-compact">
          Pulse
        </Link>
        <span className="hidden text-ink-tertiary sm:inline">/</span>
        <Link href="/sops" className="hidden truncate ui-section-subtitle hover:text-ink sm:inline">
          SOPs
        </Link>
        {crumb ? (
          <>
            <span className="hidden text-ink-tertiary sm:inline">/</span>
            <span className="hidden min-w-0 truncate ui-section-subtitle text-ink sm:inline">{crumb}</span>
          </>
        ) : null}
      </div>

      <div className="flex items-center gap-0.5 sm:gap-1">
        {actions}
        <button type="button" onClick={toggleTheme} className="ui-btn-ghost h-10" title="Toggle theme">
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>
    </header>
  );
}
