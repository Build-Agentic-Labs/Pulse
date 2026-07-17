"use client";

import { Library, Loader2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Department } from "@/domain/departments";
import { SOP_STATUS_LABELS } from "@/domain/sop/schema";
import { listDepartments } from "@/lib/departments/store";
import { listSops, type SopListItem } from "@/lib/sop/store";
import { useSopWorkspace } from "./sop-workspace-provider";

type ListStatus = "loading" | "ready" | "error";

function formatDate(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString([], { year: "numeric", month: "numeric", day: "numeric" });
}

function departmentAccent(code: string): string {
  let hash = 0;
  for (let index = 0; index < code.length; index += 1) {
    hash = (hash * 31 + code.charCodeAt(index)) >>> 0;
  }
  const hues = [208, 162, 28, 286, 338, 188, 48, 132, 304, 12, 248];
  return `hsl(${hues[hash % hues.length]} 42% 40%)`;
}

/** The controlled, in-force SOP library, organized exactly like the All SOPs table. */
export function EffectiveLibrary() {
  const { workspaceId } = useSopWorkspace();
  const [sops, setSops] = useState<SopListItem[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [listStatus, setListStatus] = useState<ListStatus>("loading");
  const [error, setError] = useState("");

  const refreshList = useCallback(async () => {
    if (!workspaceId) {
      setSops([]);
      setDepartments([]);
      setListStatus("ready");
      return;
    }
    setListStatus("loading");
    setError("");
    try {
      const [nextSops, nextDepartments] = await Promise.all([
        listSops(workspaceId),
        listDepartments(workspaceId),
      ]);
      setSops(nextSops.filter((sop) => sop.status === "effective"));
      setDepartments(nextDepartments);
      setListStatus("ready");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load effective SOPs.");
      setListStatus("error");
    }
  }, [workspaceId]);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

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
    return ordered;
  }, [departments, sops]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="ui-section-title">Effective library</h1>
          <p className="ui-section-subtitle">
            The single approved, in-force version of every SOP. Select a document to open its controlled PDF.
          </p>
        </div>
        <span className="ui-chip shrink-0">Controlled copies</span>
      </div>

      {error ? <div className="ui-notice ui-notice-warn px-4 py-3 ui-section-subtitle">{error}</div> : null}

      {listStatus === "loading" ? (
        <section className="ui-panel flex items-center justify-center px-4 py-12">
          <Loader2 size={18} className="animate-spin text-ink-tertiary" />
        </section>
      ) : listStatus === "error" ? (
        <section className="ui-panel px-4 py-12 text-center">
          <p className="ui-section-subtitle text-ink-tertiary">{error || "Could not load effective SOPs."}</p>
          <button type="button" className="ui-btn-ghost mt-3 inline-flex h-9 px-3" onClick={() => void refreshList()}>
            Retry
          </button>
        </section>
      ) : sops.length === 0 ? (
        <section className="ui-panel px-4 py-12 text-center">
          <Library size={20} className="mx-auto text-ink-tertiary" />
          <p className="mt-2 ui-section-subtitle text-ink-tertiary">No effective SOPs yet.</p>
        </section>
      ) : (
        <div className="space-y-8">
          {groups.map((group) => {
            const name = group.department?.name ?? "Unknown department";
            const accent = departmentAccent(group.department?.code ?? group.key);
            const count = group.sops.length;

            return (
              <section key={group.key} className="space-y-2.5">
                <div className="flex items-baseline justify-between gap-3 px-0.5">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: accent }}
                      aria-hidden
                    />
                    <h2 className="truncate text-[15px] font-semibold tracking-tight text-ink">{name}</h2>
                  </div>
                  <span className="shrink-0 text-[12px] tabular-nums text-ink-tertiary">
                    {count} {count === 1 ? "SOP" : "SOPs"}
                  </span>
                </div>

                <div className="overflow-hidden rounded-xl border border-line bg-surface">
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
                        {count === 0 ? (
                          <tr>
                            <td colSpan={4} className="px-5 py-8 text-center text-[13px] text-ink-tertiary">
                              No SOPs yet
                            </td>
                          </tr>
                        ) : (
                          group.sops.map((sop) => {
                            const previewHref = `/sops/${sop.id}?preview=pdf`;
                            return (
                              <tr
                                key={sop.id}
                                className="group border-b border-line/70 transition-colors last:border-b-0 hover:bg-surface-hover"
                              >
                                <td className="px-5 py-3.5 align-middle">
                                  <Link
                                    href={previewHref}
                                    className="font-mono text-[12px] tracking-wide text-ink-secondary hover:text-ink"
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
                                  <span className="inline-flex shrink-0 items-center rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                                    {SOP_STATUS_LABELS.effective}
                                  </span>
                                </td>
                                <td className="px-5 py-3.5 align-middle text-[12px] tabular-nums text-ink-tertiary">
                                  {formatDate(sop.updatedAt) || "—"}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
