"use client";

import { Check, FolderKanban, MoreHorizontal, Plus, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  createPlannerSupabaseClient,
  createProjectWithStarterPlan,
  deleteProjectFromSupabase,
  ensureDefaultWorkspaceMembership,
  updateProjectInSupabase,
} from "@/domain/supabase-planner";
import type { PlannerProjectContext, Project, WorkspaceRole } from "@/domain/types";
import { resolveSupabaseSession } from "@/lib/supabase-auth";
import { ThemedFeedbackLayer, type FeedbackConfirm } from "./themed-feedback";
import { UiContextMenu } from "./ui-context-menu";

const LAST_PROJECT_STORAGE_KEY = "pulse:last-project-id";

function projectFromContext(project: PlannerProjectContext): Project {
  return {
    id: project.projectId,
    workspaceId: project.workspaceId,
    name: project.projectName,
    status: "active",
    createdAt: "",
    updatedAt: "",
  };
}

function canEdit(role?: WorkspaceRole) {
  return role === "owner" || role === "admin" || role === "editor";
}

function canManage(role?: WorkspaceRole) {
  return role === "owner" || role === "admin";
}

function projectPlannerHref(projectId: string) {
  return `/projects/${projectId}/planner`;
}

function clearLastProjectIdIfMatch(projectId: string) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    if (window.localStorage.getItem(LAST_PROJECT_STORAGE_KEY) === projectId) {
      window.localStorage.removeItem(LAST_PROJECT_STORAGE_KEY);
    }
  } catch {
    // Ignore storage failures in private browsing.
  }
}

