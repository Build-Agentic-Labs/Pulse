"use client";

import type { Session } from "@supabase/supabase-js";
import { ChevronRight, Loader2, LogOut, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  createPlannerSupabaseClient,
  createProjectWithStarterPlan,
  ensureDefaultWorkspaceMembership,
  loadWorkspaceProjectGroups,
} from "@/domain/supabase-planner";
import type { PlannerProjectContext, WorkspaceProjectGroup } from "@/domain/types";

type ProjectRouteKind = "planner" | "mobile-photos" | "excel/gantt";

type AuthProjectGateProps = {
  children: (project: PlannerProjectContext) => ReactNode;
  projectId?: string;
  routeKind?: ProjectRouteKind;
};

function projectHref(projectId: string, routeKind: ProjectRouteKind) {
  return `/projects/${projectId}/${routeKind}`;
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

export function AuthProjectGate({ children, projectId, routeKind = "planner" }: AuthProjectGateProps) {
  const router = useRouter();
  const supabase = useMemo(() => createPlannerSupabaseClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [groups, setGroups] = useState<WorkspaceProjectGroup[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "auth" | "error">("loading");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newProjectName, setNewProjectName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedProject = projectId ? buildProjectContext(groups, projectId) : undefined;
  const flatProjects = groups.flatMap((group) =>
    group.projects.map((project) => ({
      project,
      workspace: group.workspace,
      role: group.role,
    })),
  );
  const firstWorkspace = groups[0]?.workspace;

  async function refreshWorkspaceProjects(nextSession = session) {
    if (!nextSession) {
      setGroups([]);
      setStatus("auth");
      return;
    }

    setStatus("loading");
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

    supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) {
        return;
      }

      if (error) {
        setMessage(error.message);
        setStatus("error");
        return;
      }

      setSession(data.session);
      void refreshWorkspaceProjects(data.session);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      void refreshWorkspaceProjects(nextSession);
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

    if (flatProjects.length === 1) {
      router.replace(projectHref(flatProjects[0].project.id, routeKind));
    }
  }, [flatProjects, projectId, routeKind, router, status]);

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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

  async function handleCreateAccount() {
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

  async function handleCreateProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!firstWorkspace) {
      setMessage("Create or join a workspace before adding a project.");
      return;
    }

    setIsSubmitting(true);
    setMessage("");

    try {
      const project = await createProjectWithStarterPlan(firstWorkspace.id, newProjectName);
      setNewProjectName("");
      await loadWorkspaceProjectGroups().then(setGroups);
      router.push(projectHref(project.projectId, routeKind));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to create the project.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    setSession(null);
    setGroups([]);
    setStatus("auth");
  }

  if (status === "loading") {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f2efe6] text-ink">
        <div className="flex items-center gap-3 rounded-md border border-line bg-white px-4 py-3 text-sm font-bold text-steel shadow-sm">
          <Loader2 size={18} className="animate-spin" />
          Loading workspace
        </div>
      </main>
    );
  }

  if (!session || status === "auth") {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f2efe6] px-4 text-ink">
        <section className="w-full max-w-md rounded-md border border-line bg-white p-6 shadow-sm">
          <div>
            <p className="text-xs font-black uppercase tracking-wide text-steel">BuildLogic</p>
            <h1 className="mt-2 text-2xl font-black">Sign in to your workspace</h1>
          </div>
          <form className="mt-6 space-y-3" onSubmit={handleSignIn}>
            <label className="block text-xs font-black uppercase tracking-wide text-steel">
              Email
              <input
                className="mt-1 h-12 w-full rounded border border-line px-3 text-base font-bold text-ink outline-none focus:border-teal"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                required
              />
            </label>
            <label className="block text-xs font-black uppercase tracking-wide text-steel">
              Password
              <input
                className="mt-1 h-12 w-full rounded border border-line px-3 text-base font-bold text-ink outline-none focus:border-teal"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
            {message ? <p className="rounded border border-amber bg-amber/10 px-3 py-2 text-sm font-bold text-steel">{message}</p> : null}
            <button
              className="flex h-12 w-full items-center justify-center rounded bg-ink text-sm font-black text-white disabled:opacity-60"
              type="submit"
              disabled={isSubmitting}
            >
              {isSubmitting ? <Loader2 size={18} className="animate-spin" /> : "Sign In"}
            </button>
            <button
              className="h-12 w-full rounded border border-line bg-white text-sm font-black text-ink disabled:opacity-60"
              type="button"
              onClick={handleCreateAccount}
              disabled={isSubmitting}
            >
              Create Account
            </button>
          </form>
        </section>
      </main>
    );
  }

  if (projectId && selectedProject) {
    return <>{children(selectedProject)}</>;
  }

  if (projectId && status === "ready") {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f2efe6] px-4 text-ink">
        <section className="w-full max-w-lg rounded-md border border-line bg-white p-6 shadow-sm">
          <p className="text-xs font-black uppercase tracking-wide text-signal">Project unavailable</p>
          <h1 className="mt-2 text-2xl font-black">You do not have access to this project.</h1>
          <button className="mt-5 rounded bg-ink px-4 py-3 text-sm font-black text-white" onClick={() => router.push("/")}>
            Choose Project
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f2efe6] px-4 py-6 text-ink">
      <section className="mx-auto max-w-4xl rounded-md border border-line bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-wide text-steel">Workspace</p>
            <h1 className="mt-1 text-2xl font-black">Choose a project</h1>
          </div>
          <button
            className="inline-flex h-10 items-center gap-2 rounded border border-line px-3 text-sm font-black text-steel"
            onClick={handleSignOut}
          >
            <LogOut size={16} />
            Sign Out
          </button>
        </div>

        {message ? <p className="mt-4 rounded border border-amber bg-amber/10 px-3 py-2 text-sm font-bold text-steel">{message}</p> : null}

        <div className="mt-5 grid gap-3">
          {flatProjects.map(({ project, workspace, role }) => (
            <button
              key={project.id}
              className="flex items-center justify-between rounded-md border border-line bg-[#f7f5ef] p-4 text-left hover:border-teal"
              onClick={() => router.push(projectHref(project.id, routeKind))}
            >
              <span>
                <span className="block text-lg font-black">{project.name}</span>
                <span className="mt-1 block text-xs font-bold uppercase tracking-wide text-steel">
                  {workspace.name} · {role}
                </span>
              </span>
              <ChevronRight size={22} />
            </button>
          ))}
        </div>

        <form className="mt-6 flex flex-col gap-3 border-t border-line pt-5 sm:flex-row" onSubmit={handleCreateProject}>
          <input
            className="h-11 min-w-0 flex-1 rounded border border-line px-3 text-base font-bold outline-none focus:border-teal"
            value={newProjectName}
            onChange={(event) => setNewProjectName(event.target.value)}
            placeholder="New project name"
          />
          <button
            className="inline-flex h-11 items-center justify-center gap-2 rounded bg-ink px-4 text-sm font-black text-white disabled:opacity-60"
            type="submit"
            disabled={isSubmitting}
          >
            <Plus size={18} />
            Project
          </button>
        </form>
      </section>
    </main>
  );
}
