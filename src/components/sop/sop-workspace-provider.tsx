"use client";

import type { Session } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppLoadingShell, AuthFormPanel, ErrorRecoveryPanel } from "@/components/app-flow-panels";
import { ThemedSelect } from "@/components/themed-select";
import { createPlannerSupabaseClient, ensureDefaultWorkspaceMembership, fetchOrgToolAccess } from "@/domain/supabase-planner";
import type { AccessLevel, WorkspaceProjectGroup, WorkspaceRole } from "@/domain/types";
import { useAuthFormActions } from "@/lib/auth-form-actions";
import { resolveSupabaseSession } from "@/lib/supabase-auth";

const WORKSPACE_STORAGE_KEY = "pulse:sops:workspace-id";
const LAST_PROJECT_STORAGE_KEY = "pulse:last-project-id";

/** Roles allowed to create/edit/delete SOPs. Viewers get a read-only surface. */
export function canEdit(role?: WorkspaceRole): boolean {
  return role === "owner" || role === "admin" || role === "editor";
}

/**
 * Whether the current user may author/edit SOPs — mirrors the database's has_org_tool_access(edit):
 * workspace owners/admins always can, and any other member (including a viewer) can if they hold
 * org-tool EDIT access. Gating on this instead of the raw workspace role keeps the editor honest
 * with the RLS the save actually hits — a viewer granted SOP edit access can author, and a member
 * without it can't type into a form the database would reject anyway.
 */
export function canEditSops(role?: WorkspaceRole, orgToolAccess?: AccessLevel): boolean {
  return role === "owner" || role === "admin" || orgToolAccess === "edit";
}

/** Workspace managers: the only roles allowed to move a SOP to `approved` or `obsolete`. */
export function canManage(role?: WorkspaceRole): boolean {
  return role === "owner" || role === "admin";
}

type SopWorkspaceContextValue = {
  status: "loading" | "ready";
  workspaceId?: string;
  role?: WorkspaceRole;
  /** The user's org-tool (SOP) access level; undefined while still loading. */
  orgToolAccess?: AccessLevel;
  /** Derived: may this user author/edit SOPs? See canEditSops. */
  canEditSops: boolean;
  workspaces: WorkspaceProjectGroup[];
  setWorkspaceId: (workspaceId: string) => void;
};

const SopWorkspaceContext = createContext<SopWorkspaceContextValue | undefined>(undefined);

export function useSopWorkspace(): SopWorkspaceContextValue {
  const value = useContext(SopWorkspaceContext);
  if (!value) {
    throw new Error("useSopWorkspace must be used within a SopWorkspaceProvider.");
  }
  return value;
}

