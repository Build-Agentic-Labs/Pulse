"use client";

import { Archive } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { QuietLoading } from "@/components/quiet-loading";
import { formatDate } from "@/domain/formatting";
import { listNumberLabel } from "@/domain/sop/authoring";
import { listSops, type SopListItem } from "@/lib/sop/store";
import { listHistoricalRevisions, type HistoricalSopRevision } from "@/lib/sop/review";
import { useSopWorkspace } from "./sop-workspace-provider";

type ListStatus = "loading" | "ready" | "error";

interface RetiredEntry {
  id: string;
  sopNumber: string;
  title: string;
  version: string;
  archivedAt: string;
  reason: "Older version" | "Retired SOP";
}


/** Pure assembly shared by the client refresh and the server-seeded first paint. */
function buildRetiredEntries(rows: SopListItem[], revisions: HistoricalSopRevision[]): RetiredEntry[] {
  const retiredSops = rows
    .filter((sop): sop is SopListItem => sop.status === "obsolete")
    .map<RetiredEntry>((sop) => ({
      id: `sop:${sop.id}`,
      sopNumber: listNumberLabel(sop.sopNumber, sop.departmentCode),
      title: sop.title,
      version: sop.version,
      archivedAt: sop.updatedAt,
      reason: "Retired SOP",
    }));
  const olderVersions = revisions.map<RetiredEntry>((revision) => ({
    id: `revision:${revision.id}`,
    // A frozen revision only exists for a released document, so it always has a real number;
    // normalize anyway so a blank can never render as an empty cell.
    sopNumber: listNumberLabel(revision.sopNumber, null),
    title: revision.title,
    version: revision.versionLabel,
    archivedAt: revision.createdAt,
    reason: "Older version",
  }));
  return [...retiredSops, ...olderVersions].sort((a, b) => b.archivedAt.localeCompare(a.archivedAt));
}

/** Read-only archive of SOPs explicitly retired through the document-control lifecycle. */
export function RetiredSops({
  active = true,
  preload = false,
  initialSops,
  initialRevisions,
  initialWorkspaceId,
}: {
  active?: boolean;
  preload?: boolean;
  /** Server-fetched first paint (Stage 5): seeds the archive, then background-revalidates. */
  initialSops?: SopListItem[];
  initialRevisions?: HistoricalSopRevision[];
  initialWorkspaceId?: string;
}) {
  const { workspaceId } = useSopWorkspace();
  const seededFromServer =
    initialSops !== undefined &&
    initialRevisions !== undefined &&
    initialWorkspaceId !== undefined &&
    initialWorkspaceId === workspaceId;
  const [entries, setEntries] = useState<RetiredEntry[]>(
    seededFromServer ? buildRetiredEntries(initialSops, initialRevisions) : [],
  );
  const [status, setStatus] = useState<ListStatus>(seededFromServer ? "ready" : "loading");
  const [error, setError] = useState("");
  const freshnessRef = useRef<{ workspaceId?: string; loadedAt: number }>(
    seededFromServer ? { workspaceId, loadedAt: 1 } : { loadedAt: 0 },
  );

  const refresh = useCallback(async (options: { background?: boolean } = {}) => {
    if (!workspaceId) {
      setEntries([]);
      setStatus("ready");
      freshnessRef.current = { workspaceId, loadedAt: Date.now() };
      return;
    }
    if (!options.background) {
      setStatus("loading");
      setError("");
    }
    try {
      const [rows, revisions] = await Promise.all([
        listSops(workspaceId),
        listHistoricalRevisions(workspaceId),
      ]);
      setEntries(buildRetiredEntries(rows, revisions));
      setError("");
      setStatus("ready");
      freshnessRef.current = { workspaceId, loadedAt: Date.now() };
    } catch (caught) {
      if (!options.background) {
        setError(caught instanceof Error ? caught.message : "Could not load retired SOPs.");
        setStatus("error");
      }
    }
  }, [workspaceId]);

  useEffect(() => {
    if (!active && !preload) return;
    const hasCurrentData =
      freshnessRef.current.workspaceId === workspaceId && freshnessRef.current.loadedAt > 0;
    if (hasCurrentData && Date.now() - freshnessRef.current.loadedAt < 30_000) return;
    void refresh({ background: hasCurrentData });
  }, [active, preload, refresh, workspaceId]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="ui-section-title">Retired</h1>
        <p className="ui-section-subtitle">Older versions retained as a list for traceability. They cannot be opened or downloaded.</p>
      </div>

      {error ? <div className="ui-notice ui-notice-warn px-4 py-3 ui-section-subtitle">{error}</div> : null}

      {status === "loading" ? (
        <QuietLoading active={active} label="Loading retired SOPs" />
      ) : status === "error" ? (
        <section className="ui-empty-state">
          <button type="button" className="ui-btn-ghost inline-flex h-9 px-3" onClick={() => void refresh()}>
            Retry
          </button>
        </section>
      ) : entries.length === 0 ? (
        <section className="ui-empty-state ui-empty-state-flat">
          <Archive size={20} className="mx-auto text-ink-tertiary" />
          <p className="mt-2 ui-section-subtitle text-ink-tertiary">No retired SOPs.</p>
        </section>
      ) : (
        <section className="ui-data-table-frame ui-data-table-frame-canvas">
          <div className="ui-table-scroll">
            <table className="w-full min-w-[640px] border-collapse text-left">
              <thead>
                <tr className="border-b border-line">
                  <th className="px-4 py-3 text-[11px] font-medium text-ink-secondary">SOP</th>
                  <th className="w-24 px-4 py-3 text-[11px] font-medium text-ink-secondary">Version</th>
                  <th className="w-32 px-4 py-3 text-[11px] font-medium text-ink-secondary">Type</th>
                  <th className="w-28 px-4 py-3 text-[11px] font-medium text-ink-secondary">Archived</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id} className="border-b border-line/70 last:border-b-0">
                    <td className="px-4 py-3.5">
                      <div className="truncate text-[13px] font-medium text-ink">{entry.title || "Untitled SOP"}</div>
                      <div className="ui-mono-label mt-0.5 text-ink-tertiary">{entry.sopNumber}</div>
                    </td>
                    <td className="px-4 py-3.5 ui-mono-label text-ink-secondary">{entry.version || "—"}</td>
                    <td className="px-4 py-3.5"><span className="ui-chip">{entry.reason}</span></td>
                    <td className="px-4 py-3.5 text-[12px] tabular-nums text-ink-tertiary">{formatDate(entry.archivedAt) || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
