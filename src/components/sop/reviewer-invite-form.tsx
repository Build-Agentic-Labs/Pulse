"use client";

import { Loader2, MailPlus, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { ThemedSelect } from "@/components/themed-select";
import { standardPositionTitlesForDepartment } from "@/domain/departments";
import { nominationOutcomeMessage, type NominationResponse } from "@/domain/workspace/reviewer-nomination";

interface ReviewerInviteFormProps {
  sopId: string;
  departmentId: string;
  departmentCode: string;
  /** Called after a successful nomination, before the message is shown. */
  onNominated: (result: NominationResponse, email: string) => Promise<void> | void;
  onCancel: () => void;
  departments?: { id: string; code: string; name: string }[];
  onDepartmentChange?: (id: string) => void;
}

export async function submitNomination(input: {
  sopId: string;
  departmentId: string;
  email: string;
  positionTitle: string;
}): Promise<NominationResponse> {
  const response = await fetch("/api/sops/approvers/stage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = (await response.json().catch(() => ({}))) as Partial<NominationResponse> & { error?: string };
  if (!response.ok) throw new Error(payload.error || "The invitation could not be sent.");
  return payload as NominationResponse;
}

/**
 * Inline "Invite an approver" row for the SOP roster: email + position title, posted to the
 * nomination route. The database decides whether the caller may nominate; this form only
 * relays its answer. Authors reach it only for departments they belong to (the roster editor
 * hides the action elsewhere).
 */
export function ReviewerInviteForm({ sopId, departmentId, departmentCode, onNominated, onCancel, departments, onDepartmentChange }: ReviewerInviteFormProps) {
  const titles = standardPositionTitlesForDepartment(departmentCode);
  const [email, setEmail] = useState("");
  const [positionTitle, setPositionTitle] = useState(departmentId ? titles[0] ?? "Team Member" : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    const normalizedEmail = email.trim().toLowerCase();
    try {
      const result = await submitNomination({ sopId, departmentId, email: normalizedEmail, positionTitle });
      await onNominated(result, normalizedEmail);
      setMessage(result.deferred ? "Approver added. Their invitation will be sent when you send for review." : nominationOutcomeMessage(result, normalizedEmail));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The invitation could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} aria-label="Add an approver" className="w-full min-w-0 space-y-3 bg-transparent">
      <div className="text-[13px] font-medium text-ink">Add an approver</div>
      <p className="text-xs text-ink-secondary">Their invitation will be sent when you send this SOP for review.</p>
      {departments ? <div className="space-y-1"><span className="block text-xs text-ink-secondary">Department</span>
        <ThemedSelect variant="sop" className="w-full" ariaLabel="New approver department" value={departmentId}
          options={[{ value: "", label: "Choose their department…" }, ...departments.map((department) => ({ value: department.id, label: department.name }))]}
          onChange={(id) => { onDepartmentChange?.(id); setPositionTitle(standardPositionTitlesForDepartment(departments.find((department) => department.id === id)?.code ?? "")[0] ?? "Team Member"); }} disabled={busy} />
      </div> : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label className="min-w-0 space-y-1">
        <span className="block text-xs text-ink-secondary">Email address</span>
      <input
        autoFocus
        type="email"
        required
        aria-label="Approver email"
        placeholder="name@anacorp.com"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        disabled={busy}
        className="ui-input h-9 w-full min-w-0 rounded border border-line bg-surface px-2.5 py-0 text-[13px]"
      />
      </label>
      <div className="min-w-0 space-y-1">
        <span className="block text-xs text-ink-secondary">Position title</span>
      <ThemedSelect
        variant="sop"
        className="w-full min-w-0"
        triggerClassName="ui-sop-select-inline h-9 rounded border border-line bg-surface px-2.5"
        ariaLabel="Position title"
        value={positionTitle}
        disabled={busy || !departmentId}
        placeholder="Choose a position…"
        allowCustomValue
        options={titles.map((title) => ({ value: title, label: title }))}
        onChange={setPositionTitle}
      />
      </div>
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-line pt-3">
      <button type="button" className="ui-btn-ghost h-8 gap-1 px-2" aria-label="Cancel invite" onClick={onCancel} disabled={busy}>
        <X size={14} />
        Cancel
      </button>
      <button type="submit" className="ui-btn-primary h-8 gap-1.5 px-3 disabled:opacity-40" disabled={busy || !email.trim() || !departmentId || !positionTitle.trim()}>
        {busy ? <Loader2 size={14} className="animate-spin" /> : <MailPlus size={14} />}
        Add approver
      </button>
      </div>
      {error ? <p role="alert" className="text-xs leading-4 text-danger">{error}</p> : null}
      {message ? <p role="status" className="text-xs leading-4 text-ink-secondary">{message}</p> : null}
    </form>
  );
}