function readStoredWorkspaceId(): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage.getItem(WORKSPACE_STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeStoredWorkspaceId(workspaceId: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WORKSPACE_STORAGE_KEY, workspaceId);
  } catch {
    // Ignore storage failures in private browsing.
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
// project the user opened in the planner -> else the first group. Returns undefined when the
// user has no workspaces (a clean empty state, not an error).
function pickWorkspaceId(groups: WorkspaceProjectGroup[]): string | undefined {
  if (groups.length === 0) {
    return undefined;
  }

  const ids = new Set(groups.map((group) => group.workspace.id));

  const stored = readStoredWorkspaceId();
  if (stored && ids.has(stored)) {
    return stored;
  }

  const lastProjectId = readLastProjectId();
  if (lastProjectId) {
    const owning = groups.find((group) => group.projects.some((project) => project.id === lastProjectId));
    if (owning) {
      return owning.workspace.id;
    }
  }

  return groups[0]?.workspace.id;
}

export function SopWorkspaceProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => createPlannerSupabaseClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [groups, setGroups] = useState<WorkspaceProjectGroup[]>([]);
  const [workspaceId, setWorkspaceIdState] = useState<string | undefined>(undefined);
  const [orgToolAccess, setOrgToolAccess] = useState<AccessLevel | undefined>(undefined);
  const [status, setStatus] = useState<"loading" | "ready" | "auth" | "error">("loading");
  const [message, setMessage] = useState("");
  const auth = useAuthFormActions(supabase);
  const statusRef = useRef(status);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  async function refreshWorkspaces(nextSession: Session | null, options: { showLoading?: boolean } = {}) {
    if (!nextSession) {
      setGroups([]);
      setWorkspaceIdState(undefined);
      setStatus("auth");
      return;
    }

    if (options.showLoading ?? statusRef.current !== "ready") {
      setStatus("loading");
    }
    setMessage("");

    try {
      const nextGroups = await ensureDefaultWorkspaceMembership();
      setGroups(nextGroups);
      setWorkspaceIdState((current) => {
        // Keep a still-valid current selection across re-hydrations; otherwise re-pick.
        if (current && nextGroups.some((group) => group.workspace.id === current)) {
          return current;
        }
        return pickWorkspaceId(nextGroups);
      });
      setStatus("ready");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load organizations.");
      setStatus("error");
    }
  }

  useEffect(() => {
    let mounted = true;

    void resolveSupabaseSession(supabase).then(({ session: nextSession, error }) => {
      if (!mounted) return;

      if (error) {
        setMessage(error.message);
        setStatus("error");
        setSessionReady(true);
        return;
      }

      setSession(nextSession);
      setSessionReady(true);
      void refreshWorkspaces(nextSession);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      setSessionReady(true);

      if (event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
        return;
      }

      void refreshWorkspaces(nextSession);
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

  // The user's org-tool (SOP) access level. Org-wide (per user, not per workspace), so it tracks
  // the session rather than the selected workspace. Falls back to "none" if it can't be read.
  useEffect(() => {
    if (!session) {
      setOrgToolAccess(undefined);
      return;
    }
    let active = true;
    fetchOrgToolAccess(supabase)
      .then((level) => {
        if (active) setOrgToolAccess(level);
      })
      .catch(() => {
        if (active) setOrgToolAccess("none");
      });
    return () => {
      active = false;
    };
  }, [session, supabase]);

  function setWorkspaceId(nextId: string) {
    setWorkspaceIdState(nextId);
    writeStoredWorkspaceId(nextId);
  }

  const role = useMemo(
    () => groups.find((group) => group.workspace.id === workspaceId)?.role,
    [groups, workspaceId],
  );

  const contextValue = useMemo<SopWorkspaceContextValue>(
    () => ({
      status: "ready",
      workspaceId,
      role,
      orgToolAccess,
      canEditSops: canEditSops(role, orgToolAccess),
      workspaces: groups,
      setWorkspaceId,
    }),
    [workspaceId, role, orgToolAccess, groups],
  );

  if (!sessionReady || (session && status === "loading")) {
    return <AppLoadingShell title="Loading SOPs" />;
  }

  if (!session || status === "auth") {
    return (
      <AuthFormPanel
        title="Sign in to your organization"
        message={auth.message}
        isSubmitting={auth.isSubmitting}
        onSignIn={(email, password) => void auth.handleSignIn(email, password)}
        onCreateAccount={(email, password, fullName) => void auth.handleCreateAccount(email, password, fullName)}
        onMicrosoftSignIn={() => void auth.handleMicrosoftSignIn()}
        onResetPassword={(email) => void auth.handleResetPassword(email)}
        onResendConfirmation={(email) => void auth.handleResendConfirmation(email)}
      />
    );
  }

  if (status === "error") {
    return (
      <ErrorRecoveryPanel
        title="SOPs failed to load"
        body={message || "Your organizations could not be loaded. Retry keeps you here and reloads access."}
        onRetry={() => void refreshWorkspaces(session, { showLoading: true })}
      />
    );
  }

  return <SopWorkspaceContext.Provider value={contextValue}>{children}</SopWorkspaceContext.Provider>;
}

/**
 * Workspace picker shown in SOP sidebars. Renders only for users who belong to more than one
 * workspace (superadmins / multi-workspace members) -- otherwise there's nothing to choose.
 */
export function SopWorkspaceSwitcher() {
  const { workspaceId, workspaces, setWorkspaceId } = useSopWorkspace();

  if (workspaces.length <= 1) {
    return null;
  }

  return (
    <div className="px-2 pb-2 pt-1">
      <span className="ui-field-label">Organization</span>
      <ThemedSelect
        variant="sop"
        className="mt-1 w-full"
        ariaLabel="Organization"
        value={workspaceId ?? ""}
        options={workspaces.map((group) => ({
          value: group.workspace.id,
          label: group.workspace.name,
        }))}
        onChange={setWorkspaceId}
      />
    </div>
  );
}
