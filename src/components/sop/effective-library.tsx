"use client";

import { Library, Loader2 } from "lucide-react";
import { formatDate } from "@/domain/formatting";
import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Department } from "@/domain/departments";
import { SOP_STATUS_LABELS } from "@/domain/sop/schema";
import { listDepartments } from "@/lib/departments/store";
import { listSops, type SopListItem } from "@/lib/sop/store";
import { useSopWorkspace } from "./sop-workspace-provider";

type ListStatus = "loading" | "ready" | "error";


/** The controlled, in-force SOP library, organized exactly like the All SOPs table. */
export function EffectiveLibrary({
  active = true,
  initialSops,
  initialDepartments,
  initialWorkspaceId,
}: {
  active?: boolean;
  /** Server-fetched first paint (Stage 5): seeds the list, then background-revalidates. */
  initialSops?: SopListItem[];
  initialDepartments?: Department[];
  initialWorkspaceId?: string;
}) {
  const { workspaceId } = useSopWorkspace();
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
        listSops(workspaceId),
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
    if (!active) return;
    const hasCurrentData =
      freshnessRef.current.workspaceId === workspaceId && freshnessRef.current.loadedAt > 0;
    if (hasCurrentData && Date.now() - freshnessRef.current.loadedAt < 30_000) return;
    void refreshList({ background: hasCurrentData });
  }, [active, refreshList, workspaceId]);

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

      {error ? <div className="ui-notice ui-notice-warn px-4 py-3 ui-section-subtitle">{error}</div> : null}

      {listStatus === "loading" ? (
        <section className="flex min-h-40 items-center justify-center border-t border-line px-4">
          <Loader2 size={18} className="animate-spin text-ink-tertiary" />
        </section>
      ) : listStatus === "error" ? (
        <section className="flex min-h-40 flex-col items-center justify-center border-t border-line px-4 text-center">
          <p className="ui-section-subtitle text-ink-tertiary">{error || "Could not load effective SOPs."}</p>
          <button type="button" className="ui-btn-ghost mt-3 inline-flex h-9 px-3" onClick={() => void refreshList()}>
            Retry
          </button>
        </section>
      ) : sops.length === 0 ? (
        <section className="flex min-h-40 flex-col items-center justify-center border-t border-line px-4 text-center">
          <Library size={20} className="mx-auto text-ink-tertiary" />
          <p className="mt-2 ui-section-subtitle text-ink-tertiary">No effective SOPs yet.</p>
        </section>
      ) : (
        <div className="overflow-hidden border-y border-line bg-surface">
          <div className="ui-table-scroll">
            <table className="w-full min-w-[680px] border-collapse text-left">
                      <thead>
                        <tr className="border-b border-line">
                          <th className="w-36 px-5 py-3 text-[11px] font-medium text-ink-secondary">Number</th>
                          <th className="px-5 py-3 text-[11px] font-medium text-ink-secondary">Title</th>
                          <th className="w-32 px-5 py-3 text-[11px] font-medium text-ink-secondary">Status</th>
                          <th className="w-28 px-5 py-3 text-[11px] font-medium text-ink-secondary">Updated</th>
                        </tr>
                      </thead>
                      <tbody>
                        {groups.map((group) => {
                          const name = group.department?.name ?? "Unknown department";
                          const count = group.sops.length;
                          return (
                            <Fragment key={group.key}>
                              <tr className="border-b border-line bg-canvas/70">
                                <th colSpan={4} className="px-5 py-2.5 text-left">
                                  <div className="flex items-center justify-between gap-3">
                                    <span className="truncate text-sm font-semibold text-ink">{name}</span>
                                    <span className="shrink-0 text-xs font-normal tabular-nums text-ink-tertiary">
                                      {count} {count === 1 ? "SOP" : "SOPs"}
                                    </span>
                                  </div>
                                </th>
                              </tr>
                              {group.sops.map((sop) => {
                            const previewHref = `/sops/${sop.id}?preview=pdf`;
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
                                    {sop.sopNumber || "—"}
                                  </Link>
                                </td>
                                <td className="max-w-0 px-5 py-3.5 align-middle">
                                  <Link href={previewHref} className="block min-w-0">
                                    <span className="block truncate text-[13px] font-medium leading-snug text-ink">
                                      {sop.title || sop.sopNumber || "Untitled SOP"}
                                    </span>
                                    {sop.version ? (
                                      <span className="mt-1 block text-[11px] text-ink-tertiary">Version {sop.version}</span>
                                    ) : null}
                                  </Link>
                                </td>
                                <td className="px-5 py-3.5 align-middle">
                                  <span className="inline-flex shrink-0 items-center rounded bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700">
                                    {SOP_STATUS_LABELS.effective}
                                  </span>
                                </td>
                                <td className="px-5 py-3.5 align-middle text-[12px] tabular-nums text-ink-tertiary">
                                  {formatDate(sop.updatedAt) || "—"}
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
