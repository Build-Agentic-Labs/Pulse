"use client";

import { Check, LockKeyhole, Loader2, Plus, Trash2, X } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { ThemedSelect } from "@/components/themed-select";
import { type Department, type DeptRole } from "@/domain/departments";
import type { SopApproval } from "@/domain/sop/schema";
import { buildApproverOptions } from "@/domain/sop/roster-options";
import { canNominateIntoDepartment, type NominationResponse } from "@/domain/workspace/reviewer-nomination";
import { ConvertedApprovalsNotice } from "./converted-approvals-notice";
import { ReviewerInviteForm } from "./reviewer-invite-form";
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
  pendingInviteAt: string | null;
  departmentIds: string[];
}

interface RosterEditorProps {
  sopId: string;
  authorId?: string;
  departments: Department[];
  seats: SopReviewSeat[];
  /**
   * The caller's department roles. A seat whose department appears here (and is not the Quality
   * gate) offers "Invite an approver" — the database re-checks membership on submit.
   */
  myDeptRoles?: ReadonlyMap<string, DeptRole>;
  /**
   * The SOP's owning department. When the caller belongs to it, every non-Quality seat offers
   * "Invite an approver" too — the nominee joins that seat's department, never this one — and the
   * database re-checks the seat and the caller's edit access on submit.
   */
  owningDepartmentId?: string;
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
  authorId,
  departments,
  seats,
  myDeptRoles,
  owningDepartmentId,
  convertedApprovals,
  onMapApproval,
  onChanged,
}: RosterEditorProps) {
  const [members, setMembers] = useState<Map<string, RosterMember[]>>(new Map());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [invitingFor, setInvitingFor] = useState<string | null>(null);
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
    const ids = [...new Set([...departmentIds, ...departments.map((department) => department.id)].filter(Boolean))];
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
              .filter((row, index, all) => row.userId !== authorId && all.findIndex((candidate) => candidate.userId === row.userId) === index)
              .map((row) => ({
                departmentIds: rows.filter((membership) => membership.userId === row.userId).map((membership) => membership.departmentId),
                userId: row.userId,
                name: names.get(row.userId) || "Unnamed member",
                positionTitle: row.positionTitle,
                deptRole: row.deptRole,
                pendingInviteAt: row.pendingInviteAt ?? null,
              })),
          );
        }
        return next;
      });
    } catch (caught) {
      setError(getErrorMessage(caught));
    }
  }, [departments, authorId]);

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

  function canNominateInto(departmentId: string): boolean {
    return canNominateIntoDepartment({
      department: departments.find((item) => item.id === departmentId),
      myDeptRoles,
      owningDepartmentId,
    });
  }

  /**
   * After a nomination: reload the roster and, when the nominee is selectable, seat them.
   *
   * Deliberately does NOT route through `guarded` (which no-ops while another roster write is
   * in flight) — the nomination has already happened server-side by the time this runs, so
   * silently dropping the seat write here would leave the author looking at a success message
   * with the roster still unseated and no error shown anywhere.
   */
  async function handleNominated(seat: SopReviewSeat | null, departmentId: string, result: NominationResponse) {
    if (result.deferred) {
      await onChanged(); setInvitingFor(null); setAdding(false); setDraft({ departmentId: "", signerId: "" }); return;
    }
    await loadMembersForDepartmentIds([departmentId]);
    if (!result.seated || !result.userId) return;
    try {
      await upsertSeat({ ...(seat ?? { sopId, departmentId }), rasic: "responsible", signerId: result.userId });
      await onChanged();
      setInvitingFor(null);
      if (!seat) {
        setAdding(false);
        setDraft({ departmentId: "", signerId: "" });
      }
    } catch (caught) {
      // The invitation went out; only the seat write failed. Surface it where the author is
      // looking (the form) instead of a success line, and keep the roster's error banner in sync.
      const message = `${getErrorMessage(caught)} — the invitation was sent; choose them from the list to seat them.`;
      setError(message);
      throw new Error(message);
    }
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

  const allMembers = members.values().next().value ?? [];
  const newApproverMembers = allMembers.filter((member) =>
    !workflowSeats.some((seat) => seat.signerId === member.userId),
  );
  const inviteDepartments = available.filter((department) => canNominateInto(department.id));
  const memberDescription = (member: RosterMember | undefined) => member ? [
    member.positionTitle,
    ...member.departmentIds.map((id) => departments.find((department) => department.id === id)?.name),
  ].filter(Boolean).join(" · ") : "";
  const personOptions = (people: RosterMember[], signerId: string | null, placeholder: string) =>
    buildApproverOptions({ members: people.map((member) => ({ ...member, positionTitle: memberDescription(member) })), signerId, placeholder, now: new Date() });

  return (
    <div className="space-y-4">
    <section className="ui-data-table-frame">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
        <h2 className="ui-setup-section-title">Approvers</h2>
        {available.length > 0 || adding ? <button type="button" className="ui-btn-ghost h-8 gap-1.5 px-2" aria-expanded={adding}
          onClick={() => { setAdding((current) => !current); setDraft({ departmentId: "", signerId: "" }); setInvitingFor(null); }}>
          {adding ? <X size={14} /> : <Plus size={14} />}{adding ? "Cancel" : "Add approver"}
        </button> : null}
      </div>
      {error ? <div className="border-b border-line px-5 py-3"><p role="alert" className="ui-section-subtitle text-danger">{error}</p></div> : null}
      <table className="w-full table-fixed border-collapse text-left">
        <colgroup><col /><col className="w-14" /></colgroup>
        <thead><tr className="border-b border-line">
          <th scope="col" className="px-5 py-3 text-[11px] font-medium text-ink-secondary">Required approver</th>
          <th scope="col" className="px-2 py-3"><span className="sr-only">Actions</span></th>
        </tr></thead>
        <tbody>
          {workflowSeats.filter((seat) => !(adding && draft.departmentId === seat.departmentId)).map((seat) => {
            const department = departments.find((item) => item.id === seat.departmentId);
            const people = members.get(seat.departmentId) ?? [];
            const selected = people.find((member) => member.userId === seat.signerId);
            const options = personOptions(people, members.has(seat.departmentId) ? seat.signerId : null, "Choose an approver…");
            const nominatable = canNominateInto(seat.departmentId);
            return <Fragment key={seat.departmentId}>
              <tr className="group border-b border-line/70">
                <td className="px-5 py-3 align-middle">
                  {seat.signerId || seat.nomination ? <span className="block text-[13px] font-medium text-ink" aria-label={`Saved approver for ${department?.code ?? "department"}`}>
                    {selected?.name ?? seat.nomination?.email ?? (members.has(seat.departmentId) ? "No longer an SOP member" : "Loading approver…")}
                  </span> : <ThemedSelect variant="sop" className="w-full" triggerClassName="ui-sop-select-inline"
                    ariaLabel={`Required approver for ${department?.code ?? "department"}`} searchable searchPlaceholder="Search by name…" value={seat.signerId ?? ""}
                    selectedLabel={selected?.name} disabled={busy !== null}
                    options={[...options, ...(nominatable ? [{ value: "__invite__", label: "Add an approver…", alwaysVisible: true, description: "Add someone who is not on the list", group: "New person" }] : [])]}
                    onChange={(value) => {
                      if (value === "__invite__") { setInvitingFor(seat.departmentId); return; }
                      void guarded(`approver-${seat.departmentId}`, () => upsertSeat({ ...seat, rasic: "responsible", signerId: value || null }));
                    }} />}
                  {seat.nomination ? <p className="mt-1 text-[11px] text-ink-tertiary">{seat.nomination.positionTitle} · {department?.name}{!seat.nomination.deliveredAt ? " · Invitation pending · sent with review" : selected?.pendingInviteAt ? " · Invited · waiting to join" : ""}</p> : null}
                  {selected ? <p className="mt-1 text-[11px] leading-4 text-ink-tertiary">{memberDescription(selected)}</p> : null}
                  {department?.isQualityGate ? <p className="mt-1 text-[11px] leading-4 text-ink-tertiary">Normal review loop. A different Quality approver completes final approval.</p> : null}
                </td>
                <td className="px-2 py-3 align-middle">
                  <button type="button" aria-label={`Remove ${department?.code ?? "department"} from the roster`} title="Remove approver"
                    className="ui-btn-ghost h-8 w-8 p-0 text-ink-tertiary hover:text-danger disabled:opacity-40" disabled={busy !== null}
                    onClick={() => void guarded(`remove-${seat.departmentId}`, () => removeSeat(sopId, seat.departmentId))}>
                    {busy === `remove-${seat.departmentId}` ? <Loader2 size={14} className="mx-auto animate-spin" /> : <Trash2 size={14} className="mx-auto" />}
                  </button>
                </td>
              </tr>
              {invitingFor === seat.departmentId ? <tr className="border-b border-line/70"><td colSpan={2} className="px-5 pb-3">
                <ReviewerInviteForm sopId={sopId} departmentId={seat.departmentId} departmentCode={department?.code ?? ""}
                  onNominated={(result) => handleNominated(seat, seat.departmentId, result)} onCancel={() => setInvitingFor(null)} />
              </td></tr> : null}
            </Fragment>;
          })}
          <tr className="border-b border-line/70">
            <td className="px-5 py-3.5"><span className={`block text-[13px] ${qualityDepartment ? "text-ink" : "text-danger"}`}>
              {qualityDepartment ? "Quality final approver" : "Quality department not assigned"}</span>
              <span className="mt-0.5 block text-[11px] text-ink-tertiary">Final approver</span>
            </td>
            <td className="px-2 py-3.5"><LockKeyhole size={14} className="mx-auto text-ink-tertiary" aria-label="Managed automatically" /></td>
          </tr>
          {adding ? <tr className={invitingFor === "__new__" ? undefined : "bg-canvas/55"}>
            <td colSpan={invitingFor === "__new__" ? 2 : 1} className="px-5 py-3 align-middle">
              {invitingFor !== "__new__" ? <ThemedSelect variant="sop" className="w-full" ariaLabel="Required departmental approver" searchable searchPlaceholder="Search by name…" value={draft.signerId}
                disabled={busy !== null} selectedLabel={allMembers.find((member) => member.userId === draft.signerId)?.name}
                options={[...personOptions(newApproverMembers, null, "Choose an approver…").map((option) => {
                  const member = newApproverMembers.find((person) => person.userId === option.value);
                  return member && !member.departmentIds.some((id) => available.some((department) => department.id === id))
                    ? { ...option, disabled: true, description: "Their department already has a required approver" }
                    : option;
                }),
                  ...(inviteDepartments.length ? [{ value: "__invite__", label: "Add an approver…", alwaysVisible: true, description: "Add someone who is not on the list", group: "New person" }] : [])]}
                onChange={(signerId) => {
                  if (signerId === "__invite__") { setInvitingFor("__new__"); setDraft({ departmentId: "", signerId: "" }); return; }
                  const member = newApproverMembers.find((person) => person.userId === signerId);
                  const linkedDepartments = member?.departmentIds.filter((id) => available.some((department) => department.id === id)) ?? [];
                  const departmentId = linkedDepartments.includes(owningDepartmentId ?? "") ? owningDepartmentId! : linkedDepartments[0] ?? "";
                  setInvitingFor(null); setDraft({ departmentId, signerId });
                }} /> : null}
              {draft.signerId ? <p className="mt-1 text-[11px] text-ink-tertiary">{memberDescription(allMembers.find((member) => member.userId === draft.signerId))}</p> : null}
              {invitingFor === "__new__" ? <div className="py-2">
                <ReviewerInviteForm sopId={sopId} departmentId={draft.departmentId}
                  departmentCode={departments.find((department) => department.id === draft.departmentId)?.code ?? ""}
                  departments={inviteDepartments} onDepartmentChange={(departmentId) => setDraft({ departmentId, signerId: "" })}
                  onNominated={(result) => handleNominated(null, draft.departmentId, result)} onCancel={() => setInvitingFor(null)} />
              </div> : null}
            </td>
            {invitingFor !== "__new__" ? <td className="px-2 py-3 align-middle">
              <button type="button" className="ui-btn-primary h-8 w-8 p-0 disabled:opacity-40" aria-label="Add departmental approver"
                disabled={busy !== null || !draft.departmentId || !draft.signerId} onClick={() => void guarded("add", async () => {
                  await upsertSeat({ sopId, departmentId: draft.departmentId, rasic: "responsible", signerId: draft.signerId });
                  setAdding(false); setDraft({ departmentId: "", signerId: "" }); setInvitingFor(null);
                })}>{busy === "add" ? <Loader2 size={14} className="mx-auto animate-spin" /> : <Check size={14} className="mx-auto" />}</button>
            </td> : null}
          </tr> : null}
        </tbody>
      </table>
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
