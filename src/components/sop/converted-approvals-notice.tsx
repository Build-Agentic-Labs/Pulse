"use client";

import { AlertTriangle, Check, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { ThemedSelect } from "@/components/themed-select";
import type { Department } from "@/domain/departments";
import { mapApprovalsToDepartments, type ApprovalMapping } from "@/domain/sop/approval-mapping";
import type { SopApproval } from "@/domain/sop/schema";

/**
 * What conversion made of the legacy document's approval table.
 *
 * Conversion pre-populates the roster in the background, so the author needs to see what was
 * decided on their behalf before they submit. Every outcome is stated, including the ones that
 * did nothing:
 *
 *  - mapped        — a seat exists for this department
 *  - quality gate  — deliberately NOT a seat. Quality signs the release, and the transition guard
 *                    refuses to release an SOP whose Quality approver holds a seat. Saying so
 *                    stops it looking like the row was dropped.
 *  - unmapped      — nothing matched; the author adds it by hand or decides it is not needed
 *
 * Laid out as a table, one fact per column, because the question being asked of the reader is a
 * comparison — "did the old document's role become the right department?" — and a comparison is
 * read down columns. The same content as prose forced that comparison back into the reader's head.
 *
 * Derived, not stored: it compares the document's legacy rows against the seats that exist right
 * now. There is nothing to dismiss because it stops being interesting once the roster is right.
 */

type RowStatus = "seated" | "quality-gate" | "seat-removed" | "no-match";

interface NoticeRow {
  key: string;
  /** This row's position in `approvals`, so a picker action can name which row it is for. */
  index: number;
  /** What the original document called this approval, e.g. "Reviewed By". */
  documentRole: string;
  /**
   * The job title the original document printed. Shown because it is the EVIDENCE for the mapping:
   * the position title is what the fallback matched on when the converter offered no department.
   */
  documentPosition: string;
  /** The Pulse department this became, or empty when nothing matched. */
  mappedTo: string;
  status: RowStatus;
}

const STATUS_LABEL: Record<RowStatus, string> = {
  seated: "Seat added",
  "quality-gate": "Final release",
  "seat-removed": "Seat removed",
  "no-match": "No match",
};

function StatusIcon({ status }: { status: RowStatus }) {
  if (status === "quality-gate") return <ShieldCheck size={13} className="shrink-0 text-emerald-700" aria-hidden />;
  if (status === "seated") return <Check size={13} className="shrink-0 text-emerald-700" aria-hidden />;
  return <AlertTriangle size={13} className="shrink-0 text-warn" aria-hidden />;
}

function toRow(mapping: ApprovalMapping, index: number, seatedDepartmentIds: ReadonlySet<string>): NoticeRow {
  const { approval, outcome, department } = mapping;
  // The person named in the legacy document is deliberately NOT shown anywhere here. It is
  // transcribed text with no account behind it, and printing it beside real approver pickers
  // invites the reader to treat it as someone in the system. The name stays in sop.approvals as
  // the historical record of what the original said.
  const status: RowStatus =
    outcome === "quality-gate"
      ? "quality-gate"
      : outcome === "unmapped"
        ? "no-match"
        : seatedDepartmentIds.has(department!.id)
          ? "seated"
          : "seat-removed";

  return {
    key: `${approval.role}-${index}`,
    index,
    documentRole: approval.role.trim() || "Approval row",
    documentPosition: approval.position.trim(),
    mappedTo: department?.name ?? "",
    status,
  };
}

export function ConvertedApprovalsNotice({
  approvals,
  departments,
  seatedDepartmentIds,
  onSeatDepartment,
}: {
  approvals: readonly SopApproval[];
  departments: readonly Department[];
  seatedDepartmentIds: ReadonlySet<string>;
  /**
   * Turn an unresolved row into a real seat. Absent — a read-only viewer, or an
   * SOP past draft — renders the table exactly as it always was: a report.
   */
  onSeatDepartment?: (approvalIndex: number, departmentId: string) => Promise<void>;
}) {
  const [pending, setPending] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      mapApprovalsToDepartments(approvals, departments).map((mapping, index) =>
        toRow(mapping, index, seatedDepartmentIds),
      ),
    [approvals, departments, seatedDepartmentIds],
  );

  // Quality is the release gate, never a seat; an already-seated department has
  // nothing to add. Both exclusions mirror the roster's own add-row.
  const seatableDepartments = useMemo(
    () => departments.filter((d) => !d.isQualityGate && !seatedDepartmentIds.has(d.id)),
    [departments, seatedDepartmentIds],
  );

  // Nothing to verify when the legacy document had no approval table.
  //
  // "No rows" is not the only way that happens. A converted document whose Word file had no
  // approval table falls back to the blank template's standard roles (see the base.approvals
  // fallback in lib/sop/store.ts), so `source === "converted"` alone would print five phantom
  // rows announcing that approvals were carried over when none were. The honest test is whether
  // any row carries something to map WITH: a position title or a department hint. Without one, no
  // row can resolve to a department and there is nothing for the author to check.
  const hasMappableInput = approvals.some(
    (approval) => approval.position.trim() !== "" || (approval.departmentCode ?? "").trim() !== "",
  );
  if (rows.length === 0 || !hasMappableInput) return null;

  const unresolved = rows.filter((row) => row.status === "no-match" || row.status === "seat-removed");

  // The per-row guidance that does not fit in a cell. Each note appears only when a row needs it,
  // so the panel gets quieter as the roster gets right.
  const notes: string[] = [];
  if (rows.some((row) => row.status === "quality-gate")) {
    notes.push("Quality signs the final release, so a Quality row is not a department approval here.");
  }
  if (rows.some((row) => row.status === "no-match")) {
    notes.push("No match: nothing in this workspace matched the row. Add the department above if the approval is still required.");
  }
  if (rows.some((row) => row.status === "seat-removed")) {
    notes.push("Seat removed: the seat was created and then deleted. Add it back above if the approval is still required.");
  }

  return (
    <section className="ui-panel overflow-hidden">
      <div className="border-b border-line px-4 py-3">
        <h3 className="ui-setup-section-title">Approvals carried over from the original document</h3>
        <p className="mt-1 text-xs text-ink-tertiary">
          {`These were matched automatically when the document was converted. Check they are right before submitting for review — ${
            unresolved.length > 0 ? "some rows still need a department." : "every row was placed."
          }`}
        </p>
      </div>

      <div className="ui-table-scroll">
        <table className="w-full min-w-[560px] table-fixed border-collapse text-left">
          <colgroup>
            <col className="w-[24%]" />
            <col className="w-[26%]" />
            <col className="w-[28%]" />
            <col />
          </colgroup>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="px-4 py-2.5 text-[11px] font-medium text-ink-secondary">Document role</th>
              <th scope="col" className="px-4 py-2.5 text-[11px] font-medium text-ink-secondary">Document position</th>
              <th scope="col" className="px-4 py-2.5 text-[11px] font-medium text-ink-secondary">Mapped to</th>
              <th scope="col" className="px-4 py-2.5 text-[11px] font-medium text-ink-secondary">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => (
              <tr key={row.key}>
                <th scope="row" className="px-4 py-2.5 align-middle text-[13px] font-medium text-ink">
                  {row.documentRole}
                </th>
                <td className="px-4 py-2.5 align-middle text-[13px] text-ink-secondary">
                  {row.documentPosition || "—"}
                </td>
                <td className="px-4 py-2.5 align-middle text-[13px] text-ink">
                  {onSeatDepartment && (row.status === "no-match" || row.status === "seat-removed") ? (
                    <ThemedSelect
                      variant="sop"
                      ariaLabel={`Department for the ${row.documentRole} approval`}
                      value=""
                      disabled={pending === row.key}
                      menuMaxHeight={420}
                      options={[
                        { value: "", label: "Choose a department…" },
                        ...seatableDepartments.map((department) => ({
                          value: department.id,
                          label: `${department.code} · ${department.name}`,
                        })),
                      ]}
                      onChange={(departmentId) => {
                        if (!departmentId) return;
                        setPending(row.key);
                        void onSeatDepartment(row.index, departmentId).finally(() => setPending(null));
                      }}
                    />
                  ) : (
                    row.mappedTo || "—"
                  )}
                </td>
                <td className="px-4 py-2.5 align-middle">
                  <span className="inline-flex items-center gap-1.5 text-xs text-ink-secondary">
                    <StatusIcon status={row.status} />
                    {STATUS_LABEL[row.status]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {notes.length > 0 ? (
        <div className="space-y-1 border-t border-line px-4 py-3">
          {notes.map((note) => (
            <p key={note} className="text-xs text-ink-tertiary">
              {note}
            </p>
          ))}
        </div>
      ) : null}
    </section>
  );
}
