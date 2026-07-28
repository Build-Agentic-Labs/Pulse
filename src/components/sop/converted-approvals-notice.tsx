"use client";

import { AlertTriangle, Check, ShieldCheck } from "lucide-react";
import { useMemo } from "react";
import type { Department } from "@/domain/departments";
import { mapApprovalsToDepartments } from "@/domain/sop/approval-mapping";
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
 * Derived, not stored: it compares the document's legacy rows against the seats that exist right
 * now. There is nothing to dismiss because it stops being interesting once the roster is right.
 */
export function ConvertedApprovalsNotice({
  approvals,
  departments,
  seatedDepartmentIds,
}: {
  approvals: readonly SopApproval[];
  departments: readonly Department[];
  seatedDepartmentIds: ReadonlySet<string>;
}) {
  const mappings = useMemo(
    () => mapApprovalsToDepartments(approvals, departments),
    [approvals, departments],
  );

  // Nothing to verify when the legacy document had no approval table.
  if (mappings.length === 0) return null;

  const unmapped = mappings.filter((mapping) => mapping.outcome === "unmapped");
  const mapped = mappings.filter((mapping) => mapping.outcome === "mapped");
  // A mapped row whose seat has since been removed reads as unresolved again, not as done.
  const missingSeat = mapped.filter((mapping) => !seatedDepartmentIds.has(mapping.department!.id));

  return (
    <section className="ui-panel overflow-hidden">
      <div className="border-b border-line px-4 py-3">
        <h3 className="ui-setup-section-title">Approvals carried over from the original document</h3>
        <p className="mt-1 text-xs text-ink-tertiary">
          {`These were matched automatically when the document was converted. Check they are right before submitting for review — ${
            unmapped.length + missingSeat.length > 0
              ? "some rows still need a department."
              : "every row was placed."
          }`}
        </p>
      </div>

      <ul className="divide-y divide-line">
        {mappings.map((mapping, index) => {
          const { approval, outcome, department } = mapping;
          const label = [approval.role, approval.name].filter(Boolean).join(" — ") || "Approval row";
          const needsSeat = outcome === "mapped" && !seatedDepartmentIds.has(department!.id);

          return (
            <li key={`${label}-${index}`} className="flex items-start gap-3 px-4 py-2.5">
              {outcome === "quality-gate" ? (
                <ShieldCheck size={14} className="mt-0.5 shrink-0 text-emerald-700" />
              ) : outcome === "mapped" && !needsSeat ? (
                <Check size={14} className="mt-0.5 shrink-0 text-emerald-700" />
              ) : (
                <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warn" />
              )}

              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-ink">{label}</div>
                <div className="ui-section-subtitle text-ink-tertiary">
                  {outcome === "quality-gate"
                    ? "Quality signs the final release, so it is not a department approval here."
                    : outcome === "unmapped"
                      ? "No matching department — add one above if this approval is still required."
                      : needsSeat
                        ? `${department!.name} — the seat was removed; add it back if still required.`
                        : `${department!.name} — seat added, choose a reviewer above.`}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
