"use client";
import { UiContextMenu } from "@/components/ui-context-menu";
import { listEffectiveLibrary } from "@/lib/sop/controlled-changes";
import { createPlannerSupabaseClient, getUserFromSession } from "@/domain/supabase-planner";
import { getSopControl } from "@/lib/sop/review";
import { formatVersion, nextVersion, parseVersion, type ChangeSignificance } from "@/domain/sop/version";
import { useRouter } from "next/navigation";

import { Library, Pencil, GitPullRequest } from "lucide-react";
import { listNumberLabel } from "@/domain/sop/authoring";
import { formatDate } from "@/domain/formatting";
import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QualitySkeleton } from "./quality-skeleton";
import type { Department } from "@/domain/departments";
import { SOP_STATUS_LABELS } from "@/domain/sop/schema";
import { listDepartments } from "@/lib/departments/store";
import { type SopListItem } from "@/lib/sop/store";
import { useSopWorkspace } from "./sop-workspace-provider";

type ListStatus = "loading" | "ready" | "error";


/** The controlled, in-force SOP library, organized exactly like the All SOPs table. */
export function EffectiveLibrary({
  active = true,
  preload = false,
  initialSops,
  initialDepartments,
  initialWorkspaceId,
}: {
  active?: boolean;
  preload?: boolean;
  /** Server-fetched first paint (Stage 5): seeds the list, then background-revalidates. */
  initialSops?: SopListItem[];
  initialDepartments?: Department[];
  initialWorkspaceId?: string;
}) {
  const { workspaceId, canEditSops } = useSopWorkspace();
  const router = useRouter();
  const [userId, setUserId] = useState<string>();
  const [changing, setChanging] = useState<SopListItem | null>(null);
  const [changeAnchor, setChangeAnchor] = useState<DOMRect | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { void getUserFromSession(createPlannerSupabaseClient()).then(({ data }) => setUserId(data.user?.id)); }, []);
  async function startChange(kind: ChangeSignificance) {
    if (!changing || saving) return;
    setSaving(true); setError("");
    try {
      const control = await getSopControl(changing.id);
      if (!control || control.status !== "effective") throw new Error("A working change already exists or this SOP is no longer effective.");
      router.push(`/sops/${changing.id}?change=${kind}`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The change could not be started."); }
    finally { setSaving(false); }
  }
  const currentChangeVersion = changing ? parseVersion(changing.version) : null;
  const nextChangeVersion = (kind: ChangeSignificance) => currentChangeVersion ? `(${formatVersion(nextVersion(currentChangeVersion, kind))})` : undefined;
  const seededFromServer =
    initialSops !== undefined &&
    initialDepartments !== undefined &&
    initialWorkspaceId !== undefined &&
    initialWorkspaceId === workspaceId;
  const [sops, setSops] = useState<SopListItem[]>(
    seededFromServer ? initialSops.filter((sop) => sop.status === "effective") : [],
  );
  const [departments, setDepartments] = useState<Department[]>(seededFromServer ? initialDepartments : []);
  const [listStatus, setListStatus] = useState<ListStatus>(seededFromServer ? "ready" : "loading");
  const [error, setError] = useState("");
  const freshnessRef = useRef<{ workspaceId?: string; loadedAt: number }>(
    seededFromServer ? { workspaceId, loadedAt: 1 } : { loadedAt: 0 },
  );

  const refreshList = useCallback(async (options: { background?: boolean } = {}) => {
    if (!workspaceId) {
      setSops([]);
      setDepartments([]);
      setListStatus("ready");
      freshnessRef.current = { workspaceId, loadedAt: Date.now() };
      return;
    }
    if (!options.background) {
      setListStatus("loading");
      setError("");
    }
    try {
      const [nextSops, nextDepartments] = await Promise.all([
        listEffectiveLibrary(workspaceId),
        listDepartments(workspaceId),
      ]);
      setSops(nextSops.filter((sop) => sop.status === "effective"));
      setDepartments(nextDepartments);
      setError("");
      setListStatus("ready");
      freshnessRef.current = { workspaceId, loadedAt: Date.now() };
    } catch (caught) {
      if (!options.background) {
        setError(caught instanceof Error ? caught.message : "Could not load effective SOPs.");
        setListStatus("error");
      }
    }
  }, [workspaceId]);

  useEffect(() => {
    if (!active && !preload) return;
    const hasCurrentData =
      freshnessRef.current.workspaceId === workspaceId && freshnessRef.current.loadedAt > 0;
    if (hasCurrentData && Date.now() - freshnessRef.current.loadedAt < 30_000) return;
    void refreshList({ background: hasCurrentData });
  }, [active, preload, refreshList, workspaceId]);

  const groups = useMemo(() => {
    const byDepartment = new Map<string, SopListItem[]>();
    for (const sop of sops) {
      if (!sop.departmentId) continue;
      const list = byDepartment.get(sop.departmentId) ?? [];
      list.push(sop);
      byDepartment.set(sop.departmentId, list);
    }

    const visibleDepartments = departments.filter(
      (department) =>
        department.code.trim().toUpperCase() !== "UNA" &&
        department.name.trim().toLowerCase() !== "unassigned",
    );
    const ordered: Array<{ key: string; department: Department | null; sops: SopListItem[] }> =
      visibleDepartments.map((department) => ({
        key: department.id,
        department,
        sops: byDepartment.get(department.id) ?? [],
      }));

    for (const [departmentId, departmentSops] of byDepartment) {
      if (departments.some((department) => department.id === departmentId)) continue;
      ordered.push({ key: departmentId, department: null, sops: departmentSops });
    }
    return ordered.filter((group) => group.sops.length > 0);
  }, [departments, sops]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <div>
          <h1 className="ui-section-title">Effective library</h1>
          <p className="ui-section-subtitle">
            The single approved, in-force version of every SOP. Select a document to open its controlled PDF.
          </p>
        </div>
      </div>

      {changing && changeAnchor ? <UiContextMenu anchorRect={changeAnchor} ariaLabel="Make a change" density="comfortable" menuWidth={200}
        onClose={() => { setChanging(null); setChangeAnchor(null); }} items={[
          { id: "minor", label: "Minor Revision", hint: nextChangeVersion("MINOR"), disabled: !currentChangeVersion, onSelect: () => void startChange("MINOR") },
          { id: "major", label: "New Version", hint: nextChangeVersion("MAJOR"), disabled: !currentChangeVersion, onSelect: () => void startChange("MAJOR") },
        ]} /> : null}
      {error ? <div className="ui-notice ui-notice-warn px-4 py-3 ui-section-subtitle">{error}</div> : null}

      {listStatus === "loading" ? (
        <QualitySkeleton active={active} label="Loading effective SOPs" />
      ) : listStatus === "error" ? (
        <section className="ui-empty-state">
          <p className="ui-section-subtitle text-ink-tertiary">{error || "Could not load effective SOPs."}</p>
          <button type="button" className="ui-btn-ghost mt-3 inline-flex h-9 px-3" onClick={() => void refreshList()}>
            Retry
          </button>
        </section>
      ) : sops.length === 0 ? (
        <section className="ui-empty-state ui-empty-state-flat">
          <Library size={20} className="mx-auto text-ink-tertiary" />
          <p className="mt-2 ui-section-subtitle text-ink-tertiary">No effective SOPs yet.</p>
        </section>
      ) : (
        <div className="ui-data-table-frame ui-data-table-frame-canvas">
          <div className="ui-table-scroll">
            <table className="w-full min-w-[680px] border-collapse text-left">
                      <thead>
                        <tr className="border-b border-line">
                          <th className="w-36 px-5 py-3 text-[11px] font-medium text-ink-secondary">Number</th>
                          <th className="px-5 py-3 text-[11px] font-medium text-ink-secondary">Title</th>
                          <th className="w-32 px-5 py-3 text-[11px] font-medium text-ink-secondary">Status</th>
                          <th className="w-28 px-5 py-3 text-[11px] font-medium text-ink-secondary">Updated</th>
                          <th className="w-24 px-3 py-3"><span className="sr-only">Actions</span></th>
                        </tr>
                      </thead>
                      <tbody>
                        {groups.map((group) => {
                          const name = group.department?.name ?? "Unknown department";
                          const count = group.sops.length;
                          return (
                            <Fragment key={group.key}>
                              <tr className="border-b border-line bg-canvas/70">
                                <th colSpan={5} className="px-5 py-2.5 text-left">
                                  <div className="flex items-center justify-between gap-3">
                                    <span className="truncate text-sm font-semibold text-ink">{name}</span>
                                    <span className="shrink-0 text-xs font-normal tabular-nums text-ink-tertiary">
                                      {count} {count === 1 ? "SOP" : "SOPs"}
                                    </span>
                                  </div>
                                </th>
                              </tr>
                              {group.sops.map((sop) => {
                            const previewHref = `/sops/${sop.id}/released`;
                            const releasedVersion = parseVersion(sop.version ?? "");
                            const workingVersion = parseVersion(sop.workingVersion ?? "");
                            const isMinor = sop.changeSignificance === "MINOR" || (!sop.changeSignificance && releasedVersion && workingVersion && releasedVersion.major === workingVersion.major);
                            const changeLabel = `${isMinor ? "New revision" : "New version"}${sop.workingVersion ? ` (${sop.workingVersion})` : ""} in progress`;
                            return (
                              <tr
                                key={sop.id}
                                className="group border-b border-line/70 transition-colors last:border-b-0 hover:bg-surface-hover"
                              >
                                <td className="px-5 py-3.5 align-middle">
                                  <Link
                                    href={previewHref}
                                    className="text-xs font-medium text-ink-secondary hover:text-ink"
                                  >
                                    {/* Everything here is released, so this is always a real
                                        number -- routed through the shared label anyway so the app
                                        states unnumbered-ness exactly one way. */}
                                    {listNumberLabel(sop.sopNumber, sop.departmentCode)}
                                  </Link>
                                </td>
                                <td className="max-w-0 px-5 py-3.5 align-middle">
                                  <Link href={previewHref} className="flex min-w-0 items-baseline gap-2">
                                    <span className="truncate text-[13px] font-medium leading-snug text-ink">
                                      {sop.title || sop.sopNumber || "Untitled SOP"}
                                    </span>
                                    {sop.version ? (
                                      <span className="shrink-0 whitespace-nowrap text-[11px] text-ink-tertiary">Version {sop.version}</span>
                                    ) : null}
                                  </Link>
                                </td>
                                <td className="px-5 py-3.5 align-middle">
                                  <div className="flex items-center gap-2">
                                  <span className="inline-flex shrink-0 items-center rounded bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700">
                                    {SOP_STATUS_LABELS.effective}
                                  </span>
                                  {sop.hasWorkingDraft ? <Link href={`/sops/${sop.id}`} aria-label={changeLabel} className="group/change relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-ink-tertiary hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                                    <GitPullRequest size={14} aria-hidden="true" />
                                    <span role="tooltip" className="pointer-events-none absolute bottom-full right-0 z-20 mb-1 hidden whitespace-nowrap rounded border border-line bg-surface px-2 py-1 text-[11px] text-ink shadow-sm group-hover/change:block group-focus-visible/change:block">{changeLabel}</span>
                                  </Link> : null}
                                  </div>
                                </td>
                                <td className="px-5 py-3.5 align-middle text-[12px] tabular-nums text-ink-tertiary">
                                  {formatDate(sop.updatedAt) || "—"}
                                </td>
                                <td className="px-2 py-2.5 align-middle">
                                  {!sop.hasWorkingDraft && userId === sop.createdBy && canEditSops && sop.supportsControlledChanges ? <button type="button" title="Make a change" disabled={saving} aria-haspopup="menu" aria-expanded={changing?.id === sop.id} className="ui-btn-ghost h-8 w-8 px-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 max-sm:opacity-100"
                                      onClick={(event) => { setChanging(sop); setChangeAnchor(event.currentTarget.getBoundingClientRect()); }}><Pencil size={14} /><span className="sr-only">Make a change</span></button> : null}
                                </td>
                              </tr>
                            );
                              })}
                            </Fragment>
                          );
                        })}
                      </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
