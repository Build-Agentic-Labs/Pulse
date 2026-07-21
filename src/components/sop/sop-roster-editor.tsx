"use client";

import { Check, LockKeyhole, Loader2, Plus, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ThemedSelect } from "@/components/themed-select";
import type { Department } from "@/domain/departments";
import { listMembers } from "@/lib/departments/store";
import {
  listProfileNames,
  removeSeat,
  upsertSeat,
  type SopRasic,
  type SopReviewSeat,
} from "@/lib/sop/review";

const RASIC_OPTIONS: { value: SopRasic; label: string; hint: string }[] = [
  { value: "responsible", label: "Responsible", hint: "Does the work. Signature required." },
  { value: "accountable", label: "Accountable", hint: "Owns the outcome. Signature required. Exactly one." },
  { value: "support", label: "Support", hint: "Supplies resources. Signs; does not block." },
  { value: "informed", label: "Informed", hint: "Notified on release. Never signs." },
  { value: "consulted", label: "Consulted", hint: "Gives input. Signs or comments; does not block." },
];

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

interface RosterEditorProps {
  sopId: string;
  departments: Department[];
  seats: SopReviewSeat[];
  /** The SOP's author. They may not hold a Responsible or Accountable seat. */
  authorId: string | null;
  onChanged: () => Promise<void> | void;
}

/**
 * Assign the responsible parties. RASIC is carried by DEPARTMENTS; each seated department names
 * exactly one designated reviewer who signs on its behalf.
 *
 * Editable only while the SOP is a draft — the database freezes the roster on submit, and after
 * that only an admin may reassign a seat's signer. Every rule mirrored here is enforced in the
 * trigger; we surface the database's own message when it refuses.
 */
