"use client";

import { SopReviewLoading } from "./sop-review-loading";

import { Check, Loader2, Send, Trash2, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { SopReviewComment } from "./sop-review-comment";
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
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [conversationOpen, setConversationOpen] = useState(false);
  const [submission, setSubmission] = useState<SopReviewSubmission | null>(null);
  const [noChanges, setNoChanges] = useState(false);
  const [reviewCycle, setReviewCycle] = useState(0);
  const commentFieldRef = useRef<HTMLTextAreaElement | null>(null);
  const [commentAttachment, setCommentAttachment] = useState<{ id: string; name: string } | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const [commentSaving, setCommentSaving] = useState(false);
  const commentSavingRef = useRef(false);
  const [commentDismissKey, setCommentDismissKey] = useState(0);
  const [pendingQuote, setPendingQuote] = useState<{ category: string; text: string } | null>(null);
  const [activeCategory, setActiveCategory] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "saving" | "error">("loading");
  const [autosaveStatus, setAutosaveStatus] = useState<"idle" | "waiting" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");

  useLayoutEffect(() => {
    const field = commentFieldRef.current;
    if (!field) return;
    const resize = () => {
      field.style.height = "auto";
      field.style.height = `${field.scrollHeight + field.offsetHeight - field.clientHeight}px`;
    };
    resize();
    let width = field.clientWidth;
    const observer = new ResizeObserver(() => {
      if (field.clientWidth === width) return;
      width = field.clientWidth;
      resize();
    });
    observer.observe(field);
    return () => observer.disconnect();
  }, [commentBody, activeCategory]);


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
          (comment) => comment.reviewCycle === (control?.reviewCycle ?? 0) && (!comment.resolvedAt || Boolean(comment.authorResponse) || Boolean(comment.replies?.length)),
        );
        setRecord(nextRecord);
        setAnnexFiles(files);
        setAnnotations(activeComments);
        setCurrentUserId(userId);
        setSubmission(currentSubmission);
        setConversationOpen(Boolean(control && ["draft", "in_review"].includes(control.status) && !control.finalApprovalRequestedAt));
        setNoChanges(currentSubmission?.noChanges ?? false);
        setReviewCycle(control?.reviewCycle ?? 0);
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

  useEffect(() => {
    let alive = true;
    let pending = false;
    const refresh = async () => {
      if (pending || document.visibilityState !== "visible") return;
      pending = true;
      try {
        const comments = await listSopReviewAnnotations(sopId);
        if (!alive) return;
        setAnnotations(comments.filter(item => item.reviewCycle === reviewCycle && (!item.resolvedAt || Boolean(item.authorResponse) || Boolean(item.replies?.length))));
      } finally { pending = false; }
    };
    const run = () => { void refresh().catch(() => { /* Retain the last conversation; retry on the next focus or interval. */ }); };
    const timer = window.setInterval(run, 15000);
    window.addEventListener("focus", run);
    document.addEventListener("visibilitychange", run);
    return () => { alive = false; window.clearInterval(timer); window.removeEventListener("focus", run); document.removeEventListener("visibilitychange", run); };
  }, [sopId, reviewCycle]);

  const hasAnyRemarks = annotations.some((item) => item.createdBy === currentUserId);

  useEffect(() => {
    if (!commentBody.trim()) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [commentBody]);

  async function refreshAnnotations() {
    const comments = await listSopReviewAnnotations(sopId);
    setAnnotations(comments.filter((comment) => comment.reviewCycle === reviewCycle && !comment.resolvedAt));
  }

  async function submitReview() {
    if (status === "saving" || submission || activeCategory) return;
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
      await refreshAnnotations();
      setAutosaveStatus("saved");
      setStatus("ready");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The review remark could not be deleted.");
      setStatus("error");
    }
  }

  async function handleClose() {
    if (commentSavingRef.current) return;
    if (commentBody.trim()) {
      const discard = await confirm({ title: "Discard unsaved comment?", body: "This comment has not been saved. Your saved comments will remain.", confirmLabel: "Discard comment", tone: "warning" });
      if (!discard) return;
    }
    onClose();
  }

  function addComment(category: string, quote = "", attachment?: { id: string; name: string }) {
    setCommentAttachment(attachment ?? null);
    setActiveCategory(category);
    setCommentBody("");
    setError("");
    setPendingQuote(quote ? { category, text: quote } : null);
    window.setTimeout(() => document.getElementById(`review-${category}`)?.focus(), 0);
  }

  function cancelComment() {
    if (commentSavingRef.current) return;
    setActiveCategory("");
    setCommentAttachment(null);
    setPendingQuote(null);
    setCommentBody("");
    setError("");
    setCommentDismissKey((key) => key + 1);
  }

  async function saveComment() {
    if (!activeCategory || !commentBody.trim() || commentSavingRef.current) return;
    commentSavingRef.current = true;
    setCommentSaving(true);
    setError("");
    const category = activeCategory;
    const comment = commentAttachment ? `[Attachment:${encodeURIComponent(commentAttachment.id)}] ${commentAttachment.name}\n${commentBody.trim()}` : pendingQuote?.text ? `Selected text: “${pendingQuote.text}”\n${commentBody.trim()}` : commentBody.trim();
    const body = comment;
    try {
      const saved = await saveSopReviewRemark({ sopId, category, body });
      if (!saved) throw new Error("The comment was not saved. Please try again.");
      setAnnotations((current) => [...current.filter((item) => item.id !== saved.id), saved]);
      setNoChanges(false);
      setAutosaveStatus("saved");
      commentSavingRef.current = false;
      cancelComment();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The comment could not be saved. Try again.");
    } finally {
      commentSavingRef.current = false;
      setCommentSaving(false);
    }
  }

  const marginNotes = REVIEW_CATEGORIES.filter(({ key }) =>
    key === activeCategory || annotations.some((item) => item.category === key),
  ).map(({ key, label }) => ({
    key,
    category: key,
    node: (
      <section className={activeCategory === key ? "rounded-md bg-canvas" : "space-y-2"}>
        <label htmlFor={`review-${key}`} className="sr-only">{label}</label>
        <div className={activeCategory === key ? "relative" : "space-y-2"}>
          {activeCategory === key ? <>
            <textarea ref={commentFieldRef} id={`review-${key}`} rows={2} className="ui-field-standalone block min-h-24 w-full resize-none overflow-hidden rounded-md !pb-10 text-xs" placeholder="What needs to change?" value={commentBody} disabled={commentSaving} onChange={(event) => { setCommentBody(event.target.value); setError(""); }} />
            {error ? <p role="alert" className="text-xs text-danger">{error}</p> : null}
            <div className="absolute bottom-1.5 right-2 flex gap-1">
              <button type="button" aria-label="Cancel" title="Cancel" className="ui-btn-ghost inline-flex h-8 w-8 items-center justify-center p-0" disabled={commentSaving} onClick={cancelComment}><X size={15} /></button>
              <button type="button" aria-label="Save comment" title="Save comment" className="ui-btn-ghost inline-flex h-8 w-8 items-center justify-center p-0 disabled:opacity-40" disabled={commentSaving || !commentBody.trim()} onClick={() => void saveComment()}>{commentSaving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}</button>
            </div>
          </> : <>
            {annotations.filter((item) => item.category === key).map((remark) => (
              <SopReviewComment key={remark.id} remark={remark} viewerIsReviewer={remark.createdBy === currentUserId} canReviewerReply={conversationOpen && Boolean(submission) && remark.createdBy === currentUserId} actions={remark.createdBy === currentUserId && !submission ? (
                <button type="button" className="ui-btn-ghost h-7 w-7 shrink-0 px-0 text-ink-tertiary" aria-label={`Delete ${label} remarks`} disabled={status === "saving" || Boolean(activeCategory)} onClick={() => void removeRemark(remark)}><Trash2 size={12} className="mx-auto" /></button>
              ) : undefined} />
            ))}
          </>}
        </div>
      </section>
    ),
  }));
  const toolbar = (
    <>
      {error ? <span role="alert" className="max-w-64 text-xs text-danger">{error}</span> : null}
      <span role="status" className="text-[11px] text-ink-tertiary">{commentSaving ? "Saving comment…" : commentBody.trim() ? "Unsaved comment" : autosaveStatus === "error" ? "Save failed" : autosaveStatus === "saving" || autosaveStatus === "waiting" ? "Saving…" : "Saved"}</span>
      <label className="flex shrink-0 items-center gap-2 text-xs"><input type="checkbox" checked={noChanges} disabled={status === "saving" || Boolean(submission) || hasAnyRemarks || Boolean(activeCategory)} onChange={(event) => { setNoChanges(event.target.checked); setError(""); }} />No changes needed</label>
      <button type="button" className="ui-btn-primary inline-flex h-9 shrink-0 items-center gap-2 px-4 disabled:opacity-40" disabled={status === "saving" || Boolean(submission) || Boolean(activeCategory)} onClick={() => void submitReview()}>
        {status === "saving" ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
        {submission ? "Review submitted" : noChanges ? "Submit review" : "Send feedback to author"}
      </button>
    </>
  );

  if (!record || status === "loading") {
    return <SopReviewLoading label="Review document" error={status === "error" ? error : undefined} onClose={onClose} />;
  }

  return (
    <SopPrintPreview
      sop={record.sop}
      departmentCode={record.departmentCode}
      annexFiles={annexFiles}
      onClose={() => void handleClose()}
      mode="review"
      embedded
      taskLabel={submission ? "Review conversation" : "Review document"}
      toolbarNote={submission ? "Review submitted · Author responses appear beside your comments." : "Highlight text to add a comment."}
      footerActions={toolbar}
      marginNotes={marginNotes}
      highlightRemarks={annotations}
      onSelectReviewSection={submission ? undefined : addComment}
      onDismissReviewComment={cancelComment}
      commentDismissKey={commentDismissKey}
      commentBusy={commentSaving}
    />
  );
}
