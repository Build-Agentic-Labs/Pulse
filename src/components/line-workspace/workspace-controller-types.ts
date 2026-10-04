import type { Dispatch, RefObject, SetStateAction } from "react";
import type { SaveState } from "@/domain/supabase-planner";
import type { PlannerState } from "@/domain/types";
import type { FeedbackToast } from "../themed-feedback";

// Narrow capabilities LineWorkspace hands to its save and draft owners. Each hook receives only the
// groups it uses, as flat options. These are plain values and refs owned by the component, not a store.

/** Planner state for async work (the ref is refreshed every commit) and the functional state setter. */
export type PlannerStateAccess = {
  latestDerivedStateRef: RefObject<PlannerState>;
  setPlannerState: Dispatch<SetStateAction<PlannerState>>;
};

/** The project this render's cache and draft writes belong to, and the Main scenario recorded beside them. */
export type PlannerCacheScope = {
  projectId?: string;
  mainScenarioIdRef: RefObject<string | undefined>;
};

/** Setters for the reported save status. The status users see is aggregated in useWorkspaceSaves. */
export type ReportedSaveStatusSetters = {
  setSaveState: Dispatch<SetStateAction<SaveState>>;
  setSaveError: Dispatch<SetStateAction<string | undefined>>;
};

/** Existing toast feedback, and the view-only write gate (which shows its notice once). */
export type WorkspaceFeedback = {
  notifyFeedback: (message: Omit<FeedbackToast, "id">) => void;
  blockViewOnlyWrite: () => boolean;
};

/** The project and scenario a save was issued for. Completion, retries and cache writes stay in it. */
export type SaveScope = {
  projectId?: string;
  scenarioId: string;
};

/** True when a save scope is the one the workspace shows now; only that work drives status and guards. */
export type ForegroundSaveScope = {
  isForegroundSaveScope: (scope: SaveScope) => boolean;
};

/** Per-task private-media hydration status for the scenario on screen. */
export type TaskDetailHydrationStatus = Record<string, "loading" | "loaded" | "error">;