export function SidebarWorkspacePanel({
  activeProject,
}: {
  activeProject?: PlannerProjectContext;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createPlannerSupabaseClient(), []);
  const [projects, setProjects] = useState<Project[]>(() => (activeProject ? [projectFromContext(activeProject)] : []));
  const [workspaceId, setWorkspaceId] = useState<string | undefined>(() => activeProject?.workspaceId);
  const [role, setRole] = useState<WorkspaceRole | undefined>(() => activeProject?.role);
  const [status, setStatus] = useState<"loading" | "ready" | "auth" | "error">(() =>
    activeProject ? "ready" : "loading",
  );
  const [isAdding, setIsAdding] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createError, setCreateError] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [feedbackConfirm, setFeedbackConfirm] = useState<FeedbackConfirm>();
  const [contextMenu, setContextMenu] = useState<{ project: Project; anchorRect: DOMRect } | null>(null);
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  useEffect(() => {
    if (!activeProject) return;
    const fallbackProject = projectFromContext(activeProject);
    setWorkspaceId(activeProject.workspaceId);
    setRole(activeProject.role);
    setStatus((current) => (current === "loading" ? "ready" : current));
    setProjects((current) => {
      if (current.some((project) => project.id === activeProject.projectId)) {
        return current.map((project) =>
          project.id === activeProject.projectId ? { ...fallbackProject, ...project, name: activeProject.projectName } : project,
        );
      }
      return [fallbackProject, ...current];
    });
  }, [activeProject?.projectId, activeProject?.projectName, activeProject?.workspaceId, activeProject?.role]);

  async function hydrate() {
    try {
      const groups = await ensureDefaultWorkspaceMembership();
      const group =
        groups.find((entry) => entry.workspace.id === activeProject?.workspaceId) ?? groups[0];

      if (!group) {
        setProjects([]);
        setWorkspaceId(undefined);
        setRole(undefined);
        setStatus("ready");
        return [];
      }

      const nextProjects = group.projects.filter((project) => project.status !== "archived");
      setWorkspaceId(group.workspace.id);
      setRole(group.role);
      setProjects(nextProjects);
      setStatus("ready");
      return nextProjects;
    } catch {
      setStatus("error");
      return [];
    }
  }

  useEffect(() => {
    let mounted = true;

    void resolveSupabaseSession(supabase).then(({ session }) => {
      if (!mounted) return;
      if (!session) {
        setStatus("auth");
        return;
      }
      void hydrate();
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        setStatus("auth");
        setProjects([]);
        return;
      }
      void hydrate();
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [supabase, activeProject?.workspaceId]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceId || !newProjectName.trim()) {
      return;
    }

    setIsSubmitting(true);
    setCreateError("");
    try {
      const created = await createProjectWithStarterPlan(workspaceId, newProjectName.trim());
      setNewProjectName("");
      setIsAdding(false);
      await hydrate();
      router.push(projectPlannerHref(created.projectId));
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Unable to create project.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function requestDeleteProject(project: Project, anchorRect: DOMRect) {
    setDeleteError("");
    setFeedbackConfirm({
      title: "Remove project?",
      body: `"${project.name}" and all of its planner data will be permanently deleted. This cannot be undone.`,
      tone: "danger",
      confirmLabel: "Remove",
      cancelLabel: "Keep",
      placement: "anchor",
      anchorRect: {
        top: anchorRect.top,
        right: anchorRect.right,
        bottom: anchorRect.bottom,
        left: anchorRect.left,
        width: anchorRect.width,
        height: anchorRect.height,
      },
      onConfirm: () => {
        void executeDeleteProject(project);
      },
    });
  }

  async function executeDeleteProject(project: Project) {
    setIsSubmitting(true);
    setDeleteError("");
    try {
      await deleteProjectFromSupabase(project.id);
      clearLastProjectIdIfMatch(project.id);

      const wasActive = project.id === activeProject?.projectId;
      const remaining = await hydrate();

      if (wasActive) {
        const nextProject = remaining[0];
        router.push(nextProject ? projectPlannerHref(nextProject.id) : "/");
      }
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Unable to remove project.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function archiveProject(project: Project) {
    setIsSubmitting(true);
    setDeleteError("");
    try {
      await updateProjectInSupabase(project.id, { status: "archived" });

      const wasActive = project.id === activeProject?.projectId;
      const remaining = await hydrate();

      if (wasActive) {
        const nextProject = remaining[0];
        router.push(nextProject ? projectPlannerHref(nextProject.id) : "/");
      }
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Unable to archive project.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function saveProjectRename(projectId: string) {
    const nextName = renameDraft.trim();
    if (!nextName) {
      return;
    }

    setIsSubmitting(true);
    setDeleteError("");
    try {
      await updateProjectInSupabase(projectId, { name: nextName });
      setRenamingProjectId(null);
      setRenameDraft("");
      await hydrate();
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Unable to rename project.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function openProjectMenu(project: Project, anchorRect: DOMRect) {
    setContextMenu({ project, anchorRect });
  }

  function startRenameProject(project: Project) {
    setRenamingProjectId(project.id);
    setRenameDraft(project.name);
  }

  return (
    <>
      <div className="px-2 py-2">
        <div className="group flex items-center justify-between gap-1">
          <div className="ui-nav-section mb-0 px-2">Workspace</div>
          {status === "ready" && canEdit(role) ? (
            <button
              type="button"
              className="ui-btn-ghost h-6 w-6 shrink-0 px-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
              onClick={() => {
                setIsAdding((open) => !open);
                setCreateError("");
              }}
              title="Add project"
              aria-label="Add project"
              aria-expanded={isAdding}
            >
              <Plus size={14} />
            </button>
          ) : null}
        </div>

        <div className="mt-1 space-y-0.5">
          {status === "loading" ? (
            <div className="px-2 py-1.5 text-[11px] text-ink-tertiary">Loading projects…</div>
          ) : null}

          {status === "auth" ? (
            <Link href="/login" className="ui-nav-context">
              <FolderKanban size={15} strokeWidth={1.75} className="shrink-0 text-ink-tertiary" />
              <span className="min-w-0 flex-1 truncate">Sign in</span>
            </Link>
          ) : null}

          {status === "error" ? (
            <button type="button" className="ui-nav-context w-full" onClick={() => void hydrate()}>
              <FolderKanban size={15} strokeWidth={1.75} className="shrink-0 text-ink-tertiary" />
              <span className="min-w-0 flex-1 truncate">Retry projects</span>
            </button>
          ) : null}

          {status === "ready"
            ? projects.map((project) => {
                const active = project.id === activeProject?.projectId;
                const isRenaming = renamingProjectId === project.id;
                return (
                  <div
                    key={project.id}
                    data-project-row
                    className={`group/project ui-nav-item ${active ? "ui-nav-item-active" : "ui-nav-item-idle"}`}
                  >
                    {isRenaming ? (
                      <form
                        className="flex min-w-0 flex-1 items-center gap-1"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void saveProjectRename(project.id);
                        }}
                      >
                        <FolderKanban size={15} strokeWidth={1.75} className="shrink-0 text-ink-tertiary" />
                        <input
                          className="ui-field-standalone h-7 min-w-0 flex-1 rounded-md px-2 text-[11px] font-normal"
                          value={renameDraft}
                          onChange={(event) => setRenameDraft(event.target.value)}
                          disabled={isSubmitting}
                          autoFocus
                        />
                        <button
                          type="submit"
                          className="ui-btn-ghost h-6 w-6 shrink-0 px-0 normal-case tracking-normal disabled:opacity-40"
                          disabled={isSubmitting || !renameDraft.trim() || renameDraft.trim() === project.name}
                          title="Save name"
                          aria-label="Save name"
                        >
                          <Check size={12} strokeWidth={2} />
                        </button>
                        <button
                          type="button"
                          className="ui-btn-ghost h-6 w-6 shrink-0 px-0 normal-case tracking-normal"
                          onClick={() => {
                            setRenamingProjectId(null);
                            setRenameDraft("");
                          }}
                          disabled={isSubmitting}
                          title="Cancel rename"
                          aria-label="Cancel rename"
                        >
                          <X size={12} strokeWidth={2} />
                        </button>
                      </form>
                    ) : (
                      <Link
                        href={projectPlannerHref(project.id)}
                        title={project.name}
                        className="flex min-w-0 flex-1 items-center gap-2 text-inherit no-underline"
                      >
                        <FolderKanban size={15} strokeWidth={1.75} className="shrink-0 text-ink-tertiary" />
                        <span className="min-w-0 flex-1 truncate">{project.name}</span>
                      </Link>
                    )}
                    {canManage(role) && !isRenaming ? (
                      <button
                        type="button"
                        className="inline-flex h-4 w-4 shrink-0 items-center justify-center self-center p-0 text-ink-secondary opacity-0 transition-opacity duration-200 hover:text-ink group-hover/project:opacity-100 disabled:opacity-40"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          const anchor = event.currentTarget.getBoundingClientRect();
                          openProjectMenu(project, anchor);
                        }}
                        disabled={isSubmitting}
                        title={`${project.name} settings`}
                        aria-label={`${project.name} settings`}
                        aria-haspopup="menu"
                        aria-expanded={contextMenu?.project.id === project.id}
                      >
                        <MoreHorizontal size={14} strokeWidth={1.75} />
                      </button>
                    ) : null}
                  </div>
                );
              })
            : null}
        </div>

        {isAdding ? (
          <form className="mt-1 flex items-center gap-0.5" onSubmit={handleCreate}>
            <input
              className="ui-field-standalone h-7 min-w-0 flex-1 rounded-md px-2 text-[11px] font-normal"
              placeholder="Project name"
              value={newProjectName}
              onChange={(event) => setNewProjectName(event.target.value)}
              disabled={isSubmitting}
              autoFocus
            />
            <button
              type="submit"
              className="ui-btn-ghost h-6 w-6 shrink-0 px-0 normal-case tracking-normal disabled:opacity-40"
              disabled={isSubmitting || !newProjectName.trim()}
              title="Create project"
              aria-label="Create project"
            >
              <Check size={12} strokeWidth={2} />
            </button>
            <button
              type="button"
              className="ui-btn-ghost h-6 w-6 shrink-0 px-0 normal-case tracking-normal"
              onClick={() => {
                setIsAdding(false);
                setNewProjectName("");
                setCreateError("");
              }}
              disabled={isSubmitting}
              title="Cancel"
              aria-label="Cancel new project"
            >
              <X size={12} strokeWidth={2} />
            </button>
          </form>
        ) : null}

        {createError ? <div className="mt-1 px-2 text-[10px] leading-snug text-danger">{createError}</div> : null}
        {deleteError ? <div className="mt-1 px-2 text-[10px] leading-snug text-danger">{deleteError}</div> : null}
      </div>

      <ThemedFeedbackLayer
        confirm={feedbackConfirm}
        toasts={[]}
        onCancelConfirm={() => setFeedbackConfirm(undefined)}
        onConfirm={() => {
          const action = feedbackConfirm?.onConfirm;
          setFeedbackConfirm(undefined);
          action?.();
        }}
        onDismissToast={() => undefined}
      />

      {contextMenu ? (
        <UiContextMenu
          anchorRect={contextMenu.anchorRect}
          onClose={() => setContextMenu(null)}
          items={[
            {
              id: "rename",
              label: "Rename project",
              onSelect: () => startRenameProject(contextMenu.project),
            },
            {
              id: "archive",
              label: "Archive project",
              disabled: isSubmitting,
              onSelect: () => void archiveProject(contextMenu.project),
            },
            {
              id: "remove",
              label: "Remove",
              danger: true,
              disabled: isSubmitting,
              onSelect: () => requestDeleteProject(contextMenu.project, contextMenu.anchorRect),
            },
          ]}
        />
      ) : null}
    </>
  );
}
