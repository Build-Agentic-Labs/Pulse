"use client";

import { parseSopWorkspaceTab } from "@/domain/sop/workspace-navigation";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { QualitySkeleton } from "./quality-skeleton";
import type { Department, DepartmentMember } from "@/domain/departments";
import type { MemberAccess } from "@/domain/types";
import type { HistoricalSopRevision } from "@/lib/sop/review";
import type { SopListReviewData } from "@/lib/sop/list-review-data";
import type { QueueData } from "@/lib/sop/review-queue-data";
import { useReviewQueueCount } from "@/lib/sop/review-queue-count";
import type { SopListItem } from "@/lib/sop/store";
import { SopShell } from "./sop-shell";
import { SopTabNav, type SopTab } from "./sop-tab-nav";
import { canManage, SopWorkspaceSwitcher, useSopWorkspace } from "./sop-workspace-provider";

function SopTabChunkLoading() {
  const params = useSearchParams();
  const active = parseSopWorkspaceTab(params.get("tab"), params.get("via"));
  return active === "settings" ? <QualitySkeleton variant="form" label="Loading Quality settings" /> : <QualityWorkspaceSkeleton active={active} />;
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

type Tab = SopTab;

const CRUMB: Record<Tab, string> = {
  dashboard: "Quality / Dashboard",
  all: "Quality / SOPs",
  library: "Quality / Effective library",
  review: "Quality / Review queue",
  retired: "Quality / Retired",
  settings: "Quality / Quality settings",
};


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
  const { role, workspaceId } = useSopWorkspace();
  const manage = canManage(role);
  const reviewCount = useReviewQueueCount(workspaceId);
  const params = useSearchParams();
  const requested = parseSopWorkspaceTab(params.get("tab"), params.get("via"));
  const tab = requested === "settings" && !manage ? "all" : requested;
  const [mountedTabs, setMountedTabs] = useState<Set<Tab>>(() => new Set([tab]));

  useEffect(() => {
    setMountedTabs((current) => {
      if (current.has(tab)) return current;
      return new Set(current).add(tab);
    });
  }, [tab]);

  useEffect(() => {
    // Warm only the route chunks. Mounting every hidden panel here also started
    // every panel's Supabase reads, duplicating SOP and department queries before
    // the user visited those screens. A selected panel stays mounted afterward,
    // so first use is cold once and return navigation remains instant.
    const warmPanelChunks = () => {
      void Promise.all([
        import("./sop-dashboard"),
        import("./sop-list"),
        import("./review-queue"),
        import("./effective-library"),
        import("./retired-sops"),
        ...(manage ? [import("./departments-admin")] : []),
      ]).catch(() => undefined);
    };
    const idleWindow = window as Window & {
      requestIdleCallback?: Window["requestIdleCallback"];
      cancelIdleCallback?: Window["cancelIdleCallback"];
    };
    if (idleWindow.requestIdleCallback) {
      const id = idleWindow.requestIdleCallback(warmPanelChunks, { timeout: 750 });
      return () => idleWindow.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(warmPanelChunks, 150);
    return () => window.clearTimeout(id);
  }, [manage]);

  function select(next: Tab) {
    setMountedTabs((current) => current.has(next) ? current : new Set(current).add(next));
    const href = next === "all" ? "/sops" : `/sops?tab=${next}`;
    window.history.pushState(null, "", href);
  }

  const sidebar = (
    <>
      <SopTabNav active={tab} manage={manage} onSelect={select} reviewCount={reviewCount} />
      <SopWorkspaceSwitcher />
    </>
  );

  return (
    <SopShell sidebar={sidebar} crumb={CRUMB[tab]}>
      <div hidden={tab !== "dashboard"} aria-hidden={tab !== "dashboard"}>
        {mountedTabs.has("dashboard") ? (
          <SopDashboard
            active={tab === "dashboard"}
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
            key={workspaceId}
            active={tab === "review"}
            openReviewId={tab === "review" ? params.get("review") : null}
            openApprovalId={tab === "review" ? params.get("approval") : null}
            openApprovalDepartment={params.get("department")}
            initialQueue={initial?.tab === "review" ? initial.queue : undefined}
            initialWorkspaceId={initial?.tab === "review" ? initial.workspaceId : undefined}
          />
        ) : null}
      </div>
      <div hidden={tab !== "library"} aria-hidden={tab !== "library"}>
        {mountedTabs.has("library") ? (
          <EffectiveLibrary
            active={tab === "library"}
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
  initialDepartments,
  initialMembers,
  initialDirectory,
  initialWorkspaceId,
}: {
  active: boolean;
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
export function SopWorkspaceLoadingState({ active }: { active?: Tab }) {
  const params = useSearchParams();
  active = active ?? parseSopWorkspaceTab(params.get("tab"), params.get("via"));
  const { role, workspaceId } = useSopWorkspace();
  const reviewCount = useReviewQueueCount(workspaceId);
  const manage = canManage(role);
  const safeActive = active === "settings" && !manage ? "all" : active;
  const sidebar = (
    <>
      <SopTabNav active={safeActive} manage={manage} reviewCount={reviewCount} />
      <SopWorkspaceSwitcher />
    </>
  );

  return (
    <SopShell sidebar={sidebar} crumb={CRUMB[safeActive]}>
      <QualityWorkspaceSkeleton active={safeActive} />
    </SopShell>
  );
}

function QualityWorkspaceSkeleton({ active }: { active: Tab }) {
  return <div className="mx-auto max-w-6xl space-y-6">
    <div><h1 className="ui-section-title">{CRUMB[active].replace("Quality / ", "")}</h1>
      {active === "library" ? <p className="ui-section-subtitle">The single approved, in-force version of every SOP. Select a document to open its controlled PDF.</p> : null}
    </div>
    <QualitySkeleton variant={active === "dashboard" ? "dashboard" : active === "settings" ? "form" : "list"} label={`Opening ${CRUMB[active]}`} />
  </div>;
}
