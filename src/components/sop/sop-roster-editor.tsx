"use client";

import { Check, LockKeyhole, Loader2, Plus, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ThemedSelect } from "@/components/themed-select";
import type { Department } from "@/domain/departments";
import { listMembersForDepartments } from "@/lib/departments/store";
import {
  isBlockingSeat,
  listProfileNames,
  removeSeat,
  upsertSeat,
  type SopReviewSeat,
} from "@/lib/sop/review";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

interface RosterEditorProps {
  sopId: string;
  departments: Department[];
  seats: SopReviewSeat[];
  onChanged: () => Promise<void> | void;
}

/**
 * Assign the departments whose approval is required. Each department names exactly one approver
 * who reviews the draft and later signs the formal departmental approval. Procedure RASIC is a
 * separate responsibility map and is intentionally not part of this roster.
 *
 * Editable only while the SOP is a draft — the database freezes the roster on submit, and after
 * that only an admin may reassign an approver.
 */
export function SopRosterEditor({ sopId, departments, seats, onChanged }: RosterEditorProps) {
  const [members, setMembers] = useState<Map<string, { userId: string; name: string; positionTitle: string }[]>>(new Map());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<{ departmentId: string; signerId: string }>({
    departmentId: "",
    signerId: "",
  });

  const qualityDepartment = departments.find((department) => department.isQualityGate);
  const workflowSeats = useMemo(
    () => seats.filter(
      (seat) =>
        isBlockingSeat(seat.rasic) &&
        !departments.find((department) => department.id === seat.departmentId)?.isQualityGate,
    ),
    [departments, seats],
  );
  const seatedIds = new Set(workflowSeats.map((seat) => seat.departmentId));
  const available = departments.filter(
    (department) => !department.isQualityGate && !seatedIds.has(department.id),
  );

  // One batched pass for any number of departments: a single department_members
  // query + a single profiles query, instead of 2 round trips per seat (N+1).
  const loadMembersForDepartmentIds = useCallback(async (departmentIds: readonly string[]) => {
    const ids = [...new Set(departmentIds.filter(Boolean))];
    if (ids.length === 0) return;
    try {
      const rows = await listMembersForDepartments(ids);
      const names = await listProfileNames(rows.map((row) => row.userId));
      setMembers((prev) => {
        const next = new Map(prev);
        for (const departmentId of ids) {
          next.set(
            departmentId,
            rows
              .filter((row) => row.departmentId === departmentId)
              .map((row) => ({
                userId: row.userId,
                name: names.get(row.userId) || "Unnamed member",
                positionTitle: row.positionTitle,
              })),
          );
        }
        return next;
      });
    } catch (caught) {
      setError(getErrorMessage(caught));
    }
  }, []);

  const loadMembers = useCallback(
    (departmentId: string) => loadMembersForDepartmentIds([departmentId]),
    [loadMembersForDepartmentIds],
  );

  useEffect(() => {
    void loadMembersForDepartmentIds(workflowSeats.map((seat) => seat.departmentId));
  }, [workflowSeats, loadMembersForDepartmentIds]);

  async function guarded(key: string, fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(key);
    setError("");
    try {
      await fn();
      await onChanged();
    } catch (caught) {
      setError(getErrorMessage(caught));
    }
    setBusy(null);
  }

  return (
    <section className="ui-data-table-frame">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
        <h2 className="ui-setup-section-title">Department approvals</h2>
        {available.length > 0 ? (
          <button
            type="button"
            className="ui-btn-ghost h-8 gap-1.5 px-2"
            aria-expanded={adding}
            onClick={() => {
              setAdding((current) => !current);
              setDraft({ departmentId: "", signerId: "" });
            }}
          >
            {adding ? <X size={14} /> : <Plus size={14} />}
            {adding ? "Cancel" : "Add approver"}
          </button>
        ) : null}
      </div>

      {error ? (
        <div className="border-b border-line px-4 py-3">
          <p className="ui-section-subtitle text-danger">{error}</p>
        </div>
      ) : null}

      <div className="ui-table-scroll">
        <table className="w-full min-w-[620px] table-fixed border-collapse text-left">
          <colgroup>
            <col className="w-[38%]" />
            <col />
            <col className="w-14" />
          </colgroup>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="px-5 py-3 text-[11px] font-medium text-ink-secondary">Department</th>
              <th scope="col" className="px-5 py-3 text-[11px] font-medium text-ink-secondary">Required approver</th>
              <th scope="col" className="px-2 py-3"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {workflowSeats.map((seat) => {
              const department = departments.find((item) => item.id === seat.departmentId);
              const options = members.get(seat.departmentId) ?? [];
              const approverOptions = [
                { value: "", label: "Choose an approver…" },
                ...options.map((member) => ({
                  value: member.userId,
                  label: member.name,
                  description: member.positionTitle || "Position not assigned",
                })),
              ];
              return (
                <tr
                  key={seat.departmentId}
                  className="group border-b border-line/70 transition-colors hover:bg-surface-hover"
                >
                  <td className="px-5 py-3.5 align-middle text-[13px] font-medium text-ink">
                    <span className="block truncate">{department?.name ?? "Unknown"}</span>
                  </td>
                  <td className="px-5 py-2.5 align-middle">
                    <ThemedSelect
                      variant="sop"
                      className="w-full"
                      triggerClassName="ui-sop-select-inline"
                      ariaLabel={`Required approver for ${department?.code ?? "department"}`}
                      value={seat.signerId ?? ""}
                      options={approverOptions}
                      disabled={busy !== null}
                      onChange={(value) =>
                        void guarded(`approver-${seat.departmentId}`, () =>
                          upsertSeat({ ...seat, rasic: "responsible", signerId: value || null }),
                        )
                      }
                    />
                  </td>
                  <td className="px-2 py-2.5 align-middle">
                    <button
                      type="button"
                      aria-label={`Remove ${department?.code ?? "department"} from the roster`}
                      className="ui-btn-ghost h-8 w-8 p-0 text-ink-tertiary opacity-50 hover:text-danger group-hover:opacity-100 focus-visible:opacity-100 disabled:opacity-40"
                      title="Remove department"
                      disabled={busy !== null}
                      onClick={() => void guarded(`remove-${seat.departmentId}`, () => removeSeat(sopId, seat.departmentId))}
                    >
                      {busy === `remove-${seat.departmentId}` ? (
                        <Loader2 size={14} className="mx-auto animate-spin" />
                      ) : (
                        <Trash2 size={14} className="mx-auto" />
                      )}
                    </button>
                  </td>
                </tr>
              );
            })}

            <tr className="border-b border-line/70">
              <td className="px-5 py-3.5 align-middle">
                <span className={`block truncate text-[13px] font-medium ${
                  qualityDepartment ? "text-ink" : "text-danger"
                }`}>
                  {qualityDepartment?.name ?? "Quality department not assigned"}
                </span>
              </td>
              <td className="px-5 py-3.5 align-middle">
                <span className="block text-[13px] text-ink-secondary">Quality approvers</span>
                <span className="mt-0.5 block text-[11px] text-ink-tertiary">Final approver</span>
              </td>
              <td className="px-2 py-3.5 align-middle text-center">
                <LockKeyhole size={14} className="mx-auto text-ink-tertiary" aria-label="Managed automatically" />
              </td>
            </tr>

            {adding && available.length > 0 ? (
              <tr className="bg-canvas/55">
                <td className="px-5 py-2.5 align-middle">
                  <ThemedSelect
                    variant="sop"
                    ariaLabel="Department to add"
                    value={draft.departmentId}
                    disabled={busy !== null}
                    options={[
                      { value: "", label: "Add a department…" },
                      ...available.map((department) => ({
                        value: department.id,
                        label: `${department.code} · ${department.name}`,
                      })),
                    ]}
                    onChange={(departmentId) => {
                      setDraft((prev) => ({ ...prev, departmentId, signerId: "" }));
                      void loadMembers(departmentId);
                    }}
                  />
                </td>
                <td className="px-5 py-2.5 align-middle">
                  <ThemedSelect
                    variant="sop"
                    ariaLabel="Required departmental approver"
                    value={draft.signerId}
                    disabled={busy !== null || !draft.departmentId}
                    options={[
                      { value: "", label: "Select approver…" },
                      ...(members.get(draft.departmentId) ?? []).map((member) => ({
                        value: member.userId,
                        label: member.name,
                        description: member.positionTitle || "Position not assigned",
                      })),
                    ]}
                    onChange={(signerId) => setDraft((prev) => ({ ...prev, signerId }))}
                  />
                </td>
                <td className="px-2 py-2.5 align-middle">
                  <button
                    type="button"
                    className="ui-btn-primary h-8 w-8 p-0 disabled:opacity-40"
                    aria-label="Add departmental approver"
                    title="Add departmental approver"
                    disabled={
                      busy !== null ||
                      !draft.departmentId ||
                      !draft.signerId
                    }
                    onClick={() =>
                      void guarded("add", async () => {
                        await upsertSeat({
                          sopId,
                          departmentId: draft.departmentId,
                          rasic: "responsible",
                          signerId: draft.signerId,
                        });
                        setAdding(false);
                        setDraft({ departmentId: "", signerId: "" });
                      })
                    }
                  >
                    {busy === "add" ? (
                      <Loader2 size={14} className="mx-auto animate-spin" />
                    ) : (
                      <Check size={14} className="mx-auto" />
                    )}
                  </button>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

    </section>
  );
}
