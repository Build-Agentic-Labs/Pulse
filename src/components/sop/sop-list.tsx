"use client";

import { FileText, Loader2, Plus, Search, Trash2, Upload, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConfirm } from "@/components/confirm-provider";
import type { Department } from "@/domain/departments";
import { DEFAULT_DOC_TYPE } from "@/domain/sop/authoring";
import { getSopProcessState, SOP_PROCESS_STATE_LABELS } from "@/domain/sop/process-state";
import type { Sop } from "@/domain/sop/schema";
import type { ExtractedSop } from "@/domain/sop/extraction";
import { listDepartments, listMyDepartments } from "@/lib/departments/store";
import { createPlannerSupabaseClient, getUserFromSession } from "@/domain/supabase-planner";
import {
  deleteSop,
  listSops,
  readLegacyLocalSops,
  saveSop,
  sopFromExtraction,
  type SopListItem,
} from "@/lib/sop/store";
import { listProfileNames, listSeats, mintSopNumber } from "@/lib/sop/review";
import {
  listSopReviewAnnotations,
  listSopReviewSubmissions,
  type SopReviewAnnotation,
  type SopReviewSubmission,
} from "@/lib/sop/review-annotations";
import { SopConvertOverlay, type ConvertPhase } from "./sop-convert-overlay";
import { useSopWorkspace } from "./sop-workspace-provider";

function formatDate(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
}

/** Periodic-review flag for a next-review date: overdue (past) or due soon (within 30 days). */
function reviewFlag(iso: string | null): { label: string; className: string } | null {
  if (!iso) return null;
  const due = new Date(iso);
  if (Number.isNaN(due.getTime())) return null;
  const days = Math.ceil((due.getTime() - Date.now()) / 86_400_000);
  if (days < 0) return { label: "overdue", className: "text-danger" };
  if (days <= 30) return { label: "due soon", className: "text-warn" };
  return null;
}

function importDoneKey(workspaceId: string): string {
  return `pulse:sops:import-done:${workspaceId}`;
}

function isImportDone(workspaceId: string): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(importDoneKey(workspaceId)) === "1";
  } catch {
    return true;
  }
}

function markImportDone(workspaceId: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(importDoneKey(workspaceId), "1");
  } catch {
    // Ignore storage failures in private browsing.
  }
}

const REVIEW_FEEDBACK_LABELS: Record<string, string> = {
  document: "Document control",
  purpose: "Purpose",
  scope: "Scope",
  definitions: "Definitions",
  responsible: "Responsible parties",
  references: "References",
  measurements: "Measurements",
  procedure: "Procedure & process flow",
  annexes: "Annexes & forms",
  history: "Change history",
  overall: "Overall remarks",
};

interface ReviewParticipant {
  userId: string;
  name: string;
}

function reviewerInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}

