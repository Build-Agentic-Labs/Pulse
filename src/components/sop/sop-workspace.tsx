"use client";

import { Archive, Building2, FileText, Inbox, Library } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import { DepartmentsAdmin } from "./departments-admin";
import { EffectiveLibrary } from "./effective-library";
import { ReviewQueue } from "./review-queue";
import { RetiredSops } from "./retired-sops";
import { SopList } from "./sop-list";
import { SopShell } from "./sop-shell";
import { canManage, SopWorkspaceSwitcher, useSopWorkspace } from "./sop-workspace-provider";

type Tab = "all" | "review" | "library" | "retired" | "departments";

const CRUMB: Record<Tab, string> = {
  all: "Quality / SOPs",
  library: "Quality / Effective library",
  review: "Quality / Review queue",
  retired: "Quality / Retired",
  departments: "Quality / Departments",
};

function parseTab(raw: string | null, manage: boolean): Tab {
  if (raw === "review" || raw === "library" || raw === "retired") return raw;
  if (raw === "departments" && manage) return "departments";
  return "all";
}

/**
 * The persistent SOP workspace: one shell (header + sidebar) that stays mounted while the tabs
 * swap the content panel client-side — no route change, no provider re-mount, no reload. This is
 * the same model as the planner (Product) space. The editor remains its own route and shares
 * this section's provider (mounted in app/sops/layout.tsx).
 */
export function SopWorkspace() {
  const { role } = useSopWorkspace();
  const manage = canManage(role);
  const params = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => parseTab(params.get("tab"), manage));

  function select(next: Tab) {
    setTab(next);
    // Keep the URL shareable/refresh-safe, but WITHOUT a Next navigation (so nothing re-mounts).
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", next === "all" ? "/sops" : `/sops?tab=${next}`);
    }
  }

  const sidebar = <SopTabNav active={tab} manage={manage} onSelect={select} />;

  return (
    <SopShell sidebar={sidebar} crumb={CRUMB[tab]}>
      {tab === "all" ? (
        <SopList />
      ) : tab === "review" ? (
        <ReviewQueue />
      ) : tab === "library" ? (
        <EffectiveLibrary />
      ) : tab === "retired" ? (
        <RetiredSops />
      ) : (
        <DepartmentsAdmin />
      )}
    </SopShell>
  );
}

function SopTabNav({
  active,
  manage,
  onSelect,
}: {
  active: Tab;
  manage: boolean;
  onSelect: (tab: Tab) => void;
}) {
  function item(tab: Tab, icon: ReactNode, label: string) {
    return (
      <button
        type="button"
        onClick={() => onSelect(tab)}
        className={`ui-nav-item w-full ${active === tab ? "ui-nav-item-active" : "ui-nav-item-idle"}`}
      >
        {icon}
        <span>{label}</span>
      </button>
    );
  }

  return (
    <>
      <div className="ui-nav-section">SOPs</div>
      <div className="space-y-0.5">
        {item("all", <FileText size={15} strokeWidth={1.75} />, "All SOPs")}
        {item("review", <Inbox size={15} strokeWidth={1.75} />, "Review queue")}
        {item("library", <Library size={15} strokeWidth={1.75} />, "Effective library")}
        {item("retired", <Archive size={15} strokeWidth={1.75} />, "Retired")}
      </div>
      {manage ? (
        <>
          <div className="ui-nav-section mt-3">Manage</div>
          <div className="space-y-0.5">
            {item("departments", <Building2 size={15} strokeWidth={1.75} />, "Departments")}
          </div>
        </>
      ) : null}
      <SopWorkspaceSwitcher />
    </>
  );
}
