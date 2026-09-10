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
}

export async function submitNomination(input: {
  sopId: string;
  departmentId: string;
  email: string;
  positionTitle: string;
}): Promise<NominationResponse> {
  const response = await fetch("/api/sops/reviewers/nominate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = (await response.json().catch(() => ({}))) as Partial<NominationResponse> & { error?: string };
  if (!response.ok) throw new Error(payload.error || "The invitation could not be sent.");
  return payload as NominationResponse;
}

/**
 * Inline "Invite a reviewer" row for the SOP roster: email + position title, posted to the
 * nomination route. The database decides whether the caller may nominate; this form only
 * relays its answer. Authors reach it only for departments they belong to (the roster editor
 * hides the action elsewhere).
 */
export function ReviewerInviteForm({ sopId, departmentId, departmentCode, onNominated, onCancel }: ReviewerInviteFormProps) {
  const titles = standardPositionTitlesForDepartment(departmentCode);
  const [email, setEmail] = useState("");
  const [positionTitle, setPositionTitle] = useState(titles[0] ?? "Team Member");
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
      setMessage(nominationOutcomeMessage(result, normalizedEmail));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The invitation could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} aria-label="Invite a reviewer" className="flex flex-wrap items-center gap-2">
      <input
        type="email"
        required
        aria-label="Reviewer email"
        placeholder="name@anacorp.com"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        disabled={busy}
        className="ui-input h-8 min-w-[220px] flex-1 rounded-[4px] border border-line bg-surface px-2 py-0 text-[13px]"
      />
      <ThemedSelect
        variant="sop"
        className="min-w-[200px]"
        triggerClassName="ui-sop-select-inline"
        ariaLabel="Position title"
        value={positionTitle}
        disabled={busy}
        allowCustomValue
        options={titles.map((title) => ({ value: title, label: title }))}
        onChange={setPositionTitle}
      />
      <button type="submit" className="ui-btn-primary h-8 gap-1.5 px-3 disabled:opacity-40" disabled={busy || !email.trim()}>
        {busy ? <Loader2 size={14} className="animate-spin" /> : <MailPlus size={14} />}
        Send invite
      </button>
      <button type="button" className="ui-btn-ghost h-8 gap-1 px-2" aria-label="Cancel invite" onClick={onCancel} disabled={busy}>
        <X size={14} />
        Cancel
      </button>
      {error ? <p className="w-full text-[11px] leading-4 text-danger">{error}</p> : null}
      {message ? <p className="w-full text-[11px] leading-4 text-ink-secondary">{message}</p> : null}
    </form>
  );
}
