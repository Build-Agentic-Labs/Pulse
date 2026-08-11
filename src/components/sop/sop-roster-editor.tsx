"use client";

import { Check, LockKeyhole, Loader2, Plus, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ThemedSelect } from "@/components/themed-select";
import { canSignReview, type Department, type DeptRole } from "@/domain/departments";
import type { SopApproval } from "@/domain/sop/schema";
import { signerAfterDepartmentChange } from "@/domain/sop/approval-mapping";
import { ConvertedApprovalsNotice } from "./converted-approvals-notice";
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

interface RosterMember {
  userId: string;
  name: string;
  positionTitle: string;
  deptRole: DeptRole;
}

interface RosterEditorProps {
  sopId: string;
  departments: Department[];
  seats: SopReviewSeat[];
  /**
   * The legacy document's approval rows, for a converted SOP. Present means "show the author what
   * conversion decided on their behalf"; absent (hand-authored) means there is nothing to verify.
   */
  convertedApprovals?: readonly SopApproval[];
  /**
   * Persist the author's department choice onto the legacy approval row. Supplied
   * only when the document is editable; its absence is what hides the picker.
   */
  onMapApproval?: (approvalIndex: number, departmentCode: string) => Promise<void>;
  onChanged: () => Promise<void> | void;
}

/**
 * Assign the departments whose approval is required. Each department names exactly one approver
 * who reviews the draft and later signs the formal departmental approval. Quality may also hold
 * one of these normal review seats; its locked final-release gate remains separate and must be
 * completed by a different Quality approver. Procedure RASIC is a separate responsibility map and
 * is intentionally not part of this roster.
 *
 * Editable only while the SOP is a draft — the database freezes the roster on submit, and after
 * that only an admin may reassign an approver.
 */
