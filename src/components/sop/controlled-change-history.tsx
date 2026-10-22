"use client";
import { useEffect, useState } from "react";
import { listControlledChanges, type ControlledChange } from "@/lib/sop/controlled-changes";
import { formatDate } from "@/domain/formatting";

export function ControlledChangeHistory({ sopId, refreshKey, releasedOnly = false }: { sopId: string; refreshKey: string; releasedOnly?: boolean }) {
  const [rows, setRows] = useState<ControlledChange[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    listControlledChanges(sopId).then((next) => { if (active) { setRows(releasedOnly ? next.filter((row) => row.released_at) : next); setError(""); } })
      .catch(() => { if (active) setError("Change history could not be loaded."); });
    return () => { active = false; };
  }, [sopId, refreshKey, releasedOnly]);
  if (!rows.length && !error) return releasedOnly ? <p className="text-xs text-ink-secondary">No released change requests have been recorded yet.</p> : null;
  return <section className="ui-panel p-4">
    <h3 className="ui-setup-section-title">Controlled change log</h3>
    {error ? <p role="alert" className="mt-2 text-xs text-danger">{error}</p> : null}
    {rows.map((row) => <div key={row.review_cycle} className="mt-3 border-t border-line pt-3 text-xs">
      <p className="font-medium">{row.from_version} → {row.to_version} · {row.kind === "MINOR" ? "Minor revision" : "New version"} · {row.released_at ? "Effective" : row.closed_at ? "Returned by Quality" : "Pending release"}</p>
      <p className="mt-1 text-ink-secondary">{row.reason}</p>
      {row.closed_reason ? <p className="mt-1 text-ink-secondary">Quality feedback: {row.closed_reason}</p> : null}
      <p className="mt-1 text-ink-tertiary">Requested {formatDate(row.requested_at)} · Author {row.requested_by_name}</p>
      {row.released_at ? <p className="mt-1 text-ink-tertiary">Released by Quality {row.released_by_name} · {formatDate(row.released_at)}</p> : null}
      <details className="mt-2"><summary className="cursor-pointer">Approver changes and approval provenance</summary>
        <p className="mt-2">Original approvers: {(row.original_roster ?? []).map((person) => `${person.name} · ${person.department}`).join(", ")}</p>
        <p className="mt-1">{row.released_at ? "Released approvers" : "Current approvers"}: {row.release_roster ? row.release_roster.map((person) => `${person.name} · ${person.department}`).join(", ") : "Pending release"}</p>
        {row.release_roster ? <>
          <p className="mt-1">Added: {row.release_roster.filter((person) => !(row.original_roster ?? []).some((original) => original.userId === person.userId && original.departmentId === person.departmentId)).map((person) => person.name).join(", ") || "None"}</p>
          <p className="mt-1">Removed: {(row.original_roster ?? []).filter((original) => !row.release_roster!.some((person) => original.userId === person.userId && original.departmentId === person.departmentId)).map((person) => person.name).join(", ") || "None"}</p>
        </> : null}
        <p className="mt-1">Approval handling: {row.approval_handling ? row.approval_handling.map((approval) => `${approval.name} · ${approval.department}: ${approval.carriedForward ? `approval carried forward from ${approval.sourceVersion}` : row.released_at ? "fresh approval captured" : "fresh review and signature required"}`).join("; ") : row.kind === "MINOR" ? "Unchanged approvals retain original signature records; changed approvers must review and sign." : "All approvers must review and sign again."}</p>
      </details>
    </div>)}
  </section>;
}
