"use client";
import { ModalSurface } from "@/components/ui/modal-surface";
import { listEffectiveLibrary } from "@/lib/sop/controlled-changes";
import { createPlannerSupabaseClient, getUserFromSession } from "@/domain/supabase-planner";
import { getSopControl, transitionSop } from "@/lib/sop/review";
import { nextVersion, parseVersion, formatVersion, type ChangeSignificance } from "@/domain/sop/version";
import { useRouter } from "next/navigation";

import { Library, Pencil } from "lucide-react";
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
  const [kind, setKind] = useState<ChangeSignificance>("MINOR");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => { void getUserFromSession(createPlannerSupabaseClient()).then(({ data }) => setUserId(data.user?.id)); }, []);
  async function startChange() {
    if (!changing || !reason.trim() || saving) return;
    setSaving(true); setError("");
    try {
      const control = await getSopControl(changing.id);
      if (!control || control.status !== "effective") throw new Error("A working change already exists or this SOP is no longer effective.");
      await transitionSop(changing.id, "draft", control.updatedAt, { changeSignificance: kind, revisionReason: reason.trim() });
      router.push(`/sops/${changing.id}?step=document`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The change could not be started."); }
    finally { setSaving(false); }
  }
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

      {changing ? <ModalSurface label="Make a controlled change" onCancel={() => { if (!saving) setChanging(null); }}><section className="ui-panel w-[min(36rem,calc(100vw-2rem))] space-y-3 p-5">
        <h2 className="ui-setup-section-title">Make a change · {changing.title}</h2>
        <p className="text-xs text-ink-secondary">The current release remains effective until Quality releases the replacement.</p>
        <div className="flex gap-2">{(["MINOR", "MAJOR"] as const).map((value) => <button key={value} type="button" aria-pressed={kind === value} className="ui-btn-ghost border border-line px-3"
          onClick={() => setKind(value)}>{value === "MINOR" ? "Minor revision" : "New version"} · {formatVersion(nextVersion(parseVersion(changing.version) ?? { major: 1, minor: 0 }, value))}</button>)}</div>
        <p className="text-xs text-ink-tertiary">{kind === "MINOR" ? "Unchanged approvals are carried forward. Only new or replacement approvers review and sign; Quality must approve the release." : "Every approver completes the full review and signature loop again."}</p>
        <label className="block text-xs">Reason for change<textarea className="ui-field-standalone mt-2 w-full" value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        <div className="flex gap-2"><button type="button" disabled={saving || !reason.trim()} className="ui-btn-primary px-3" onClick={() => void startChange()}>{saving ? "Creating draft…" : "Create draft"}</button>
        <button type="button" disabled={saving} className="ui-btn-ghost px-3" onClick={() => setChanging(null)}>Cancel</button></div>
      </section></ModalSurface> : null}
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
                            const previewHref = `/sops/${sop.id}/released`;
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
                                  {sop.hasWorkingDraft ? <Link className="mt-2 block text-xs underline" href={`/sops/${sop.id}`}>Version {sop.workingVersion} in progress</Link> :
                                    userId === sop.createdBy && canEditSops && sop.supportsControlledChanges ? <button type="button" className="ui-btn-ghost mt-2 h-8 gap-1 px-2 text-xs opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 max-sm:opacity-100"
                                      onClick={() => { setChanging(sop); setReason(""); setKind("MINOR"); }}><Pencil size={12} />Make a change</button> : null}
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
