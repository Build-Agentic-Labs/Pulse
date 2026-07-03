"use client";

import { Check, ChevronLeft, ChevronRight, Download, Plus, Sparkles, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useConfirm } from "@/components/confirm-provider";
import { rasicLegend, SOP_STATUS_LABELS, SOP_STATUSES, type Sop, type SopStatus } from "@/domain/sop/schema";
import { applySampleData } from "@/domain/sop/sample";
import { saveSop, SopConflictError } from "@/lib/sop/store";
import { SopShell } from "./sop-shell";
import { AutoTextarea } from "./auto-textarea";
import { ProcessFlowchart } from "./process-flowchart";

type StepId = "document" | "overview" | "procedure" | "annexes" | "approvals";

const STEPS: Array<{ id: StepId; label: string }> = [
  { id: "document", label: "Document" },
  { id: "overview", label: "Overview" },
  { id: "procedure", label: "Procedure" },
  { id: "annexes", label: "Annexes & history" },
  { id: "approvals", label: "Approvals" },
];

/** Whether a step has any content yet — drives the ✓ marker in the step nav. */
function stepFilled(sop: Sop, id: StepId): boolean {
  switch (id) {
    case "document":
      return Boolean(sop.meta.sopNumber || sop.meta.title);
    case "overview":
      return Boolean(sop.purpose || sop.scope || sop.definitions.length || sop.references.length);
    case "procedure":
      return Boolean(
        sop.responsiblePersons.length ||
          sop.measurements.length ||
          sop.procedure.processFlowDescription ||
          sop.procedure.activities.length,
      );
    case "annexes":
      return Boolean(sop.annexes.length || sop.changeHistory.length);
    case "approvals":
      return sop.approvals.some((row) => row.name || row.position || row.date);
  }
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

/** Debounce for autosave: persist this long after the last edit settles. */
const AUTOSAVE_DELAY_MS = 2000;

/** The changeHistory row auto-appended when a save carries a status transition. */
function statusChangeEntry(sop: Sop, from: SopStatus): Sop["changeHistory"][number] {
  return {
    version: sop.meta.version,
    changes: `Status changed from ${SOP_STATUS_LABELS[from]} to ${SOP_STATUS_LABELS[sop.status]}.`,
    createdByName: "",
    createdByPosition: "",
    createdByDate: new Date().toISOString().slice(0, 10),
  };
}

export function SopEditor({
  initial,
  workspaceId,
  canEdit = true,
  canApprove = false,
  isNew = false,
}: {
  initial: Sop;
  workspaceId?: string;
  canEdit?: boolean;
  /** Workspace managers only: allows transitions to `approved` / `obsolete`. */
  canApprove?: boolean;
  /** True when the SOP has never been persisted (autosave stays off until the first save). */
  isNew?: boolean;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [sop, setSop] = useState<Sop>(initial);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [reviewDismissed, setReviewDismissed] = useState(false);
  // Edits since the last successful save -- drives the leave guards and autosave.
  const [dirty, setDirty] = useState(false);
  // A save lost the concurrency check: freeze autosave so we never loop against the conflict.
  const [conflicted, setConflicted] = useState(false);
  // Optimistic-concurrency token: the updated_at loaded with the SOP (undefined until the
  // first insert), refreshed from every save response so consecutive saves keep working.
  const [persistedUpdatedAt, setPersistedUpdatedAt] = useState<string | undefined>(
    isNew ? undefined : initial.updatedAt,
  );
  // Bumped on every user edit so a save that raced with typing doesn't clobber newer edits.
  const editVersionRef = useRef(0);
  // The status as last persisted -- a save that changes it auto-appends a changeHistory row.
  const lastSavedStatusRef = useRef<SopStatus>(initial.status);

  const step = STEPS[stepIndex];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === STEPS.length - 1;
  const saveDisabled = !canEdit || !workspaceId || saveStatus === "saving";

  function update(patch: Partial<Sop>) {
    setSop((current) => ({ ...current, ...patch }));
    editVersionRef.current += 1;
    setDirty(true);
    setSaveStatus("idle");
  }

  // Persist the current SOP, returning whether it succeeded. Callers that navigate or export
  // gate on the boolean so a failed save never silently drops the user's work.
  async function persist(): Promise<boolean> {
    if (!canEdit || !workspaceId) {
      setSaveError(workspaceId ? "You do not have permission to save this SOP." : "Select an organization before saving.");
      setSaveStatus("error");
      return false;
    }
    const statusChanged = sop.status !== lastSavedStatusRef.current;
    const historyEntry = statusChanged ? statusChangeEntry(sop, lastSavedStatusRef.current) : undefined;
    const toSave: Sop = historyEntry ? { ...sop, changeHistory: [...sop.changeHistory, historyEntry] } : sop;
    const editVersion = editVersionRef.current;
    setSaveStatus("saving");
    setSaveError("");
    try {
      const next = await saveSop(toSave, workspaceId, { expectedUpdatedAt: persistedUpdatedAt });
      setPersistedUpdatedAt(next.updatedAt);
      lastSavedStatusRef.current = next.status;
      if (editVersionRef.current === editVersion) {
        // Nothing changed while the save was in flight -- adopt the server copy wholesale.
        setSop(next);
        setDirty(false);
        setSaveStatus("saved");
      } else {
        // Edits landed mid-save: keep them (still dirty, so autosave picks them up) and only
        // fold in the server timestamp plus the auto-appended history row.
        setSop((current) => ({
          ...current,
          updatedAt: next.updatedAt,
          changeHistory: historyEntry ? [...current.changeHistory, historyEntry] : current.changeHistory,
        }));
        setSaveStatus("idle");
      }
      return true;
    } catch (error) {
      if (error instanceof SopConflictError) {
        // Never retry into a conflict -- the user copies their changes and reloads.
        setConflicted(true);
      }
      setSaveError(error instanceof Error ? error.message : "Save failed.");
      setSaveStatus("error");
      return false;
    }
  }

  function handleSave() {
    void persist();
  }

  function handleLoadSample() {
    setSop((current) => applySampleData(current));
    editVersionRef.current += 1;
    setDirty(true);
    setSaveStatus("idle");
  }

  // Warn on tab close / hard navigation while there are unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    function warnBeforeLeaving(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [dirty]);

  // Debounced autosave, only for SOPs that already exist server-side (never auto-create a
  // row) and only while a fresh edit is pending -- a failed save waits for the next edit
  // instead of retrying in a loop, and a conflict stops autosave entirely.
  const autosaveArmed =
    canEdit && Boolean(workspaceId) && dirty && !conflicted && Boolean(persistedUpdatedAt) && saveStatus === "idle";
  useEffect(() => {
    if (!autosaveArmed) return;
    const timer = window.setTimeout(() => {
      void persist();
    }, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
    // `persist` is recreated per render with the latest sop; re-arming on `sop` restarts
    // the debounce after every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autosaveArmed, sop]);

  // Confirm in-app exits (shell back link / brand link) while edits are unsaved. The shell
  // awaits this, so an unsaved-changes exit resolves through the themed dialog instead of a
  // native prompt. (Tab close / hard reload still uses the native beforeunload guard below,
  // which browsers require to be synchronous.)
  async function confirmLeave(): Promise<boolean> {
    if (!dirty) return true;
    return confirm({
      title: "Leave without saving?",
      body: "You have unsaved changes that will be lost.",
      tone: "warning",
      confirmLabel: "Leave",
      cancelLabel: "Stay",
    });
  }

  async function handleFinish() {
    if (await persist()) {
      router.push("/sops");
    }
  }

  async function handleSaveAndExport() {
    if (await persist()) {
      await handleExport();
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      // The docx library is heavy and only needed for export — pull it in on demand
      // so it stays out of the editor's initial bundle.
      const { exportFileName, exportSopToDocx } = await import("@/lib/sop/export-docx");
      const blob = await exportSopToDocx(sop);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = exportFileName(sop);
      anchor.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  const actions = (
    <>
      {canEdit ? (
        <button
          type="button"
          className="ui-btn-ghost h-10 gap-2"
          onClick={handleLoadSample}
          title="Fill every step with sample data"
        >
          <Sparkles size={15} />
          <span className="hidden sm:inline">Sample</span>
        </button>
      ) : null}
      <button
        type="button"
        className="ui-btn-ghost h-10 gap-2 disabled:opacity-50"
        onClick={handleExport}
        disabled={exporting}
        title="Export to Word (.docx)"
      >
        <Download size={15} />
        {exporting ? "Exporting…" : "Export"}
      </button>
      {canEdit ? (
        <button
          type="button"
          className="ui-btn-ghost h-10 gap-2 disabled:opacity-50"
          onClick={handleSave}
          disabled={saveDisabled}
          title={dirty ? "Unsaved changes" : undefined}
        >
          <Check size={15} />
          {saveStatus === "saving"
            ? "Saving…"
            : saveStatus === "saved"
              ? "Saved"
              : saveStatus === "error"
                ? "Retry save"
                : dirty
                  ? "Save*"
                  : "Save"}
        </button>
      ) : null}
    </>
  );

  const sidebar = (
    <>
      <div className="ui-nav-section">Steps</div>
      <div className="space-y-0.5">
        {STEPS.map((entry, index) => {
          const active = index === stepIndex;
          const filled = stepFilled(sop, entry.id);
          return (
            <button
              key={entry.id}
              type="button"
              className={`ui-nav-item w-full ${active ? "ui-nav-item-active" : "ui-nav-item-idle"}`}
              onClick={() => setStepIndex(index)}
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                {active ? (
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                ) : filled ? (
                  <Check size={13} style={{ color: "var(--color-success)" }} />
                ) : (
                  <span className="ui-mono-label text-ink-tertiary">{index + 1}</span>
                )}
              </span>
              <span className="min-w-0 flex-1 truncate text-left">{entry.label}</span>
            </button>
          );
        })}
      </div>
    </>
  );

  return (
    <SopShell
      crumb={sop.meta.title || sop.meta.sopNumber || "Untitled"}
      actions={actions}
      sidebar={sidebar}
      back={{ href: "/sops", label: "All SOPs" }}
      confirmLeave={confirmLeave}
    >
      <div className="sop-editor">
        <div className="mx-auto max-w-4xl space-y-5 pb-16">
            {sop.source === "converted" && !reviewDismissed ? (
              <div className="ui-notice ui-notice-warn flex items-start gap-3">
                <Sparkles size={16} className="mt-0.5 shrink-0 text-ink-secondary" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">Review your converted SOP</p>
                  <p className="ui-section-subtitle mt-1 text-ink-secondary">
                    We mapped your uploaded document into the standard format with AI. It can miss or misplace
                    details, so step through each section in the left nav, fix anything that looks off, then Save
                    or Export to Word.
                  </p>
                </div>
                <button
                  type="button"
                  className="ui-btn-ghost h-7 w-7 shrink-0 px-0 text-ink-tertiary"
                  onClick={() => setReviewDismissed(true)}
                  title="Dismiss"
                  aria-label="Dismiss review notice"
                >
                  <X size={14} />
                </button>
              </div>
            ) : null}

            {saveStatus === "error" && saveError ? (
              <div className="ui-notice ui-notice-warn px-4 py-3 ui-section-subtitle">{saveError}</div>
            ) : null}

            {/* Compact step indicator on mobile */}
            <div className="ui-mono-label text-ink-tertiary sm:hidden">
              Step {stepIndex + 1} of {STEPS.length} · {step.label}
            </div>

            {step.id === "document" ? (
              <Section title="Document">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="SOP number">
                    <input
                      className="ui-field-standalone"
                      value={sop.meta.sopNumber}
                      placeholder="SOP-QA-001"
                      disabled={!canEdit}
                      onChange={(event) => update({ meta: { ...sop.meta, sopNumber: event.target.value } })}
                    />
                  </Field>
                  <Field label="Title">
                    <input
                      className="ui-field-standalone"
                      value={sop.meta.title}
                      placeholder="QMS"
                      disabled={!canEdit}
                      onChange={(event) => update({ meta: { ...sop.meta, title: event.target.value } })}
                    />
                  </Field>
                  <Field label="Version">
                    <input
                      className="ui-field-standalone"
                      value={sop.meta.version}
                      placeholder="1.0"
                      disabled={!canEdit}
                      onChange={(event) => update({ meta: { ...sop.meta, version: event.target.value } })}
                    />
                  </Field>
                  <Field label="Status">
                    <select
                      className="ui-field-standalone"
                      value={sop.status}
                      disabled={!canEdit}
                      onChange={(event) => update({ status: event.target.value as SopStatus })}
                    >
                      {SOP_STATUSES.map((status) => (
                        <option
                          key={status}
                          value={status}
                          // Approval-gated states are picked by workspace managers only; the
                          // current value stays selectable so the control never lies.
                          disabled={
                            !canApprove && (status === "approved" || status === "obsolete") && status !== sop.status
                          }
                        >
                          {SOP_STATUS_LABELS[status]}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Revision date">
                    <input
                      type="date"
                      required
                      className="ui-field-standalone"
                      value={sop.meta.revisionDate}
                      disabled={!canEdit}
                      onChange={(event) => update({ meta: { ...sop.meta, revisionDate: event.target.value } })}
                    />
                  </Field>
                  <Field label="Effective date">
                    <input
                      type="date"
                      required
                      className="ui-field-standalone"
                      value={sop.meta.effectiveDate}
                      disabled={!canEdit}
                      onChange={(event) => update({ meta: { ...sop.meta, effectiveDate: event.target.value } })}
                    />
                  </Field>
                </div>
              </Section>
            ) : null}

            {step.id === "overview" ? (
              <>
                <Section title="Purpose">
                  <AutoTextarea
                    className="ui-field-standalone min-h-20 py-2"
                    value={sop.purpose}
                    placeholder="Define the purpose of this process"
                    disabled={!canEdit}
                    onChange={(event) => update({ purpose: event.target.value })}
                  />
                </Section>
                <Section title="Scope">
                  <AutoTextarea
                    className="ui-field-standalone min-h-20 py-2"
                    value={sop.scope}
                    placeholder="For which products, processes or areas this applies"
                    disabled={!canEdit}
                    onChange={(event) => update({ scope: event.target.value })}
                  />
                </Section>
                <Section title="Definitions">
                  <PairListEditor
                    rows={sop.definitions}
                    keyLabel="Term"
                    valueLabel="Definition"
                    keyName="term"
                    valueName="definition"
                    disabled={!canEdit}
                    onChange={(definitions) => update({ definitions })}
                  />
                </Section>
                <Section title="References">
                  <StringListEditor
                    items={sop.references}
                    placeholder="e.g. ISO 9001:2015"
                    disabled={!canEdit}
                    onChange={(references) => update({ references })}
                  />
                </Section>
              </>
            ) : null}

            {step.id === "procedure" ? (
              <>
                <Section title="Responsible person(s)">
                  <StringListEditor
                    items={sop.responsiblePersons}
                    placeholder="Function / role"
                    disabled={!canEdit}
                    onChange={(responsiblePersons) => update({ responsiblePersons })}
                  />
                </Section>
                <Section title="Measurement (KPIs)">
                  <StringListEditor
                    items={sop.measurements}
                    placeholder="e.g. % of released SOPs"
                    disabled={!canEdit}
                    onChange={(measurements) => update({ measurements })}
                  />
                </Section>
                <Section title="Procedure">
                  <Field label="Process flow description">
                    <AutoTextarea
                      className="ui-field-standalone min-h-16 py-2"
                      value={sop.procedure.processFlowDescription}
                      placeholder="Describe the process flow"
                      disabled={!canEdit}
                      onChange={(event) =>
                        update({ procedure: { ...sop.procedure, processFlowDescription: event.target.value } })
                      }
                    />
                  </Field>
                  <p className="ui-mono-label mt-3 text-ink-tertiary">
                    RASIC — {rasicLegend()}
                  </p>
                  <ProcessFlowchart
                    roles={sop.procedure.roles}
                    activities={sop.procedure.activities}
                    disabled={!canEdit}
                    onChange={(roles, activities) => update({ procedure: { ...sop.procedure, roles, activities } })}
                  />
                </Section>
              </>
            ) : null}

            {step.id === "annexes" ? (
              <>
                <Section title="Annexes & forms">
                  <PairListEditor
                    rows={sop.annexes}
                    keyLabel="Label"
                    valueLabel="Description"
                    keyName="label"
                    valueName="description"
                    disabled={!canEdit}
                    onChange={(annexes) => update({ annexes })}
                  />
                </Section>
                <Section title="Change history">
                  <ChangeHistoryEditor
                    rows={sop.changeHistory}
                    disabled={!canEdit}
                    onChange={(changeHistory) => update({ changeHistory })}
                  />
                </Section>
              </>
            ) : null}

            {step.id === "approvals" ? (
              <Section title="Change approvals">
                <ApprovalsEditor rows={sop.approvals} disabled={!canEdit} onChange={(approvals) => update({ approvals })} />
              </Section>
            ) : null}

            {/* Footer nav */}
            <div className="flex items-center justify-between border-t border-line pt-4">
              <button
                type="button"
                className="ui-btn-ghost h-9 gap-1.5 px-3 disabled:opacity-40"
                disabled={isFirst}
                onClick={() => setStepIndex((index) => Math.max(0, index - 1))}
              >
                <ChevronLeft size={14} />
                Back
              </button>
              {isLast ? (
                <div className="flex items-center gap-2">
                  {canEdit ? (
                    <button
                      type="button"
                      className="ui-btn-ghost h-9 gap-1.5 px-4 disabled:opacity-50"
                      onClick={handleFinish}
                      disabled={saveDisabled}
                    >
                      <Check size={14} />
                      {saveStatus === "saving" ? "Saving…" : "Save & finish"}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="ui-btn-primary h-9 gap-1.5 px-4 disabled:opacity-50"
                    onClick={canEdit ? handleSaveAndExport : handleExport}
                    disabled={exporting || (canEdit && saveStatus === "saving")}
                  >
                    <Download size={14} />
                    {exporting ? "Exporting…" : canEdit ? "Save & export" : "Export"}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="ui-btn-ghost h-9 gap-1.5 px-4"
                  onClick={() => setStepIndex((index) => Math.min(STEPS.length - 1, index + 1))}
                >
                  Next
                  <ChevronRight size={14} />
                </button>
              )}
            </div>
          </div>
        </div>
      </SopShell>
  );
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="ui-panel px-4 py-3">
      <h2 className="ui-setup-section-title mb-3">{title}</h2>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="ui-field-label">{label}</span>
      {children}
    </label>
  );
}

function RowDeleteButton({ onClick, title }: { onClick: () => void; title: string }) {
  return (
    <button
      type="button"
      className="ui-btn-ghost h-9 w-9 shrink-0 px-0 text-ink-tertiary hover:text-danger"
      title={title}
      onClick={onClick}
    >
      <Trash2 size={13} />
    </button>
  );
}

function AddButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" className="ui-btn-ghost mt-2 h-8 gap-1.5 px-3" onClick={onClick}>
      <Plus size={13} />
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// List editors
// ---------------------------------------------------------------------------

function StringListEditor({
  items,
  placeholder,
  disabled = false,
  onChange,
}: {
  items: string[];
  placeholder: string;
  disabled?: boolean;
  onChange: (items: string[]) => void;
}) {
  return (
    <div className="space-y-2">
      {items.map((item, index) => (
        <div key={index} className="flex items-center gap-2">
          <input
            className="ui-field-standalone min-w-0 flex-1"
            value={item}
            placeholder={placeholder}
            disabled={disabled}
            onChange={(event) => {
              const next = [...items];
              next[index] = event.target.value;
              onChange(next);
            }}
          />
          {disabled ? null : (
            <RowDeleteButton title="Remove" onClick={() => onChange(items.filter((_, i) => i !== index))} />
          )}
        </div>
      ))}
      {disabled ? null : <AddButton label="Add" onClick={() => onChange([...items, ""])} />}
    </div>
  );
}

type PairRow<K extends string, V extends string> = Record<K | V, string>;

function PairListEditor<K extends string, V extends string>({
  rows,
  keyLabel,
  valueLabel,
  keyName,
  valueName,
  disabled = false,
  onChange,
}: {
  rows: Array<PairRow<K, V>>;
  keyLabel: string;
  valueLabel: string;
  keyName: K;
  valueName: V;
  disabled?: boolean;
  onChange: (rows: Array<PairRow<K, V>>) => void;
}) {
  function patch(index: number, field: K | V, value: string) {
    const next = rows.map((row, i) => (i === index ? { ...row, [field]: value } : row));
    onChange(next);
  }

  return (
    <div className="space-y-2">
      {rows.map((row, index) => (
        <div key={index} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] gap-2">
          <input
            className="ui-field-standalone min-w-0"
            value={row[keyName]}
            placeholder={keyLabel}
            disabled={disabled}
            onChange={(event) => patch(index, keyName, event.target.value)}
          />
          <input
            className="ui-field-standalone min-w-0"
            value={row[valueName]}
            placeholder={valueLabel}
            disabled={disabled}
            onChange={(event) => patch(index, valueName, event.target.value)}
          />
          {disabled ? null : (
            <RowDeleteButton title="Remove" onClick={() => onChange(rows.filter((_, i) => i !== index))} />
          )}
        </div>
      ))}
      {disabled ? null : (
        <AddButton
          label="Add"
          onClick={() => onChange([...rows, { [keyName]: "", [valueName]: "" } as PairRow<K, V>])}
        />
      )}
    </div>
  );
}

function ChangeHistoryEditor({
  rows,
  disabled = false,
  onChange,
}: {
  rows: Sop["changeHistory"];
  disabled?: boolean;
  onChange: (rows: Sop["changeHistory"]) => void;
}) {
  function patch(index: number, field: keyof Sop["changeHistory"][number], value: string) {
    onChange(rows.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  }

  return (
    <div className="space-y-3">
      {rows.map((row, index) => (
        <div key={index} className="rounded-md border border-line p-3">
          <div className="grid gap-2 sm:grid-cols-[6rem_minmax(0,1fr)]">
            <input
              className="ui-field-standalone"
              value={row.version}
              placeholder="Version"
              disabled={disabled}
              onChange={(event) => patch(index, "version", event.target.value)}
            />
            <input
              className="ui-field-standalone"
              value={row.changes}
              placeholder="Description of changes"
              disabled={disabled}
              onChange={(event) => patch(index, "changes", event.target.value)}
            />
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_10rem_auto]">
            <input
              className="ui-field-standalone"
              value={row.createdByName}
              placeholder="Created by"
              disabled={disabled}
              onChange={(event) => patch(index, "createdByName", event.target.value)}
            />
            <input
              className="ui-field-standalone"
              value={row.createdByPosition}
              placeholder="Position"
              disabled={disabled}
              onChange={(event) => patch(index, "createdByPosition", event.target.value)}
            />
            <input
              type="date"
              required
              className="ui-field-standalone"
              value={row.createdByDate}
              disabled={disabled}
              onChange={(event) => patch(index, "createdByDate", event.target.value)}
            />
            {disabled ? null : (
              <RowDeleteButton title="Remove entry" onClick={() => onChange(rows.filter((_, i) => i !== index))} />
            )}
          </div>
        </div>
      ))}
      {disabled ? null : (
        <AddButton
          label="Add entry"
          onClick={() =>
            onChange([
              ...rows,
              { version: "", changes: "", createdByName: "", createdByPosition: "", createdByDate: "" },
            ])
          }
        />
      )}
    </div>
  );
}

function ApprovalsEditor({
  rows,
  disabled = false,
  onChange,
}: {
  rows: Sop["approvals"];
  disabled?: boolean;
  onChange: (rows: Sop["approvals"]) => void;
}) {
  function patch(index: number, field: keyof Sop["approvals"][number], value: string) {
    onChange(rows.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  }

  return (
    <div className="space-y-2">
      {rows.map((row, index) => (
        <div key={index} className="grid gap-2 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_10rem_auto]">
          <input
            className="ui-field-standalone"
            value={row.role}
            placeholder="Role"
            disabled={disabled}
            onChange={(event) => patch(index, "role", event.target.value)}
          />
          <input
            className="ui-field-standalone"
            value={row.name}
            placeholder="Name"
            disabled={disabled}
            onChange={(event) => patch(index, "name", event.target.value)}
          />
          <input
            className="ui-field-standalone"
            value={row.position}
            placeholder="Position"
            disabled={disabled}
            onChange={(event) => patch(index, "position", event.target.value)}
          />
          <input
            type="date"
            required
            className="ui-field-standalone"
            value={row.date}
            disabled={disabled}
            onChange={(event) => patch(index, "date", event.target.value)}
          />
          {disabled ? null : (
            <RowDeleteButton title="Remove row" onClick={() => onChange(rows.filter((_, i) => i !== index))} />
          )}
        </div>
      ))}
      {disabled ? null : (
        <AddButton
          label="Add approver"
          onClick={() => onChange([...rows, { role: "", name: "", position: "", date: "" }])}
        />
      )}
    </div>
  );
}
