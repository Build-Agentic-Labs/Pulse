"use client";

import type { Session } from "@supabase/supabase-js";
import { Archive, Check, ChevronRight, FolderKanban, LogOut, MailPlus, Moon, Plus, RefreshCw, Sun, Trash2, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppLoadingShell, AuthFormPanel, ErrorRecoveryPanel } from "@/components/app-flow-panels";
import { useTheme } from "@/components/theme-provider";
import { displayWorkspaceName } from "@/lib/display-names";
import { resolveSupabaseSession } from "@/lib/supabase-auth";
import {
  createPlannerSupabaseClient,
  createProjectWithStarterPlan,
  deleteWorkspaceAccessGrantFromSupabase,
  ensureDefaultWorkspaceMembership,
  loadWorkspaceAccessGrantsFromSupabase,
  loadWorkspaceMembersFromSupabase,
  loadWorkspaceProjectGroups,
  upsertWorkspaceAccessGrantInSupabase,
  updateProjectInSupabase,
  updateWorkspaceInSupabase,
} from "@/domain/supabase-planner";
import type { Project, WorkspaceAccessGrant, WorkspaceMemberProfile, WorkspaceProjectGroup, WorkspaceRole } from "@/domain/types";

function canManage(role?: string) {
  return role === "owner" || role === "admin";
}

function canEdit(role?: string) {
  return role === "owner" || role === "admin" || role === "editor";
}

function projectPlannerHref(projectId: string) {
  return `/projects/${projectId}/planner`;
}