export function SopRosterEditor({ sopId, departments, seats, authorId, onChanged }: RosterEditorProps) {
  const [members, setMembers] = useState<Map<string, { userId: string; name: string; positionTitle: string }[]>>(new Map());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<{ departmentId: string; rasic: SopRasic; signerId: string }>({
    departmentId: "",
    rasic: "responsible",
    signerId: "",
  });

  const qualityDepartment = departments.find((department) => department.isQualityGate);
  const workflowSeats = useMemo(
    () => seats.filter(
      (seat) => !departments.find((department) => department.id === seat.departmentId)?.isQualityGate,
    ),
    [departments, seats],
  );
  const seatedIds = new Set(workflowSeats.map((seat) => seat.departmentId));
  const available = departments.filter(
    (department) => !department.isQualityGate && !seatedIds.has(department.id),
  );

  const loadMembers = useCallback(async (departmentId: string) => {
    if (!departmentId) return;
    try {
      const rows = await listMembers(departmentId);
      const names = await listProfileNames(rows.map((row) => row.userId));
      setMembers((prev) => {
        const next = new Map(prev);
        next.set(
          departmentId,
          rows.map((row) => ({
            userId: row.userId,
            name: names.get(row.userId) || "Unnamed member",
            positionTitle: row.positionTitle,
          })),
        );
        return next;
      });
    } catch (caught) {
      setError(getErrorMessage(caught));
    }
  }, []);

  useEffect(() => {
    for (const seat of workflowSeats) void loadMembers(seat.departmentId);
  }, [workflowSeats, loadMembers]);

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

  const responsibleCount = workflowSeats.filter((seat) => seat.rasic === "responsible").length;
  const accountableCount = workflowSeats.filter((seat) => seat.rasic === "accountable").length;
  const authorHoldsBlockingSeat = workflowSeats.some(
    (seat) => (seat.rasic === "responsible" || seat.rasic === "accountable") && seat.signerId === authorId,
  );
  const soloSelfReview =
    Boolean(authorId) &&
    responsibleCount === 1 &&
    workflowSeats.find((seat) => seat.rasic === "responsible")?.signerId === authorId &&
    accountableCount === 0 &&
    workflowSeats.every((seat) => seat.rasic === "informed" || Boolean(seat.signerId));

  const problems: string[] = [];
  if (responsibleCount === 0) problems.push("Name at least one Responsible department.");
  if (!soloSelfReview && accountableCount !== 1) problems.push("Name exactly one Accountable department.");
  if (workflowSeats.some((seat) => seat.rasic !== "informed" && !seat.signerId)) {
    problems.push("Choose a reviewer for every department that must sign or review.");
  }
  if (!soloSelfReview && authorHoldsBlockingSeat) {
    problems.push("The author cannot hold a Responsible or Accountable seat.");
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
              setDraft({ departmentId: "", rasic: "responsible", signerId: "" });
            }}
          >
            {adding ? <X size={14} /> : <Plus size={14} />}
            {adding ? "Cancel" : "Add reviewer"}
          </button>
        ) : null}
      </div>

      {error ? (
        <div className="border-b border-line px-4 py-3">
          <p className="ui-section-subtitle text-danger">{error}</p>
        </div>
      ) : null}

      <div className="ui-table-scroll">
        <table className="w-full min-w-[720px] table-fixed border-collapse text-left">
          <colgroup>
            <col className="w-[34%]" />
            <col className="w-40" />
            <col />
            <col className="w-14" />
          </colgroup>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="px-5 py-3 text-[11px] font-medium text-ink-secondary">Department</th>
              <th scope="col" className="px-5 py-3 text-[11px] font-medium text-ink-secondary">Duty</th>
              <th scope="col" className="px-5 py-3 text-[11px] font-medium text-ink-secondary">Reviewer</th>
              <th scope="col" className="px-2 py-3"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {workflowSeats.map((seat) => {
              const department = departments.find((item) => item.id === seat.departmentId);
              const options = members.get(seat.departmentId) ?? [];
              const reviewerOptions = [
                { value: "", label: seat.rasic === "informed" ? "No signer" : "Choose a reviewer…" },
                ...options.map((member) => ({
                  value: member.userId,
                  label: `${member.name}${member.positionTitle ? ` — ${member.positionTitle}` : ""}`,
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
                      ariaLabel={`RASIC duty for ${department?.code ?? "department"}`}
                      value={seat.rasic}
                      options={RASIC_OPTIONS}
                      disabled={busy !== null}
                      onChange={(value) =>
                        void guarded(`rasic-${seat.departmentId}`, () =>
                          upsertSeat({
                            ...seat,
                            rasic: value as SopRasic,
                            signerId: value === "informed" ? null : seat.signerId,
                          }),
                        )
                      }
                    />
                  </td>
                  <td className="px-5 py-2.5 align-middle">
                    <ThemedSelect
                      variant="sop"
                      className="w-full"
                      triggerClassName="ui-sop-select-inline"
                      ariaLabel={`Designated reviewer for ${department?.code ?? "department"}`}
                      value={seat.signerId ?? ""}
                      options={reviewerOptions}
                      disabled={busy !== null || seat.rasic === "informed"}
                      onChange={(value) =>
                        void guarded(`signer-${seat.departmentId}`, () =>
                          upsertSeat({ ...seat, signerId: value || null }),
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
              <td className="px-5 py-3.5 align-middle text-[13px] text-ink-secondary">Approver</td>
              <td className="px-5 py-3.5 align-middle text-[13px] text-ink-secondary">Quality approvers</td>
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
                <td className="px-3 py-2.5 align-middle">
                  <ThemedSelect
                    variant="sop"
                    ariaLabel="RASIC duty"
                    value={draft.rasic}
                    disabled={busy !== null || !draft.departmentId}
                    options={RASIC_OPTIONS}
                    onChange={(value) => setDraft((prev) => ({ ...prev, rasic: value as SopRasic }))}
                  />
                </td>
                <td className="px-3 py-2.5 align-middle">
                  <ThemedSelect
                    variant="sop"
                    ariaLabel="Designated reviewer"
                    value={draft.signerId}
                    disabled={busy !== null || !draft.departmentId || draft.rasic === "informed"}
                    options={[
                      { value: "", label: draft.rasic === "informed" ? "No signer" : "Select reviewer…" },
                      ...(members.get(draft.departmentId) ?? []).map((member) => ({
                        value: member.userId,
                        label: `${member.name}${member.positionTitle ? ` — ${member.positionTitle}` : ""}`,
                      })),
                    ]}
                    onChange={(signerId) => setDraft((prev) => ({ ...prev, signerId }))}
                  />
                </td>
                <td className="px-2 py-2.5 align-middle">
                  <button
                    type="button"
                    className="ui-btn-primary h-8 w-8 p-0 disabled:opacity-40"
                    aria-label="Add department reviewer"
                    title="Add department reviewer"
                    disabled={
                      busy !== null ||
                      !draft.departmentId ||
                      (draft.rasic !== "informed" && !draft.signerId)
                    }
                    onClick={() =>
                      void guarded("add", async () => {
                        await upsertSeat({
                          sopId,
                          departmentId: draft.departmentId,
                          rasic: draft.rasic,
                          signerId: draft.rasic === "informed" ? null : draft.signerId,
                        });
                        setAdding(false);
                        setDraft({ departmentId: "", rasic: "responsible", signerId: "" });
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

      {problems.length > 0 ? (
        <div className="flex gap-3 border-t border-line px-5 py-2.5 text-xs">
          <span className="shrink-0 font-medium text-warn">Setup required</span>
          <span className="text-ink-secondary">{problems.join(" ")}</span>
        </div>
      ) : null}

      {soloSelfReview ? (
        <div className="border-t border-line px-5 py-2.5 text-xs text-ink-tertiary">
          Author self-review is enabled for this test SOP.
        </div>
      ) : null}
    </section>
  );
}
