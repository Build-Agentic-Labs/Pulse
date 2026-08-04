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

import { ArrowLeft, Printer } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { NothingLoadingBlock } from "@/components/nothing-ui";
import { loadPlannerStateFromSupabase } from "@/domain/supabase-planner";
import type { PlannerState } from "@/domain/types";
import { buildWorkInstruction } from "@/domain/work-instruction/build";
import type { WorkInstruction } from "@/domain/work-instruction/schema";
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
  onReady?: () => void;
}

/** Build the requested instructions out of a loaded planner state, in the order asked for. */
function buildFromState(state: PlannerState, taskIds: string[]): WorkInstruction[] {
  const zoneById = new Map(state.zones.map((zone) => [zone.id, zone]));
  return taskIds
    .map((taskId) => state.tasks.find((task) => task.id === taskId))
    .filter((task): task is NonNullable<typeof task> => Boolean(task))
    .map((task) =>
      buildWorkInstruction({
        task,
        product: state.product,
        zone: task.zoneId ? zoneById.get(task.zoneId) : undefined,
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

function PrintToolbar({ backHref, label }: { backHref: string; label: string }) {
  return (
    <div className="wi-print-chrome sticky top-0 z-10 flex items-center gap-3 border-b border-line bg-surface px-4 py-2">
      <Link href={backHref} className="ui-btn-ghost h-8 gap-1.5 px-3">
        <ArrowLeft size={13} />
        Back
      </Link>
      <span className="flex-1" />
      <span className="ui-mono-label text-ink-tertiary">{label}</span>
      <button type="button" className="ui-btn-primary h-8 gap-1.5 px-3" onClick={() => window.print()}>
        <Printer size={13} />
        Print
      </button>
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
      materialKit: "",
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
  onReady,
}: WorkInstructionPrintPreviewProps) {
  const seeded = blank
    ? [blankInstruction()]
    : serverStateIsUsable(initialPlannerState, scenarioId)
      ? buildFromState(initialPlannerState, taskIds)
      : [];

  const [instructions, setInstructions] = useState<WorkInstruction[]>(seeded);
  const [status, setStatus] = useState<LoadStatus>(blank || seeded.length > 0 ? "ready" : "loading");
  const [error, setError] = useState("");

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
      const built = buildFromState(state, taskIds);
      setInstructions(built);
      setStatus(built.length > 0 ? "ready" : "empty");
    } catch (caught) {
      if (seq !== loadSeqRef.current) return;
      setError(caught instanceof Error ? caught.message : "Could not load the work instruction.");
      setStatus("error");
    }
  }, [blank, projectId, scenarioId, taskIds]);

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

  const label =
    instructions.length === 1
      ? instructions[0].meta.documentNumber || instructions[0].meta.title || "Work instruction"
      : `${instructions.length} work instructions`;

  return (
    <div className="wi-print-root h-[100dvh] overflow-y-auto bg-canvas">
      <PrintToolbar backHref={`/projects/${projectId}/planner`} label={blank ? "Blank template" : label} />
      <div className="px-8 py-8">
        {status === "loading" ? (
          <NothingLoadingBlock title="Loading work instruction" />
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
          instructions.map((instruction) => (
            <WorkInstructionDocument instruction={instruction} key={instruction.taskId} />
          ))
        )}
      </div>
    </div>
  );
}
