"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { WorkspaceProjectGroup, WorkspaceRole } from "@/domain/types";
import { fetchMySpaceAccess } from "@/lib/planning/store";
import { SOP_WORKSPACE_STORAGE_KEY } from "@/lib/sop/workspace-cookie";

const LAST_PROJECT_STORAGE_KEY = "pulse:last-project-id";

type PlanningWorkspaceContextValue = {
  workspaceId: string;
  workspaceName: string;
  role: WorkspaceRole;
  /** `null` while the user's space_access grant is still being checked. */
  hasAccess: boolean | null;
  canWrite: boolean;
  canManage: boolean;
  /** Route data retained for this mounted Planning session, scoped by the active workspace. */
  readScreenCache: <T>(key: string) => T | undefined;
  writeScreenCache: <T>(key: string, value: T) => void;
};

const PlanningWorkspaceContext = createContext<PlanningWorkspaceContextValue | undefined>(undefined);

export function usePlanningWorkspace(): PlanningWorkspaceContextValue {
  const value = useContext(PlanningWorkspaceContext);
  if (!value) {
    throw new Error("usePlanningWorkspace must be used within a PlanningWorkspaceProvider.");
  }
  return value;
}

function readStoredWorkspaceId(): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage.getItem(SOP_WORKSPACE_STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function readLastProjectId(): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage.getItem(LAST_PROJECT_STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

// Choose the active workspace: a valid saved choice -> else the workspace owning the last
// project the user opened in the planner -> else the first group. Mirrors
// sop-workspace-provider.tsx's pickWorkspaceId exactly, so Planning and SOPs agree on which
// workspace is "current" for a given browser.
function pickWorkspaceGroup(groups: WorkspaceProjectGroup[]): WorkspaceProjectGroup | undefined {
  if (groups.length === 0) {
    return undefined;
  }

  const ids = new Set(groups.map((group) => group.workspace.id));

  const stored = readStoredWorkspaceId();
  if (stored && ids.has(stored)) {
    return groups.find((group) => group.workspace.id === stored);
  }

  const lastProjectId = readLastProjectId();
  if (lastProjectId) {
    const owning = groups.find((group) => group.projects.some((project) => project.id === lastProjectId));
    if (owning) {
      return owning;
    }
  }

  return groups[0];
}

type PlanningWorkspaceProviderProps = {
  groups: WorkspaceProjectGroup[];
  children: ReactNode;
};

export function PlanningWorkspaceProvider({ groups, children }: PlanningWorkspaceProviderProps) {
  const group = useMemo(() => pickWorkspaceGroup(groups), [groups]);
  const workspaceId = group?.workspace.id ?? "";
  const workspaceName = group?.workspace.name ?? "";
  const role = group?.role ?? "viewer";
  const isSuperAdmin = Boolean(group?.isSuperAdmin);
  const isManager = role === "owner" || role === "admin" || isSuperAdmin;

  const [hasAccess, setHasAccess] = useState<boolean | null>(null);
  const screenCacheRef = useRef(new Map<string, unknown>());

  const cacheKey = useCallback((key: string) => `${workspaceId}:${key}`, [workspaceId]);
  const readScreenCache = useCallback(
    <T,>(key: string) => screenCacheRef.current.get(cacheKey(key)) as T | undefined,
    [cacheKey],
  );
  const writeScreenCache = useCallback(
    <T,>(key: string, value: T) => {
      screenCacheRef.current.set(cacheKey(key), value);
    },
    [cacheKey],
  );

  useEffect(() => {
    if (!workspaceId) return;
    if (isManager) {
      setHasAccess(true);
      return;
    }
    setHasAccess(null);
    let cancelled = false;
    fetchMySpaceAccess(workspaceId, "planning")
      .then((granted) => {
        if (!cancelled) setHasAccess(granted);
      })
      .catch(() => {
        if (!cancelled) setHasAccess(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, isManager]);

  const canWrite = isManager || (role === "editor" && hasAccess === true);
  const canManage = isManager;

  const contextValue = useMemo<PlanningWorkspaceContextValue>(
    () => ({
      workspaceId,
      workspaceName,
      role,
      hasAccess,
      canWrite,
      canManage,
      readScreenCache,
      writeScreenCache,
    }),
    [workspaceId, workspaceName, role, hasAccess, canWrite, canManage, readScreenCache, writeScreenCache],
  );

  return <PlanningWorkspaceContext.Provider value={contextValue}>{children}</PlanningWorkspaceContext.Provider>;
}
