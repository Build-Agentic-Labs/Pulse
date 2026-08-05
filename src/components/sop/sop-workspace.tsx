"use client";

import { Archive, Building2, FileText, Inbox, LayoutDashboard, Library } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { NavSelectionTrack } from "@/components/nav-selection-track";
import { QualityListLoadingContent } from "@/components/space-loading-states";
import type { Department, DepartmentMember } from "@/domain/departments";
import type { MemberAccess } from "@/domain/types";
import type { HistoricalSopRevision } from "@/lib/sop/review";
import type { SopListReviewData } from "@/lib/sop/list-review-data";
import type { QueueData } from "@/lib/sop/review-queue-data";
import type { SopListItem } from "@/lib/sop/store";
import { SopShell } from "./sop-shell";
import { canManage, SopWorkspaceSwitcher, useSopWorkspace } from "./sop-workspace-provider";

function SopTabChunkLoading() {
  // Tab chunks are mounted while their panels are hidden so they are ready before selection.
  // Keep that background work visually silent; the active panel's data loader owns any
  // foreground loading feedback once the chunk is available.
  return <div className="min-h-[260px]" aria-hidden />;
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
const DepartmentsAdmin = dynamic(
  () => import("./departments-admin").then((module) => module.DepartmentsAdmin),
  { loading: SopTabChunkLoading },
);
const SopDashboard = dynamic(
  () => import("./sop-dashboard").then((module) => module.SopDashboard),
  { loading: SopTabChunkLoading },
);

type Tab = "dashboard" | "all" | "review" | "library" | "retired" | "settings";

const CRUMB: Record<Tab, string> = {
  dashboard: "Quality / Dashboard",
  all: "Quality / SOPs",
  library: "Quality / Effective library",
  review: "Quality / Review queue",
  retired: "Quality / Retired",
  settings: "Quality / Quality settings",
};

function parseTab(raw: string | null): Tab {
  if (raw === "dashboard" || raw === "review" || raw === "library" || raw === "retired" || raw === "settings") return raw;
  return "all";
}

/**
 * The persistent SOP workspace: one shell (header + sidebar) that stays mounted while the tabs
 * swap the content panel client-side — no route change, no provider re-mount, no reload. This is
 * the same model as the planner (Product) space. The editor remains its own route and shares
 * this section's provider (mounted in app/sops/layout.tsx).
 */
/**
 * Server-fetched first paint for whichever tab the URL addressed (Stage 5): the
 * server page fetches ONE tab's data and the matching child seeds from it. Only
 * type imports cross the boundary here — runtime values imported from a client
 * module into a server component become client-reference proxies.
 */
export type SopWorkspaceInitialData =
  | { tab: "dashboard"; workspaceId: string; sops: SopListItem[]; departments: Department[] }
  | {
      tab: "all";
      workspaceId: string;
      sops: SopListItem[];
      departments: Department[];
      memberDepartments: Department[];
      review: SopListReviewData;
    }
  | { tab: "library"; workspaceId: string; sops: SopListItem[]; departments: Department[] }
  | { tab: "retired"; workspaceId: string; sops: SopListItem[]; revisions: HistoricalSopRevision[] }
  | { tab: "review"; workspaceId: string; queue: QueueData }
  | {
      tab: "settings";
      workspaceId: string;
      departments: Department[];
      members: DepartmentMember[];
      directory: MemberAccess[];
    };

export function SopWorkspace({ initial }: { initial?: SopWorkspaceInitialData } = {}) {
  const { role } = useSopWorkspace();
  const manage = canManage(role);
  const params = useSearchParams();
  const requested = parseTab(params.get("tab"));
  const tab = requested === "settings" && !manage ? "all" : requested;
  const [mountedTabs, setMountedTabs] = useState<Set<Tab>>(() => new Set([tab]));

  useEffect(() => {
    setMountedTabs((current) => {
      if (current.has(tab)) return current;
      return new Set(current).add(tab);
    });
  }, [tab]);

  useEffect(() => {
    const warmPanels = () => {
      setMountedTabs(new Set<Tab>([
        "dashboard",
        "all",
        "review",
        "library",
        "retired",
        ...(manage ? ["settings" as const] : []),
      ]));
    };
    const idleWindow = window as Window & {
      requestIdleCallback?: Window["requestIdleCallback"];
      cancelIdleCallback?: Window["cancelIdleCallback"];
    };
    if (idleWindow.requestIdleCallback) {
      const id = idleWindow.requestIdleCallback(warmPanels, { timeout: 750 });
      return () => idleWindow.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(warmPanels, 150);
    return () => window.clearTimeout(id);
  }, [manage]);

  function select(next: Tab) {
    setMountedTabs((current) => current.has(next) ? current : new Set(current).add(next));
    const href = next === "all" ? "/sops" : `/sops?tab=${next}`;
    window.history.pushState(null, "", href);
  }

  const sidebar = <SopTabNav active={tab} manage={manage} onSelect={select} />;

  return (
    <SopShell sidebar={sidebar} crumb={CRUMB[tab]}>
      <div hidden={tab !== "dashboard"} aria-hidden={tab !== "dashboard"}>
        {mountedTabs.has("dashboard") ? (
          <SopDashboard
            active={tab === "dashboard"}
            preload
            initialSops={initial?.tab === "dashboard" ? initial.sops : undefined}
            initialDepartments={initial?.tab === "dashboard" ? initial.departments : undefined}
            initialWorkspaceId={initial?.tab === "dashboard" ? initial.workspaceId : undefined}
          />
        ) : null}
      </div>
      <div hidden={tab !== "all"} aria-hidden={tab !== "all"}>
        {mountedTabs.has("all") ? (
          <SopList
            active={tab === "all"}
            preload
            initialSops={initial?.tab === "all" ? initial.sops : undefined}
            initialDepartments={initial?.tab === "all" ? initial.departments : undefined}
            initialMemberDepartments={initial?.tab === "all" ? initial.memberDepartments : undefined}
            initialReview={initial?.tab === "all" ? initial.review : undefined}
            initialWorkspaceId={initial?.tab === "all" ? initial.workspaceId : undefined}
          />
        ) : null}
      </div>
      <div hidden={tab !== "review"} aria-hidden={tab !== "review"}>
        {mountedTabs.has("review") ? (
          <ReviewQueue
            active={tab === "review"}
            preload
            initialQueue={initial?.tab === "review" ? initial.queue : undefined}
            initialWorkspaceId={initial?.tab === "review" ? initial.workspaceId : undefined}
          />
        ) : null}
      </div>
      <div hidden={tab !== "library"} aria-hidden={tab !== "library"}>
        {mountedTabs.has("library") ? (
          <EffectiveLibrary
            active={tab === "library"}
            preload
            initialSops={initial?.tab === "library" ? initial.sops : undefined}
            initialDepartments={initial?.tab === "library" ? initial.departments : undefined}
            initialWorkspaceId={initial?.tab === "library" ? initial.workspaceId : undefined}
          />
        ) : null}
      </div>
      <div hidden={tab !== "retired"} aria-hidden={tab !== "retired"}>
        {mountedTabs.has("retired") ? (
          <RetiredSops
            active={tab === "retired"}
            preload
            initialSops={initial?.tab === "retired" ? initial.sops : undefined}
            initialRevisions={initial?.tab === "retired" ? initial.revisions : undefined}
            initialWorkspaceId={initial?.tab === "retired" ? initial.workspaceId : undefined}
          />
        ) : null}
      </div>
      <div hidden={tab !== "settings"} aria-hidden={tab !== "settings"}>
        {mountedTabs.has("settings") && manage ? (
          <QualitySettingsPanel
            active={tab === "settings"}
            preload
            initialDepartments={initial?.tab === "settings" ? initial.departments : undefined}
            initialMembers={initial?.tab === "settings" ? initial.members : undefined}
            initialDirectory={initial?.tab === "settings" ? initial.directory : undefined}
            initialWorkspaceId={initial?.tab === "settings" ? initial.workspaceId : undefined}
          />
        ) : null}
      </div>
    </SopShell>
  );
}

function QualitySettingsPanel({
  active,
  preload,
  initialDepartments,
  initialMembers,
  initialDirectory,
  initialWorkspaceId,
}: {
  active: boolean;
  preload: boolean;
  initialDepartments?: Department[];
  initialMembers?: DepartmentMember[];
  initialDirectory?: MemberAccess[];
  initialWorkspaceId?: string;
}) {
  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <h1 className="ui-section-title">Quality settings</h1>
        <p className="ui-section-subtitle">
          Manage departments, SOP ownership, access, and release controls.
        </p>
      </div>
      <DepartmentsAdmin
        active={active}
        preload={preload}
        embedded
        initialDepartments={initialDepartments}
        initialMembers={initialMembers}
        initialDirectory={initialDirectory}
        initialWorkspaceId={initialWorkspaceId}
      />
    </div>
  );
}

/**
 * Route/Suspense fallback for the SOP list. It uses the same authenticated
 * provider data and the same navigation component as the settled page, so a
 * server-data wait changes only the content body—not labels, icons, permissions,
 * or active-row styling in the shell.
 */
export function SopWorkspaceLoadingState({ active = "all" }: { active?: Tab }) {
  const { role } = useSopWorkspace();
  const manage = canManage(role);
  const safeActive = active === "settings" && !manage ? "all" : active;
  const sidebar = <SopTabNav active={safeActive} manage={manage} />;

  return (
    <SopShell sidebar={sidebar} crumb={CRUMB[safeActive]}>
      <QualityListLoadingContent />
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
  onSelect?: (tab: Tab) => void;
}) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>, tab: Tab) {
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

  function item(tab: Tab, icon: ReactNode, label: string) {
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
      <SopWorkspaceSwitcher />
    </>
  );
}
