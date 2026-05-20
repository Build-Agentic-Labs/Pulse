"use client";

import type { Session } from "@supabase/supabase-js";
import { Archive, Check, ChevronRight, FolderKanban, Loader2, LogOut, Plus, RefreshCw, UserCircle, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  createPlannerSupabaseClient,
  createProjectWithStarterPlan,
  ensureDefaultWorkspaceMembership,
  loadWorkspaceMembersFromSupabase,
  loadWorkspaceProjectGroups,
  updateProjectInSupabase,
  updateWorkspaceInSupabase,
} from "@/domain/supabase-planner";
import type { Project, WorkspaceMemberProfile, WorkspaceProjectGroup } from "@/domain/types";

function canManage(role?: string) {
  return role === "owner" || role === "admin";
}

function canEdit(role?: string) {
  return role === "owner" || role === "admin" || role === "editor";
}

function projectPlannerHref(projectId: string) {
  return `/projects/${projectId}/planner`;
}

function LoginPanel({
  message,
  isSubmitting,
  onSignIn,
  onCreateAccount,
}: {
  message: string;
  isSubmitting: boolean;
  onSignIn: (email: string, password: string) => void;
  onCreateAccount: (email: string, password: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSignIn(email, password);
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#f2efe6] px-4 text-ink">
      <section className="w-full max-w-md rounded-md border border-line bg-white p-6 shadow-soft">
        <p className="text-xs font-black uppercase tracking-wide text-steel">BuildLogic Account</p>
        <h1 className="mt-2 text-2xl font-black">Sign in to manage workspaces</h1>
        <form className="mt-6 space-y-3" onSubmit={submit}>
          <label className="block text-xs font-black uppercase tracking-wide text-steel">
            Email
            <input
              className="mt-1 h-12 w-full rounded border border-line px-3 text-base font-bold outline-none focus:border-teal"
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
              className="mt-1 h-12 w-full rounded border border-line px-3 text-base font-bold outline-none focus:border-teal"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          {message ? <p className="rounded border border-amber/40 bg-amber/10 px-3 py-2 text-sm font-bold text-steel">{message}</p> : null}
          <button className="flex h-12 w-full items-center justify-center rounded bg-ink text-sm font-black text-white disabled:opacity-60" disabled={isSubmitting}>
            {isSubmitting ? <Loader2 size={18} className="animate-spin" /> : "Sign In"}
          </button>
          <button
            className="h-12 w-full rounded border border-line bg-white text-sm font-black text-ink disabled:opacity-60"
            type="button"
            disabled={isSubmitting}
            onClick={() => onCreateAccount(email, password)}
          >
            Create Account
          </button>
        </form>
      </section>
    </main>
  );
}

export function AccountWorkspacePage() {
  const supabase = useMemo(() => createPlannerSupabaseClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [groups, setGroups] = useState<WorkspaceProjectGroup[]>([]);
  const [membersByWorkspaceId, setMembersByWorkspaceId] = useState<Record<string, WorkspaceMemberProfile[]>>({});
  const [status, setStatus] = useState<"loading" | "auth" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newProjectNameByWorkspaceId, setNewProjectNameByWorkspaceId] = useState<Record<string, string>>({});
  const [workspaceNameDrafts, setWorkspaceNameDrafts] = useState<Record<string, string>>({});
  const [projectNameDrafts, setProjectNameDrafts] = useState<Record<string, string>>({});

  async function hydrate(nextSession = session) {
    if (!nextSession) {
      setStatus("auth");
      setGroups([]);
      setMembersByWorkspaceId({});
      return;
    }

    setStatus("loading");
    setMessage("");

    try {
      const nextGroups = await ensureDefaultWorkspaceMembership();
      setGroups(nextGroups);
      setWorkspaceNameDrafts(
        Object.fromEntries(nextGroups.map((group) => [group.workspace.id, group.workspace.name])),
      );
      setProjectNameDrafts(
        Object.fromEntries(nextGroups.flatMap((group) => group.projects.map((project) => [project.id, project.name]))),
      );

      const memberEntries = await Promise.all(
        nextGroups.map(async (group) => [
          group.workspace.id,
          await loadWorkspaceMembersFromSupabase(group.workspace.id).catch(() => []),
        ] as const),
      );
      setMembersByWorkspaceId(Object.fromEntries(memberEntries));
      setStatus("ready");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load account workspace data.");
      setStatus("error");
    }
  }

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return;
      if (error) {
        setMessage(error.message);
        setStatus("error");
        return;
      }
      setSession(data.session);
      void hydrate(data.session);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      void hydrate(nextSession);
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [supabase]);

  async function signIn(email: string, password: string) {
    setIsSubmitting(true);
    setMessage("");
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to sign in.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function createAccount(email: string, password: string) {
    setIsSubmitting(true);
    setMessage("");
    try {
      const { error } = await supabase.auth.signUp({ email: email.trim(), password });
      if (error) throw error;
      setMessage("Account created. Sign in after email confirmation if your workspace requires it.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to create account.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    setSession(null);
    setStatus("auth");
  }

  async function createProject(workspaceId: string) {
    const projectName = newProjectNameByWorkspaceId[workspaceId]?.trim();
    if (!projectName) {
      setMessage("Add a project name first.");
      return;
    }

    setIsSubmitting(true);
    setMessage("");
    try {
      await createProjectWithStarterPlan(workspaceId, projectName);
      setNewProjectNameByWorkspaceId((current) => ({ ...current, [workspaceId]: "" }));
      await hydrate(session);
      setMessage("Project created.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to create the project.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function saveWorkspaceName(workspaceId: string) {
    setIsSubmitting(true);
    setMessage("");
    try {
      await updateWorkspaceInSupabase(workspaceId, { name: workspaceNameDrafts[workspaceId] });
      await hydrate(session);
      setMessage("Workspace updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to update the workspace.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function saveProjectName(projectId: string) {
    setIsSubmitting(true);
    setMessage("");
    try {
      await updateProjectInSupabase(projectId, { name: projectNameDrafts[projectId] });
      await hydrate(session);
      setMessage("Project updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to update the project.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function setProjectStatus(project: Project, statusValue: Project["status"]) {
    setIsSubmitting(true);
    setMessage("");
    try {
      await updateProjectInSupabase(project.id, { status: statusValue });
      await hydrate(session);
      setMessage(statusValue === "archived" ? "Project archived." : "Project restored.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to update project status.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (status === "loading") {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f2efe6] text-ink">
        <div className="flex items-center gap-3 rounded-md border border-line bg-white px-4 py-3 text-sm font-bold text-steel shadow-sm">
          <Loader2 size={18} className="animate-spin" />
          Loading account
        </div>
      </main>
    );
  }

  if (!session || status === "auth") {
    return (
      <LoginPanel
        message={message}
        isSubmitting={isSubmitting}
        onSignIn={signIn}
        onCreateAccount={createAccount}
      />
    );
  }

  return (
    <main className="min-h-screen bg-[#f2efe6] text-ink">
      <header className="border-b border-line bg-graphite px-4 py-4 text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-wide text-white/60">BuildLogic Account</p>
            <h1 className="text-2xl font-black">Workspace & Projects</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="inline-flex h-10 items-center gap-2 rounded border border-white/15 bg-white/10 px-3 text-sm font-black text-white"
              onClick={() => hydrate(session)}
            >
              <RefreshCw size={16} />
              Refresh
            </button>
            <button
              className="inline-flex h-10 items-center gap-2 rounded border border-white/15 bg-white/10 px-3 text-sm font-black text-white"
              onClick={signOut}
            >
              <LogOut size={16} />
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl space-y-4 p-4">
        <section className="rounded-md border border-line bg-white p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <UserCircle className="mt-1 text-steel" size={22} />
            <div>
              <p className="text-xs font-black uppercase tracking-wide text-steel">Signed in as</p>
              <div className="text-lg font-black">{session.user.email}</div>
              <div className="mt-1 text-xs font-semibold text-steel">Project access is controlled by workspace membership.</div>
            </div>
          </div>
        </section>

        {message ? <p className="rounded-md border border-amber/40 bg-amber/10 px-3 py-2 text-sm font-bold text-steel">{message}</p> : null}

        {groups.map((group) => {
          const workspaceMembers = membersByWorkspaceId[group.workspace.id] ?? [];
          const editable = canEdit(group.role);
          const manageable = canManage(group.role);

          return (
            <section key={group.workspace.id} className="rounded-md border border-line bg-white shadow-sm">
              <div className="border-b border-line p-4">
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
                  <label className="block">
                    <span className="text-xs font-black uppercase tracking-wide text-steel">Workspace</span>
                    <input
                      className="mt-1 h-11 w-full rounded border border-line px-3 text-lg font-black outline-none focus:border-teal disabled:bg-[#f7f5ef]"
                      value={workspaceNameDrafts[group.workspace.id] ?? group.workspace.name}
                      onChange={(event) => setWorkspaceNameDrafts((current) => ({ ...current, [group.workspace.id]: event.target.value }))}
                      disabled={!manageable || isSubmitting}
                    />
                  </label>
                  <button
                    className="inline-flex h-11 items-center justify-center gap-2 rounded bg-ink px-4 text-sm font-black text-white disabled:opacity-50"
                    disabled={!manageable || isSubmitting || (workspaceNameDrafts[group.workspace.id] ?? group.workspace.name) === group.workspace.name}
                    onClick={() => saveWorkspaceName(group.workspace.id)}
                  >
                    <Check size={16} />
                    Save Workspace
                  </button>
                </div>
                <div className="mt-2 text-xs font-bold uppercase tracking-wide text-steel">
                  Your role: {group.role} · {group.projects.length} project(s)
                </div>
              </div>

              <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(280px,0.8fr)]">
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-steel">
                    <FolderKanban size={16} />
                    Projects
                  </div>

                  {group.projects.map((project) => (
                    <div key={project.id} className="rounded-md border border-line bg-[#f7f5ef] p-3">
                      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                        <input
                          className="h-10 min-w-0 rounded border border-line bg-white px-3 text-base font-black outline-none focus:border-teal disabled:bg-[#eee9dd]"
                          value={projectNameDrafts[project.id] ?? project.name}
                          onChange={(event) => setProjectNameDrafts((current) => ({ ...current, [project.id]: event.target.value }))}
                          disabled={!editable || isSubmitting}
                        />
                        <div className="flex flex-wrap gap-2">
                          <button
                            className="h-10 rounded border border-line bg-white px-3 text-xs font-black text-ink disabled:opacity-50"
                            disabled={!editable || isSubmitting || (projectNameDrafts[project.id] ?? project.name) === project.name}
                            onClick={() => saveProjectName(project.id)}
                          >
                            Save
                          </button>
                          <Link
                            className="inline-flex h-10 items-center gap-1 rounded bg-ink px-3 text-xs font-black text-white"
                            href={projectPlannerHref(project.id)}
                          >
                            Open
                            <ChevronRight size={15} />
                          </Link>
                          <button
                            className="inline-flex h-10 items-center gap-1 rounded border border-line bg-white px-3 text-xs font-black text-steel disabled:opacity-50"
                            disabled={!manageable || isSubmitting}
                            onClick={() => setProjectStatus(project, project.status === "archived" ? "active" : "archived")}
                          >
                            <Archive size={14} />
                            {project.status === "archived" ? "Restore" : "Archive"}
                          </button>
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-black uppercase tracking-wide text-steel">
                        <span className="rounded border border-line bg-white px-2 py-1">{project.status}</span>
                        <span className="rounded border border-line bg-white px-2 py-1">{project.id}</span>
                      </div>
                    </div>
                  ))}

                  <form
                    className="grid gap-2 rounded-md border border-dashed border-line bg-white p-3 sm:grid-cols-[minmax(0,1fr)_auto]"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void createProject(group.workspace.id);
                    }}
                  >
                    <input
                      className="h-11 rounded border border-line px-3 text-base font-bold outline-none focus:border-teal"
                      placeholder="New project name"
                      value={newProjectNameByWorkspaceId[group.workspace.id] ?? ""}
                      onChange={(event) => setNewProjectNameByWorkspaceId((current) => ({ ...current, [group.workspace.id]: event.target.value }))}
                      disabled={!editable || isSubmitting}
                    />
                    <button
                      className="inline-flex h-11 items-center justify-center gap-2 rounded bg-copper px-4 text-sm font-black text-white disabled:opacity-50"
                      disabled={!editable || isSubmitting}
                    >
                      <Plus size={16} />
                      Add Project
                    </button>
                  </form>
                </div>

                <aside className="rounded-md border border-line bg-[#f7f5ef] p-3">
                  <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-steel">
                    <Users size={16} />
                    Members
                  </div>
                  <div className="mt-3 space-y-2">
                    {workspaceMembers.length ? (
                      workspaceMembers.map((member) => (
                        <div key={member.userId} className="rounded border border-line bg-white px-3 py-2">
                          <div className="text-sm font-black">{member.fullName || (member.userId === session.user.id ? session.user.email : member.userId)}</div>
                          <div className="mt-1 text-[11px] font-black uppercase tracking-wide text-steel">{member.role}</div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded border border-line bg-white px-3 py-2 text-sm font-bold text-steel">No members visible.</div>
                    )}
                  </div>
                </aside>
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}
