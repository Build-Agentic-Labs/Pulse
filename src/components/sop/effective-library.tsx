"use client";

import { Building2, FileText, Inbox, Library, Loader2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SOP_STATUS_LABELS } from "@/domain/sop/schema";
import { listSops, type SopListItem } from "@/lib/sop/store";
import { SopShell } from "./sop-shell";
import { SopWorkspaceSwitcher, useSopWorkspace } from "./sop-workspace-provider";

/** Department code = the first '-'-delimited segment of the SOP number ("ENG-SOP-007" -> "ENG"). */
function departmentOf(sopNumber: string): string {
  const segment = sopNumber.split("-")[0]?.trim();
  return segment ? segment.toUpperCase() : "";
}

/** Distinct department codes present in the given SOPs, alphabetically ordered. */
function distinctDepartments(sops: readonly SopListItem[]): string[] {
  const codes = new Set<string>();
  for (const sop of sops) {
    const code = departmentOf(sop.sopNumber);
    if (code) {
      codes.add(code);
    }
  }
  return Array.from(codes).sort((a, b) => a.localeCompare(b));
}

type ListStatus = "loading" | "ready" | "error";

/**
 * Read-only, org-wide view of every effective SOP -- the single approved, in-force copy of each
 * document. No editor: rows link to the read-only control view. Mirrors the sop-list shell,
 * sidebar, and status-chip patterns.
 */
export function EffectiveLibrary() {
  const { workspaceId } = useSopWorkspace();
  const [sops, setSops] = useState<SopListItem[]>([]);
  const [listStatus, setListStatus] = useState<ListStatus>("loading");
  const [error, setError] = useState("");
  const [department, setDepartment] = useState("");

  const refreshList = useCallback(async () => {
    if (!workspaceId) {
      setSops([]);
      setListStatus("ready");
      return;
    }
    setListStatus("loading");
    setError("");
    try {
      const next = await listSops(workspaceId);
      setSops(next.filter((sop) => sop.status === "effective"));
      setListStatus("ready");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load effective SOPs.");
      setListStatus("error");
    }
  }, [workspaceId]);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  const departments = useMemo(() => distinctDepartments(sops), [sops]);

  // A department chip that no longer matches any effective SOP falls back to "All" so the grid
  // can never end up filtered to nothing by a stale selection.
  const activeDepartment = department && departments.includes(department) ? department : "";

  const visibleSops = useMemo(() => {
    if (!activeDepartment) {
      return sops;
    }
    return sops.filter((sop) => departmentOf(sop.sopNumber) === activeDepartment);
  }, [sops, activeDepartment]);

  const sidebar = (
    <>
      <div className="ui-nav-section">SOPs</div>
      <div className="space-y-0.5">
        <Link href="/sops" className="ui-nav-item ui-nav-item-idle">
          <FileText size={15} strokeWidth={1.75} />
          <span>All SOPs</span>
        </Link>
        <span className="ui-nav-item ui-nav-item-active" aria-current="page">
          <Library size={15} strokeWidth={1.75} />
          <span>Effective library</span>
        </span>
      </div>
      <div className="ui-nav-section mt-3">Control</div>
      <div className="space-y-0.5">
        <Link href="/sops/review" className="ui-nav-item ui-nav-item-idle">
          <Inbox size={15} strokeWidth={1.75} />
          <span>Review queue</span>
        </Link>
      </div>
      <div className="ui-nav-section mt-3">Manage</div>
      <div className="space-y-0.5">
        <Link href="/sops/departments" className="ui-nav-item ui-nav-item-idle">
          <Building2 size={15} strokeWidth={1.75} />
          <span>Departments</span>
        </Link>
      </div>
      <SopWorkspaceSwitcher />
    </>
  );

  return (
    <SopShell sidebar={sidebar} crumb="Quality / Effective library">
      <div className="mx-auto max-w-4xl space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="ui-section-title">Effective library</h1>
            <p className="ui-section-subtitle">
              The single approved, in-force version of every SOP. Read-only for the whole organization.
            </p>
          </div>
          <span className="ui-chip shrink-0">Controlled copies</span>
        </div>

        {error ? <div className="ui-notice ui-notice-warn px-4 py-3 ui-section-subtitle">{error}</div> : null}

        {listStatus === "ready" && departments.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={activeDepartment ? "ui-chip" : "ui-chip-accent"}
              onClick={() => setDepartment("")}
            >
              All
            </button>
            {departments.map((code) => (
              <button
                key={code}
                type="button"
                className={activeDepartment === code ? "ui-chip-accent" : "ui-chip"}
                onClick={() => setDepartment(code)}
              >
                {code}
              </button>
            ))}
          </div>
        ) : null}

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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {visibleSops.map((sop) => {
              const dept = departmentOf(sop.sopNumber);
              return (
                <Link
                  key={sop.id}
                  href={`/sops/${sop.id}/control`}
                  className="ui-panel flex flex-col gap-2.5 p-4 transition-colors hover:bg-surface-hover"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="ui-mono-label font-bold text-ink">{sop.sopNumber || "Unnumbered"}</span>
                    <span className="ui-chip shrink-0 border-success text-success">
                      {SOP_STATUS_LABELS.effective}
                    </span>
                  </div>
                  <div className="text-sm font-semibold leading-snug text-ink">
                    {sop.title || "Untitled SOP"}
                  </div>
                  <div className="flex items-center gap-2">
                    {dept ? <span className="ui-chip-accent">{dept}</span> : null}
                    {sop.version ? (
                      <span className="ui-mono-label text-ink-tertiary">v{sop.version}</span>
                    ) : null}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </SopShell>
  );
}
