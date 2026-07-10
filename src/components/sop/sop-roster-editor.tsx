"use client";

import { Loader2, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
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
  { value: "consulted", label: "Consulted", hint: "Gives input. Signs or comments; does not block." },
  { value: "informed", label: "Informed", hint: "Notified on release. Never signs." },
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
  const [members, setMembers] = useState<Map<string, { userId: string; name: string }[]>>(new Map());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<{ departmentId: string; rasic: SopRasic; signerId: string }>({
    departmentId: "",
    rasic: "responsible",
    signerId: "",
  });

  const seatedIds = new Set(seats.map((seat) => seat.departmentId));
  const available = departments.filter((department) => !seatedIds.has(department.id));

  const loadMembers = useCallback(async (departmentId: string) => {
    if (!departmentId) return;
    try {
      const rows = await listMembers(departmentId);
      const names = await listProfileNames(rows.map((row) => row.userId));
      setMembers((prev) => {
        const next = new Map(prev);
        next.set(
          departmentId,
          rows.map((row) => ({ userId: row.userId, name: names.get(row.userId) || "Unnamed member" })),
        );
        return next;
      });
    } catch (caught) {
      setError(getErrorMessage(caught));
    }
  }, []);

  useEffect(() => {
    for (const seat of seats) void loadMembers(seat.departmentId);
  }, [seats, loadMembers]);

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

  const responsibleCount = seats.filter((seat) => seat.rasic === "responsible").length;
  const accountableCount = seats.filter((seat) => seat.rasic === "accountable").length;
  const authorHoldsBlockingSeat = seats.some(
    (seat) => (seat.rasic === "responsible" || seat.rasic === "accountable") && seat.signerId === authorId,
  );

  const problems: string[] = [];
  if (responsibleCount === 0) problems.push("Name at least one Responsible department.");
  if (accountableCount !== 1) problems.push("Name exactly one Accountable department.");
  if (authorHoldsBlockingSeat) problems.push("The author cannot hold a Responsible or Accountable seat.");

  return (
    <section className="ui-panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="ui-mono-label text-ink-tertiary">Assign responsible parties</div>
        <div className="ui-mono-label text-ink-tertiary">RASIC · one reviewer per department</div>
      </div>

      {error ? (
        <div className="border-b border-line px-4 py-3">
          <p className="ui-section-subtitle text-danger">{error}</p>
        </div>
      ) : null}

      <div className="divide-y divide-line">
        {seats.map((seat) => {
          const department = departments.find((item) => item.id === seat.departmentId);
          const options = members.get(seat.departmentId) ?? [];
          return (
            <div key={seat.departmentId} className="flex flex-wrap items-center gap-2 px-4 py-3">
              <span className="ui-chip shrink-0">{department?.code ?? "—"}</span>
              <span className="min-w-32 flex-1 truncate text-sm text-ink">{department?.name ?? "Unknown"}</span>

              <select
                aria-label={`RASIC duty for ${department?.code ?? "department"}`}
                className="ui-field-standalone h-9 w-36 shrink-0"
                value={seat.rasic}
                disabled={busy !== null}
                onChange={(event) =>
                  void guarded(`rasic-${seat.departmentId}`, () =>
                    upsertSeat({
                      ...seat,
                      rasic: event.target.value as SopRasic,
                      signerId: event.target.value === "informed" ? null : seat.signerId,
                    }),
                  )
                }
              >
                {RASIC_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>

              <select
                aria-label={`Designated reviewer for ${department?.code ?? "department"}`}
                className="ui-field-standalone h-9 w-44 shrink-0"
                value={seat.signerId ?? ""}
                disabled={busy !== null || seat.rasic === "informed"}
                onChange={(event) =>
                  void guarded(`signer-${seat.departmentId}`, () =>
                    upsertSeat({ ...seat, signerId: event.target.value || null }),
                  )
                }
              >
                <option value="">{seat.rasic === "informed" ? "No signer" : "Choose a reviewer…"}</option>
                {options.map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {member.name}
                  </option>
                ))}
              </select>

              <button
                type="button"
                aria-label={`Remove ${department?.code ?? "department"} from the roster`}
                className="ui-btn-ghost h-9 w-9 shrink-0 rounded border border-border-strong p-0 text-danger disabled:opacity-40"
                disabled={busy !== null}
                onClick={() => void guarded(`remove-${seat.departmentId}`, () => removeSeat(sopId, seat.departmentId))}
              >
                {busy === `remove-${seat.departmentId}` ? (
                  <Loader2 size={14} className="mx-auto animate-spin" />
                ) : (
                  <Trash2 size={14} className="mx-auto" />
                )}
              </button>
            </div>
          );
        })}
      </div>

      {available.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
          <select
            aria-label="Department to add"
            className="ui-field-standalone h-9 w-44"
            value={draft.departmentId}
            disabled={busy !== null}
            onChange={(event) => {
              const departmentId = event.target.value;
              setDraft((prev) => ({ ...prev, departmentId, signerId: "" }));
              void loadMembers(departmentId);
            }}
          >
            <option value="">Add a department…</option>
            {available.map((department) => (
              <option key={department.id} value={department.id}>
                {department.code} · {department.name}
              </option>
            ))}
          </select>

          <select
            aria-label="RASIC duty"
            className="ui-field-standalone h-9 w-36"
            value={draft.rasic}
            disabled={busy !== null || !draft.departmentId}
            onChange={(event) => setDraft((prev) => ({ ...prev, rasic: event.target.value as SopRasic }))}
          >
            {RASIC_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <select
            aria-label="Designated reviewer"
            className="ui-field-standalone h-9 w-44"
            value={draft.signerId}
            disabled={busy !== null || !draft.departmentId || draft.rasic === "informed"}
            onChange={(event) => setDraft((prev) => ({ ...prev, signerId: event.target.value }))}
          >
            <option value="">{draft.rasic === "informed" ? "No signer" : "Choose a reviewer…"}</option>
            {(members.get(draft.departmentId) ?? []).map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.name}
              </option>
            ))}
          </select>

          <button
            type="button"
            className="ui-btn-ghost h-9 rounded border border-border-strong px-3 disabled:opacity-40"
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
                setDraft({ departmentId: "", rasic: "responsible", signerId: "" });
              })
            }
          >
            {busy === "add" ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            <span className="ml-1.5">Add</span>
          </button>
        </div>
      ) : null}

      {problems.length > 0 ? (
        <div className="border-t border-line px-4 py-3">
          <div className="ui-mono-label text-ink-tertiary">Before this SOP can be submitted</div>
          <ul className="mt-1.5 space-y-1">
            {problems.map((problem) => (
              <li key={problem} className="ui-section-subtitle text-ink-secondary">
                {problem}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
