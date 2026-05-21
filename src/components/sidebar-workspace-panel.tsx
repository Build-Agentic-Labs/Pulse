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
} from "@/domain/supabase-planner";
import type { PlannerProjectContext, Project, WorkspaceRole } from "@/domain/types";
import { ThemedFeedbackLayer, type FeedbackConfirm } from "./themed-feedback";

const LAST_PROJECT_STORAGE_KEY = "pulse:last-project-id";

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
  const [projects, setProjects] = useState<Project[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string>();
  const [role, setRole] = useState<WorkspaceRole>();
  const [status, setStatus] = useState<"loading" | "ready" | "auth" | "error">("loading");
  const [isAdding, setIsAdding] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createError, setCreateError] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [feedbackConfirm, setFeedbackConfirm] = useState<FeedbackConfirm>();

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

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      if (!data.session) {
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

  function requestDeleteProject(project: Project) {
    setDeleteError("");
    setFeedbackConfirm({
      title: "Remove project?",
      body: `"${project.name}" and all of its planner data will be permanently deleted. This cannot be undone.`,
      tone: "danger",
      confirmLabel: "Remove project",
      cancelLabel: "Keep project",
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
                return (
                  <div
                    key={project.id}
                    className={`group/project ui-nav-item ${active ? "ui-nav-item-active" : "ui-nav-item-idle"}`}
                  >
                    <Link
                      href={projectPlannerHref(project.id)}
                      title={project.name}
                      className="flex min-w-0 flex-1 items-center gap-2 text-inherit no-underline"
                    >
                      <FolderKanban size={15} strokeWidth={1.75} className="shrink-0 text-ink-tertiary" />
                      <span className="min-w-0 flex-1 truncate">{project.name}</span>
                    </Link>
                    {canManage(role) ? (
                      <button
                        type="button"
                        className="inline-flex h-4 w-4 shrink-0 items-center justify-center self-center p-0 text-ink-secondary opacity-0 transition-opacity duration-200 hover:text-ink group-hover/project:opacity-100 disabled:opacity-40"
                        onClick={() => requestDeleteProject(project)}
                        disabled={isSubmitting}
                        title={`Remove ${project.name}`}
                        aria-label={`Remove ${project.name}`}
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
    </>
  );
}
