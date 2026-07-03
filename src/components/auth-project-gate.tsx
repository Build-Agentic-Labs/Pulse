"use client";

import type { Session } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppLoadingShell, AuthFormPanel, ErrorRecoveryPanel, PasswordUpdatePanel } from "@/components/app-flow-panels";
import {
  createPlannerSupabaseClient,
  ensureDefaultWorkspaceMembership,
} from "@/domain/supabase-planner";
import type { PlannerProjectContext, WorkspaceProjectGroup } from "@/domain/types";
import { useAuthFormActions } from "@/lib/auth-form-actions";
import { resolveSupabaseSession } from "@/lib/supabase-auth";

type ProjectRouteKind = "planner" | "mobile-photos" | "excel/gantt";

/** What the company dashboard (and other project-less home surfaces) render with. */
export type DashboardHomeContext = {
  groups: WorkspaceProjectGroup[];
  displayName: string;
  preferredProjectId?: string;
};

type AuthProjectGateProps = {
  children: (project: PlannerProjectContext | undefined, onReady: () => void) => ReactNode;
  projectId?: string;
  routeKind?: ProjectRouteKind;
  /**
   * Home mode: instead of auto-redirecting a project-less visit into the last project,
   * render this once workspaces are ready (auth/loading/error handling unchanged).
   */
  renderHome?: (home: DashboardHomeContext) => ReactNode;
};

const LAST_PROJECT_STORAGE_KEY = "pulse:last-project-id";
const WORKSPACE_GROUPS_CACHE_KEY = "pulse:workspace-groups-cache-v1";
const WORKSPACE_LOADING_TITLE = "Loading organization";
const PROJECT_SWITCH_SESSION_KEY = "pulse:project-switch-started-at";
const PROJECT_SWITCH_TARGET_SESSION_KEY = "pulse:project-switch-target-v1";
const PROJECT_SWITCH_SESSION_MAX_AGE_MS = 15_000;

function readSwitchTargetTitle(projectId: string): string {
  if (typeof window === "undefined") {
    return "";
  }

  try {
    const raw = window.sessionStorage.getItem(PROJECT_SWITCH_TARGET_SESSION_KEY);
    if (!raw) {
      return "";
    }

    const parsed = JSON.parse(raw) as { projectId?: string; title?: string };
    return parsed.projectId === projectId && typeof parsed.title === "string" ? parsed.title : "";
  } catch {
    return "";
  }
}

function hasRecentProjectSwitchSession() {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    const startedAt = Number(window.sessionStorage.getItem(PROJECT_SWITCH_SESSION_KEY));
    return Number.isFinite(startedAt) && Date.now() - startedAt < PROJECT_SWITCH_SESSION_MAX_AGE_MS;
  } catch {
    return false;
  }
}

function projectHref(projectId: string, routeKind: ProjectRouteKind) {
  const href = `/projects/${projectId}/${routeKind}`;
  return routeKind === "planner" ? `${href}?view=dashboard` : href;
}

function buildProjectContext(groups: WorkspaceProjectGroup[], projectId: string): PlannerProjectContext | undefined {
  for (const group of groups) {
    const project = group.projects.find((candidate) => candidate.id === projectId);
    if (project) {
      return {
        projectId: project.id,
        projectName: project.name,
        workspaceId: group.workspace.id,
        workspaceName: group.workspace.name,
        role: group.role,
        // Per-project level for view-only gating; managers always edit.
        accessLevel:
          group.isSuperAdmin || group.role === "owner" || group.role === "admin" ? "edit" : project.accessLevel,
      };
    }
  }

  return undefined;
}

function readLastProjectId() {
  if (typeof window === "undefined") {
    return undefined;
  }

  try {
    return window.localStorage.getItem(LAST_PROJECT_STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeLastProjectId(projectId: string) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(LAST_PROJECT_STORAGE_KEY, projectId);
  } catch {
    // Ignore storage failures in private browsing.
  }
}

// True when supabase-js has a persisted session in this browser (its storage key is
// sb-<project-ref>-auth-token). Painting cached workspace data before the async session
// resolve is gated on this so a signed-out browser never flashes another user's cache.
function hasLocalSupabaseSession() {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key && key.startsWith("sb-") && key.includes("auth-token")) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

function readWorkspaceGroupsCache(): WorkspaceProjectGroup[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(WORKSPACE_GROUPS_CACHE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as WorkspaceProjectGroup[]) : [];
  } catch {
    return [];
  }
}

function writeWorkspaceGroupsCache(groups: WorkspaceProjectGroup[]) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(WORKSPACE_GROUPS_CACHE_KEY, JSON.stringify(groups));
  } catch {
    // Ignore storage failures in private browsing.
  }
}

