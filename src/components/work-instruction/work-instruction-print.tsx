"use client";

/**
 * Screen preview + print trigger for one or more assembly work instructions.
 *
 * Owns the data load; `WorkInstructionDocument` stays a pure render. Planner
 * state is reloaded here rather than threaded through the workspace so the
 * print URL is shareable and survives a refresh.
 *
 * See docs/superpowers/specs/2026-08-04-assembly-work-instruction-design.md
 */

import { ArrowLeft, Printer, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { loadPlannerStateFromSupabase } from "@/domain/supabase-planner";
import type { PlannerState } from "@/domain/types";
import { buildWorkInstruction } from "@/domain/work-instruction/build";
import type { WorkInstructionReferenceRecord } from "@/domain/work-instruction/references";
import {
  releaseStateFor,
  releasedDocument,
  revisionLabel,
  withReleaseMeta,
  type WorkInstructionRelease,
  type WorkInstructionReleaseState,
  type WorkInstructionReleaseSummary,
} from "@/domain/work-instruction/release";
import {
  DEFAULT_WORK_INSTRUCTION_LAYOUT,
  WORK_INSTRUCTION_LAYOUTS,
  type WorkInstruction,
  type WorkInstructionLayout,
} from "@/domain/work-instruction/schema";
import {
  getWorkInstructionRelease,
  listWorkInstructionReferences,
  listWorkInstructionReleases,
} from "@/lib/work-instruction/store";
import { WorkInstructionDocument } from "./work-instruction-document";

type LoadStatus = "loading" | "ready" | "empty" | "error";

export interface WorkInstructionPrintPreviewProps {
  projectId: string;
  scenarioId?: string;
  taskIds: string[];
  /** Renders the fill-in form instead of loading planner data. */
  blank?: boolean;
  /** Server-fetched first paint. An accelerant — the client load is the fallback, never skipped when this is absent. */
  initialPlannerState?: PlannerState;
  /** Card-grid variant. Defaults to whatever the app generates today. */
  layout?: WorkInstructionLayout;
  onReady?: () => void;
  /** When provided, render as an in-place modal preview instead of the standalone print route. */
  onClose?: () => void;
  /**
   * Show exactly this released revision (its frozen content), ignoring the live planner data.
   * Used by the revision history and by shareable `?release=` print links.
   */
  pinnedReleaseId?: string;
}

/** Build the requested instructions out of a loaded planner state, in the order asked for. */
function buildFromState(
  state: PlannerState,
  taskIds: string[],
  layout: WorkInstructionLayout,
  references: readonly WorkInstructionReferenceRecord[] = [],
): WorkInstruction[] {
  const zoneById = new Map(state.zones.map((zone) => [zone.id, zone]));
  return taskIds
    .map((taskId) => state.tasks.find((task) => task.id === taskId))
    .filter((task): task is NonNullable<typeof task> => Boolean(task))
    .map((task) =>
      buildWorkInstruction({
        task,
        product: state.product,
        zone: task.zoneId ? zoneById.get(task.zoneId) : undefined,
        layout,
        references: references.filter((reference) => reference.taskId === task.id),
      }),
    );
}

/**
 * The server prefetch loads the project's default scenario. If the URL asks for
 * a specific one, the prefetch is only usable when it happens to be that
 * scenario — otherwise we would print the wrong scenario's steps.
 */
function serverStateIsUsable(state: PlannerState | undefined, scenarioId?: string): state is PlannerState {
  if (!state) return false;
  return !scenarioId || state.scenario.id === scenarioId;
}

function PrintToolbar({
  backHref,
  label,
  layout,
  hrefForLayout,
  onLayoutChange,
  onClose,
  canPrint,
  layoutLocked = false,
  controlNote = "",
  view,
  onViewChange,
}: {
  backHref: string;
  label: string;
  layout: WorkInstructionLayout;
  hrefForLayout: (layoutId: string) => string;
  onLayoutChange: (layout: WorkInstructionLayout) => void;
  onClose?: () => void;
  canPrint: boolean;
  /** A frozen release is pre-split for the default layout, so the switcher is disabled. */
  layoutLocked?: boolean;
  /** "Released Rev B", "Draft · modified since Rev B"; empty when there is nothing to say. */
  controlNote?: string;
  /** Present only when a draft differs from its release; lets the reader flip between them. */
  view?: "draft" | "released";
  onViewChange?: (view: "draft" | "released") => void;
}) {
  return (
    <div className="wi-print-chrome sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-2">
      {onClose ? (
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink" title={label}>
          {label}
        </span>
      ) : (
        <Link href={backHref} className="ui-btn-ghost h-8 gap-1.5 px-3">
          <ArrowLeft size={13} />
          Back
        </Link>
      )}

      <div className="flex items-center gap-1 rounded border border-line p-0.5" role="group" aria-label="Steps per sheet">
        {Object.values(WORK_INSTRUCTION_LAYOUTS)
          .sort((left, right) => left.cardsPerSheet - right.cardsPerSheet)
          .map((option) => {
            const className = `h-7 rounded px-2.5 text-xs leading-7 transition ${
              option.id === layout.id ? "bg-surface-sunken font-semibold text-ink" : "text-ink-tertiary hover:text-ink"
            }`;

            return onClose || layoutLocked ? (
              <button
                key={option.id}
                type="button"
                aria-pressed={option.id === layout.id}
                className={`${className} disabled:cursor-not-allowed disabled:opacity-40`}
                disabled={layoutLocked && option.id !== layout.id}
                title={layoutLocked ? "A released revision prints in the layout it was released in" : undefined}
                onClick={() => onLayoutChange(option)}
              >
                {option.label}
              </button>
            ) : (
              <Link
                key={option.id}
                href={hrefForLayout(option.id)}
                aria-current={option.id === layout.id ? "page" : undefined}
                className={className}
              >
                {option.label}
              </Link>
            );
          })}
      </div>

      {view && onViewChange ? (
        <div className="flex items-center gap-1 rounded border border-line p-0.5" role="group" aria-label="Draft or released">
          {(["draft", "released"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={view === option}
              className={`h-7 rounded px-2.5 text-xs leading-7 transition ${
                view === option ? "bg-surface-sunken font-semibold text-ink" : "text-ink-tertiary hover:text-ink"
              }`}
              onClick={() => onViewChange(option)}
            >
              {option === "draft" ? "Draft" : "Released"}
            </button>
          ))}
        </div>
      ) : null}

      {controlNote ? (
        <span className="ui-chip shrink-0 border-line bg-surface-raised text-ink-secondary" data-testid="wi-control-note">
          {controlNote}
        </span>
      ) : null}

      {onClose ? null : <span className="flex-1" />}

      {onClose ? null : <span className="ui-mono-label text-ink-tertiary">{label}</span>}
      <button
        type="button"
        className="ui-btn-primary h-8 gap-1.5 px-3 disabled:cursor-wait disabled:opacity-40"
        onClick={() => window.print()}
        disabled={!canPrint}
        title={canPrint ? undefined : "Wait for the work instruction to finish loading"}
      >
        <Printer size={13} />
        Print / Save PDF
      </button>
      {onClose ? (
        <button type="button" className="ui-btn-ghost h-8 w-8 px-0" onClick={onClose} aria-label="Close preview">
          <X size={15} className="mx-auto" />
        </button>
      ) : null}
    </div>
  );
}

function PreviewSkeletonBar({ className, rectangular = false }: { className: string; rectangular?: boolean }) {
  return (
    <span
      className={`ui-skeleton-line block ${className}`}
      style={rectangular ? { borderRadius: 2 } : undefined}
      aria-hidden="true"
    />
  );
}

function WorkInstructionPreviewSkeleton({
  layout,
  modal,
  scale,
}: {
  layout: WorkInstructionLayout;
  modal: boolean;
  scale: number;
}) {
  return (
    <div
      className="wi-preview-skeleton wi-print-chrome"
      style={{ margin: "0 auto", width: "17in", zoom: modal ? scale : 1 }}
      aria-busy="true"
      aria-label="Loading work instruction preview"
      role="status"
    >
      <div
        className="box-border flex w-[17in] flex-col gap-[0.12in] bg-white shadow-[0_8px_40px_rgba(0,0,0,0.25)]"
        style={{ height: "11in", padding: "0.45in 0.5in 0.35in" }}
      >
        <div
          className="grid shrink-0 border border-[#c8c8c8]"
          style={{ height: "1.05in", gridTemplateColumns: "1.9in 1fr 1.9in 3.4in 2in" }}
        >
          <div className="flex items-center justify-center border-r border-[#c8c8c8] px-3">
            <PreviewSkeletonBar className="h-8 w-28" />
          </div>
          <div className="flex flex-col justify-center gap-3 border-r border-[#c8c8c8] px-4">
            <PreviewSkeletonBar className="h-4 w-3/5" />
            <PreviewSkeletonBar className="h-3 w-2/5" />
          </div>
          <div className="flex flex-col justify-center gap-2 border-r border-[#c8c8c8] px-3">
            <PreviewSkeletonBar className="h-2.5 w-full" />
            <PreviewSkeletonBar className="h-2.5 w-4/5" />
            <PreviewSkeletonBar className="h-2.5 w-3/5" />
          </div>
          <div className="grid grid-cols-3 gap-px border-r border-[#c8c8c8] bg-[#d8d8d8] p-px">
            {Array.from({ length: 9 }, (_, index) => (
              <div className="flex items-center bg-white px-2" key={index}>
                <PreviewSkeletonBar className="h-2 w-full" />
              </div>
            ))}
          </div>
          <div className="flex flex-col justify-center gap-2 px-3">
            <PreviewSkeletonBar className="h-2.5 w-full" />
            <PreviewSkeletonBar className="h-2.5 w-4/5" />
            <PreviewSkeletonBar className="h-2.5 w-3/5" />
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-rows-2 gap-[0.12in]">
          <div className="grid grid-cols-5 gap-[0.12in]">
            {Array.from({ length: 5 }, (_, index) => (
              <div className="flex flex-col gap-3 border border-[#c8c8c8] p-3" key={index}>
                <PreviewSkeletonBar className="h-3 w-2/5" />
                <PreviewSkeletonBar className="h-2.5 w-4/5" />
                <PreviewSkeletonBar className="h-2.5 w-3/5" />
              </div>
            ))}
          </div>
          <div className="grid gap-[0.12in]" style={{ gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))` }}>
            {Array.from({ length: layout.cardsOnFirstSheet }, (_, index) => (
              <div className="flex min-h-0 flex-col gap-3 border border-[#c8c8c8] p-3" key={index}>
                <div className="flex items-center gap-3">
                  <PreviewSkeletonBar className="h-6 w-6" />
                  <PreviewSkeletonBar className="h-3 w-2/5" />
                </div>
                <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
                  <PreviewSkeletonBar className="h-full w-full" rectangular />
                  <div className="flex flex-col gap-3 pt-2">
                    <PreviewSkeletonBar className="h-2.5 w-full" />
                    <PreviewSkeletonBar className="h-2.5 w-5/6" />
                    <PreviewSkeletonBar className="h-2.5 w-2/3" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex h-[0.3in] shrink-0 items-center justify-between border-t border-[#c8c8c8] pt-2">
          <PreviewSkeletonBar className="h-2 w-36" />
          <PreviewSkeletonBar className="h-2 w-1/3" />
          <PreviewSkeletonBar className="h-2 w-20" />
        </div>
      </div>
    </div>
  );
}

/**
 * A work instruction with no task behind it: every slot ruled and empty, for
 * printing and filling in by hand. Same renderer, no data.
 */
function blankInstruction(): WorkInstruction {
  return {
    taskId: "blank",
    meta: {
      documentNumber: "",
      title: "",
      revision: "",
      effectiveDate: "",
      preparedBy: "",
      reviewedBy: "",
      approvedBy: "",
      revisionHistory: [],
    },
    context: { productName: "", productCode: "", productRevision: "", zoneName: "", manufacturingCode: "" },
    setup: {
      purpose: "",
      safetyNotes: "",
      tools: [],
      parts: [],
      drawingLink: "",
      sopLink: "",
      plannedDurationMinutes: 0,
      plannedOperators: 0,
      qualityGate: false,
    },
    cards: [],
    blank: true,
  };
}

/** Release rows and references for a project; `null` until loaded (or when the load failed). */
interface ControlData {
  releases: WorkInstructionReleaseSummary[];
  references: WorkInstructionReferenceRecord[];
}

const NO_REFERENCES: readonly WorkInstructionReferenceRecord[] = [];

export function WorkInstructionPrintPreview({
  projectId,
  scenarioId,
  taskIds,
  blank,
  initialPlannerState,
  layout: initialLayout = DEFAULT_WORK_INSTRUCTION_LAYOUT,
  onReady,
  onClose,
  pinnedReleaseId,
}: WorkInstructionPrintPreviewProps) {
  const [layout, setLayout] = useState(initialLayout);
  const seeded = blank
    ? [blankInstruction()]
    : serverStateIsUsable(initialPlannerState, scenarioId)
      ? buildFromState(initialPlannerState, taskIds, layout)
      : [];

  const [instructions, setInstructions] = useState<WorkInstruction[]>(seeded);
  // The same tasks built with the DEFAULT layout: releases are fingerprinted and frozen in that
  // layout, so release state must be judged against it whatever layout is on screen.
  const [baselines, setBaselines] = useState<WorkInstruction[]>(
    layout.id === DEFAULT_WORK_INSTRUCTION_LAYOUT.id || blank || !serverStateIsUsable(initialPlannerState, scenarioId)
      ? seeded
      : buildFromState(initialPlannerState, taskIds, DEFAULT_WORK_INSTRUCTION_LAYOUT),
  );
  const [status, setStatus] = useState<LoadStatus>(blank || seeded.length > 0 ? "ready" : "loading");
  const [error, setError] = useState("");
  const [previewScale, setPreviewScale] = useState(1);
  const [control, setControl] = useState<ControlData | null>(null);
  const [view, setView] = useState<"draft" | "released">("draft");
  const [fullReleases, setFullReleases] = useState<ReadonlyMap<string, WorkInstructionRelease>>(new Map());
  const [pinnedMissing, setPinnedMissing] = useState(false);
  const previewBodyRef = useRef<HTMLDivElement | null>(null);
  const loadedStateRef = useRef<PlannerState | undefined>(
    serverStateIsUsable(initialPlannerState, scenarioId) ? initialPlannerState : undefined,
  );

  // Stale-response guard, same idiom as work-order-print.tsx: only the latest
  // load may commit state.
  const loadSeqRef = useRef(0);
  // Seeded first paint means the client load is redundant on mount; a manual
  // Retry still forces one.
  const seededRef = useRef(seeded.length > 0 || Boolean(blank));

  const references = control?.references ?? NO_REFERENCES;

  // Document control is an overlay, never a dependency: a failed load leaves the header's control
  // fields blank rather than claiming "Draft" or a revision we could not confirm.
  useEffect(() => {
    if (blank || !projectId) return;
    let alive = true;
    Promise.all([listWorkInstructionReleases(projectId), listWorkInstructionReferences(projectId)])
      .then(([releases, loadedReferences]) => {
        if (alive) setControl({ releases, references: loadedReferences });
      })
      .catch(() => {
        if (alive) setControl(null);
      });
    return () => {
      alive = false;
    };
  }, [blank, projectId]);

  const commit = useCallback(
    (state: PlannerState) => {
      const built = buildFromState(state, taskIds, layout, references);
      setInstructions(built);
      setBaselines(
        layout.id === DEFAULT_WORK_INSTRUCTION_LAYOUT.id
          ? built
          : buildFromState(state, taskIds, DEFAULT_WORK_INSTRUCTION_LAYOUT, references),
      );
      setStatus(built.length > 0 ? "ready" : "empty");
    },
    [layout, references, taskIds],
  );

  const refresh = useCallback(async () => {
    if (blank) {
      setInstructions([blankInstruction()]);
      setBaselines([]);
      setStatus("ready");
      return;
    }
    if (serverStateIsUsable(initialPlannerState, scenarioId)) {
      loadedStateRef.current = initialPlannerState;
      commit(initialPlannerState);
      return;
    }
    if (serverStateIsUsable(loadedStateRef.current, scenarioId)) {
      commit(loadedStateRef.current);
      return;
    }
    const seq = ++loadSeqRef.current;
    if (!projectId || taskIds.length === 0) {
      setInstructions([]);
      setBaselines([]);
      setStatus("empty");
      return;
    }
    setStatus("loading");
    setError("");
    try {
      const state = await loadPlannerStateFromSupabase(projectId, scenarioId);
      if (seq !== loadSeqRef.current) return;
      if (!state) {
        setInstructions([]);
        setBaselines([]);
        setStatus("empty");
        return;
      }
      loadedStateRef.current = state;
      commit(state);
    } catch (caught) {
      if (seq !== loadSeqRef.current) return;
      setError(caught instanceof Error ? caught.message : "Could not load the work instruction.");
      setStatus("error");
    }
  }, [blank, commit, initialPlannerState, projectId, scenarioId, taskIds]);

  useEffect(() => {
    setLayout(initialLayout);
  }, [initialLayout]);

  useEffect(() => {
    if (seededRef.current) {
      seededRef.current = false;
      return;
    }
    void refresh();
    return () => {
      loadSeqRef.current += 1;
    };
  }, [refresh]);

  const releasesByTask = useMemo(() => {
    const grouped = new Map<string, WorkInstructionReleaseSummary[]>();
    for (const release of control?.releases ?? []) {
      grouped.set(release.taskId, [...(grouped.get(release.taskId) ?? []), release]);
    }
    return grouped;
  }, [control]);

  const states = useMemo(() => {
    const byTask = new Map<string, WorkInstructionReleaseState>();
    if (!control) return byTask;
    for (const baseline of baselines) {
      byTask.set(baseline.taskId, releaseStateFor(baseline, releasesByTask.get(baseline.taskId) ?? []));
    }
    return byTask;
  }, [baselines, control, releasesByTask]);

  const modifiedStates = [...states.values()].filter(
    (state): state is Extract<WorkInstructionReleaseState, { kind: "modified" }> => state.kind === "modified",
  );

  // The frozen documents this view needs: the pinned one, or — in "Released" view — the latest
  // release of every instruction that has drifted from it.
  const neededReleaseIds = useMemo(
    () => (pinnedReleaseId ? [pinnedReleaseId] : view === "released" ? modifiedStates.map((state) => state.release.id) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the ids, not the array identity
    [pinnedReleaseId, view, modifiedStates.map((state) => state.release.id).join(",")],
  );

  useEffect(() => {
    const missing = neededReleaseIds.filter((id) => !fullReleases.has(id));
    if (missing.length === 0) return;
    let alive = true;
    Promise.all(missing.map((id) => getWorkInstructionRelease(id).catch(() => null))).then((loaded) => {
      if (!alive) return;
      const found = loaded.filter((release): release is WorkInstructionRelease => Boolean(release));
      if (pinnedReleaseId && !found.some((release) => release.id === pinnedReleaseId)) setPinnedMissing(true);
      if (found.length === 0) return;
      setFullReleases((current) => {
        const next = new Map(current);
        for (const release of found) next.set(release.id, release);
        return next;
      });
    });
    return () => {
      alive = false;
    };
  }, [fullReleases, neededReleaseIds, pinnedReleaseId]);

  const pinnedRelease = pinnedReleaseId ? fullReleases.get(pinnedReleaseId) : undefined;

  // What is actually drawn: each entry carries the layout it must be paginated with, because a
  // frozen release is pre-split for the default layout.
  const documents: Array<{ instruction: WorkInstruction; layout: WorkInstructionLayout }> = useMemo(() => {
    if (pinnedReleaseId) {
      return pinnedRelease
        ? [
            {
              instruction: releasedDocument(pinnedRelease, releasesByTask.get(pinnedRelease.taskId) ?? [pinnedRelease]),
              layout: DEFAULT_WORK_INSTRUCTION_LAYOUT,
            },
          ]
        : [];
    }
    return instructions.map((instruction) => {
      const state = states.get(instruction.taskId);
      const taskReleases = releasesByTask.get(instruction.taskId) ?? [];
      if (view === "released" && state?.kind === "modified") {
        const frozen = fullReleases.get(state.release.id);
        if (frozen) return { instruction: releasedDocument(frozen, taskReleases), layout: DEFAULT_WORK_INSTRUCTION_LAYOUT };
      }
      return { instruction: state ? withReleaseMeta(instruction, taskReleases, state) : instruction, layout };
    });
  }, [fullReleases, instructions, layout, pinnedRelease, pinnedReleaseId, releasesByTask, states, view]);

  // A pinned release does not depend on the planner at all — its task may even be gone.
  const effectiveStatus: LoadStatus = pinnedReleaseId ? (pinnedRelease ? "ready" : pinnedMissing ? "empty" : "loading") : status;

  useEffect(() => {
    if (effectiveStatus === "ready") onReady?.();
  }, [effectiveStatus, onReady]);

  useEffect(() => {
    if (!onClose) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (!onClose || typeof ResizeObserver === "undefined") return;
    const previewBody = previewBodyRef.current;
    if (!previewBody) return;

    const fitPreviewToWidth = () => {
      // Ledger landscape is 17in = 1632 CSS px. The modal body contributes
      // 32px of padding on each side, matching the SOP preview's inset paper.
      const availableWidth = Math.max(0, previewBody.clientWidth - 64);
      setPreviewScale(Math.min(1, availableWidth / (17 * 96)));
    };

    fitPreviewToWidth();
    const resizeObserver = new ResizeObserver(fitPreviewToWidth);
    resizeObserver.observe(previewBody);
    return () => resizeObserver.disconnect();
  }, [onClose]);

  // Layout lives in the URL so a preview link carries the variant it was shared as.
  const hrefForLayout = (layoutId: string) => {
    const params = new URLSearchParams();
    if (taskIds.length > 0) params.set("taskIds", taskIds.join(","));
    if (scenarioId) params.set("scenarioId", scenarioId);
    if (blank) params.set("blank", "1");
    if (layoutId !== DEFAULT_WORK_INSTRUCTION_LAYOUT.id) params.set("v", layoutId.replace(/^v/, ""));
    return `/projects/${projectId}/planner/work-instructions/print?${params.toString()}`;
  };

  const label =
    effectiveStatus !== "ready"
      ? taskIds.length === 1 || pinnedReleaseId
        ? "Work instruction preview"
        : `${taskIds.length} work instructions`
      : documents.length === 1
      ? documents[0].instruction.meta.documentNumber || documents[0].instruction.meta.title || "Work instruction"
      : `${documents.length} work instructions`;

  // One short line saying what the reader is looking at, so a draft is never mistaken for a release.
  const soleState = documents.length === 1 ? states.get(documents[0].instruction.taskId) : undefined;
  const controlNote = pinnedRelease
    ? `Released ${revisionLabel(pinnedRelease.revision)}`
    : blank || !control || effectiveStatus !== "ready"
      ? ""
      : soleState
        ? soleState.kind === "released"
          ? `Released ${revisionLabel(soleState.release.revision)}`
          : soleState.kind === "modified"
            ? view === "released"
              ? `Released ${revisionLabel(soleState.release.revision)}`
              : `Draft · modified since ${revisionLabel(soleState.release.revision)}`
            : "Draft · not released"
        : modifiedStates.length > 0
          ? `${modifiedStates.length} modified since release`
          : "";

  const showingFrozen = Boolean(pinnedReleaseId) || (view === "released" && modifiedStates.length > 0);

  const preview = (
    <div
      className={`wi-print-root ${
        onClose
          ? "wi-print-modal fixed inset-0 z-[60] flex flex-col bg-black/60"
          : "h-[100dvh] overflow-y-auto bg-canvas"
      }`}
      role={onClose ? "dialog" : undefined}
      aria-modal={onClose ? "true" : undefined}
      aria-label={onClose ? "Work instruction document preview" : undefined}
    >
      <PrintToolbar
        backHref={`/projects/${projectId}/planner`}
        label={blank ? "Blank template" : label}
        layout={showingFrozen ? DEFAULT_WORK_INSTRUCTION_LAYOUT : layout}
        layoutLocked={showingFrozen}
        hrefForLayout={hrefForLayout}
        onLayoutChange={setLayout}
        onClose={onClose}
        canPrint={effectiveStatus === "ready"}
        controlNote={controlNote}
        view={!pinnedReleaseId && modifiedStates.length > 0 ? view : undefined}
        onViewChange={setView}
      />
      {/* wi-print-body: the print stylesheet zeroes this padding, which would
          otherwise spill past the last sheet and print a blank trailing page. */}
      <div
        ref={previewBodyRef}
        className={`wi-print-body px-8 py-8 ${onClose ? "min-h-0 flex-1 overflow-auto" : ""}`}
      >
        {effectiveStatus === "loading" ? (
          <WorkInstructionPreviewSkeleton layout={layout} modal={Boolean(onClose)} scale={previewScale} />
        ) : effectiveStatus === "empty" ? (
          <section className="wi-print-chrome ui-panel mx-auto max-w-[820px] p-5">
            <p className="ui-section-subtitle text-ink-tertiary">
              {pinnedReleaseId
                ? "That released revision could not be found, or you do not have access to it."
                : "No work instruction found for the selected task."}
            </p>
          </section>
        ) : effectiveStatus === "error" ? (
          <section className="wi-print-chrome ui-panel mx-auto max-w-[820px] p-5">
            <p className="ui-section-subtitle text-ink-tertiary">{error || "Could not load the work instruction."}</p>
            <button type="button" className="ui-btn-ghost mt-3 inline-flex h-9 px-3" onClick={() => void refresh()}>
              Retry
            </button>
          </section>
        ) : (
          <div
            className={onClose ? "wi-preview-scale" : undefined}
            style={onClose ? { margin: "0 auto", width: "17in", zoom: previewScale } : undefined}
          >
            {documents.map((entry) => (
              <WorkInstructionDocument instruction={entry.instruction} layout={entry.layout} key={entry.instruction.taskId} />
            ))}
          </div>
        )}
      </div>
    </div>
  );

  // The planner panel uses space-y utilities between its children. Portaling
  // the fixed overlay prevents that parent spacing from offsetting the dialog
  // and exposing the global header above it.
  return onClose && typeof document !== "undefined" ? createPortal(preview, document.body) : preview;
}
