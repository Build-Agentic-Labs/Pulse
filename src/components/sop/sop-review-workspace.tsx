"use client";

import { Loader2, Send, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useConfirm } from "@/components/confirm-provider";
import { createPlannerSupabaseClient, getUserFromSession } from "@/domain/supabase-planner";
import { listSopAnnexFiles, type SopAnnexFile } from "@/lib/sop/annex-files";
import {
  deleteSopReviewAnnotation,
  listSopReviewAnnotations,
  listSopReviewSubmissions,
  saveSopReviewRemark,
  submitSopReviewResult,
  type SopReviewAnnotation,
  type SopReviewSubmission,
} from "@/lib/sop/review-annotations";
import { getSopControl } from "@/lib/sop/review";
import { getSop, type SopRecord } from "@/lib/sop/store";
import { SopPrintPreview } from "./sop-print-preview";

export const REVIEW_CATEGORIES = [
  { key: "document", label: "Document control" },
  { key: "purpose", label: "Purpose" },
  { key: "scope", label: "Scope" },
  { key: "definitions", label: "Definitions" },
  { key: "responsible", label: "Responsible parties" },
  { key: "references", label: "References" },
  { key: "measurements", label: "Measurements" },
  { key: "procedure", label: "Procedure & process flow" },
  { key: "annexes", label: "Annexes & forms" },
  { key: "history", label: "Change history" },
  { key: "overall", label: "Overall remarks" },
] as const;

export function reviewCategoryLabel(category: string): string {
  return REVIEW_CATEGORIES.find((item) => item.key === category)?.label ?? "Overall remarks";
}

const REMARK_AUTOSAVE_DELAY_MS = 700;