export function AccountWorkspacePage() {
  const supabase = useMemo(() => createPlannerSupabaseClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [groups, setGroups] = useState<WorkspaceProjectGroup[]>([]);
  const [membersByWorkspaceId, setMembersByWorkspaceId] = useState<Record<string, WorkspaceMemberProfile[]>>({});
  const [grantsByWorkspaceId, setGrantsByWorkspaceId] = useState<Record<string, WorkspaceAccessGrant[]>>({});
  const [status, setStatus] = useState<"loading" | "auth" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newProjectNameByWorkspaceId, setNewProjectNameByWorkspaceId] = useState<Record<string, string>>({});
  const [grantEmailByWorkspaceId, setGrantEmailByWorkspaceId] = useState<Record<string, string>>({});
  const [grantRoleByWorkspaceId, setGrantRoleByWorkspaceId] = useState<Record<string, WorkspaceRole>>({});
  const [workspaceNameDrafts, setWorkspaceNameDrafts] = useState<Record<string, string>>({});
  const [projectNameDrafts, setProjectNameDrafts] = useState<Record<string, string>>({});
  const statusRef = useRef(status);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  async function hydrate(nextSession = session, options: { showLoading?: boolean } = {}) {
    if (!nextSession) {
      setStatus("auth");
      setGroups([]);
      setMembersByWorkspaceId({});
      setGrantsByWorkspaceId({});
      return;
    }

    if (options.showLoading ?? statusRef.current !== "ready") {
      setStatus("loading");
    }
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

      const grantEntries = await Promise.all(
        nextGroups.map(async (group) => [
          group.workspace.id,
          canManage(group.role) ? await loadWorkspaceAccessGrantsFromSupabase(group.workspace.id).catch(() => []) : [],
        ] as const),
      );
      setGrantsByWorkspaceId(Object.fromEntries(grantEntries));
      setStatus("ready");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load account workspace data.");
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
        return;
      }
      setSession(nextSession);
      void hydrate(nextSession);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      if (event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
        return;
      }
      void hydrate(nextSession, { showLoading: statusRef.current !== "ready" });
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

  async function signInWithMicrosoft() {
    setIsSubmitting(true);
    setMessage("");
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "azure",
        options: {
          redirectTo: typeof window !== "undefined" ? window.location.href : undefined,
          scopes: "email profile openid",
        },
      });
      if (error) throw error;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to start Microsoft sign in.");
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

  async function saveAccessGrant(workspaceId: string) {
    const email = grantEmailByWorkspaceId[workspaceId]?.trim();
    if (!email) {
      setMessage("Add an Anacorp email first.");
      return;
    }

    setIsSubmitting(true);
    setMessage("");
    try {
      await upsertWorkspaceAccessGrantInSupabase(workspaceId, email, grantRoleByWorkspaceId[workspaceId] ?? "editor");
      setGrantEmailByWorkspaceId((current) => ({ ...current, [workspaceId]: "" }));
      await hydrate(session);
      setMessage("Access grant saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save access grant.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function removeAccessGrant(workspaceId: string, email: string) {
    setIsSubmitting(true);
    setMessage("");
    try {
      await deleteWorkspaceAccessGrantFromSupabase(workspaceId, email);
      await hydrate(session);
      setMessage("Access grant removed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to remove access grant.");
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
      <AppLoadingShell title="Loading account" />
    );
  }

  if (!session || status === "auth") {
    return (
      <AuthFormPanel
        eyebrow="Pulse Account"
        title="Sign in to manage workspaces"
        message={message}
        isSubmitting={isSubmitting}
        onSignIn={signIn}
        onCreateAccount={createAccount}
      />
    );
  }

  if (status === "error") {
    return (
      <ErrorRecoveryPanel
        title="Account failed to load"
        body={message || "The app could not load workspace and project settings."}
        onRetry={() => void hydrate(session, { showLoading: true })}
      />
    );
  }

  return (
    <div className="fixed inset-0 flex h-[100dvh] flex-col overflow-hidden bg-canvas text-ink">
      <AccountHeader
        onRefresh={() => void hydrate(session)}
        onSignOut={() => void signOut()}
        isSubmitting={isSubmitting}
      />

      <main className="min-h-0 flex-1 overflow-auto p-3 sm:p-4">
        <div className="mx-auto max-w-3xl space-y-5">
          <div>
            <h1 className="ui-section-title">Account</h1>
            <p className="ui-section-subtitle">Manage workspaces, projects, and membership.</p>
          </div>

          <section className="ui-panel px-4 py-3">
            <div className="ui-settings-row">
              <div className="ui-settings-row-label">Signed in as</div>
              <div>
                <div className="ui-settings-row-value">{session.user.email}</div>
                <p className="mt-1 text-[11px] text-ink-tertiary">Project access is controlled by workspace membership.</p>
              </div>
            </div>
          </section>

          {message ? (
            <div className="ui-notice ui-notice-warn px-4 py-3 text-[12px] text-ink-secondary">{message}</div>
          ) : null}

          {groups.map((group) => {
            const workspaceMembers = membersByWorkspaceId[group.workspace.id] ?? [];
            const editable = canEdit(group.role);
            const manageable = canManage(group.role);
            const workspaceName = workspaceNameDrafts[group.workspace.id] ?? group.workspace.name;

            return (
              <section key={group.workspace.id} className="ui-panel overflow-hidden">
                <div className="border-b border-line px-4 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-medium text-ink">{displayWorkspaceName(group.workspace.name)}</h2>
                      <p className="mt-1 text-[11px] text-ink-tertiary">
                        {group.role} · {group.projects.length} project{group.projects.length === 1 ? "" : "s"}
                      </p>
                    </div>
                    {manageable ? (
                      <button
                        type="button"
                        className="ui-btn-ghost h-8 gap-1.5 px-3 text-[10px] disabled:opacity-50"
                        disabled={isSubmitting || workspaceName === group.workspace.name}
                        onClick={() => void saveWorkspaceName(group.workspace.id)}
                      >
                        <Check size={12} />
                        Save name
                      </button>
                    ) : null}
                  </div>

                  {manageable ? (
                    <label className="mt-4 block">
                      <span className="ui-field-label">Workspace name</span>
                      <input
                        className="ui-field-standalone"
                        value={workspaceName}
                        onChange={(event) =>
                          setWorkspaceNameDrafts((current) => ({ ...current, [group.workspace.id]: event.target.value }))
                        }
                        disabled={isSubmitting}
                      />
                    </label>
                  ) : null}
                </div>

                <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_240px]">
                  <div className="min-w-0 border-b border-line xl:border-b-0 xl:border-r">
                    <div className="border-b border-line px-4 py-3">
                      <div className="flex items-center gap-2">
                        <FolderKanban size={14} className="text-ink-tertiary" />
                        <span className="ui-setup-section-title">Projects</span>
                      </div>
                    </div>

                    <div className="divide-y divide-line">
                      {group.projects.map((project) => {
                        const projectName = projectNameDrafts[project.id] ?? project.name;

                        return (
                          <div key={project.id} className="space-y-3 px-4 py-4">
                            <label className="block">
                              <span className="ui-field-label">Project</span>
                              <input
                                className="ui-field-standalone"
                                value={projectName}
                                onChange={(event) =>
                                  setProjectNameDrafts((current) => ({ ...current, [project.id]: event.target.value }))
                                }
                                disabled={!editable || isSubmitting}
                              />
                            </label>

                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                className="ui-btn-ghost h-8 px-3 text-[10px] disabled:opacity-50"
                                disabled={!editable || isSubmitting || projectName === project.name}
                                onClick={() => void saveProjectName(project.id)}
                              >
                                Save
                              </button>
                              <Link
                                className="ui-btn-ghost h-8 gap-1 px-3 text-[10px]"
                                href={projectPlannerHref(project.id)}
                              >
                                Open
                                <ChevronRight size={12} />
                              </Link>
                              <button
                                type="button"
                                className="ui-btn-ghost h-8 gap-1 px-2 text-[10px] disabled:opacity-50"
                                disabled={!manageable || isSubmitting}
                                onClick={() => void setProjectStatus(project, project.status === "archived" ? "active" : "archived")}
                              >
                                <Archive size={12} />
                                {project.status === "archived" ? "Restore" : "Archive"}
                              </button>
                            </div>

                            <div className="flex flex-wrap gap-2">
                              <span className="ui-chip">{project.status}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <form
                      className="border-t border-line px-4 py-4"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void createProject(group.workspace.id);
                      }}
                    >
                      <span className="ui-field-label">New project</span>
                      <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                        <input
                          className="ui-field-standalone"
                          placeholder="Project name"
                          value={newProjectNameByWorkspaceId[group.workspace.id] ?? ""}
                          onChange={(event) =>
                            setNewProjectNameByWorkspaceId((current) => ({
                              ...current,
                              [group.workspace.id]: event.target.value,
                            }))
                          }
                          disabled={!editable || isSubmitting}
                        />
                        <button
                          type="submit"
                          className="ui-btn-ghost h-10 gap-1.5 px-4 text-[10px] disabled:opacity-50"
                          disabled={!editable || isSubmitting}
                        >
                          <Plus size={14} />
                          Add
                        </button>
                      </div>
                    </form>
                  </div>

                  <aside className="px-4 py-4">
                    <div className="flex items-center gap-2">
                      <Users size={14} className="text-ink-tertiary" />
                      <span className="ui-setup-section-title">Members</span>
                    </div>
                    <div className="mt-3 divide-y divide-line rounded-lg border border-line">
                      {workspaceMembers.length ? (
                        workspaceMembers.map((member) => (
                          <div key={member.userId} className="px-3 py-2.5">
                            <div className="text-[13px] font-medium text-ink">
                              {member.fullName ||
                                (member.userId === session.user.id ? session.user.email : member.userId)}
                            </div>
                            <div className="mt-0.5 text-[11px] uppercase tracking-wide text-ink-tertiary">{member.role}</div>
                          </div>
                        ))
                      ) : (
                        <div className="px-3 py-2.5 text-[12px] text-ink-tertiary">No members visible.</div>
                      )}
                    </div>

                    {manageable ? (
                      <div className="mt-5">
                        <div className="flex items-center gap-2">
                          <MailPlus size={14} className="text-ink-tertiary" />
                          <span className="ui-setup-section-title">Access grants</span>
                        </div>

                        <form
                          className="mt-3 space-y-2"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void saveAccessGrant(group.workspace.id);
                          }}
                        >
                          <label className="block">
                            <span className="ui-field-label">Work email</span>
                            <input
                              className="ui-field-standalone h-9 px-3 text-[12px]"
                              type="email"
                              placeholder="name@anacorp.com"
                              value={grantEmailByWorkspaceId[group.workspace.id] ?? ""}
                              onChange={(event) =>
                                setGrantEmailByWorkspaceId((current) => ({
                                  ...current,
                                  [group.workspace.id]: event.target.value,
                                }))
                              }
                              disabled={isSubmitting}
                            />
                          </label>

                          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                            <select
                              className="ui-field-standalone h-9 px-3 text-[12px]"
                              value={grantRoleByWorkspaceId[group.workspace.id] ?? "editor"}
                              onChange={(event) =>
                                setGrantRoleByWorkspaceId((current) => ({
                                  ...current,
                                  [group.workspace.id]: event.target.value as WorkspaceRole,
                                }))
                              }
                              disabled={isSubmitting}
                            >
                              <option value="viewer">Viewer</option>
                              <option value="editor">Editor</option>
                              <option value="admin">Admin</option>
                              <option value="owner">Owner</option>
                            </select>
                            <button
                              type="submit"
                              className="ui-btn-ghost h-9 gap-1.5 px-3 text-[10px] disabled:opacity-50"
                              disabled={isSubmitting}
                            >
                              <Plus size={13} />
                              Grant
                            </button>
                          </div>
                        </form>

                        <div className="mt-3 divide-y divide-line rounded-lg border border-line">
                          {(grantsByWorkspaceId[group.workspace.id] ?? []).length ? (
                            (grantsByWorkspaceId[group.workspace.id] ?? []).map((grant) => (
                              <div key={grant.email} className="flex items-center justify-between gap-2 px-3 py-2.5">
                                <div className="min-w-0">
                                  <div className="truncate text-[12px] font-medium text-ink">{grant.email}</div>
                                  <div className="mt-0.5 text-[10px] uppercase tracking-wide text-ink-tertiary">
                                    {grant.role}
                                    {grant.redeemedAt ? " - redeemed" : ""}
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  className="ui-btn-ghost h-8 w-8 shrink-0 px-0 text-danger disabled:opacity-50"
                                  disabled={isSubmitting}
                                  onClick={() => void removeAccessGrant(group.workspace.id, grant.email)}
                                  title="Remove grant"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            ))
                          ) : (
                            <div className="px-3 py-2.5 text-[12px] text-ink-tertiary">No grants yet.</div>
                          )}
                        </div>
                      </div>
                    ) : null}
                  </aside>
                </div>
              </section>
            );
          })}
        </div>
      </main>
    </div>
  );
}

