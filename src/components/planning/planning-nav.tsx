"use client";

import { ClipboardList, FileSpreadsheet, Settings2 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavSelectionTrack } from "@/components/nav-selection-track";

/**
 * The Planning space's left nav. Rendered once by `app/planning/layout.tsx`, so it stays mounted
 * across every Planning route -- App Router layouts do not re-render when navigating between
 * their children. Idiom copied from the Quality sidebar (`SopTabNav`) so the two spaces match,
 * with `Link`s instead of buttons because these are real routes rather than client-side tabs.
 */

/** Nav order follows the flow (schedule in -> work orders out), not the alphabet. */
const FLOW_ITEMS = [
  { href: "/planning/sales-orders", label: "Sales orders", Icon: FileSpreadsheet },
  { href: "/planning", label: "Work orders", Icon: ClipboardList },
] as const;

const CONFIGURATION_HREF = "/planning/configuration";

/**
 * Which nav entry owns a pathname. `/planning` is the board, and every work-order sub-route
 * (new, detail, print) belongs to it -- so the Work orders entry stays lit while the planner is
 * three levels deep in an order rather than going dark and looking like nothing is selected.
 */
export function activeNavHref(pathname: string): string {
  if (pathname.startsWith("/planning/sales-orders")) return "/planning/sales-orders";
  if (pathname.startsWith(CONFIGURATION_HREF)) return CONFIGURATION_HREF;
  if (pathname === "/planning" || pathname.startsWith("/planning/work-orders") || pathname.startsWith("/planning/print")) {
    return "/planning";
  }
  return "";
}

export function PlanningNav() {
  const active = activeNavHref(usePathname() ?? "");

  return (
    <>
      <div className="ui-nav-section">Planning</div>
      <NavSelectionTrack
        activeIndex={FLOW_ITEMS.findIndex((item) => item.href === active)}
        className="space-y-0.5"
      >
        {FLOW_ITEMS.map(({ href, label, Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={active === href ? "page" : undefined}
            className={`ui-nav-item w-full ${active === href ? "ui-nav-item-active" : "ui-nav-item-idle"}`}
          >
            <Icon size={15} strokeWidth={1.75} />
            <span>{label}</span>
          </Link>
        ))}
      </NavSelectionTrack>

      {/* Reference data the planner edits rarely, kept out of the daily-work group. */}
      <div className="ui-nav-section mt-3">Setup</div>
      <div className="space-y-0.5">
        <Link
          href={CONFIGURATION_HREF}
          aria-current={active === CONFIGURATION_HREF ? "page" : undefined}
          className={`ui-nav-item ${active === CONFIGURATION_HREF ? "ui-nav-item-active" : "ui-nav-item-idle"}`}
        >
          <Settings2 size={15} strokeWidth={1.75} />
          <span>Product configuration</span>
        </Link>
      </div>
    </>
  );
}