export function SopReviewWorkspace({
  sopId,
  onClose,
  onSubmitted,
}: {
  sopId: string;
  onClose: () => void;
  onSubmitted?: () => void;
}) {
  const confirm = useConfirm();
  const [record, setRecord] = useState<SopRecord | null>(null);
  const [annexFiles, setAnnexFiles] = useState<SopAnnexFile[]>([]);
  const [annotations, setAnnotations] = useState<SopReviewAnnotation[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [submission, setSubmission] = useState<SopReviewSubmission | null>(null);
  const [noChanges, setNoChanges] = useState(false);
  const [reviewCycle, setReviewCycle] = useState(0);
  const [activeCategory, setActiveCategory] = useState("document");
  const [status, setStatus] = useState<"loading" | "ready" | "saving" | "error">("loading");
  const [autosaveStatus, setAutosaveStatus] = useState<"idle" | "waiting" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");
  const pdfNavigationRef = useRef(false);
  const pdfNavigationTimerRef = useRef<number | null>(null);
  const autosaveInFlightRef = useRef(false);

  useEffect(() => {
    let active = true;
    setStatus("loading");
    setError("");
    const supabase = createPlannerSupabaseClient();
    Promise.all([
      getSop(sopId),
      listSopAnnexFiles(sopId),
      listSopReviewAnnotations(sopId),
      getUserFromSession(supabase),
      getSopControl(sopId),
      listSopReviewSubmissions([sopId]),
    ])
      .then(([nextRecord, files, comments, userResult, control, submissions]) => {
        if (!active) return;
        if (!nextRecord) throw new Error("This SOP could not be loaded for review.");
        const userId = userResult.data.user?.id ?? null;
        // One round per cycle: a submission counts even if the author has since
        // recalled and edited the draft (content hash changed).
        const currentSubmission = submissions.find(
          (item) =>
            item.reviewerId === userId &&
            item.reviewCycle === control?.reviewCycle,
        ) ?? null;
        const activeComments = comments.filter(
          (comment) => comment.reviewCycle === (control?.reviewCycle ?? 0) && !comment.resolvedAt,
        );
        setRecord(nextRecord);
        setAnnexFiles(files);
        setAnnotations(activeComments);
        setCurrentUserId(userId);
        setSubmission(currentSubmission);
        setNoChanges(currentSubmission?.noChanges ?? false);
        setReviewCycle(control?.reviewCycle ?? 0);
        setDrafts(Object.fromEntries(
          activeComments
            .filter((comment) => comment.createdBy === userId)
            .map((comment) => [comment.category, comment.body]),
        ));
        setAutosaveStatus("saved");
        setStatus("ready");
      })
      .catch((caught) => {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : "The review could not be opened.");
        setStatus("error");
      });
    return () => {
      active = false;
    };
  }, [sopId]);

  const myRemarks = useMemo(
    () => new Map(annotations.filter((item) => item.createdBy === currentUserId).map((item) => [item.category, item])),
    [annotations, currentUserId],
  );
  const hasChanges = REVIEW_CATEGORIES.some(({ key }) =>
    (drafts[key] ?? "").trim() !== (myRemarks.get(key)?.body ?? "").trim(),
  );
  const hasAnyRemarks = REVIEW_CATEGORIES.some(({ key }) => Boolean((drafts[key] ?? "").trim()));

  useEffect(() => () => {
    if (pdfNavigationTimerRef.current !== null) window.clearTimeout(pdfNavigationTimerRef.current);
  }, []);

  useEffect(() => {
    if (!hasChanges) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasChanges]);

  function focusPdfCategory(category: string) {
    setActiveCategory(category);
    pdfNavigationRef.current = true;
    if (pdfNavigationTimerRef.current !== null) window.clearTimeout(pdfNavigationTimerRef.current);
    const panel = document.querySelector<HTMLElement>(".sop-review-panel");
    if (panel) panel.dataset.scrollSyncPaused = "true";
    document
      .querySelector<HTMLElement>(`.sop-preview-scroll [data-review-category="${category}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
    pdfNavigationTimerRef.current = window.setTimeout(() => {
      pdfNavigationRef.current = false;
      pdfNavigationTimerRef.current = null;
      if (panel) delete panel.dataset.scrollSyncPaused;
    }, 700);
  }

  async function refreshAnnotations(adoptSavedDrafts = false) {
    const comments = await listSopReviewAnnotations(sopId);
    const activeComments = comments.filter(
      (comment) => comment.reviewCycle === reviewCycle && !comment.resolvedAt,
    );
    setAnnotations(activeComments);
    if (adoptSavedDrafts) {
      setDrafts(Object.fromEntries(
        activeComments
          .filter((comment) => comment.createdBy === currentUserId)
          .map((comment) => [comment.category, comment.body]),
      ));
    }
  }

  async function persistRemarks(snapshot = drafts) {
    await Promise.all(
      REVIEW_CATEGORIES.filter(({ key }) =>
        (snapshot[key] ?? "").trim() !== (myRemarks.get(key)?.body ?? "").trim(),
      ).map(({ key }) => saveSopReviewRemark({ sopId, category: key, body: snapshot[key] ?? "" })),
    );
    await refreshAnnotations();
  }

  useEffect(() => {
    if (!record || submission || !hasChanges || status === "loading" || status === "saving") return;
    const snapshot = { ...drafts };
    setAutosaveStatus("waiting");
    const timer = window.setTimeout(() => {
      if (autosaveInFlightRef.current) return;
      autosaveInFlightRef.current = true;
      setStatus("saving");
      setAutosaveStatus("saving");
      setError("");
      void (async () => {
        try {
          await Promise.all(
            REVIEW_CATEGORIES.filter(({ key }) =>
              (snapshot[key] ?? "").trim() !== (myRemarks.get(key)?.body ?? "").trim(),
            ).map(({ key }) => saveSopReviewRemark({ sopId, category: key, body: snapshot[key] ?? "" })),
          );
          const comments = await listSopReviewAnnotations(sopId);
          setAnnotations(comments.filter(
            (comment) => comment.reviewCycle === reviewCycle && !comment.resolvedAt,
          ));
          setStatus("ready");
          setAutosaveStatus("saved");
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : "The review remarks could not be saved.");
          setStatus("error");
          setAutosaveStatus("error");
        } finally {
          autosaveInFlightRef.current = false;
        }
      })();
    }, REMARK_AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [drafts, hasChanges, myRemarks, record, reviewCycle, sopId, status, submission]);

  async function submitReview() {
    if (status === "saving" || submission) return;
    if (noChanges && hasAnyRemarks) {
      setError("Remove your remarks before selecting No changes needed.");
      setStatus("error");
      return;
    }
    if (!noChanges && !hasAnyRemarks) {
      setError("Add at least one remark or select No changes needed.");
      setStatus("error");
      return;
    }

    setStatus("saving");
    setError("");
    try {
      if (hasChanges) await persistRemarks();
      const id = await submitSopReviewResult(sopId, noChanges);
      setSubmission({
        id,
        sopId,
        reviewCycle,
        reviewerId: currentUserId ?? "",
        reviewerName: "You",
        noChanges,
        contentHash: record?.sop ? (await getSopControl(sopId))?.contentHash ?? "" : "",
        submittedAt: new Date().toISOString(),
      });
      setStatus("ready");
      onSubmitted?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The review could not be sent to the author.");
      setStatus("error");
    }
  }

  async function removeRemark(annotation: SopReviewAnnotation) {
    const approved = await confirm({
      title: `Delete ${reviewCategoryLabel(annotation.category)} remarks?`,
      body: "This review remark will be removed permanently.",
      tone: "warning",
      confirmLabel: "Delete remark",
    });
    if (!approved) return;
    setStatus("saving");
    setError("");
    try {
      await deleteSopReviewAnnotation(annotation.id);
      await refreshAnnotations(true);
      setAutosaveStatus("saved");
      setStatus("ready");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The review remark could not be deleted.");
      setStatus("error");
    }
  }

  async function handleClose() {
    const needsFlush =
      !submission &&
      (hasChanges || autosaveStatus === "waiting" || autosaveStatus === "saving" || autosaveStatus === "error");
    if (needsFlush) {
      setStatus("saving");
      setAutosaveStatus("saving");
      setError("");
      try {
        await persistRemarks();
        setStatus("ready");
        setAutosaveStatus("saved");
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "The review remarks could not be saved.");
        setStatus("error");
        setAutosaveStatus("error");
        return;
      }
    }
    onClose();
  }

  const panel = (
    <div className="flex h-full min-h-0 flex-col">
      <div
        data-review-panel-header
        className="flex-none border-b border-line bg-canvas px-4 py-3"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="ui-mono-label text-ink-tertiary">Structured review remarks</div>
            <p className="ui-section-subtitle mt-1 text-ink-secondary">Add remarks under the section they apply to.</p>
          </div>
          <div
            role="status"
            aria-live="polite"
            className={`flex shrink-0 items-center gap-1.5 text-[11px] ${
              autosaveStatus === "error" ? "text-danger" : "text-ink-tertiary"
            }`}
          >
            {autosaveStatus === "saving" ? <Loader2 size={12} className="animate-spin" /> : null}
            {autosaveStatus === "waiting"
              ? "Autosave pending"
              : autosaveStatus === "saving"
                ? "Saving…"
                : autosaveStatus === "error"
                  ? "Autosave failed"
                  : "Saved"}
          </div>
        </div>
      </div>

      <div data-review-panel-scroll className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
      {error ? <div className="ui-notice ui-notice-warn px-3 py-2 text-xs">{error}</div> : null}

      {REVIEW_CATEGORIES.map(({ key, label }) => {
        const mine = myRemarks.get(key);
        const others = annotations.filter((item) => item.category === key && item.createdBy !== currentUserId);
        return (
          <section
            key={key}
            data-review-field={key}
            className={`rounded-md border p-3 transition-colors ${
              activeCategory === key ? "border-ink bg-surface-hover" : "border-line"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <label htmlFor={`review-${key}`} className="text-xs font-medium text-ink">{label}</label>
              {mine ? (
                <button
                  type="button"
                  className="ui-btn-ghost h-7 w-7 px-0 text-danger disabled:opacity-40"
                  aria-label={`Delete ${label} remarks`}
                  title="Delete remarks"
                  disabled={status === "saving" || Boolean(submission)}
                  onClick={() => void removeRemark(mine)}
                >
                  <Trash2 size={13} className="mx-auto" />
                </button>
              ) : null}
            </div>
            <textarea
              id={`review-${key}`}
              className="ui-field-standalone sop-review-remark-field mt-2 min-h-20 w-full resize-y"
              placeholder={`Add ${label.toLowerCase()} remarks…`}
              value={drafts[key] ?? ""}
              disabled={Boolean(submission)}
              onChange={(event) => {
                setDrafts((current) => ({ ...current, [key]: event.target.value }));
                setError("");
                if (status === "error") setStatus("ready");
              }}
              onFocus={() => focusPdfCategory(key)}
            />
            {others.length ? (
              <div className="mt-2 space-y-2 border-t border-line pt-2">
                {others.map((remark) => (
                  <div key={remark.id}>
                    <p className="text-xs leading-5 text-ink-secondary">{remark.body}</p>
                    <p className="ui-section-subtitle mt-0.5 text-ink-tertiary">{remark.authorName}</p>
                  </div>
                ))}
              </div>
            ) : null}
          </section>
        );
      })}
      </div>
      <div className="flex-none border-t border-line bg-canvas p-4">
        <label className="flex cursor-pointer items-start gap-2.5 text-sm text-ink">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-line"
            checked={noChanges}
            disabled={status === "saving" || Boolean(submission)}
            onChange={(event) => {
              setNoChanges(event.target.checked);
              setError("");
              if (status === "error") setStatus("ready");
            }}
          />
          <span>
            <span className="block font-medium">No changes needed</span>
            <span className="mt-0.5 block text-xs leading-5 text-ink-secondary">
              Leave unchecked when your remarks should be returned to the author.
            </span>
          </span>
        </label>
        <button
          type="button"
          className="ui-btn-primary mt-3 h-9 w-full gap-2 px-4 disabled:opacity-40"
          disabled={status === "saving" || Boolean(submission)}
          onClick={() => void submitReview()}
        >
          {status === "saving" ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          {submission ? "Sent to author" : "Send back to author"}
        </button>
      </div>
    </div>
  );

  if (!record || status === "loading") {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60">
        {status === "error" ? (
          <div className="ui-panel max-w-sm p-5 text-center">
            <p className="ui-section-subtitle text-danger">{error}</p>
            <button type="button" className="ui-btn-ghost mt-3 h-9 px-4" onClick={onClose}>Back to review queue</button>
          </div>
        ) : <Loader2 size={22} className="animate-spin text-white" />}
      </div>
    );
  }

  return (
    <SopPrintPreview
      sop={record.sop}
      annexFiles={annexFiles}
      onClose={() => void handleClose()}
      mode="review"
      reviewPanel={panel}
      onReviewCategoryChange={(category) => {
        if (!pdfNavigationRef.current) setActiveCategory(category);
      }}
    />
  );
}
