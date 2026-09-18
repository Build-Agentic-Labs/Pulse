"use client";

/**
 * Document control for ONE work instruction: a short stepped flow in the spirit of the SOP
 * builder — Readiness → References → Release → History.
 *
 * It does not author content. Steps, tools, checks and photos are edited in the planner; this
 * only decides whether what is there gets frozen as the next revision. "use client" because it is
 * a dialog with form state and writes.
 *
 * Spec: docs/superpowers/specs/2026-09-18-work-instruction-release-design.md
 */

import { AlertTriangle, Check, Eye, FileCheck2, History, Link2, ListChecks, Loader2, Paperclip, Plus, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { createPortal } from "react-dom";
import { useConfirm } from "@/components/confirm-provider";
import { ThemedSelect } from "@/components/themed-select";
import { formatDate, formatDateTime } from "@/domain/formatting";
import {
  REFERENCE_FILE_ACCEPT,
  REFERENCE_KINDS,
  REFERENCE_KIND_LABELS,
  referenceFileProblem,
  referenceKindAcceptsFile,
  referenceLine,
  type WorkInstructionReferenceRecord,
} from "@/domain/work-instruction/references";
import {
  CHANGE_DESCRIPTION_MAX,
  isoDateOnly,
  nextRevisionLetter,
  releaseReadiness,
  releaseStateFor,
  revisionLabel,
  revisionLetter,
  validateReleaseInput,
  type WorkInstructionReleaseSummary,
} from "@/domain/work-instruction/release";
import type { WorkInstruction, WorkInstructionReferenceKind } from "@/domain/work-instruction/schema";
import {
  addWorkInstructionReference,
  listReferenceableSops,
  openWorkInstructionReferenceFile,
  releaseWorkInstruction,
  removeWorkInstructionReference,
} from "@/lib/work-instruction/store";

type StepId = "readiness" | "references" | "release" | "history";

const STEPS: Array<{ id: StepId; label: string; icon: ComponentType<{ size?: number; strokeWidth?: number }> }> = [
  { id: "readiness", label: "Readiness", icon: ListChecks },
  { id: "references", label: "References", icon: Link2 },
  { id: "release", label: "Release", icon: FileCheck2 },
  { id: "history", label: "History", icon: History },
];

/** Example text for the add-a-reference fields, so the hint matches the kind being added. */
const REFERENCE_EXAMPLES: Record<WorkInstructionReferenceKind, { number: string; title: string }> = {
  sop: { number: "", title: "" },
  drawing: { number: "DWG-1140 rev C", title: "Frame weldment drawing" },
  document: { number: "FRM-010", title: "Torque log form" },
  link: { number: "Optional", title: "Supplier installation guide" },
};

export interface WorkInstructionControlProps {
  projectId: string;
  /** The live DEFAULT-LAYOUT build, references included, with no control meta applied. */
  instruction: WorkInstruction;
  /** This task's releases. */
  releases: WorkInstructionReleaseSummary[];
  /** This task's managed references. */
  references: WorkInstructionReferenceRecord[];
  /**
   * False while the task's photos are still loading (the planner loads them lazily). Releasing
   * waits for them, because a release freezes the photos too.
   */
  photosLoaded?: boolean;
  /** View-only project access: everything is visible, nothing can be changed. */
  readOnly?: boolean;
  /** True while a preview is open on top, so Escape closes that instead of this. */
  suspended?: boolean;
  initialStep?: StepId;
  /** Reload releases and references after a write. */
  onChanged: () => Promise<void> | void;
  onClose: () => void;
  onPreview: (options?: { releaseId?: string }) => void;
  onEditTask: () => void;
}

/** The letter after the one about to be released — only for the confirmation's wording. */
function revisionLetterAfter(_next: string, releases: readonly WorkInstructionReleaseSummary[]): string {
  return revisionLetter(releases.reduce((max, release) => Math.max(max, release.revisionIndex), 0) + 2);
}

function errorMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : "Something went wrong. Please try again.";
}