export function SopList({ active = true }: { active?: boolean }) {
  const router = useRouter();
  const confirm = useConfirm();
  const { workspaceId, canEditSops } = useSopWorkspace();
  const editable = canEditSops;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [sops, setSops] = useState<SopListItem[]>([]);
  const [listStatus, setListStatus] = useState<"loading" | "ready" | "error">("loading");
  const [convert, setConvert] = useState<{ fileName: string; phase: ConvertPhase } | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [pendingImport, setPendingImport] = useState<Sop[]>([]);
  const [importing, setImporting] = useState(false);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [convertDepartments, setConvertDepartments] = useState<Department[] | null>(null);
  const [convertDepartmentId, setConvertDepartmentId] = useState("");
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [reviewResults, setReviewResults] = useState<Map<string, SopReviewSubmission[]>>(new Map());
  const [reviewParticipants, setReviewParticipants] = useState<Map<string, ReviewParticipant[]>>(new Map());
  const [feedbackSop, setFeedbackSop] = useState<SopListItem | null>(null);
  const [feedbackAnnotations, setFeedbackAnnotations] = useState<SopReviewAnnotation[]>([]);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackError, setFeedbackError] = useState("");
  const freshnessRef = useRef<{ workspaceId?: string; loadedAt: number }>({ loadedAt: 0 });
  const converting = convert !== null;

  const refreshList = useCallback(async (options: { background?: boolean } = {}) => {
    if (!workspaceId) {
      setSops([]);
      setCurrentUserId(null);
      setReviewResults(new Map());
      setReviewParticipants(new Map());
      setListStatus("ready");
      freshnessRef.current = { workspaceId, loadedAt: Date.now() };
      return [] as SopListItem[];
    }
    if (!options.background) {
      setListStatus("loading");
      setError("");
    }
    try {
      const next = await listSops(workspaceId);
      const supabase = createPlannerSupabaseClient();
      const userResult = await getUserFromSession(supabase);
      const userId = userResult.data.user?.id ?? null;
      const authored = userId ? next.filter((sop) => sop.createdBy === userId) : [];
      const authoredInReview = authored.filter((sop) => sop.status === "in_review");
      const [submissions, seatGroups] = await Promise.all([
        listSopReviewSubmissions(authored.map((sop) => sop.id)),
        Promise.all(authoredInReview.map(async (sop) => ({ sopId: sop.id, seats: await listSeats(sop.id) }))),
      ]);
      const profileNames = await listProfileNames(
        seatGroups.flatMap(({ seats }) => seats.flatMap((seat) => seat.signerId ? [seat.signerId] : [])),
      );
      const bySop = new Map<string, SopReviewSubmission[]>();
      for (const submission of submissions) {
        const sop = authored.find((item) => item.id === submission.sopId);
        if (
          !sop ||
          submission.reviewCycle !== sop.reviewCycle ||
          submission.contentHash !== (sop.contentHash ?? "")
        ) continue;
        bySop.set(submission.sopId, [...(bySop.get(submission.sopId) ?? []), submission]);
      }
      const participantsBySop = new Map<string, ReviewParticipant[]>();
      for (const { sopId, seats } of seatGroups) {
        const unique = new Map<string, ReviewParticipant>();
        for (const seat of seats) {
          if (!seat.signerId || unique.has(seat.signerId)) continue;
          unique.set(seat.signerId, {
            userId: seat.signerId,
            name: profileNames.get(seat.signerId) || "Assigned reviewer",
          });
        }
        participantsBySop.set(sopId, Array.from(unique.values()));
      }
      setSops(next);
      setCurrentUserId(userId);
      setReviewResults(bySop);
      setReviewParticipants(participantsBySop);
      setListStatus("ready");
      freshnessRef.current = { workspaceId, loadedAt: Date.now() };
      return next;
    } catch (caught) {
      if (!options.background) {
        setError(caught instanceof Error ? caught.message : "Could not load SOPs.");
        setListStatus("error");
      }
      return [] as SopListItem[];
    }
  }, [workspaceId]);

  const activeSops = useMemo(
    () => sops.filter(
      (sop) => sop.status === "draft" || sop.status === "in_review" || sop.status === "approved",
    ),
    [sops],
  );
  const memberDepartmentIds = useMemo(
    () => new Set((convertDepartments ?? []).map((department) => department.id)),
    [convertDepartments],
  );

  const filteredSops = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return activeSops;
    return activeSops.filter(
      (sop) => sop.title.toLowerCase().includes(needle) || sop.sopNumber.toLowerCase().includes(needle),
    );
  }, [activeSops, query]);

  const groups = useMemo(() => {
    const byDept = new Map<string, SopListItem[]>();
    for (const sop of filteredSops) {
      if (!sop.departmentId) continue;
      const list = byDept.get(sop.departmentId) ?? [];
      list.push(sop);
      byDept.set(sop.departmentId, list);
    }
    const visibleDepartments = departments.filter(
      (department) => department.code.trim().toUpperCase() !== "UNA" && department.name.trim().toLowerCase() !== "unassigned",
    );
    const ordered: { key: string; department: Department | null; sops: SopListItem[] }[] = visibleDepartments.map(
      (department) => ({
        key: department.id,
        department,
        sops: byDept.get(department.id) ?? [],
      }),
    );
    for (const [departmentId, list] of byDept) {
      if (departments.some((dept) => dept.id === departmentId)) continue;
      ordered.push({ key: departmentId, department: null, sops: list });
    }
    return ordered.filter((group) => group.sops.length > 0);
  }, [filteredSops, departments]);

  const showReviewStatus = useMemo(
    () => filteredSops.some((sop) => sop.status === "in_review"),
    [filteredSops],
  );

  // Departments power the grouped sections.
  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    void listDepartments(workspaceId)
      .then((rows) => {
        if (active) setDepartments(rows);
      })
      .catch(() => {
        /* non-fatal: the list still works without department grouping */
      });
    return () => {
      active = false;
    };
  }, [workspaceId]);

  // Conversion ownership follows the converter's explicit department membership, matching
  // new-SOP authoring. One department is automatic; several are selected in the toolbar.
  useEffect(() => {
    if (!workspaceId) {
      setConvertDepartments([]);
      setConvertDepartmentId("");
      return;
    }
    let active = true;
    setConvertDepartments(null);
    void listMyDepartments(workspaceId)
      .then((rows) => {
        if (!active) return;
        setConvertDepartments(rows);
        setConvertDepartmentId((current) =>
          rows.some((department) => department.id === current) ? current : (rows[0]?.id ?? ""),
        );
      })
      .catch(() => {
        if (!active) return;
        setConvertDepartments([]);
        setConvertDepartmentId("");
      });
    return () => {
      active = false;
    };
  }, [workspaceId]);

  // Load the workspace's SOPs, then surface any legacy localStorage SOPs not yet in this
  // workspace as a one-time import offer (id-deduped; skipped once dismissed/imported).
  useEffect(() => {
    if (!active) return;
    const hasCurrentData =
      freshnessRef.current.workspaceId === workspaceId && freshnessRef.current.loadedAt > 0;
    if (hasCurrentData && Date.now() - freshnessRef.current.loadedAt < 15_000) return;

    let alive = true;
    void refreshList({ background: hasCurrentData }).then((loaded) => {
      if (!alive || !workspaceId) return;
      if (!editable || isImportDone(workspaceId)) {
        setPendingImport([]);
        return;
      }
      const existingIds = new Set(loaded.map((sop) => sop.id));
      setPendingImport(readLegacyLocalSops().filter((sop) => !existingIds.has(sop.id)));
    });
    return () => {
      alive = false;
    };
  }, [active, refreshList, workspaceId, editable]);

  // Workflow actions often finish in another tab (review/signature workspaces). Refresh this
  // list as soon as the user returns, with a visible-tab interval as a fallback for long-lived
  // list tabs. Background refreshes preserve the current table instead of flashing a loader.
  useEffect(() => {
    if (!active || !workspaceId) return;

    const refreshInBackground = () => {
      if (document.visibilityState === "visible") void refreshList({ background: true });
    };
    const interval = window.setInterval(refreshInBackground, 15_000);
    window.addEventListener("focus", refreshInBackground);
    document.addEventListener("visibilitychange", refreshInBackground);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshInBackground);
      document.removeEventListener("visibilitychange", refreshInBackground);
    };
  }, [active, refreshList, workspaceId]);

  async function handleUpload(file: File) {
    if (!workspaceId) return;
    setConvert({ fileName: file.name, phase: "working" });
    setError("");
    try {
      const owningDepartment = convertDepartments?.find(
        (department) => department.id === convertDepartmentId,
      );
      if (!owningDepartment) {
        throw new Error("Choose one of your departments before converting this SOP.");
      }

      const supabase = createPlannerSupabaseClient();
      // Conversion calls our own API route with an explicit bearer token. Unlike normal
      // Supabase queries, that fetch cannot auto-refresh a cached token after it is attached,
      // so refresh immediately before starting the long upload/extraction request.
      const { data: sessionData, error: refreshError } = await supabase.auth.refreshSession();
      const accessToken = sessionData.session?.access_token;
      if (refreshError || !accessToken) {
        throw new Error("Your session expired. Sign in again, then retry the conversion.");
      }

      const body = new FormData();
      body.append("file", file);
      const response = await fetch("/api/sops/extract", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body,
      });
      const payload = (await response.json()) as { sop?: ExtractedSop; error?: string };
      if (!response.ok || !payload.sop) {
        throw new Error(payload.error || "Conversion failed.");
      }
      const created = sopFromExtraction(payload.sop);
      // The uploaded document's number is legacy source content. Converted SOPs enter this
      // system under the converter's department sequence, just like hand-authored SOPs.
      const sopNumber = await mintSopNumber(workspaceId, owningDepartment.id, DEFAULT_DOC_TYPE);
      const numbered = { ...created, meta: { ...created.meta, sopNumber } };
      await saveSop(numbered, workspaceId, {
        departmentId: owningDepartment.id,
        docType: DEFAULT_DOC_TYPE,
      });
      // Flip the overlay to its completed state for a beat before opening the editor.
      setConvert((current) => (current ? { ...current, phase: "done" } : current));
      await new Promise((resolve) => setTimeout(resolve, 700));
      router.push(`/sops/${created.id}?converted=1`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Conversion failed.");
      setConvert(null);
    }
  }

  async function handleDelete(sop: SopListItem) {
    if (!workspaceId) return;
    const label = sop.title || sop.sopNumber || "this SOP";
    // Soft delete under the hood (deleted_at), but it still leaves the list immediately --
    // confirm so a misclick on the row's trash icon can't silently remove a document.
    const ok = await confirm({
      title: `Delete "${label}"?`,
      body: "It will be removed from the SOP list.",
      tone: "danger",
      confirmLabel: "Delete SOP",
    });
    if (!ok) {
      return;
    }
    const previous = sops;
    setSops((current) => current.filter((entry) => entry.id !== sop.id));
    try {
      await deleteSop(sop.id);
    } catch (caught) {
      setSops(previous);
      setError(caught instanceof Error ? caught.message : "Could not delete SOP.");
    }
  }

  async function openFeedback(sop: SopListItem) {
    setFeedbackSop(sop);
    setFeedbackAnnotations([]);
    setFeedbackError("");
    setFeedbackLoading(true);
    try {
      const annotations = await listSopReviewAnnotations(sop.id);
      setFeedbackAnnotations(annotations.filter((item) => item.reviewCycle === sop.reviewCycle && !item.resolvedAt));
    } catch (caught) {
      setFeedbackError(caught instanceof Error ? caught.message : "Could not load the review feedback.");
    } finally {
      setFeedbackLoading(false);
    }
  }

  async function handleImport() {
    if (!workspaceId || pendingImport.length === 0) return;
    setImporting(true);
    setError("");
    try {
      const owningDepartment = convertDepartments?.find(
        (department) => department.id === convertDepartmentId,
      );
      if (!owningDepartment) {
        throw new Error("Choose one of your departments before importing SOPs.");
      }
      for (const sop of pendingImport) {
        await saveSop(sop, workspaceId, {
          departmentId: owningDepartment.id,
          docType: DEFAULT_DOC_TYPE,
        });
      }
      markImportDone(workspaceId);
      setPendingImport([]);
      await refreshList({ background: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  }

  function handleDismissImport() {
    if (workspaceId) {
      markImportDone(workspaceId);
    }
    setPendingImport([]);
  }

  return (
    <>
      {convert ? <SopConvertOverlay fileName={convert.fileName} phase={convert.phase} /> : null}

      <input
        ref={fileInputRef}
        type="file"
        accept=".docx,.pdf"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void handleUpload(file);
        }}
      />

      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="ui-section-title">SOPs</h1>
            <p className="ui-section-subtitle">
              Organized by department. Create a new SOP, or convert an old document into the new format.
            </p>
          </div>
          {editable ? (
            <div className="flex items-center gap-2">
              {convertDepartments && convertDepartments.length > 1 ? (
                <select
                  className="ui-field-standalone h-9 w-auto min-w-44"
                  value={convertDepartmentId}
                  disabled={converting}
                  onChange={(event) => setConvertDepartmentId(event.target.value)}
                  aria-label="Owning department for converted SOP"
                  title="Owning department"
                >
                  {convertDepartments.map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.code} · {department.name}
                    </option>
                  ))}
                </select>
              ) : null}
              <button
                type="button"
                className="ui-btn-ghost h-9 gap-1.5 px-3 disabled:opacity-50"
                disabled={converting || !workspaceId || !convertDepartmentId}
                onClick={() => fileInputRef.current?.click()}
                title={
                  convertDepartments?.length === 0
                    ? "Join a department before converting SOPs"
                    : "Convert an existing document"
                }
              >
                {converting ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                {converting ? "Converting…" : "Convert"}
              </button>
              <Link href="/sops/new" className="ui-btn-primary h-9 gap-1.5 px-3">
                <Plus size={14} strokeWidth={2} />
                New SOP
              </Link>
            </div>
          ) : null}
        </div>

        {error ? <div className="ui-notice ui-notice-warn px-4 py-3 ui-section-subtitle">{error}</div> : null}

        {listStatus === "ready" && activeSops.length > 0 ? (
          <div className="relative max-w-sm">
            <Search
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-tertiary"
              strokeWidth={1.75}
            />
            <input
              type="search"
              className="ui-field-standalone h-9 w-full pl-9 pr-3 font-normal"
              placeholder="Search by SOP number or title"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        ) : null}

        {editable && pendingImport.length > 0 ? (
          <div className="ui-notice ui-notice-warn flex flex-wrap items-center gap-3 px-4 py-3">
            <p className="ui-section-subtitle min-w-0 flex-1 text-ink-secondary">
              Import {pendingImport.length} local SOP{pendingImport.length === 1 ? "" : "s"} into this organization?
            </p>
            <button
              type="button"
              className="ui-btn-primary h-8 gap-1.5 px-3 disabled:opacity-50"
              onClick={() => void handleImport()}
              disabled={importing}
            >
              {importing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              {importing ? "Importing…" : "Import"}
            </button>
            <button type="button" className="ui-btn-ghost h-8 px-3" onClick={handleDismissImport} disabled={importing}>
              Dismiss
            </button>
          </div>
        ) : null}

        {listStatus === "loading" ? (
          <section className="flex min-h-40 items-center justify-center border-t border-line px-4">
            <Loader2 size={18} className="animate-spin text-ink-tertiary" />
          </section>
        ) : listStatus === "error" ? (
          <section className="flex min-h-40 flex-col items-center justify-center border-t border-line px-4 text-center">
            <p className="ui-section-subtitle text-ink-tertiary">{error || "Could not load SOPs."}</p>
            <button type="button" className="ui-btn-ghost mt-3 inline-flex h-9 px-3" onClick={() => void refreshList()}>
              Retry
            </button>
          </section>
        ) : activeSops.length === 0 ? (
          <section className="flex min-h-40 flex-col items-center justify-center border-t border-line px-4 text-center">
            <FileText size={20} className="mx-auto text-ink-tertiary" />
            <p className="mt-2 ui-section-subtitle text-ink-tertiary">
              No draft SOPs. {editable ? "Create one or convert an existing .docx / .pdf." : "Ask an editor to add one."}
            </p>
          </section>
        ) : filteredSops.length === 0 ? (
          <section className="flex min-h-40 items-center justify-center border-t border-line px-4 text-center">
            <p className="ui-section-subtitle text-ink-tertiary">No SOPs match &ldquo;{query.trim()}&rdquo;.</p>
          </section>
        ) : (
          <div className="overflow-hidden border-y border-line bg-surface">
            <div className="ui-table-scroll">
              <table className={`w-full border-collapse text-left ${showReviewStatus ? "min-w-[780px]" : "min-w-[680px]"}`}>
                        <thead>
                          <tr className="border-b border-line">
                            <th className="w-36 px-5 py-3 text-[11px] font-medium text-ink-secondary">Number</th>
                            <th className="px-5 py-3 text-[11px] font-medium text-ink-secondary">Title</th>
                            <th className="w-32 px-5 py-3 text-[11px] font-medium text-ink-secondary">Status</th>
                            <th className="w-28 px-5 py-3 text-[11px] font-medium text-ink-secondary">Updated</th>
                            {showReviewStatus ? (
                              <th className="w-36 px-3 py-3 text-[11px] font-medium text-ink-secondary">Review Status</th>
                            ) : null}
                            <th className="w-24 px-3 py-3"><span className="sr-only">Actions</span></th>
                          </tr>
                        </thead>
                        <tbody>
                          {groups.map((group) => {
                            const name =
                              group.department?.name ??
                              (group.key === "unassigned" ? "Unassigned" : "Unknown department");
                            const count = group.sops.length;
                            return (
                              <Fragment key={group.key}>
                                <tr className="border-b border-line bg-canvas/70">
                                  <th
                                    colSpan={showReviewStatus ? 6 : 5}
                                    className="px-5 py-2.5 text-left"
                                  >
                                    <div className="flex items-center justify-between gap-3">
                                      <span className="truncate text-sm font-semibold text-ink">{name}</span>
                                      <span className="shrink-0 text-xs font-normal tabular-nums text-ink-tertiary">
                                        {count} {count === 1 ? "SOP" : "SOPs"}
                                      </span>
                                    </div>
                                  </th>
                                </tr>
                                {group.sops.map((sop) => {
                              const processState = getSopProcessState(sop);
                              const flag = reviewFlag(sop.nextReviewDate);
                              const rowReviewResults = reviewResults.get(sop.id) ?? [];
                              const rowReviewers = reviewParticipants.get(sop.id) ?? [];
                              const isViewOnly = Boolean(
                                sop.departmentId && !memberDepartmentIds.has(sop.departmentId),
                              );
                              const editorHref = isViewOnly
                                ? `/sops/${sop.id}?preview=pdf`
                                : processState === "draft_review"
                                  ? `/sops/${sop.id}?step=draft-review`
                                  : processState === "final_approval"
                                    ? `/sops/${sop.id}?step=final-approval`
                                    : processState === "awaiting_quality"
                                      ? `/sops/${sop.id}?step=quality-approval`
                                    : `/sops/${sop.id}`;
                              const openInNewTab =
                                !isViewOnly && (
                                  processState === "draft_review" ||
                                  processState === "final_approval" ||
                                  processState === "awaiting_quality"
                                );
                              const canEditRow =
                                editable &&
                                sop.status === "draft" &&
                                (!sop.departmentId || memberDepartmentIds.has(sop.departmentId));
                              return (
                                <tr
                                  key={sop.id}
                                  className="group border-b border-line/70 transition-colors last:border-b-0 hover:bg-surface-hover"
                                >
                                <td className="px-5 py-3.5 align-middle">
                                  <Link
                                    href={editorHref}
                                    target={openInNewTab ? "_blank" : undefined}
                                    rel={openInNewTab ? "noopener noreferrer" : undefined}
                                    className="text-xs font-medium text-ink-secondary hover:text-ink"
                                  >
                                    {sop.sopNumber || "—"}
                                  </Link>
                                </td>
                                <td className="max-w-0 px-5 py-3.5 align-middle">
                                  <Link
                                    href={editorHref}
                                    target={openInNewTab ? "_blank" : undefined}
                                    rel={openInNewTab ? "noopener noreferrer" : undefined}
                                    className="block min-w-0"
                                  >
                                    <span className="block truncate text-[13px] font-medium leading-snug text-ink">
                                      {sop.title || sop.sopNumber || "Untitled SOP"}
                                    </span>
                                    {flag ? (
                                      <span className={`mt-1 block text-[11px] ${flag.className}`}>{flag.label}</span>
                                    ) : null}
                                  </Link>
                                </td>
                                <td className="px-5 py-3.5 align-middle">
                                  <div className="flex flex-nowrap items-center gap-1.5 whitespace-nowrap">
                                    <span className="inline-flex shrink-0 items-center rounded bg-surface-muted px-2 py-1 text-[11px] font-medium text-ink-secondary">
                                      {SOP_PROCESS_STATE_LABELS[processState]}
                                    </span>
                                  </div>
                                </td>
                                <td className="px-5 py-3.5 align-middle text-[12px] tabular-nums text-ink-tertiary">
                                  {formatDate(sop.updatedAt) || "—"}
                                </td>
                                {showReviewStatus ? (
                                  <td className="px-3 py-2.5 align-middle">
                                    {sop.status === "in_review" && sop.createdBy === currentUserId && rowReviewers.length ? (
                                      <button
                                        type="button"
                                        className="flex -space-x-1.5 rounded-full p-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                                        aria-label={`View review status for ${sop.title || sop.sopNumber}`}
                                        onClick={() => void openFeedback(sop)}
                                      >
                                        {rowReviewers.slice(0, 4).map((reviewer) => {
                                          const result = rowReviewResults.find((item) => item.reviewerId === reviewer.userId);
                                          const label = !result
                                            ? `${reviewer.name}: still reviewing`
                                            : result.noChanges
                                              ? `${reviewer.name}: no changes needed`
                                              : `${reviewer.name}: feedback returned`;
                                          return (
                                            <span
                                              key={reviewer.userId}
                                              className={`inline-flex h-7 w-7 items-center justify-center rounded-full border-2 border-surface text-[9px] font-semibold ${
                                                !result
                                                  ? "bg-zinc-400 text-white"
                                                  : result.noChanges
                                                    ? "bg-emerald-600 text-white"
                                                    : "bg-red-600 text-white"
                                              }`}
                                              title={label}
                                            >
                                              {reviewerInitials(reviewer.name)}
                                            </span>
                                          );
                                        })}
                                        {rowReviewers.length > 4 ? (
                                          <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border-2 border-surface bg-surface-muted text-[9px] font-semibold text-ink-secondary">
                                            +{rowReviewers.length - 4}
                                          </span>
                                        ) : null}
                                      </button>
                                    ) : null}
                                  </td>
                                ) : null}
                                <td className="px-2 py-2.5 align-middle">
                                  <div className="flex items-center justify-end gap-1">
                                    <div className="flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                                      {canEditRow ? (
                                        <button
                                          type="button"
                                          className="ui-btn-ghost h-8 w-8 px-0 text-ink-tertiary hover:text-danger"
                                          title="Delete SOP"
                                          onClick={() => void handleDelete(sop)}
                                        >
                                          <Trash2 size={13} />
                                        </button>
                                      ) : null}
                                    </div>
                                  </div>
                                </td>
                                </tr>
                                  );
                                })}
                              </Fragment>
                            );
                          })}
                        </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {feedbackSop ? (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Review feedback for ${feedbackSop.title || feedbackSop.sopNumber}`}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setFeedbackSop(null);
          }}
        >
          <section className="ui-panel flex max-h-[82vh] w-full max-w-2xl flex-col overflow-hidden shadow-2xl">
            <div className="flex flex-none items-start justify-between gap-4 border-b border-line px-5 py-4">
              <div className="min-w-0">
                <div className="ui-mono-label text-ink-tertiary">Review feedback</div>
                <h2 className="mt-1 truncate text-base font-semibold text-ink">
                  {feedbackSop.title || feedbackSop.sopNumber || "Untitled SOP"}
                </h2>
                <p className="ui-section-subtitle mt-0.5 text-ink-secondary">
                  {[feedbackSop.sopNumber, feedbackSop.version ? `v${feedbackSop.version}` : ""]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <button
                type="button"
                className="ui-btn-ghost h-9 w-9 shrink-0 px-0"
                aria-label="Close review feedback"
                onClick={() => setFeedbackSop(null)}
              >
                <X size={16} className="mx-auto" />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-auto p-5">
              {feedbackLoading ? (
                <div className="flex justify-center py-10">
                  <Loader2 size={18} className="animate-spin text-ink-tertiary" />
                </div>
              ) : feedbackError ? (
                <div className="ui-notice ui-notice-warn px-3 py-2 text-xs">{feedbackError}</div>
              ) : (
                (reviewParticipants.get(feedbackSop.id) ?? []).map((reviewer) => {
                  const result = (reviewResults.get(feedbackSop.id) ?? []).find(
                    (item) => item.reviewerId === reviewer.userId,
                  );
                  const remarks = result ? feedbackAnnotations.filter(
                    (annotation) => annotation.createdBy === reviewer.userId,
                  ) : [];
                  return (
                    <article key={reviewer.userId} className="rounded-lg border border-line p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="text-sm font-medium text-ink">{reviewer.name}</div>
                          <div className="ui-section-subtitle mt-0.5 text-ink-tertiary">
                            {result ? `Returned ${formatDate(result.submittedAt)}` : "Review in progress"}
                          </div>
                        </div>
                        <span className={`ui-chip ${
                          !result
                            ? "border-line text-ink-tertiary"
                            : result.noChanges
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : "border-red-200 bg-red-50 text-red-700"
                        }`}>
                          {!result ? "Still reviewing" : result.noChanges ? "No changes needed" : "Feedback returned"}
                        </span>
                      </div>

                      {!result ? (
                        <p className="mt-3 text-sm text-ink-secondary">This reviewer has not returned their review yet.</p>
                      ) : result.noChanges ? (
                        <p className="mt-3 text-sm text-ink-secondary">The reviewer returned this SOP without remarks.</p>
                      ) : remarks.length ? (
                        <div className="mt-3 space-y-3 border-t border-line pt-3">
                          {remarks.map((remark) => (
                            <div key={remark.id}>
                              <div className="text-xs font-medium text-ink">
                                {REVIEW_FEEDBACK_LABELS[remark.category] ?? "Overall remarks"}
                              </div>
                              <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-ink-secondary">{remark.body}</p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-3 text-sm text-ink-secondary">No section remarks were found.</p>
                      )}
                    </article>
                  );
                })
              )}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
