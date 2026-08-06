"use client";

import { Archive, Check, ExternalLink, Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createProjectWithStarterPlan,
  deleteProjectFromSupabase,
  updateProjectInSupabase,
} from "@/domain/supabase-planner";
import type { PlannerProjectContext, Project, WorkspaceProjectGroup } from "@/domain/types";
import { PhonePhotoPortalPanel } from "@/components/phone-photo-portal-panel";
import { ThemedFeedbackLayer, type FeedbackConfirm } from "@/components/themed-feedback";
import { ThemedSelect } from "@/components/themed-select";

function canCreate(group?: WorkspaceProjectGroup) {
  return Boolean(group?.isSuperAdmin) || group?.role === "owner" || group?.role === "admin" || group?.role === "editor";
}

function canManage(group?: WorkspaceProjectGroup) {
  return Boolean(group?.isSuperAdmin) || group?.role === "owner" || group?.role === "admin";
}

function projectsFrom(groups: WorkspaceProjectGroup[]) {
  return groups.flatMap((group) => group.projects).filter((project) => project.status !== "archived");
}

export function ProjectSettings({
  groups,
  activeProject,
  embedded = false,
}: {
  groups: WorkspaceProjectGroup[];
  activeProject?: PlannerProjectContext;
  embedded?: boolean;
}) {
  const groupByWorkspaceId = useMemo(
    () => new Map(groups.map((group) => [group.workspace.id, group])),
    [groups],
  );
  const editableGroups = useMemo(() => groups.filter(canCreate), [groups]);
  const [projects, setProjects] = useState<Project[]>(() => projectsFrom(groups));
  const [selectedProjectId, setSelectedProjectId] = useState(activeProject?.projectId ?? projects[0]?.id ?? "");
  const [createWorkspaceId, setCreateWorkspaceId] = useState(
    activeProject?.workspaceId ?? editableGroups[0]?.workspace.id ?? "",
  );
  const [showCreate, setShowCreate] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [draftNames, setDraftNames] = useState<Record<string, string>>(() =>
    Object.fromEntries(projects.map((project) => [project.id, project.name])),
  );
  const [busyId, setBusyId] = useState<string>();
  const createPendingRef = useRef(false);
  const [message, setMessage] = useState("");
  const [confirm, setConfirm] = useState<FeedbackConfirm>();

  useEffect(() => {
    const next = projectsFrom(groups);
    setProjects(next);
    setDraftNames((current) => ({
      ...Object.fromEntries(next.map((project) => [project.id, project.name])),
      ...current,
    }));
    setSelectedProjectId((current) => {
      if (current && next.some((project) => project.id === current)) return current;
      return activeProject?.projectId ?? next[0]?.id ?? "";
    });
  }, [activeProject?.projectId, groups]);

  const selectedProject = projects.find((project) => project.id === selectedProjectId);
  const selectedGroup = selectedProject ? groupByWorkspaceId.get(selectedProject.workspaceId) : undefined;
  const selectedContext: PlannerProjectContext | undefined = selectedProject && selectedGroup
    ? {
        projectId: selectedProject.id,
        projectName: selectedProject.name,
        workspaceId: selectedProject.workspaceId,
        workspaceName: selectedGroup.workspace.name,
        role: selectedGroup.role,
        accessLevel: selectedGroup.isSuperAdmin || canManage(selectedGroup) ? "edit" : selectedProject.accessLevel,
      }
    : undefined;

  async function createProject() {
    const name = newProjectName.trim();
    if (createPendingRef.current || !name || !createWorkspaceId) return;
    createPendingRef.current = true;
    setBusyId("create");
    setMessage("");
    try {
      const context = await createProjectWithStarterPlan(createWorkspaceId, name);
      const project: Project = {
        id: context.projectId,
        workspaceId: context.workspaceId,
        name: context.projectName,
        status: "active",
        accessLevel: context.accessLevel,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      setProjects((current) => [...current, project]);
      setDraftNames((current) => ({ ...current, [project.id]: project.name }));
      setSelectedProjectId(project.id);
      setNewProjectName("");
      setShowCreate(false);
      setMessage(`${project.name} created.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to create the project.");
    } finally {
      createPendingRef.current = false;
      setBusyId(undefined);
    }
  }

  async function renameProject(project: Project) {
    const name = (draftNames[project.id] ?? "").trim();
    if (!name || name === project.name) return;
    setBusyId(project.id);
    setMessage("");
    try {
      await updateProjectInSupabase(project.id, { name });
      setProjects((current) => current.map((item) => (item.id === project.id ? { ...item, name } : item)));
      setMessage(`${name} renamed.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to rename the project.");
    } finally {
      setBusyId(undefined);
    }
  }

  async function archiveProject(project: Project) {
    setBusyId(project.id);
    setMessage("");
    try {
      await updateProjectInSupabase(project.id, { status: "archived" });
      setProjects((current) => current.filter((item) => item.id !== project.id));
      setMessage(`${project.name} archived.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to archive the project.");
    } finally {
      setBusyId(undefined);
    }
  }

  async function removeProject(project: Project) {
    setBusyId(project.id);
    setMessage("");
    try {
      await deleteProjectFromSupabase(project.id);
      setProjects((current) => current.filter((item) => item.id !== project.id));
      setMessage(`${project.name} removed.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to remove the project.");
    } finally {
      setBusyId(undefined);
    }
  }

  function requestArchive(project: Project) {
    setConfirm({
      title: `Archive ${project.name}?`,
      body: "The project leaves active navigation but its data is retained.",
      tone: "warning",
      confirmLabel: "Archive",
      onConfirm: () => void archiveProject(project),
    });
  }

  function requestRemove(project: Project) {
    setConfirm({
      title: `Remove ${project.name}?`,
      body: "This permanently deletes the project and its planner data.",
      tone: "danger",
      confirmLabel: "Remove",
      onConfirm: () => void removeProject(project),
    });
  }

  return (
    <>
      <section className="ui-settings-section">
        <div className="flex items-start justify-between gap-4">
          {!embedded ? (
            <div>
              <h3 className="ui-settings-section-title">Projects</h3>
              <p className="ui-settings-section-desc">Create projects and manage their lifecycle from one place.</p>
            </div>
          ) : <span />}
          {editableGroups.length ? (
            <button type="button" className="ui-btn-ghost h-8 gap-1.5 px-2.5" onClick={() => setShowCreate((open) => !open)}>
              {showCreate ? <X size={13} /> : <Plus size={13} />}
              {showCreate ? "Cancel" : "New project"}
            </button>
          ) : null}
        </div>

        <div className="ui-settings-group">
          {showCreate ? (
            <div className="grid gap-2 border-b border-line py-3 sm:grid-cols-[minmax(0,1fr)_180px_auto]">
              <input
                className="ui-field-standalone h-9 px-3"
                value={newProjectName}
                onChange={(event) => setNewProjectName(event.target.value)}
                placeholder="Project name"
                autoFocus
                disabled={busyId === "create"}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void createProject();
                }}
              />
              <ThemedSelect
                value={createWorkspaceId}
                onChange={setCreateWorkspaceId}
                ariaLabel="Organization for new project"
                options={editableGroups.map((group) => ({ value: group.workspace.id, label: group.workspace.name }))}
              />
              <button
                type="button"
                className="ui-btn-primary h-9 px-3 disabled:opacity-40"
                disabled={!newProjectName.trim() || !createWorkspaceId || busyId === "create"}
                onClick={() => void createProject()}
              >
                {busyId === "create" ? "Creating..." : "Create"}
              </button>
            </div>
          ) : null}

          <div className="hidden grid-cols-[minmax(0,1fr)_180px_104px] border-b border-line py-2 sm:grid">
            <span className="ui-settings-table-label">Project</span>
            <span className="ui-settings-table-label">Organization</span>
            <span className="ui-settings-table-label text-right">Actions</span>
          </div>

          {projects.length ? projects.map((project) => {
            const group = groupByWorkspaceId.get(project.workspaceId);
            const manageable = canManage(group);
            const draft = draftNames[project.id] ?? project.name;
            const dirty = draft.trim().length > 0 && draft.trim() !== project.name;
            const busy = busyId === project.id;
            return (
              <div key={project.id} className="grid gap-2 border-b border-line py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_180px_104px] sm:items-center">
                <div className="flex min-w-0 items-center gap-1.5">
                  {manageable ? (
                    <input
                      className="ui-field-standalone h-8 min-w-0 flex-1 px-2.5"
                      value={draft}
                      disabled={busy}
                      aria-label={`${project.name} project name`}
                      onChange={(event) => setDraftNames((current) => ({ ...current, [project.id]: event.target.value }))}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && dirty) void renameProject(project);
                      }}
                    />
                  ) : (
                    <span className="truncate text-[13px] font-medium text-ink">{project.name}</span>
                  )}
                  {manageable ? (
                    <button
                      type="button"
                      className="ui-btn-ghost h-8 w-8 shrink-0 px-0 disabled:opacity-30"
                      disabled={!dirty || busy}
                      onClick={() => void renameProject(project)}
                      title="Save project name"
                      aria-label={`Save ${project.name} project name`}
                    >
                      <Check size={13} />
                    </button>
                  ) : null}
                </div>
                <span className="truncate text-[11px] text-ink-secondary">{group?.workspace.name ?? "Unknown"}</span>
                <div className="flex justify-end gap-0.5">
                  <Link
                    href={`/projects/${project.id}/planner?view=dashboard`}
                    className="ui-btn-ghost inline-flex h-8 w-8 items-center justify-center px-0"
                    title={`Open ${project.name}`}
                    aria-label={`Open ${project.name}`}
                  >
                    <ExternalLink size={13} />
                  </Link>
                  {manageable ? (
                    <>
                      <button
                        type="button"
                        className="ui-btn-ghost h-8 w-8 px-0"
                        disabled={busy}
                        onClick={() => requestArchive(project)}
                        title={`Archive ${project.name}`}
                        aria-label={`Archive ${project.name}`}
                      >
                        <Archive size={13} />
                      </button>
                      <button
                        type="button"
                        className="ui-btn-ghost h-8 w-8 px-0 text-ink-tertiary hover:text-danger"
                        disabled={busy}
                        onClick={() => requestRemove(project)}
                        title={`Remove ${project.name}`}
                        aria-label={`Remove ${project.name}`}
                      >
                        <Trash2 size={13} />
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            );
          }) : (
            <div className="px-3.5 py-8 text-center text-[12px] text-ink-secondary">No active projects.</div>
          )}
        </div>
        {message ? <p className="ui-settings-section-desc mt-2 text-ink">{message}</p> : null}
      </section>

      {projects.length ? (
        <section className="ui-settings-section">
          <h3 className="ui-settings-section-title">Project tools</h3>
          <p className="ui-settings-section-desc">Choose the project used by project-specific settings below.</p>
          <div className="ui-settings-group">
            <div className="ui-settings-group-row">
              <div className="ui-settings-group-row-copy">
                <div className="ui-settings-group-row-label">Active project</div>
                <div className="ui-settings-group-row-desc">This selection does not change your current Product workspace.</div>
              </div>
              <div className="ui-settings-group-row-control sm:min-w-[260px]">
                <ThemedSelect
                  className="w-full"
                  value={selectedProjectId}
                  onChange={setSelectedProjectId}
                  ariaLabel="Project settings selection"
                  options={projects.map((project) => ({ value: project.id, label: project.name }))}
                />
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {selectedContext ? <PhonePhotoPortalPanel project={selectedContext} /> : null}

      <ThemedFeedbackLayer
        confirm={confirm}
        toasts={[]}
        onCancelConfirm={() => setConfirm(undefined)}
        onConfirm={() => {
          const action = confirm?.onConfirm;
          setConfirm(undefined);
          action?.();
        }}
        onDismissToast={() => undefined}
      />
    </>
  );
}
