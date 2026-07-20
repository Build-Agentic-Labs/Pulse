"use client";

import { Archive, Building2, FileText, Inbox, Library } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { NavSelectionTrack } from "@/components/nav-selection-track";
import { SopShell } from "./sop-shell";
import { canManage, SopWorkspaceSwitcher, useSopWorkspace } from "./sop-workspace-provider";

function SopTabChunkLoading() {
  return <div className="min-h-[560px]" aria-hidden="true" />;
}

const EffectiveLibrary = dynamic(
  () => import("./effective-library").then((module) => module.EffectiveLibrary),
  { loading: SopTabChunkLoading },
);
const ReviewQueue = dynamic(
  () => import("./review-queue").then((module) => module.ReviewQueue),
  { loading: SopTabChunkLoading },
);
const RetiredSops = dynamic(
  () => import("./retired-sops").then((module) => module.RetiredSops),
  { loading: SopTabChunkLoading },
);
const SopList = dynamic(
  () => import("./sop-list").then((module) => module.SopList),
  { loading: SopTabChunkLoading },
);

type Tab = "all" | "review" | "library" | "retired";

const CRUMB: Record<Tab, string> = {
  all: "Quality / SOPs",
  library: "Quality / Effective library",
  review: "Quality / Review queue",
  retired: "Quality / Retired",
};

function parseTab(raw: string | null): Tab {
  if (raw === "review" || raw === "library" || raw === "retired") return raw;
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
  const [tab, setTab] = useState<Tab>(() => parseTab(params.get("tab")));
  const [mountedTabs, setMountedTabs] = useState<Set<Tab>>(() => new Set([tab]));

  useEffect(() => {
    setMountedTabs((current) => {
      if (current.has(tab)) return current;
      const next = new Set(current);
      next.add(tab);
      return next;
    });
  }, [tab]);

  function select(next: Tab) {
    setMountedTabs((current) => (current.has(next) ? current : new Set(current).add(next)));
    setTab(next);
    // Keep the URL shareable/refresh-safe, but WITHOUT a Next navigation (so nothing re-mounts).
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", next === "all" ? "/sops" : `/sops?tab=${next}`);
    }
  }

  const sidebar = <SopTabNav active={tab} manage={manage} onSelect={select} />;

  return (
    <SopShell sidebar={sidebar} crumb={CRUMB[tab]}>
      <div hidden={tab !== "all"} aria-hidden={tab !== "all"}>
        {mountedTabs.has("all") ? <SopList active={tab === "all"} /> : null}
      </div>
      <div hidden={tab !== "review"} aria-hidden={tab !== "review"}>
        {mountedTabs.has("review") ? <ReviewQueue active={tab === "review"} /> : null}
      </div>
      <div hidden={tab !== "library"} aria-hidden={tab !== "library"}>
        {mountedTabs.has("library") ? <EffectiveLibrary active={tab === "library"} /> : null}
      </div>
      <div hidden={tab !== "retired"} aria-hidden={tab !== "retired"}>
        {mountedTabs.has("retired") ? <RetiredSops active={tab === "retired"} /> : null}
      </div>
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
      <NavSelectionTrack
        activeIndex={["all", "review", "library", "retired"].indexOf(active)}
        className="space-y-0.5"
      >
        {item("all", <FileText size={15} strokeWidth={1.75} />, "All SOPs")}
        {item("review", <Inbox size={15} strokeWidth={1.75} />, "Review queue")}
        {item("library", <Library size={15} strokeWidth={1.75} />, "Effective library")}
        {item("retired", <Archive size={15} strokeWidth={1.75} />, "Retired")}
      </NavSelectionTrack>
      {manage ? (
        <>
          <div className="ui-nav-section mt-3">Manage</div>
          <div className="space-y-0.5">
            <Link href="/settings?section=quality" className="ui-nav-item ui-nav-item-idle" title="Quality settings">
              <Building2 size={15} strokeWidth={1.75} />
              <span>Quality settings</span>
            </Link>
          </div>
        </>
      ) : null}
      <SopWorkspaceSwitcher />
    </>
  );
}
