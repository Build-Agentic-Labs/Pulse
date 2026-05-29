"use client";

import type { Session } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppLoadingShell, AuthFormPanel, ErrorRecoveryPanel } from "@/components/app-flow-panels";
import {
  createPlannerSupabaseClient,
  ensureDefaultWorkspaceMembership,
} from "@/domain/supabase-planner";
import type { PlannerProjectContext, WorkspaceProjectGroup } from "@/domain/types";
import { resolveSupabaseSession } from "@/lib/supabase-auth";

type ProjectRouteKind = "planner" | "mobile-photos" | "excel/gantt";

type AuthProjectGateProps = {
  children: (project: PlannerProjectContext | undefined, onReady: () => void) => ReactNode;
  projectId?: string;
  routeKind?: ProjectRouteKind;
};

const LAST_PROJECT_STORAGE_KEY = "pulse:last-project-id";
const WORKSPACE_LOADING_TITLE = "Loading workspace";
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

export function AuthProjectGate({ children, projectId, routeKind = "planner" }: AuthProjectGateProps) {
  const router = useRouter();
  const supabase = useMemo(() => createPlannerSupabaseClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [groups, setGroups] = useState<WorkspaceProjectGroup[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "auth" | "error">("loading");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [childReady, setChildReady] = useState(false);
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
      setStatus("ready");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load workspace projects.");
      setStatus("error");
    }
  }

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

  useEffect(() => {
    if (projectId || status !== "ready") {
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
  }, [flatProjects, projectId, routeKind, router, status]);

  useEffect(() => {
    if (selectedProject?.projectId) {
      writeLastProjectId(selectedProject.projectId);
    }
  }, [selectedProject?.projectId]);

  async function handleSignIn(email: string, password: string) {
    setIsSubmitting(true);
    setMessage("");

    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) {
        throw error;
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to sign in.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCreateAccount(email: string, password: string) {
    setIsSubmitting(true);
    setMessage("");

    try {
      const { error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
      });
      if (error) {
        throw error;
      }
      setMessage("Account created. If email confirmation is enabled, confirm the email before signing in.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to create account.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const isRedirectingToProject =
    !projectId && status === "ready" && flatProjects.length > 0;

  if (projectId && !sessionReady && hasRecentProjectSwitchSession()) {
    return <>{children(fallbackProjectContext(projectId), () => setChildReady(true))}</>;
  }

  if (!sessionReady) {
    return (
      <AppLoadingShell title={WORKSPACE_LOADING_TITLE} />
    );
  }

  if (!session || status === "auth") {
    return (
      <AuthFormPanel
        title="Sign in to your workspace"
        message={message}
        isSubmitting={isSubmitting}
        onSignIn={handleSignIn}
        onCreateAccount={handleCreateAccount}
      />
    );
  }

  if (status === "error") {
    return (
      <ErrorRecoveryPanel
        title="Workspace failed to load"
        body={message || "The app could not load your workspace projects. Retry keeps you on this screen and reloads access."}
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
              Open planner
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

  if (status === "loading" || isRedirectingToProject) {
    return (
      <AppLoadingShell title={WORKSPACE_LOADING_TITLE} />
    );
  }

  if (flatProjects.length === 0) {
    return <>{children(undefined, () => {})}</>;
  }

  return (
    <AppLoadingShell title={WORKSPACE_LOADING_TITLE} />
  );
}
