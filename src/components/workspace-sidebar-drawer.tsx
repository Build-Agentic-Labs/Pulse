"use client";

import type { Session } from "@supabase/supabase-js";
import {
  Archive,
  Check,
  ChevronRight,
  ChevronsLeft,
  FolderKanban,
  Loader2,
  LogOut,
  MoreVertical,
  Plus,
  RefreshCw,
  Settings,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  createPlannerSupabaseClient,
  createProjectWithStarterPlan,
  ensureDefaultWorkspaceMembership,
  loadWorkspaceMembersFromSupabase,
  updateProjectInSupabase,
  updateWorkspaceInSupabase,
} from "@/domain/supabase-planner";
import type {
  PlannerProjectContext,
  Project,
  WorkspaceMemberProfile,
  WorkspaceProjectGroup,
  WorkspaceRole,
} from "@/domain/types";

function canManage(role?: WorkspaceRole) {
  return role === "owner" || role === "admin";
}

function canEdit(role?: WorkspaceRole) {
  return role === "owner" || role === "admin" || role === "editor";
}

function projectPlannerHref(projectId: string) {
  return `/projects/${projectId}/planner`;
}

function initials(value?: string) {
  const source = value?.trim() || "BL";
  return source
    .split(/\s+|@/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function statusClass(status: Project["status"]) {
  return status === "active"
    ? "border-teal/25 bg-teal/10 text-teal"
    : "border-line bg-white text-steel";
}

function ProjectRow({
  project,
  active,
  editable,
  manageable,
  isSubmitting,
  draft,
  editing,
  onEdit,
  onDraftChange,
  onSave,
  onCancel,
  onStatusChange,
  menuOpen,
  onToggleMenu,
}: {
  project: Project;
  active: boolean;
  editable: boolean;
  manageable: boolean;
  isSubmitting: boolean;
  draft: string;
  editing: boolean;
  onEdit: () => void;
  onDraftChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onStatusChange: (status: Project["status"]) => void;
  menuOpen: boolean;
  onToggleMenu: () => void;
}) {
  if (editing) {
    return (
      <div className="border-b border-line/80 px-3 py-3">
        <input
          className="h-9 w-full rounded border border-line bg-white px-2 text-sm font-black text-ink outline-none focus:border-teal"
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          disabled={isSubmitting}
          autoFocus
        />
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            className="inline-flex h-8 flex-1 items-center justify-center gap-1 rounded bg-ink text-xs font-black text-white disabled:opacity-50"
            onClick={onSave}
            disabled={isSubmitting || !draft.trim() || draft.trim() === project.name}
          >
            <Check size={14} />
            Save
          </button>
          <button
            type="button"
            className="inline-flex h-8 items-center justify-center rounded border border-line bg-white px-3 text-xs font-black text-steel"
            onClick={onCancel}
            disabled={isSubmitting}
            aria-label="Cancel project rename"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`group relative border-b border-line/80 transition ${
        active ? "bg-[#eef6f2]" : "bg-transparent hover:bg-[#fbfaf6]"
      }`}
    >
      <Link href={projectPlannerHref(project.id)} className="block py-3 pl-3 pr-11">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-black text-ink">{project.name}</div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span className={`rounded border px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide ${statusClass(project.status)}`}>
                {project.status}
              </span>
              {active ? (
                <span className="rounded border border-copper/30 bg-copper/10 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-copper">
                  Current
                </span>
              ) : null}
            </div>
          </div>
          <ChevronRight size={16} className="mt-0.5 shrink-0 text-steel/70" />
        </div>
      </Link>
      {editable || manageable ? (
        <>
          <button
            type="button"
            className="absolute right-2 top-3 inline-flex h-8 w-8 items-center justify-center rounded text-steel hover:bg-white hover:text-ink disabled:opacity-50"
            onClick={onToggleMenu}
            disabled={isSubmitting}
            aria-label={`Open ${project.name} project actions`}
            aria-expanded={menuOpen}
          >
            <MoreVertical size={16} />
          </button>
          {menuOpen ? (
            <div className="absolute right-2 top-10 z-20 w-40 overflow-hidden rounded-md border border-line bg-white py-1 shadow-soft">
              <button
                type="button"
                className="block h-8 w-full px-3 text-left text-xs font-black text-ink hover:bg-[#f4f0e7] disabled:opacity-50"
                onClick={onEdit}
                disabled={!editable || isSubmitting}
              >
                Rename
              </button>
              <button
                type="button"
                className="flex h-8 w-full items-center gap-2 px-3 text-left text-xs font-black text-steel hover:bg-[#f4f0e7] hover:text-copper disabled:opacity-50"
                onClick={() => onStatusChange(project.status === "archived" ? "active" : "archived")}
                disabled={!manageable || isSubmitting}
              >
                <Archive size={13} />
                {project.status === "archived" ? "Restore" : "Archive"}
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export function WorkspaceSidebarDrawer({
  activeProject,
  onClose,
}: {
  activeProject?: PlannerProjectContext;
  onClose: () => void;
}) {
  const supabase = useMemo(() => createPlannerSupabaseClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [groups, setGroups] = useState<WorkspaceProjectGroup[]>([]);
  const [membersByWorkspaceId, setMembersByWorkspaceId] = useState<Record<string, WorkspaceMemberProfile[]>>({});
  const [status, setStatus] = useState<"loading" | "ready" | "auth" | "error">("loading");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string>();
  const [editingProjectId, setEditingProjectId] = useState<string>();
  const [openProjectMenuId, setOpenProjectMenuId] = useState<string>();
  const [workspaceNameDrafts, setWorkspaceNameDrafts] = useState<Record<string, string>>({});
  const [projectNameDrafts, setProjectNameDrafts] = useState<Record<string, string>>({});
  const [newProjectNameByWorkspaceId, setNewProjectNameByWorkspaceId] = useState<Record<string, string>>({});

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
      setWorkspaceNameDrafts(Object.fromEntries(nextGroups.map((group) => [group.workspace.id, group.workspace.name])));
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
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Unable to load workspace data.");
    }
  }

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return;
      if (error) {
        setStatus("error");
        setMessage(error.message);
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

  async function signOut() {
    await supabase.auth.signOut();
    setSession(null);
    setStatus("auth");
  }

  async function saveWorkspaceName(workspaceId: string) {
    setIsSubmitting(true);
    setMessage("");
    try {
      await updateWorkspaceInSupabase(workspaceId, { name: workspaceNameDrafts[workspaceId] });
      setEditingWorkspaceId(undefined);
      await hydrate(session);
      setMessage("Workspace updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to update workspace.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function saveProjectName(projectId: string) {
    setIsSubmitting(true);
    setMessage("");
    try {
      await updateProjectInSupabase(projectId, { name: projectNameDrafts[projectId] });
      setEditingProjectId(undefined);
      setOpenProjectMenuId(undefined);
      await hydrate(session);
      setMessage("Project updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to update project.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function setProjectStatus(project: Project, nextStatus: Project["status"]) {
    setIsSubmitting(true);
    setMessage("");
    try {
      await updateProjectInSupabase(project.id, { status: nextStatus });
      setOpenProjectMenuId(undefined);
      await hydrate(session);
      setMessage(nextStatus === "archived" ? "Project archived." : "Project restored.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to update project status.");
    } finally {
      setIsSubmitting(false);
    }
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
      setMessage(error instanceof Error ? error.message : "Unable to create project.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <aside
      id="workspace-sidebar-drawer"
      className="hidden min-h-0 border-r border-line bg-[#f7f5ef] text-ink shadow-[inset_-1px_0_0_rgba(25,37,31,0.05)] lg:flex lg:flex-col"
    >
      <div className="border-b border-line bg-white px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-steel">
              <FolderKanban size={15} />
              Workspace
            </div>
            <div className="mt-2 truncate text-lg font-black text-ink">
              {activeProject?.workspaceName ?? "BuildLogic"}
            </div>
            <div className="truncate text-xs font-bold text-steel">
              {activeProject?.projectName ?? "Select a project"}
            </div>
          </div>
          <button
            type="button"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded border border-line bg-white text-steel hover:bg-[#f4f0e7] hover:text-ink"
            onClick={onClose}
            title="Collapse workspace drawer"
            aria-label="Collapse workspace drawer"
          >
            <ChevronsLeft size={17} />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-white">
        {status === "loading" ? (
          <div className="flex items-center gap-2 px-4 py-4 text-sm font-black text-steel">
            <Loader2 size={16} className="animate-spin" />
            Loading workspace
          </div>
        ) : null}

        {status === "auth" ? (
          <div className="px-4 py-4">
            <div className="text-sm font-black text-ink">Sign in required</div>
            <div className="mt-1 text-xs font-semibold text-steel">Your planner projects are scoped to a workspace account.</div>
            <Link className="mt-3 inline-flex h-9 items-center rounded bg-ink px-3 text-xs font-black text-white" href="/login">
              Sign In
            </Link>
          </div>
        ) : null}

        {message ? (
          <div className="border-b border-amber/30 bg-amber/10 px-4 py-2 text-xs font-bold text-steel">{message}</div>
        ) : null}

        {status === "ready" ? (
          <div>
            <section className="border-b border-line px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-ink text-xs font-black text-white">
                  {initials(session?.user.email)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-black text-ink">{session?.user.email}</div>
                  <div className="text-[11px] font-black uppercase tracking-wide text-steel">Signed in</div>
                </div>
                <button
                  type="button"
                  className="inline-flex h-8 w-8 items-center justify-center rounded border border-line text-steel hover:bg-[#f4f0e7] hover:text-ink"
                  onClick={signOut}
                  title="Sign out"
                  aria-label="Sign out"
                >
                  <LogOut size={15} />
                </button>
              </div>
            </section>

            {groups.map((group) => {
              const editable = canEdit(group.role);
              const manageable = canManage(group.role);
              const members = membersByWorkspaceId[group.workspace.id] ?? [];
              const activeWorkspace = group.workspace.id === activeProject?.workspaceId;
              const workspaceDraft = workspaceNameDrafts[group.workspace.id] ?? group.workspace.name;

              return (
                <section key={group.workspace.id} className={activeWorkspace ? "border-l-2 border-teal" : ""}>
                  <div className="border-b border-line px-4 py-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] font-black uppercase tracking-wide text-steel">Workspace</div>
                        {editingWorkspaceId === group.workspace.id ? (
                          <div className="mt-2 flex gap-2">
                            <input
                              className="h-9 min-w-0 flex-1 rounded border border-line px-2 text-sm font-black outline-none focus:border-teal"
                              value={workspaceDraft}
                              onChange={(event) => setWorkspaceNameDrafts((current) => ({ ...current, [group.workspace.id]: event.target.value }))}
                              disabled={isSubmitting}
                              autoFocus
                            />
                            <button
                              type="button"
                              className="inline-flex h-9 w-9 items-center justify-center rounded bg-ink text-white disabled:opacity-50"
                              onClick={() => saveWorkspaceName(group.workspace.id)}
                              disabled={isSubmitting || !workspaceDraft.trim() || workspaceDraft.trim() === group.workspace.name}
                            >
                              <Check size={15} />
                            </button>
                          </div>
                        ) : (
                          <div className="mt-1 truncate text-base font-black text-ink">{group.workspace.name}</div>
                        )}
                        <div className="mt-1 text-[11px] font-black uppercase tracking-wide text-steel">
                          {group.role} · {group.projects.length} project(s)
                        </div>
                      </div>
                      {manageable && editingWorkspaceId !== group.workspace.id ? (
                        <button
                          type="button"
                          className="text-[11px] font-black uppercase tracking-wide text-steel hover:text-copper"
                          onClick={() => setEditingWorkspaceId(group.workspace.id)}
                          disabled={isSubmitting}
                        >
                          Edit
                        </button>
                      ) : null}
                    </div>
                  </div>

                  <div className="border-b border-line">
                    <div className="px-4 pb-1 pt-4 text-[11px] font-black uppercase tracking-wide text-steel">Projects</div>
                    <div>
                      {group.projects.map((project) => (
                        <ProjectRow
                          key={project.id}
                          project={project}
                          active={project.id === activeProject?.projectId}
                          editable={editable}
                          manageable={manageable}
                          isSubmitting={isSubmitting}
                          draft={projectNameDrafts[project.id] ?? project.name}
                          editing={editingProjectId === project.id}
                          menuOpen={openProjectMenuId === project.id}
                          onToggleMenu={() => setOpenProjectMenuId((current) => (current === project.id ? undefined : project.id))}
                          onEdit={() => {
                            setEditingProjectId(project.id);
                            setOpenProjectMenuId(undefined);
                          }}
                          onDraftChange={(value) => setProjectNameDrafts((current) => ({ ...current, [project.id]: value }))}
                          onSave={() => saveProjectName(project.id)}
                          onCancel={() => {
                            setEditingProjectId(undefined);
                            setProjectNameDrafts((current) => ({ ...current, [project.id]: project.name }));
                          }}
                          onStatusChange={(nextStatus) => setProjectStatus(project, nextStatus)}
                        />
                      ))}
                    </div>

                    <form
                      className="px-3 py-3"
                      onSubmit={(event: FormEvent<HTMLFormElement>) => {
                        event.preventDefault();
                        void createProject(group.workspace.id);
                      }}
                    >
                      <div className="grid grid-cols-[minmax(0,1fr)_108px] gap-2">
                        <input
                          className="h-9 min-w-0 border-b border-line bg-transparent px-1 text-sm font-bold outline-none focus:border-copper"
                          placeholder="New project"
                          value={newProjectNameByWorkspaceId[group.workspace.id] ?? ""}
                          onChange={(event) => setNewProjectNameByWorkspaceId((current) => ({ ...current, [group.workspace.id]: event.target.value }))}
                          disabled={!editable || isSubmitting}
                        />
                        <button
                          type="submit"
                          className="inline-flex h-9 items-center justify-center gap-1 rounded bg-copper text-xs font-black text-white disabled:opacity-50"
                          disabled={!editable || isSubmitting}
                        >
                          <Plus size={14} />
                          Add
                        </button>
                      </div>
                    </form>
                  </div>

                  <div className="px-4 py-3">
                    <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-wide text-steel">
                      <Users size={14} />
                      Members · {members.length}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {members.length ? (
                        members.slice(0, 8).map((member) => (
                          <div
                            key={member.userId}
                            className="flex h-8 min-w-8 items-center justify-center rounded bg-[#f4f0e7] px-2 text-[10px] font-black text-steel"
                            title={`${member.fullName || member.userId} · ${member.role}`}
                          >
                            {initials(member.fullName || member.userId)}
                          </div>
                        ))
                      ) : (
                        <span className="text-xs font-bold text-steel">No members visible.</span>
                      )}
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
        ) : null}
      </div>

      <div className="border-t border-line bg-white p-3">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            className="inline-flex h-9 items-center justify-center gap-2 rounded border border-line bg-white text-xs font-black text-steel hover:bg-[#f4f0e7] hover:text-ink"
            onClick={() => hydrate(session)}
            disabled={isSubmitting || status === "loading"}
          >
            <RefreshCw size={14} />
            Refresh
          </button>
          <Link
            href="/account"
            className="inline-flex h-9 items-center justify-center gap-2 rounded border border-line bg-white text-xs font-black text-steel hover:bg-[#f4f0e7] hover:text-ink"
          >
            <Settings size={14} />
            Account
          </Link>
        </div>
      </div>
    </aside>
  );
}
