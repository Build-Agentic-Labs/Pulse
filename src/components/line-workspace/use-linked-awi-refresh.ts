"use client";

import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { awiTaskLink, refreshLinkedAwiTasks } from "@/domain/awi-task-link";
import { loadLinkedAwiMasters } from "@/domain/supabase-planner";
import type { PlannerState } from "@/domain/types";
import { useRefreshOnReturn } from "@/lib/use-refresh-on-return";

export function useLinkedAwiRefresh({ plannerState, setPlannerState }: {
  plannerState: PlannerState;
  setPlannerState: Dispatch<SetStateAction<PlannerState>>;
}): { refreshLinkedAwi: () => Promise<void> } {
  // Compare against raw planner state: calculated fields are not the refresh baseline.
  const latestPlannerStateRef = useRef(plannerState);
  useEffect(() => {
    latestPlannerStateRef.current = plannerState;
  }, [plannerState]);

  const refreshLinkedAwi = useCallback(async () => {
    const startedFrom = latestPlannerStateRef.current;
    const linkedTasks = startedFrom.tasks.filter((task) => awiTaskLink(task));
    if (linkedTasks.length === 0) return;

    const masters = await loadLinkedAwiMasters(linkedTasks);
    const sameScope = (current: PlannerState) => current.product.projectId === startedFrom.product.projectId
      && current.scenario.id === startedFrom.scenario.id;
    if (!sameScope(latestPlannerStateRef.current)) return;

    setPlannerState((current) => {
      // React may apply this updater after a queued project/scenario switch.
      if (!sameScope(current)) return current;
      const refreshed = refreshLinkedAwiTasks(current.tasks, masters, linkedTasks);
      return refreshed.changed ? { ...current, tasks: refreshed.tasks } : current;
    });
  }, [setPlannerState]);

  useRefreshOnReturn(refreshLinkedAwi, plannerState.tasks.some((task) => awiTaskLink(task)));
  return { refreshLinkedAwi };
}
