"use client";

import { Archive, Building2, FileText, Inbox, LayoutDashboard, Library } from "lucide-react";
import Link from "next/link";
import type { MouseEvent, ReactNode } from "react";
import { NavSelectionTrack } from "@/components/nav-selection-track";
import { badgeLabel } from "@/domain/sop/queue-summary";
import { ProblemPilotLink } from "@/components/problem-solving/problem-pilot-link";

export type SopTab = "dashboard" | "all" | "review" | "library" | "retired" | "settings";

/** Shared by Quality's provider fallback, route fallback and settled workspace. */
export function SopTabNav({
  active,
  manage,
  onSelect,
  reviewCount = null,
}: {
  active: SopTab;
  manage: boolean;
  onSelect?: (tab: SopTab) => void;
  /** SOPs waiting on the viewer (to review, or back from review); null = not known yet. */
  reviewCount?: number | null;
}) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>, tab: SopTab) {
    if (
      !onSelect ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    onSelect(tab);
  }

  function item(tab: SopTab, icon: ReactNode, label: string, count: number | null = null) {
    const href = tab === "all" ? "/sops" : `/sops?tab=${tab}`;
    return (
      <Link
        href={href}
        prefetch
        scroll={false}
        onClick={(event) => handleClick(event, tab)}
        className={`ui-nav-item w-full ${active === tab ? "ui-nav-item-active" : "ui-nav-item-idle"}`}
      >
        {icon}
        <span>{label}</span>
        {count ? (
          <span
            className="ml-auto inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-none tabular-nums text-white"
            aria-label={`${count} waiting on you`}
          >
            {badgeLabel(count)}
          </span>
        ) : null}
      </Link>
    );
  }

  return (
    <>
      <NavSelectionTrack
        activeIndex={["dashboard", "all", "review", "library", "retired"].indexOf(active)}
        className="space-y-0.5"
      >
        {item("dashboard", <LayoutDashboard size={15} strokeWidth={1.75} />, "Dashboard")}
        {item("all", <FileText size={15} strokeWidth={1.75} />, "All SOPs")}
        {item("review", <Inbox size={15} strokeWidth={1.75} />, "Review queue", reviewCount)}
        {item("library", <Library size={15} strokeWidth={1.75} />, "Effective library")}
        {item("retired", <Archive size={15} strokeWidth={1.75} />, "Retired")}
      </NavSelectionTrack>
      <ProblemPilotLink />
      {manage ? (
        <>
          <div className="ui-nav-section mt-3">Manage</div>
          <NavSelectionTrack activeIndex={active === "settings" ? 0 : -1} className="space-y-0.5">
            <Link
              href="/sops?tab=settings"
              prefetch
              scroll={false}
              onClick={(event) => handleClick(event, "settings")}
              className={`ui-nav-item w-full ${
                active === "settings" ? "ui-nav-item-active" : "ui-nav-item-idle"
              }`}
              title="Quality settings"
            >
              <Building2 size={15} strokeWidth={1.75} />
              <span>Quality settings</span>
            </Link>
          </NavSelectionTrack>
        </>
      ) : null}
    </>
  );
}