function AccountHeader({
  onRefresh,
  onSignOut,
  isSubmitting,
}: {
  onRefresh: () => void;
  onSignOut: () => void;
  isSubmitting: boolean;
}) {
  const { theme, toggleTheme } = useTheme();

  return (
    <header className="ui-chrome z-40 flex h-12 shrink-0 items-center justify-between px-3 sm:px-4">
      <div className="flex min-w-0 items-center gap-3">
        <Link href="/" className="ui-brand-compact">
          Pulse
        </Link>
        <span className="hidden text-ink-tertiary sm:inline">/</span>
        <span className="hidden truncate text-[12px] text-ink-secondary sm:inline">Account</span>
      </div>

      <div className="flex items-center gap-0.5 sm:gap-1">
        <button type="button" onClick={toggleTheme} className="ui-btn-ghost h-10" title="Toggle theme">
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <button
          type="button"
          onClick={onRefresh}
          disabled={isSubmitting}
          className="ui-btn-ghost h-10 gap-2 disabled:opacity-50"
        >
          <RefreshCw size={16} />
          Refresh
        </button>
        <button type="button" onClick={onSignOut} className="ui-btn-ghost h-10 gap-2">
          <LogOut size={16} />
          Sign out
        </button>
      </div>
    </header>
  );
}