export function SopRosterEditor({
  sopId,
  departments,
  seats,
  convertedApprovals,
  onMapApproval,
  onChanged,
}: RosterEditorProps) {
  const [members, setMembers] = useState<Map<string, RosterMember[]>>(new Map());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<{ departmentId: string; signerId: string }>({
    departmentId: "",
    signerId: "",
  });

  const qualityDepartment = departments.find((department) => department.isQualityGate);
  const workflowSeats = useMemo(
    () => seats.filter((seat) => isBlockingSeat(seat.rasic)),
    [seats],
  );
  const seatedIds = new Set(workflowSeats.map((seat) => seat.departmentId));
  const available = departments.filter((department) => !seatedIds.has(department.id));

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
                deptRole: row.deptRole,
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

  /**
   * Move a seat to a different department.
   *
   * (sop_id, department_id) is the primary key, so this is a delete-and-insert rather than an
   * update. Both halves are legal only while the SOP is a draft — enforce_seat_freeze refuses
   * INSERT and DELETE once it has been submitted — and this editor only renders for drafts.
   *
   * The signer is carried over ONLY if they are also a member of the new department. Gate A
   * requires every seat's reviewer to belong to that seat's department, so keeping an outside
   * signer would leave a roster that looks complete and then fails at submission with "Every
   * seat's reviewer must belong to that seat's department". Blanking it asks the obvious
   * question now instead of raising a confusing one later.
   */
  async function changeSeatDepartment(seat: SopReviewSeat, nextDepartmentId: string) {
    if (!nextDepartmentId || nextDepartmentId === seat.departmentId) return;
    await loadMembersForDepartmentIds([nextDepartmentId]);
    await guarded(`department-${seat.departmentId}`, async () => {
      const nextMemberIds = (members.get(nextDepartmentId) ?? [])
        .filter((member) => canSignReview(member.deptRole))
        .map((member) => member.userId);
      await removeSeat(sopId, seat.departmentId);
      await upsertSeat({
        sopId,
        departmentId: nextDepartmentId,
        rasic: "responsible",
        signerId: signerAfterDepartmentChange(seat.signerId, nextMemberIds),
      });
    });
  }

  const seatedDepartmentIds = useMemo(
    () => new Set(seats.map((seat) => seat.departmentId)),
    [seats],
  );

  async function seatConvertedApproval(approvalIndex: number, departmentId: string) {
    const department = departments.find((item) => item.id === departmentId);
    if (!department || !onMapApproval) return;
    await guarded(`map-${approvalIndex}`, async () => {
      // Document write FIRST. If the seat write then fails the row reads
      // "Seat removed" — accurate, still offers its picker, and a retry heals it.
      // Reversed, a failure would leave a seat under a row still claiming "No match".
      await onMapApproval(approvalIndex, department.code);
      // Already seated: either another legacy row already mapped here, or a previous pass
      // created the seat and only the document write was lost. Either way, re-upserting with
      // signerId: null would WIPE any reviewer already assigned to that seat. The document write
      // above is enough to let this row resolve against the seat that already exists.
      if (seatedDepartmentIds.has(departmentId)) return;
      await upsertSeat({ sopId, departmentId, rasic: "responsible", signerId: null });
    });
  }

  return (
    <div className="space-y-4">
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
              const isQualityReviewSeat = Boolean(department?.isQualityGate);
              const options = members.get(seat.departmentId) ?? [];
              const eligibleOptions = options.filter((member) => canSignReview(member.deptRole));
              const ineligibleCurrentSigner = options.find(
                (member) =>
                  member.userId === seat.signerId &&
                  !canSignReview(member.deptRole),
              );
              const approverOptions = [
                { value: "", label: "Choose an approver…" },
                ...(ineligibleCurrentSigner
                  ? [{
                      value: ineligibleCurrentSigner.userId,
                      label: ineligibleCurrentSigner.name,
                      description: "Create access only — choose someone with Review or Approve access",
                      disabled: true,
                    }]
                  : []),
                ...eligibleOptions.map((member) => ({
                  value: member.userId,
                  label: member.name,
                  description: member.positionTitle || "Position not assigned",
                })),
                ...(!eligibleOptions.length && !ineligibleCurrentSigner
                  ? [{
                      value: "__no-eligible-approvers__",
                      label: "No reviewers or approvers assigned",
                      disabled: true,
                    }]
                  : []),
              ];
              return (
                <tr
                  key={seat.departmentId}
                  className="group border-b border-line/70 transition-colors hover:bg-surface-hover"
                >
                  <td className="px-5 py-2.5 align-middle">
                    <ThemedSelect
                      variant="sop"
                      className="w-full"
                      triggerClassName="ui-sop-select-inline"
                      ariaLabel={`Department for the ${department?.name ?? "unknown"} approval`}
                      value={seat.departmentId}
                      disabled={busy !== null}
                      options={[
                        ...(department
                          ? [{
                              value: department.id,
                              label: isQualityReviewSeat
                                ? `${department.name} · Additional reviewer`
                                : department.name,
                            }]
                          : [{ value: seat.departmentId, label: "Unknown" }]),
                        ...available.map((option) => ({
                          value: option.id,
                          label: option.isQualityGate
                            ? `${option.name} · Additional reviewer`
                            : option.name,
                        })),
                      ]}
                      onChange={(value) => void changeSeatDepartment(seat, value)}
                    />
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
                    {isQualityReviewSeat ? (
                      <p className="mt-1.5 text-[11px] leading-4 text-ink-tertiary">
                        Normal review loop. A different Quality approver completes final approval.
                      </p>
                    ) : null}
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
                    menuMaxHeight={420}
                    options={[
                      { value: "", label: "Add a department…" },
                      ...available.map((department) => ({
                        value: department.id,
                        label: `${department.code} · ${department.name}${
                          department.isQualityGate ? " · Additional reviewer" : ""
                        }`,
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
                      ...(members.get(draft.departmentId) ?? [])
                        .filter((member) => canSignReview(member.deptRole))
                        .map((member) => ({
                          value: member.userId,
                          label: member.name,
                          description: member.positionTitle || "Position not assigned",
                        })),
                      ...(draft.departmentId &&
                      !(members.get(draft.departmentId) ?? []).some((member) =>
                        canSignReview(member.deptRole),
                      )
                        ? [{
                            value: "__no-eligible-approvers__",
                            label: "No reviewers or approvers assigned",
                            disabled: true,
                          }]
                        : []),
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

    {convertedApprovals?.length ? (
      <ConvertedApprovalsNotice
        approvals={convertedApprovals}
        departments={departments}
        seatedDepartmentIds={seatedDepartmentIds}
        onSeatDepartment={onMapApproval ? seatConvertedApproval : undefined}
        seatingDisabled={busy !== null}
      />
    ) : null}
    </div>
  );
}
