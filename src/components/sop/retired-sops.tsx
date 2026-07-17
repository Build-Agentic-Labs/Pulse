"use client";

import { Archive, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { listSops, type SopListItem } from "@/lib/sop/store";
import { listHistoricalRevisions } from "@/lib/sop/review";
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

function formatDate(iso: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
}

/** Read-only archive of SOPs explicitly retired through the document-control lifecycle. */
export function RetiredSops() {
  const { workspaceId } = useSopWorkspace();
  const [entries, setEntries] = useState<RetiredEntry[]>([]);
  const [status, setStatus] = useState<ListStatus>("loading");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!workspaceId) {
      setEntries([]);
      setStatus("ready");
      return;
    }
    setStatus("loading");
    setError("");
    try {
      const [rows, revisions] = await Promise.all([
        listSops(workspaceId),
        listHistoricalRevisions(workspaceId),
      ]);
      const retiredSops = rows
        .filter((sop): sop is SopListItem => sop.status === "obsolete")
        .map<RetiredEntry>((sop) => ({
          id: `sop:${sop.id}`,
          sopNumber: sop.sopNumber,
          title: sop.title,
          version: sop.version,
          archivedAt: sop.updatedAt,
          reason: "Retired SOP",
        }));
      const olderVersions = revisions.map<RetiredEntry>((revision) => ({
        id: `revision:${revision.id}`,
        sopNumber: revision.sopNumber,
        title: revision.title,
        version: revision.versionLabel,
        archivedAt: revision.createdAt,
        reason: "Older version",
      }));
      setEntries([...retiredSops, ...olderVersions].sort((a, b) => b.archivedAt.localeCompare(a.archivedAt)));
      setStatus("ready");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load retired SOPs.");
      setStatus("error");
    }
  }, [workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="ui-section-title">Retired</h1>
        <p className="ui-section-subtitle">Older versions retained as a list for traceability. They cannot be opened or downloaded.</p>
      </div>

      {error ? <div className="ui-notice ui-notice-warn px-4 py-3 ui-section-subtitle">{error}</div> : null}

      {status === "loading" ? (
        <section className="ui-panel flex items-center justify-center px-4 py-12">
          <Loader2 size={18} className="animate-spin text-ink-tertiary" />
        </section>
      ) : status === "error" ? (
        <section className="ui-panel px-4 py-12 text-center">
          <button type="button" className="ui-btn-ghost inline-flex h-9 px-3" onClick={() => void refresh()}>
            Retry
          </button>
        </section>
      ) : entries.length === 0 ? (
        <section className="ui-panel px-4 py-12 text-center">
          <Archive size={20} className="mx-auto text-ink-tertiary" />
          <p className="mt-2 ui-section-subtitle text-ink-tertiary">No retired SOPs.</p>
        </section>
      ) : (
        <section className="ui-panel overflow-hidden">
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
                      <div className="ui-mono-label mt-0.5 text-ink-tertiary">{entry.sopNumber || "Unnumbered"}</div>
                    </td>
                    <td className="px-4 py-3.5 ui-mono-label text-ink-secondary">{entry.version || "—"}</td>
                    <td className="px-4 py-3.5"><span className="ui-chip">{entry.reason}</span></td>
                    <td className="px-4 py-3.5 text-[12px] tabular-nums text-ink-tertiary">{formatDate(entry.archivedAt)}</td>
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