export function WorkInstructionControl({
  projectId,
  instruction,
  releases,
  references,
  photosLoaded = true,
  readOnly = false,
  suspended = false,
  initialStep = "readiness",
  onChanged,
  onClose,
  onPreview,
  onEditTask,
}: WorkInstructionControlProps) {
  const [step, setStep] = useState<StepId>(initialStep);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const confirm = useConfirm();
  const readiness = useMemo(() => releaseReadiness(instruction, { photosLoaded }), [instruction, photosLoaded]);
  const state = useMemo(() => releaseStateFor(instruction, releases, { photosLoaded }), [instruction, photosLoaded, releases]);
  const nextLetter = nextRevisionLetter(releases);
  const sortedReleases = useMemo(() => [...releases].sort((left, right) => right.revisionIndex - left.revisionIndex), [releases]);

  const [changeDescription, setChangeDescription] = useState(releases.length === 0 ? "Initial release" : "");
  const [effectiveDate, setEffectiveDate] = useState(() => isoDateOnly(new Date()));

  const [draftKind, setDraftKind] = useState<WorkInstructionReferenceKind>("sop");
  const [draftSopId, setDraftSopId] = useState("");
  const [draftNumber, setDraftNumber] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftUrl, setDraftUrl] = useState("");
  const [draftFile, setDraftFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const draftDirty = Boolean(draftSopId || draftNumber.trim() || draftTitle.trim() || draftUrl.trim() || draftFile);
  const [sops, setSops] = useState<Array<{ id: string; number: string; title: string; version: string; status: string }> | null>(null);

  useEffect(() => {
    if (suspended) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busy, onClose, suspended]);

  // The SOP list is only needed once someone is about to pick one.
  useEffect(() => {
    if (step !== "references" || sops !== null || readOnly) return;
    let alive = true;
    listReferenceableSops(projectId)
      .then((loaded) => {
        if (alive) setSops(loaded);
      })
      .catch(() => {
        if (alive) setSops([]);
      });
    return () => {
      alive = false;
    };
  }, [projectId, readOnly, sops, step]);

  async function run(key: string, action: () => Promise<void>) {
    if (busy) return;
    setBusy(key);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (caught) {
      setError(errorMessage(caught));
    }
    setBusy(null);
  }

  const releaseBlockedReason = readOnly
    ? "You have view-only access to this project."
    : !photosLoaded
      ? "Loading this task's photos…"
      : readiness.blocking.length > 0
      ? "Resolve the readiness items first."
      : state.kind === "released"
        ? `Nothing has changed since ${revisionLabel(state.release.revision)}.`
        : validateReleaseInput({ changeDescription, effectiveDate });

  const stateChip =
    state.kind === "released"
      ? { label: `Released ${revisionLabel(state.release.revision)}`, className: "border-success/40 bg-success-muted text-success" }
      : state.kind === "modified"
        ? { label: `Modified since ${revisionLabel(state.release.revision)}`, className: "border-warn/40 bg-warn/10 text-warn" }
        : { label: "Not released", className: "border-line bg-surface-raised text-ink-secondary" };

  const dialog = (
    <div
      className="fixed inset-0 z-[55] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Document control for ${instruction.meta.title || "work instruction"}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      {/* Fixed height: a dialog that resizes per step jumps, and moves the step buttons out from
          under the cursor. */}
      <div className="ui-panel flex h-[min(620px,88vh)] w-full max-w-4xl flex-col overflow-hidden">
        <header className="flex items-start gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="ui-mono-label text-ink-tertiary">{instruction.meta.documentNumber || "WI number pending"}</div>
            <h2 className="ui-section-title mt-0.5 truncate">{instruction.meta.title || "Untitled work instruction"}</h2>
          </div>
          <span className={`ui-chip shrink-0 ${stateChip.className}`}>{stateChip.label}</span>
          <button type="button" className="ui-btn-ghost h-8 gap-1.5 px-2.5" onClick={() => onPreview()}>
            <Eye size={14} />
            Preview
          </button>
          <button type="button" className="ui-btn-ghost h-8 w-8 px-0" aria-label="Close document control" onClick={onClose} disabled={busy !== null}>
            <X size={15} className="mx-auto" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1">
          <nav className="w-44 shrink-0 space-y-1 border-r border-line p-3" aria-label="Document control steps">
            {STEPS.map((item, index) => {
              const Icon = item.icon;
              const active = item.id === step;
              const flag =
                item.id === "readiness" && readiness.blocking.length > 0
                  ? String(readiness.blocking.length)
                  : item.id === "references" && references.length > 0
                    ? String(references.length)
                    : item.id === "history" && releases.length > 0
                      ? String(releases.length)
                      : "";
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-current={active ? "step" : undefined}
                  className={`flex w-full items-center gap-2 rounded border-l-2 px-2.5 py-2 text-left text-sm transition ${
                    active
                      ? "border-ink bg-surface-sunken font-semibold text-ink"
                      : "border-transparent text-ink-secondary hover:bg-surface-raised hover:text-ink"
                  }`}
                  onClick={() => {
                    setStep(item.id);
                    setError("");
                  }}
                >
                  <span className="ui-mono-label w-3 text-ink-tertiary">{index + 1}</span>
                  <Icon size={14} strokeWidth={1.75} />
                  <span className="flex-1">{item.label}</span>
                  {flag ? (
                    <span
                      className={`ui-mono-label ${
                        item.id === "readiness" ? "text-danger" : "text-ink-tertiary"
                      }`}
                    >
                      {flag}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </nav>

          <div className="min-w-0 flex-1 space-y-4 overflow-y-auto p-5">
            {error ? <div className="ui-notice ui-notice-warn px-4 py-3 text-xs">{error}</div> : null}
            {notice ? <div className="ui-notice px-4 py-3 text-xs">{notice}</div> : null}

            {step === "readiness" ? (
              <section className="space-y-4" aria-label="Readiness">
                <p className="ui-section-subtitle">
                  The content comes from the planner task. Fix anything listed here in the task, then come back to release it.
                </p>
                {readiness.blocking.length === 0 ? (
                  <div className="flex items-center gap-2 text-sm text-ink">
                    <Check size={15} className="text-success" />
                    Ready to release.
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {readiness.blocking.map((item) => (
                      <li key={item} className="flex items-start gap-2 text-sm text-ink">
                        <AlertTriangle size={14} className="mt-0.5 shrink-0 text-danger" />
                        {item}
                      </li>
                    ))}
                  </ul>
                )}
                {readiness.warnings.length > 0 ? (
                  <div>
                    <div className="ui-mono-label mb-1.5 text-ink-tertiary">Worth a look</div>
                    <ul className="space-y-1.5">
                      {readiness.warnings.map((item) => (
                        <li key={item} className="flex items-start gap-2 text-sm text-ink-secondary">
                          <AlertTriangle size={13} className="mt-0.5 shrink-0 text-warn" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {photosLoaded ? null : (
                  <p className="flex items-center gap-2 text-xs text-ink-tertiary">
                    <Loader2 size={12} className="animate-spin" />
                    Loading this task&apos;s photos…
                  </p>
                )}
                {/* When something blocks the release, fixing it is the next step, so that is the
                    highlighted action. */}
                <div className="flex gap-2">
                  <button
                    type="button"
                    className={`h-9 px-3 ${readiness.blocking.length > 0 ? "ui-btn-primary" : "ui-btn-ghost"}`}
                    onClick={onEditTask}
                  >
                    Edit the task
                  </button>
                  <button
                    type="button"
                    className={`h-9 px-3 ${readiness.blocking.length > 0 ? "ui-btn-ghost" : "ui-btn-primary"}`}
                    onClick={() => setStep("references")}
                  >
                    Next: references
                  </button>
                </div>
              </section>
            ) : null}

            {step === "references" ? (
              <section className="space-y-4" aria-label="References">
                <p className="ui-section-subtitle">
                  Documents the operator may need. Link a Pulse SOP, or add a drawing or document with an uploaded file, a link, or both. They print on the sheet and are frozen into each release.
                </p>
                {instruction.setup.references && instruction.setup.references.length > 0 ? (
                  <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
                    {instruction.setup.references.map((reference, index) => {
                      // Legacy task links lead the list and have no row behind them.
                      const legacyCount = instruction.setup.references!.length - references.length;
                      const record = index >= legacyCount ? [...references].sort((l, r) => l.position - r.position || l.id.localeCompare(r.id))[index - legacyCount] : undefined;
                      return (
                        <li key={`${reference.kind}-${index}`} className="flex items-center gap-3 px-3 py-2.5">
                          <span className="ui-chip shrink-0 border-line bg-surface-raised text-ink-secondary">{REFERENCE_KIND_LABELS[reference.kind]}</span>
                          <span className="min-w-0 flex-1 truncate text-sm text-ink">{referenceLine(reference)}</span>
                          {record?.file ? (
                            <button
                              type="button"
                              className="ui-btn-ghost h-7 shrink-0 gap-1 px-2 text-xs"
                              title={`${record.file.name} · ${(record.file.sizeBytes / (1024 * 1024)).toFixed(1)} MB`}
                              disabled={busy !== null}
                              onClick={() => void run(`open-${record.id}`, () => openWorkInstructionReferenceFile(record.file!))}
                            >
                              {busy === `open-${record.id}` ? <Loader2 size={12} className="animate-spin" /> : <Paperclip size={12} />}
                              Open file
                            </button>
                          ) : null}
                          {reference.url ? (
                            <a href={reference.url} target="_blank" rel="noreferrer" className="ui-btn-ghost h-7 shrink-0 px-2 text-xs">
                              Open
                            </a>
                          ) : null}
                          {record && !readOnly ? (
                            <button
                              type="button"
                              className="ui-btn-ghost h-7 w-7 shrink-0 p-0 text-ink-tertiary hover:text-danger"
                              aria-label={`Remove reference ${referenceLine(reference)}`}
                              disabled={busy !== null}
                              onClick={() =>
                                void run(`remove-${record.id}`, async () => {
                                  await removeWorkInstructionReference(record);
                                  await onChanged();
                                })
                              }
                            >
                              {busy === `remove-${record.id}` ? <Loader2 size={13} className="mx-auto animate-spin" /> : <Trash2 size={13} className="mx-auto" />}
                            </button>
                          ) : record ? null : (
                            <span className="ui-mono-label shrink-0 text-ink-tertiary">from the task</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-sm text-ink-tertiary">No reference documents yet.</p>
                )}

                {readOnly ? null : (
                  <form
                    className="space-y-3 rounded-lg border border-line p-3"
                    aria-label="Add a reference"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void run("add-reference", async () => {
                        await addWorkInstructionReference(
                          { projectId, taskId: instruction.taskId, position: references.reduce((max, item) => Math.max(max, item.position), 0) + 1 },
                          { kind: draftKind, sopId: draftSopId, documentNumber: draftNumber, title: draftTitle, url: draftUrl },
                          referenceKindAcceptsFile(draftKind) ? draftFile : null,
                        );
                        setDraftSopId("");
                        setDraftNumber("");
                        setDraftTitle("");
                        setDraftUrl("");
                        setDraftFile(null);
                        if (fileInputRef.current) fileInputRef.current.value = "";
                        await onChanged();
                      });
                    }}
                  >
                    <div className="grid gap-3 sm:grid-cols-[140px_minmax(0,1fr)]">
                      <label className="block">
                        <span className="ui-field-label">Kind</span>
                        <ThemedSelect
                          className="w-full"
                          ariaLabel="Reference kind"
                          value={draftKind}
                          disabled={busy !== null}
                          options={REFERENCE_KINDS.map((kind) => ({ value: kind, label: REFERENCE_KIND_LABELS[kind] }))}
                          onChange={(value) => setDraftKind(value as WorkInstructionReferenceKind)}
                        />
                      </label>
                      {draftKind === "sop" ? (
                        <label className="block">
                          <span className="ui-field-label">SOP</span>
                          <ThemedSelect
                            className="w-full"
                            ariaLabel="SOP to reference"
                            value={draftSopId}
                            disabled={busy !== null || sops === null}
                            menuMaxHeight={320}
                            options={[
                              { value: "", label: sops === null ? "Loading SOPs…" : sops.length === 0 ? "No SOPs in this organization" : "Choose an SOP…" },
                              ...(sops ?? []).map((sop) => ({
                                value: sop.id,
                                label: [sop.number || "Unnumbered", sop.version ? `v${sop.version}` : "", "·", sop.title, sop.status === "effective" ? "" : `(${sop.status.replace("_", " ")})`]
                                  .filter(Boolean)
                                  .join(" "),
                              })),
                            ]}
                            onChange={setDraftSopId}
                          />
                        </label>
                      ) : (
                        <div className="grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)]">
                          <label className="block">
                            <span className="ui-field-label">Document no.</span>
                            <input className="ui-field-standalone" value={draftNumber} maxLength={80} disabled={busy !== null} onChange={(event) => setDraftNumber(event.target.value)} placeholder={REFERENCE_EXAMPLES[draftKind].number} />
                          </label>
                          <label className="block">
                            <span className="ui-field-label">Title</span>
                            <input className="ui-field-standalone" value={draftTitle} maxLength={200} disabled={busy !== null} onChange={(event) => setDraftTitle(event.target.value)} placeholder={REFERENCE_EXAMPLES[draftKind].title} />
                          </label>
                        </div>
                      )}
                    </div>
                    {draftKind === "sop" ? null : (
                      <label className="block">
                        <span className="ui-field-label">Link{draftKind === "link" ? "" : " (optional)"}</span>
                        <input className="ui-field-standalone" type="url" value={draftUrl} disabled={busy !== null} onChange={(event) => setDraftUrl(event.target.value)} placeholder="https://" />
                      </label>
                    )}
                    {referenceKindAcceptsFile(draftKind) ? (
                      <label className="block">
                        <span className="ui-field-label">File (optional)</span>
                        <input
                          ref={fileInputRef}
                          type="file"
                          aria-label="Reference file"
                          accept={REFERENCE_FILE_ACCEPT}
                          className="sr-only"
                          disabled={busy !== null}
                          onChange={(event) => {
                            const file = event.target.files?.[0] ?? null;
                            const problem = file ? referenceFileProblem(file) : null;
                            setError(problem ?? "");
                            if (problem) event.target.value = "";
                            setDraftFile(problem ? null : file);
                          }}
                        />
                        <span className="flex items-center gap-2">
                          <span
                            className="ui-btn-ghost inline-flex h-9 cursor-pointer items-center gap-1.5 border border-line px-3"
                            aria-hidden="true"
                          >
                            <Paperclip size={13} />
                            {draftFile ? "Change file" : "Attach a file"}
                          </span>
                          {draftFile ? (
                            <span className="flex min-w-0 items-center gap-1.5 text-sm text-ink">
                              <span className="truncate">{draftFile.name}</span>
                              <span className="shrink-0 text-xs text-ink-tertiary">
                                {draftFile.size >= 1024 * 1024
                                  ? `${(draftFile.size / (1024 * 1024)).toFixed(1)} MB`
                                  : `${Math.max(1, Math.round(draftFile.size / 1024))} KB`}
                              </span>
                              <button
                                type="button"
                                className="ui-btn-ghost h-6 w-6 shrink-0 p-0 text-ink-tertiary"
                                aria-label="Remove the attached file"
                                onClick={(event) => {
                                  event.preventDefault();
                                  setDraftFile(null);
                                  if (fileInputRef.current) fileInputRef.current.value = "";
                                }}
                              >
                                <X size={12} className="mx-auto" />
                              </button>
                            </span>
                          ) : (
                            <span className="text-xs text-ink-tertiary">No file attached</span>
                          )}
                        </span>
                        <span className="mt-1 block text-[11px] text-ink-tertiary">
                          PDF, Word, Excel, CSV, JPG or PNG, up to 20 MB. Stored privately in Pulse; leave the title blank to use the file name.
                        </span>
                      </label>
                    ) : null}
                    <button type="submit" className="ui-btn-secondary h-9 gap-1.5 px-3 disabled:opacity-40" disabled={busy !== null || !draftDirty}>
                      {busy === "add-reference" ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                      Add reference
                    </button>
                  </form>
                )}

                {state.kind === "released" || releases.length === 0 ? null : (
                  <p className="text-xs text-ink-tertiary">Reference changes are part of the document, so they count as a change since the last release.</p>
                )}
                <button type="button" className="ui-btn-primary h-9 px-3" onClick={() => setStep("release")}>
                  Next: release
                </button>
              </section>
            ) : null}

            {step === "release" ? (
              <section className="space-y-4" aria-label="Release">
                <p className="ui-section-subtitle">
                  Releasing freezes this document exactly as it is now, as <strong className="text-ink">{revisionLabel(nextLetter)}</strong>. The released copy never changes; later edits in the planner show as a draft until you release again.
                </p>
                {draftDirty ? (
                  <div className="ui-notice ui-notice-warn flex flex-wrap items-center gap-2 px-4 py-3 text-xs">
                    <span>You started a reference but have not added it. It will not be part of this release.</span>
                    <button type="button" className="underline" onClick={() => setStep("references")}>
                      Go back to references
                    </button>
                  </div>
                ) : null}
                <label className="block">
                  <span className="ui-field-label">What changed in this revision</span>
                  <textarea
                    className="ui-field-standalone min-h-[84px] py-2"
                    value={changeDescription}
                    maxLength={CHANGE_DESCRIPTION_MAX}
                    disabled={readOnly || busy !== null}
                    onChange={(event) => setChangeDescription(event.target.value)}
                    placeholder="Added torque check to step 4; replaced the bracket photo."
                  />
                  <span className="mt-1 block text-right text-[11px] text-ink-tertiary">
                    {changeDescription.trim().length}/{CHANGE_DESCRIPTION_MAX} · prints in the revision history
                  </span>
                </label>
                <label className="block max-w-[220px]">
                  <span className="ui-field-label">Effective date</span>
                  <input className="ui-field-standalone" type="date" value={effectiveDate} disabled={readOnly || busy !== null} onChange={(event) => setEffectiveDate(event.target.value)} />
                </label>
                <p className="text-xs text-ink-tertiary">You are recorded as both the preparer and the approver of this revision.</p>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    className="ui-btn-primary h-9 gap-1.5 px-4 disabled:opacity-40"
                    disabled={Boolean(releaseBlockedReason) || busy !== null}
                    onClick={() =>
                      void run("release", async () => {
                        // A release is permanent: it cannot be edited or deleted afterwards.
                        const confirmed = await confirm({
                          title: `Release ${revisionLabel(nextLetter)}?`,
                          body: `This freezes "${instruction.meta.title}" exactly as it is now. A released revision cannot be edited or deleted; to change it you release ${revisionLabel(revisionLetterAfter(nextLetter, releases))}.`,
                          confirmLabel: `Release ${revisionLabel(nextLetter)}`,
                          // Permanent but deliberate: "Review", not the helper's default "Blocked".
                          tone: "warning",
                        });
                        if (!confirmed) return;
                        const released = await releaseWorkInstruction({ projectId, instruction, changeDescription, effectiveDate });
                        await onChanged();
                        setChangeDescription("");
                        setNotice(`Released as ${revisionLabel(released.revision)}.`);
                        setStep("history");
                      })
                    }
                  >
                    {busy === "release" ? <Loader2 size={14} className="animate-spin" /> : <FileCheck2 size={14} />}
                    Release {revisionLabel(nextLetter)}
                  </button>
                  {releaseBlockedReason ? (
                    readiness.blocking.length > 0 && !readOnly && photosLoaded ? (
                      <button type="button" className="text-xs text-ink-secondary underline" onClick={() => setStep("readiness")}>
                        {releaseBlockedReason}
                      </button>
                    ) : (
                      <span className="text-xs text-ink-tertiary">{releaseBlockedReason}</span>
                    )
                  ) : null}
                </div>
              </section>
            ) : null}

            {step === "history" ? (
              <section className="space-y-3" aria-label="History">
                {sortedReleases.length === 0 ? (
                  <p className="text-sm text-ink-tertiary">Nothing released yet. The first release will be Rev A.</p>
                ) : (
                  <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
                    {sortedReleases.map((release) => (
                      <li key={release.id} className="flex items-start gap-3 px-3 py-3">
                        <span className="ui-mono-label mt-0.5 w-12 shrink-0 text-ink">{revisionLabel(release.revision)}</span>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm text-ink">{release.changeDescription}</div>
                          <div className="mt-0.5 text-xs text-ink-tertiary">
                            Effective {formatDate(`${release.effectiveDate}T12:00:00`)} · released by {release.releasedByName || "unknown"} on {formatDateTime(release.releasedAt)}
                          </div>
                        </div>
                        <button type="button" className="ui-btn-ghost h-7 shrink-0 gap-1.5 px-2 text-xs" onClick={() => onPreview({ releaseId: release.id })}>
                          <Eye size={13} />
                          View
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(dialog, document.body) : dialog;
}