function clearWorkspaceGroupsCache() {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(WORKSPACE_GROUPS_CACHE_KEY);
  } catch {
    // Ignore storage failures in private browsing.
  }
}

function fallbackProjectContext(projectId: string): PlannerProjectContext {
  return {
    projectId,
    // Use the name stashed by announceProjectSwitch so the optimistic render
    // paints the correct project label on the first frame instead of blank,
    // which avoids the sidebar "text remount" flash during a workspace switch.
    projectName: readSwitchTargetTitle(projectId),
    workspaceId: "",
    workspaceName: "",
  };
}

function resolveDisplayName(session: Session | null): string {
  const metadata = (session?.user.user_metadata ?? {}) as { full_name?: string };
  return metadata.full_name?.trim() || session?.user.email?.split("@")[0] || "";
}

export function AuthProjectGate({ children, projectId, routeKind = "planner", renderHome }: AuthProjectGateProps) {
  const router = useRouter();
  const supabase = useMemo(() => createPlannerSupabaseClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [groups, setGroups] = useState<WorkspaceProjectGroup[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "auth" | "error">("loading");
  const [message, setMessage] = useState("");
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [childReady, setChildReady] = useState(false);
  const auth = useAuthFormActions(supabase);
  const statusRef = useRef(status);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    if (!projectId) {
      setChildReady(false);
    }
  }, [projectId]);

  const selectedProject = useMemo(
    () => (projectId ? buildProjectContext(groups, projectId) : undefined),
    [groups, projectId],
  );
  const flatProjects = useMemo(
    () => groups.flatMap((group) =>
      group.projects
        .filter((project) => project.status !== "archived")
        .map((project) => ({
          project,
          workspace: group.workspace,
          role: group.role,
        })),
    ),
    [groups],
  );

  async function refreshWorkspaceProjects(nextSession = session, options: { showLoading?: boolean } = {}) {
    if (!nextSession) {
      setGroups([]);
      setStatus("auth");
      clearWorkspaceGroupsCache();
      return;
    }

    const shouldShowWorkspaceLoading = options.showLoading ?? (statusRef.current !== "ready" && !projectId);
    if (shouldShowWorkspaceLoading) {
      setStatus("loading");
    }
    setMessage("");

    try {
      const nextGroups = await ensureDefaultWorkspaceMembership();
      setGroups(nextGroups);
      writeWorkspaceGroupsCache(nextGroups);
      setStatus("ready");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load organization workspaces.");
      setStatus("error");
    }
  }

  // Cache-then-revalidate (same pattern as the sidebar's project cache): paint the last
  // known workspace groups immediately while the session resolve + fresh load below run.
  // Runs before the session effect so the cached paint lands on the first client frame.
  useEffect(() => {
    if (!hasLocalSupabaseSession()) {
      // No persisted session in this browser: the async resolve below is guaranteed to
      // land on the auth panel, so show it immediately instead of flashing the loading
      // shell first. Exception: an OAuth/email-link callback carries its credentials in
      // the URL and has no stored token yet — keep the loading shell while it exchanges.
      const isAuthCallback = /[?#&](code|access_token|refresh_token|error_description)=/.test(
        window.location.href,
      );
      if (!isAuthCallback) {
        setSessionReady(true);
        setStatus("auth");
      }
      return;
    }

    const cached = readWorkspaceGroupsCache();
    if (cached.length > 0) {
      setGroups((current) => (current.length > 0 ? current : cached));
      setStatus((current) => (current === "loading" ? "ready" : current));
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    void resolveSupabaseSession(supabase).then(({ session: nextSession, error }) => {
      if (!mounted) {
        return;
      }

      if (error) {
        setMessage(error.message);
        setStatus("error");
        setSessionReady(true);
        return;
      }

      setSession(nextSession);
      setSessionReady(true);
      void refreshWorkspaceProjects(nextSession);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      setSessionReady(true);

      if (event === "PASSWORD_RECOVERY") {
        // The user arrived from a reset email: collect the new password before
        // letting them into the app.
        setRecoveryMode(true);
        return;
      }

      if (event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
        return;
      }

      void refreshWorkspaceProjects(nextSession, {
        showLoading: statusRef.current !== "ready" && !projectId,
      });
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [supabase]);

  const homeMode = Boolean(renderHome);

  useEffect(() => {
    // Home mode renders in place — never bounce the visit into a project.
    if (homeMode || projectId || status !== "ready") {
      return;
    }

    if (flatProjects.length > 0) {
      const preferredId = readLastProjectId();
      const target =
        flatProjects.find((entry) => entry.project.id === preferredId)?.project ?? flatProjects[0]?.project;

      if (target) {
        router.replace(projectHref(target.id, routeKind));
      }
    }
  }, [flatProjects, homeMode, projectId, routeKind, router, status]);

  useEffect(() => {
    if (selectedProject?.projectId) {
      writeLastProjectId(selectedProject.projectId);
    }
  }, [selectedProject?.projectId]);

  async function handleUpdatePassword(password: string) {
    const updated = await auth.handleUpdatePassword(password);
    if (updated) {
      setRecoveryMode(false);
    }
  }

  const isRedirectingToProject =
    !homeMode && !projectId && status === "ready" && flatProjects.length > 0;

  if (projectId && !sessionReady && hasRecentProjectSwitchSession()) {
    return <>{children(fallbackProjectContext(projectId), () => setChildReady(true))}</>;
  }

  // While the session is still resolving, cached groups (guarded on a persisted local
  // session) are good enough to paint with — the resolve lands right after and either
  // confirms via the background refresh or drops to the auth panel.
  const hasCachedPaint = status === "ready" && groups.length > 0;

  if (!sessionReady && !hasCachedPaint) {
    return (
      <AppLoadingShell title={WORKSPACE_LOADING_TITLE} />
    );
  }

  if (recoveryMode) {
    return (
      <PasswordUpdatePanel
        message={auth.message}
        isSubmitting={auth.isSubmitting}
        onUpdatePassword={(password) => void handleUpdatePassword(password)}
      />
    );
  }

  if ((sessionReady && !session) || status === "auth") {
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
        title="Organization failed to load"
        body={message || "The app could not load your organization workspaces. Retry keeps you on this screen and reloads access."}
        onRetry={() => void refreshWorkspaceProjects(session, { showLoading: true })}
      />
    );
  }

  if (projectId) {
    if (status === "ready" && !selectedProject) {
      return (
        <main className="grid min-h-screen place-items-center bg-canvas px-4 text-ink">
          <section className="w-full max-w-lg ui-panel p-6">
            <p className="text-xs ui-mono-label tracking-wide text-danger">Project unavailable</p>
            <h1 className="mt-2 text-2xl font-medium">You do not have access to this project.</h1>
            <button className="ui-btn-primary mt-5" onClick={() => router.push("/")}>
              Go to home
            </button>
          </section>
        </main>
      );
    }

    return (
      <>
        {!childReady && status !== "ready" && !hasRecentProjectSwitchSession() ? <AppLoadingShell title={WORKSPACE_LOADING_TITLE} /> : null}
        {children(selectedProject ?? fallbackProjectContext(projectId), () => setChildReady(true))}
      </>
    );
  }

  if (renderHome && status === "ready") {
    const preferredId = readLastProjectId();
    const preferred =
      flatProjects.find((entry) => entry.project.id === preferredId)?.project ?? flatProjects[0]?.project;
    return (
      <>{renderHome({ groups, displayName: resolveDisplayName(session), preferredProjectId: preferred?.id })}</>
    );
  }

  if (status === "loading" || isRedirectingToProject) {
    return (
      <AppLoadingShell title={WORKSPACE_LOADING_TITLE} />
    );
  }

  if (flatProjects.length === 0) {
    // Members who can create a project get the app shell (it has the create flow).
    // Viewers with no project grants get an explanation instead of an empty planner.
    const canCreateProjects = groups.some(
      (group) => group.isSuperAdmin || group.role === "owner" || group.role === "admin" || group.role === "editor",
    );

    if (canCreateProjects) {
      return <>{children(undefined, () => {})}</>;
    }

    return (
      <main className="grid min-h-screen place-items-center bg-canvas px-4 text-ink">
        <section className="w-full max-w-lg ui-panel p-6">
          <p className="text-xs ui-mono-label tracking-wide text-ink-tertiary">No project access yet</p>
          <h1 className="mt-2 text-2xl font-medium">You&apos;re in, but nothing is shared with you yet.</h1>
          <p className="mt-3 text-[13px] leading-relaxed text-ink-secondary">
            Your account ({session?.user.email ?? "unknown"}) is part of the organization, but no projects have
            been shared with it. Ask an organization owner or admin to grant you access from Settings &rarr;
            Organization &rarr; Members.
          </p>
          <div className="mt-5 flex gap-2">
            <button
              className="ui-btn-primary"
              onClick={() => void refreshWorkspaceProjects(session, { showLoading: true })}
            >
              Check again
            </button>
            <button
              className="ui-btn-ghost"
              onClick={() => {
                void supabase.auth.signOut().then(() => router.push("/login"));
              }}
            >
              Sign out
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <AppLoadingShell title={WORKSPACE_LOADING_TITLE} />
  );
}
