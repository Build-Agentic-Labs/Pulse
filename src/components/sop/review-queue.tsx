"use client";

import { Building2, FileText, Inbox, Library, Loader2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { SOP_STATUS_LABELS, type SopStatus } from "@/domain/sop/schema";
import { listSops, type SopListItem } from "@/lib/sop/store";
import { SopShell } from "./sop-shell";
import { SopWorkspaceSwitcher, useSopWorkspace } from "./sop-workspace-provider";

/** The two lifecycle states that sit in the review queue: submitted for review, and signed-off. */
const QUEUE_STATUSES: readonly SopStatus[] = ["in_review", "approved"];

function isQueued(status: SopStatus): boolean {
  return QUEUE_STATUSES.includes(status);
}

function formatDate(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
}

/**
 * Status chip styling, matching the sop-list palette: approved reads as the black accent, in-review
 * as the warn tone. Everything else falls back to the neutral chip.
 */
function statusChipClass(status: SopStatus): string {
  if (status === "approved") {
    return "border-accent text-accent";
  }
  if (status === "in_review") {
    return "border-warn text-warn";
  }
  return "";
}

type ListStatus = "loading" | "ready" | "error";

/**
 * Read-only queue of SOPs awaiting review or freshly approved -- the control-side companion to the
 * effective library. Rows link to the read-only control view. Mirrors the sop-list shell, sidebar,
 * list-row, and status-chip patterns.
 */
export function ReviewQueue() {
  const { workspaceId } = useSopWorkspace();
  const [sops, setSops] = useState<SopListItem[]>([]);
  const [listStatus, setListStatus] = useState<ListStatus>("loading");
  const [error, setError] = useState("");

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
      setSops(next.filter((sop) => isQueued(sop.status)));
      setListStatus("ready");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load the review queue.");
      setListStatus("error");
    }
  }, [workspaceId]);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  const sidebar = (
    <>
      <div className="ui-nav-section">SOPs</div>
      <div className="space-y-0.5">
        <Link href="/sops" className="ui-nav-item ui-nav-item-idle">
          <FileText size={15} strokeWidth={1.75} />
          <span>All SOPs</span>
        </Link>
        <Link href="/sops/library" className="ui-nav-item ui-nav-item-idle">
          <Library size={15} strokeWidth={1.75} />
          <span>Effective library</span>
        </Link>
      </div>
      <div className="ui-nav-section mt-3">Control</div>
      <div className="space-y-0.5">
        <span className="ui-nav-item ui-nav-item-active" aria-current="page">
          <Inbox size={15} strokeWidth={1.75} />
          <span>Review queue</span>
        </span>
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
    <SopShell sidebar={sidebar} crumb="Quality / Review queue">
      <div className="mx-auto max-w-3xl space-y-5">
        <div>
          <h1 className="ui-section-title">Review queue</h1>
          <p className="ui-section-subtitle">
            SOPs submitted for review or approved and awaiting release. Read-only.
          </p>
        </div>

        {error ? <div className="ui-notice ui-notice-warn px-4 py-3 ui-section-subtitle">{error}</div> : null}

        <section className="ui-panel divide-y divide-line overflow-hidden">
          {listStatus === "loading" ? (
            <div className="flex items-center justify-center px-4 py-10">
              <Loader2 size={18} className="animate-spin text-ink-tertiary" />
            </div>
          ) : listStatus === "error" ? (
            <div className="px-4 py-10 text-center">
              <p className="ui-section-subtitle text-ink-tertiary">{error || "Could not load the review queue."}</p>
              <button type="button" className="ui-btn-ghost mt-3 inline-flex h-9 px-3" onClick={() => void refreshList()}>
                Retry
              </button>
            </div>
          ) : sops.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <Inbox size={20} className="mx-auto text-ink-tertiary" />
              <p className="mt-2 ui-section-subtitle text-ink-tertiary">Nothing awaiting review.</p>
            </div>
          ) : (
            sops.map((sop) => (
              <Link
                key={sop.id}
                href={`/sops/${sop.id}/control`}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-hover"
              >
                <FileText size={15} className="shrink-0 text-ink-tertiary" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink">
                    {sop.title || sop.sopNumber || "Untitled SOP"}
                  </div>
                  <div className="ui-mono-label mt-0.5 truncate text-ink-tertiary">
                    {[sop.sopNumber, sop.version ? `v${sop.version}` : ""].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <span className={`ui-chip shrink-0 ${statusChipClass(sop.status)}`}>
                  {SOP_STATUS_LABELS[sop.status]}
                </span>
                {formatDate(sop.updatedAt) ? (
                  <span className="hidden ui-mono-label text-ink-tertiary sm:inline">{formatDate(sop.updatedAt)}</span>
                ) : null}
              </Link>
            ))
          )}
        </section>
      </div>
    </SopShell>
  );
}
