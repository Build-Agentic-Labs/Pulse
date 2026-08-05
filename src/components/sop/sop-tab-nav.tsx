"use client";

import { Archive, Building2, FileText, Inbox, LayoutDashboard, Library } from "lucide-react";
import Link from "next/link";
import type { MouseEvent, ReactNode } from "react";
import { NavSelectionTrack } from "@/components/nav-selection-track";

export type SopTab = "dashboard" | "all" | "review" | "library" | "retired" | "settings";

/** Shared by Quality's provider fallback, route fallback and settled workspace. */
export function SopTabNav({
  active,
  manage,
  onSelect,
}: {
  active: SopTab;
  manage: boolean;
  onSelect?: (tab: SopTab) => void;
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

  function item(tab: SopTab, icon: ReactNode, label: string) {
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
        {item("review", <Inbox size={15} strokeWidth={1.75} />, "Review queue")}
        {item("library", <Library size={15} strokeWidth={1.75} />, "Effective library")}
        {item("retired", <Archive size={15} strokeWidth={1.75} />, "Retired")}
      </NavSelectionTrack>
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
