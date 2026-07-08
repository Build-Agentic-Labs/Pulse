"use client";

import { useEffect, useState } from "react";
import type { Department } from "@/domain/departments";
import { listDepartments } from "@/lib/departments/store";
import { assignDepartment, type SopControl } from "@/lib/sop/review";
import { SopConflictError } from "@/lib/sop/store";

/** Document types that prefix the DEPT-TYPE-NNN number. */
const DOC_TYPES = ["SOP", "WI", "FRM", "POL"] as const;

/**
 * Assigns a draft SOP to an owning department and mints its DEPT-TYPE-NNN number in one step
 * (the number encodes the department). Editable only while the SOP is a draft — once it leaves
 * draft the DB freezes the department. Otherwise it just shows the current owning department.
 */
export function SopDepartmentAssign({
  control,
  canEdit,
  onChanged,
}: {
  control: SopControl;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [deptId, setDeptId] = useState(control.departmentId ?? "");
  const [docType, setDocType] = useState(control.docType || "SOP");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    listDepartments(control.workspaceId)
      .then((rows) => {
        if (active) setDepartments(rows);
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : "Could not load departments.");
      });
    return () => {
      active = false;
    };
  }, [control.workspaceId]);

  const current = departments.find((d) => d.id === control.departmentId);
  const editable = canEdit && control.status === "draft";

  async function handleAssign() {
    if (!deptId) return;
    setBusy(true);
    setError("");
    try {
      await assignDepartment(control.id, control.workspaceId, deptId, docType, control.updatedAt);
      onChanged();
    } catch (caught) {
      setError(
        caught instanceof SopConflictError
          ? "This SOP changed since you opened it — reload and try again."
          : caught instanceof Error
            ? caught.message
            : "Could not assign the department.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!editable) {
    return (
      <div className="flex flex-col gap-1">
        <span className="ui-mono-label">Owning department</span>
        <span className="text-sm font-medium text-ink">
          {current ? `${current.code} · ${current.name}` : "Unassigned"}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="ui-mono-label">Assign owning department</span>
      {error ? <div className="ui-notice ui-notice-warn px-3 py-2 ui-section-subtitle">{error}</div> : null}
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="ui-field-standalone"
          value={deptId}
          onChange={(event) => setDeptId(event.target.value)}
          disabled={busy}
        >
          <option value="">Select department…</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.code} · {d.name}
            </option>
          ))}
        </select>
        <select
          className="ui-field-standalone"
          value={docType}
          onChange={(event) => setDocType(event.target.value)}
          disabled={busy}
        >
          {DOC_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="ui-btn-primary h-9 px-3 disabled:opacity-50"
          onClick={() => void handleAssign()}
          disabled={busy || !deptId}
        >
          {busy ? "Assigning…" : "Assign & number"}
        </button>
      </div>
    </div>
  );
}
