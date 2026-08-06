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
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { loadPlannerStateFromSupabase } from "@/domain/supabase-planner";
import type { PlannerState } from "@/domain/types";
import { buildWorkInstruction } from "@/domain/work-instruction/build";
import {
  DEFAULT_WORK_INSTRUCTION_LAYOUT,
  WORK_INSTRUCTION_LAYOUTS,
  type WorkInstruction,
  type WorkInstructionLayout,
} from "@/domain/work-instruction/schema";
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
}

/** Build the requested instructions out of a loaded planner state, in the order asked for. */
function buildFromState(state: PlannerState, taskIds: string[], layout: WorkInstructionLayout): WorkInstruction[] {
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
  onClose,
  canPrint,
}: {
  backHref: string;
  label: string;
  layout: WorkInstructionLayout;
  hrefForLayout: (layoutId: string) => string;
  onClose?: () => void;
  canPrint: boolean;
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

      {onClose ? null : (
        <div className="flex items-center gap-1 rounded border border-line p-0.5">
          {Object.values(WORK_INSTRUCTION_LAYOUTS).map((option) => (
            <Link
              key={option.id}
              href={hrefForLayout(option.id)}
              aria-current={option.id === layout.id ? "page" : undefined}
              className={`h-7 rounded px-2.5 text-xs leading-7 transition ${
                option.id === layout.id ? "bg-surface-sunken font-semibold text-ink" : "text-ink-tertiary hover:text-ink"
              }`}
            >
              {option.label}
            </Link>
          ))}
        </div>
      )}

      {onClose ? null : <span className="flex-1" />}

      {/* Ledger landscape at 100% is easy to get wrong in the print dialog and
          silently yields a shrunken Letter page, so the settings ride along. */}
      <span className="hidden text-xs text-ink-tertiary lg:inline">
        Print: Ledger 11&times;17 · Landscape · Margins none · Scale 100%
      </span>
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

export function WorkInstructionPrintPreview({
  projectId,
  scenarioId,
  taskIds,
  blank,
  initialPlannerState,
  layout = DEFAULT_WORK_INSTRUCTION_LAYOUT,
  onReady,
  onClose,
}: WorkInstructionPrintPreviewProps) {
  const seeded = blank
    ? [blankInstruction()]
    : serverStateIsUsable(initialPlannerState, scenarioId)
      ? buildFromState(initialPlannerState, taskIds, layout)
      : [];

  const [instructions, setInstructions] = useState<WorkInstruction[]>(seeded);
  const [status, setStatus] = useState<LoadStatus>(blank || seeded.length > 0 ? "ready" : "loading");
  const [error, setError] = useState("");
  const [previewScale, setPreviewScale] = useState(1);
  const previewBodyRef = useRef<HTMLDivElement | null>(null);

  // Stale-response guard, same idiom as work-order-print.tsx: only the latest
  // load may commit state.
  const loadSeqRef = useRef(0);
  // Seeded first paint means the client load is redundant on mount; a manual
  // Retry still forces one.
  const seededRef = useRef(seeded.length > 0 || Boolean(blank));

  const refresh = useCallback(async () => {
    if (blank) {
      setInstructions([blankInstruction()]);
      setStatus("ready");
      return;
    }
    const seq = ++loadSeqRef.current;
    if (!projectId || taskIds.length === 0) {
      setInstructions([]);
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
        setStatus("empty");
        return;
      }
      const built = buildFromState(state, taskIds, layout);
      setInstructions(built);
      setStatus(built.length > 0 ? "ready" : "empty");
    } catch (caught) {
      if (seq !== loadSeqRef.current) return;
      setError(caught instanceof Error ? caught.message : "Could not load the work instruction.");
      setStatus("error");
    }
  }, [blank, layout, projectId, scenarioId, taskIds]);

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

  useEffect(() => {
    if (status === "ready") onReady?.();
  }, [status, onReady]);

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
    status !== "ready"
      ? taskIds.length === 1
        ? "Work instruction preview"
        : `${taskIds.length} work instructions`
      : instructions.length === 1
      ? instructions[0].meta.documentNumber || instructions[0].meta.title || "Work instruction"
      : `${instructions.length} work instructions`;

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
        layout={layout}
        hrefForLayout={hrefForLayout}
        onClose={onClose}
        canPrint={status === "ready"}
      />
      {/* wi-print-body: the print stylesheet zeroes this padding, which would
          otherwise spill past the last sheet and print a blank trailing page. */}
      <div
        ref={previewBodyRef}
        className={`wi-print-body px-8 py-8 ${onClose ? "min-h-0 flex-1 overflow-auto" : ""}`}
      >
        {status === "loading" ? (
          <WorkInstructionPreviewSkeleton layout={layout} modal={Boolean(onClose)} scale={previewScale} />
        ) : status === "empty" ? (
          <section className="wi-print-chrome ui-panel mx-auto max-w-[820px] p-5">
            <p className="ui-section-subtitle text-ink-tertiary">
              No work instruction found for the selected task.
            </p>
          </section>
        ) : status === "error" ? (
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
            {instructions.map((instruction) => (
              <WorkInstructionDocument instruction={instruction} layout={layout} key={instruction.taskId} />
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
