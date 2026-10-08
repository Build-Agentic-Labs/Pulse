"use client";

import { BookOpen, Check, ChevronDown, FolderKanban, GripVertical, MoreHorizontal, Plus, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  createPlannerSupabaseClient,
  createProjectWithStarterPlan,
  deleteProjectFromSupabase,
  ensureDefaultWorkspaceMembership,
  updateProjectInSupabase,
} from "@/domain/supabase-planner";
import { PRODUCT_CATEGORIES, portfolioInsertionPosition, sortPortfolioProducts } from "@/domain/product-portfolio";
import type { PortfolioCategory, PlannerProjectContext, Project, WorkspaceRole, WorkspaceProjectGroup } from "@/domain/types";
import { readCachedMainPlannerStateSync, readCachedPlannerState } from "@/lib/planner-state-cache";
import { resolveSupabaseSession } from "@/lib/supabase-auth";
import { ThemedFeedbackLayer, type FeedbackConfirm } from "./themed-feedback";
import { UiContextMenu } from "./ui-context-menu";
import { NavSelectionTrack } from "./nav-selection-track";

const LAST_PROJECT_STORAGE_KEY = "pulse:last-project-id";
const SIDEBAR_PROJECT_CACHE_KEY = "pulse:sidebar-projects-v2";
const PROJECT_SWITCH_EVENT = "pulse:project-switch-start";
const PROJECT_SWITCH_SESSION_KEY = "pulse:project-switch-started-at";
const PROJECT_SWITCH_TARGET_SESSION_KEY = "pulse:project-switch-target-v1";

type SidebarProjectCache = {
  projects: Project[];
  roles: Record<string, WorkspaceRole>;
};

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

export function projectPlannerHref(projectId: string) {
  return `/projects/${projectId}/planner?view=dashboard`;
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

function readSidebarProjectCache(): SidebarProjectCache {
  if (typeof window === "undefined") {
    return { projects: [], roles: {} };
  }

  try {
    const raw = window.localStorage.getItem(SIDEBAR_PROJECT_CACHE_KEY);
    if (!raw) {
      return { projects: [], roles: {} };
    }

    const parsed = JSON.parse(raw) as Partial<SidebarProjectCache>;
    return {
      projects: Array.isArray(parsed.projects) ? parsed.projects : [],
      roles: parsed.roles && typeof parsed.roles === "object" ? parsed.roles as Record<string, WorkspaceRole> : {},
    };
  } catch {
    return { projects: [], roles: {} };
  }
}

function writeSidebarProjectCache(cache: SidebarProjectCache) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(SIDEBAR_PROJECT_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Ignore storage failures in private browsing.
  }
}

function mergeProjects(projects: Project[], activeProject?: PlannerProjectContext) {
  const byId = new Map(projects.map((project) => [project.id, project]));
  if (activeProject && !activeProject.isAwiMaster) {
    const fallback = projectFromContext(activeProject);
    byId.set(activeProject.projectId, { ...fallback, ...byId.get(activeProject.projectId), name: activeProject.projectName });
  }
  return [...byId.values()].filter((project) => !project.isAwiMaster);
}

export function announceProjectSwitch(project: Project, hasCachedState = false) {
  if (typeof window !== "undefined") {
    try {
      window.sessionStorage.setItem(PROJECT_SWITCH_SESSION_KEY, String(Date.now()));
      window.sessionStorage.setItem(
        PROJECT_SWITCH_TARGET_SESSION_KEY,
        JSON.stringify({ projectId: project.id, title: project.name, hasCachedState }),
      );
    } catch {
      // Ignore storage failures in private browsing.
    }
    window.dispatchEvent(new CustomEvent(PROJECT_SWITCH_EVENT, {
      detail: { projectId: project.id, title: project.name, hasCachedState },
    }));
  }
}

export function SidebarWorkspacePanel({
  activeProject,
  initialGroups,
}: {
  activeProject?: PlannerProjectContext;
  initialGroups?: WorkspaceProjectGroup[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({ uncategorized: true });
  useEffect(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem("pulse:portfolio-expanded") ?? "null");
      if (stored && typeof stored === "object" && !Array.isArray(stored)) setExpandedCategories(stored);
    } catch { /* Storage may be unavailable. */ }
  }, []);
  const [newCategory, setNewCategory] = useState<PortfolioCategory | "">("");
  const [movingProject, setMovingProject] = useState<{ project: Project; anchorRect: DOMRect } | null>(null);
  function toggleCategory(id: string) {
    setExpandedCategories((current) => {
      const next = { ...current, [id]: !current[id] };
      try { window.localStorage.setItem("pulse:portfolio-expanded", JSON.stringify(next)); } catch { /* Storage may be unavailable. */ }
      return next;
    });
  }
  const supabase = useMemo(() => createPlannerSupabaseClient(), []);
  const cachedSidebar = useMemo(() => initialGroups ? {
    projects: initialGroups.flatMap((group) => group.projects.filter((project) => project.status !== "archived" && !project.isAwiMaster)),
    roles: Object.fromEntries(initialGroups.map((group) => [group.workspace.id, group.role])),
  } : readSidebarProjectCache(), [initialGroups]);
  const [projects, setProjects] = useState<Project[]>(() => mergeProjects(cachedSidebar.projects, activeProject));
  const [workspaceId, setWorkspaceId] = useState<string | undefined>(() => activeProject?.workspaceId);
  const [role, setRole] = useState<WorkspaceRole | undefined>(() => activeProject?.role);
  const [roleByWorkspaceId, setRoleByWorkspaceId] = useState<Record<string, WorkspaceRole>>(() =>
    activeProject?.workspaceId && activeProject.role
      ? { ...cachedSidebar.roles, [activeProject.workspaceId]: activeProject.role }
      : cachedSidebar.roles,
  );
  const [status, setStatus] = useState<"loading" | "ready" | "auth" | "error">(() =>
    activeProject ? "ready" : "loading",
  );
  const [isAdding, setIsAdding] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const createPendingRef = useRef(false);
  const [createError, setCreateError] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [feedbackConfirm, setFeedbackConfirm] = useState<FeedbackConfirm>();
  const [contextMenu, setContextMenu] = useState<{ project: Project; anchorRect: DOMRect } | null>(null);
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState(() => activeProject?.projectId);

  const [draggedProductId, setDraggedProductId] = useState<string | null>(null);
  const dragProductRef = useRef<string | null>(null);
  const pointerDragRef = useRef<{ id: string; pointerId: number; x: number; y: number; started: boolean } | null>(null);
  const [dropTarget, setDropTarget] = useState<{ category: string; productId?: string; after?: boolean } | null>(null);
  const dropTargetRef = useRef<typeof dropTarget>(null);
  const expandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const expandCategoryRef = useRef<string | null>(null);
  const suppressClickUntilRef = useRef(0);
  useEffect(() => () => { if (expandTimerRef.current) clearTimeout(expandTimerRef.current); }, []);

  const clearProductDrag = useCallback(() => {
    pointerDragRef.current = null;
    dragProductRef.current = null;
    setDraggedProductId(null);
    setDropTarget(null);
    dropTargetRef.current = null;
    if (expandTimerRef.current) clearTimeout(expandTimerRef.current);
    expandTimerRef.current = null;
    expandCategoryRef.current = null;
    suppressClickUntilRef.current = Date.now() + 200;
  }, []);

  const dropProduct = useCallback(async (source: Project, category: string, target?: Project, after = false) => {
    if (isSubmitting || (target && source.workspaceId !== target.workspaceId) || target?.id === source.id) return;
    const siblings = sortPortfolioProducts(projects.filter((item) => item.id !== source.id && item.workspaceId === source.workspaceId
      && (item.portfolioCategory ?? "uncategorized") === category));
    const targetIndex = target ? siblings.findIndex((item) => item.id === target.id) : siblings.length;
    const index = target ? targetIndex + (after ? 1 : 0) : targetIndex;
    const original = projects;
    setIsSubmitting(true);
    setDeleteError("");
    try {
      const position = portfolioInsertionPosition(siblings, index);
      const portfolioCategory = category === "uncategorized" ? undefined : category as PortfolioCategory;
      const next = projects.map((item) => item.id === source.id ? { ...item, portfolioCategory, portfolioPosition: position } : item);
      setProjects(next);
      setExpandedCategories((current) => ({ ...current, [category]: true }));
      await updateProjectInSupabase(source.id, { portfolioCategory: portfolioCategory ?? null, portfolioPosition: position });
      writeSidebarProjectCache({ projects: next, roles: roleByWorkspaceId });
    } catch (error) {
      setProjects(original);
      setDeleteError(error instanceof Error ? error.message : "Unable to move product.");
    } finally { setIsSubmitting(false); }
  }, [isSubmitting, projects, roleByWorkspaceId]);

  // Pointer input supports the full row and avoids the browser's native drag image.
  useEffect(() => {
    function move(event: PointerEvent) {
      const pending = pointerDragRef.current;
      if (!pending || pending.pointerId !== event.pointerId) return;
      if (!pending.started && Math.hypot(event.clientX - pending.x, event.clientY - pending.y) < 6) return;
      if (!pending.started) {
        pending.started = true;
        dragProductRef.current = pending.id;
        setDraggedProductId(pending.id);
        setContextMenu(null);
      }
      event.preventDefault();
      const source = projects.find((item) => item.id === pending.id);
      const element = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-product-id], [data-portfolio-category]");
      const target = element?.dataset.productId ? projects.find((item) => item.id === element.dataset.productId) : undefined;
      const category = target ? target.portfolioCategory ?? "uncategorized" : element?.dataset.portfolioCategory;
      if (!source || !element || !category || (target && target.workspaceId !== source.workspaceId)) {
        dropTargetRef.current = null;
        setDropTarget(null);
        if (expandTimerRef.current) clearTimeout(expandTimerRef.current);
        expandCategoryRef.current = null;
        return;
      }
      const rect = element.getBoundingClientRect();
      const next = { category, productId: target?.id, after: target ? event.clientY > rect.top + rect.height / 2 : undefined };
      dropTargetRef.current = next;
      setDropTarget(next);
      if (expandCategoryRef.current !== category) {
        if (expandTimerRef.current) clearTimeout(expandTimerRef.current);
        expandCategoryRef.current = category;
        expandTimerRef.current = setTimeout(() => setExpandedCategories((current) => ({ ...current, [category]: true })), 500);
      }
      const scrollArea = element.closest<HTMLElement>("[data-portfolio-scroll]");
      if (scrollArea) {
        const bounds = scrollArea.getBoundingClientRect();
        if (event.clientY > bounds.bottom - 24) scrollArea.scrollTop += 12;
        else if (event.clientY < bounds.top + 24) scrollArea.scrollTop -= 12;
      }
    }
    function finish(event: PointerEvent) {
      const pending = pointerDragRef.current;
      if (!pending || pending.pointerId !== event.pointerId) return;
      if (!pending.started) { pointerDragRef.current = null; return; }
      const source = projects.find((item) => item.id === pending.id);
      const target = dropTargetRef.current;
      clearProductDrag();
      if (source && target) void dropProduct(source, target.category, projects.find((item) => item.id === target.productId), target.after);
    }
    function cancel() { if (pointerDragRef.current?.started) clearProductDrag(); else pointerDragRef.current = null; }
    function escape(event: KeyboardEvent) { if (event.key === "Escape") cancel(); }
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", escape);
    };
  }, [projects, clearProductDrag, dropProduct]);

  const activeCategory = projects.find((item) => item.id === activeProject?.projectId)?.portfolioCategory ?? "uncategorized";
  useEffect(() => {
    if (activeProject?.projectId) setExpandedCategories((current) => ({ ...current, [activeCategory]: true }));
  }, [activeCategory, activeProject?.projectId]);

  async function moveProduct(project: Project, category: PortfolioCategory | null) {
    setIsSubmitting(true);
    setDeleteError("");
    try {
      await updateProjectInSupabase(project.id, { portfolioCategory: category });
      await hydrate();
      setExpandedCategories((current) => ({ ...current, [category ?? "uncategorized"]: true }));
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Unable to move product.");
    } finally { setIsSubmitting(false); }
  }

  const activeProjectId = activeProject?.projectId;
  const activeProjectName = activeProject?.projectName;
  const activeWorkspaceId = activeProject?.workspaceId;
  const activeProjectRole = activeProject?.role;

  useEffect(() => {
    if (!activeProjectId || !activeWorkspaceId || activeProject?.isAwiMaster) return;
    setSelectedProjectId(activeProjectId);
    const fallbackProject: Project = {
      id: activeProjectId,
      workspaceId: activeWorkspaceId,
      name: activeProjectName ?? "",
      status: "active",
      createdAt: "",
      updatedAt: "",
    };
    setWorkspaceId(activeWorkspaceId);
    setRole(activeProjectRole);
    if (activeProjectRole) {
      setRoleByWorkspaceId((current) => ({ ...current, [activeWorkspaceId]: activeProjectRole }));
    }
    setStatus((current) => (current === "loading" ? "ready" : current));
    setProjects((current) => {
      if (current.some((project) => project.id === activeProjectId)) {
        return current.map((project) =>
          project.id === activeProjectId ? { ...fallbackProject, ...project, name: activeProjectName ?? "" } : project,
        );
      }
      return [...current, fallbackProject];
    });
  }, [activeProjectId, activeProjectName, activeProjectRole, activeWorkspaceId, activeProject?.isAwiMaster]);

  // Keep previously opened Product routes in Next's router cache. Combined
  // with the synchronous planner snapshot, returning to a project becomes an
  // immediate client transition while freshness validation continues behind it.
  useEffect(() => {
    if (status !== "ready") {
      return;
    }

    let cancelled = false;
    void Promise.all(
      projects.map(async (project) => {
        if (project.id === activeProjectId) {
          return;
        }
        // Warm the synchronous layer from IndexedDB as well, so previously
        // opened projects remain instant after a browser refresh—not just
        // during the current JavaScript session.
        if (!readCachedMainPlannerStateSync(project.id)) {
          await readCachedPlannerState(project.id).catch(() => null);
        }
        if (!cancelled && readCachedMainPlannerStateSync(project.id)) {
          router.prefetch(projectPlannerHref(project.id));
        }
      }),
    );

    return () => {
      cancelled = true;
    };
  }, [activeProjectId, projects, router, status]);

  const hydrate = useCallback(async () => {
    try {
      const groups = await ensureDefaultWorkspaceMembership();
      const activeGroup = groups.find((entry) => entry.workspace.id === activeWorkspaceId) ?? groups[0];

      if (!activeGroup) {
        setProjects([]);
        setWorkspaceId(undefined);
        setRole(undefined);
        setRoleByWorkspaceId({});
        setStatus("ready");
        return [];
      }

      const nextProjects = groups.flatMap((group) =>
        group.projects.filter((project) => project.status !== "archived" && !project.isAwiMaster),
      );
      setWorkspaceId(activeGroup.workspace.id);
      setRole(activeGroup.role);
      setRoleByWorkspaceId(
        Object.fromEntries(groups.map((group) => [group.workspace.id, group.role])),
      );
      setProjects(nextProjects);
      writeSidebarProjectCache({
        projects: nextProjects,
        roles: Object.fromEntries(groups.map((group) => [group.workspace.id, group.role])),
      });
      setStatus("ready");
      return nextProjects;
    } catch {
      setStatus("error");
      return [];
    }
  }, [activeWorkspaceId]);

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
  }, [hydrate, supabase]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (createPendingRef.current || !workspaceId || !newProjectName.trim()) {
      return;
    }

    createPendingRef.current = true;
    setIsSubmitting(true);
    setCreateError("");
    try {
      const created = await createProjectWithStarterPlan(workspaceId, newProjectName.trim());
      if (newCategory) {
        try { await updateProjectInSupabase(created.projectId, { portfolioCategory: newCategory }); }
        catch { setCreateError("Product created under Uncategorized. Use Move to category to assign it."); }
      }
      setNewProjectName("");
      setIsAdding(false);
      await hydrate();
      router.push(projectPlannerHref(created.projectId));
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Unable to create project.");
    } finally {
      createPendingRef.current = false;
      setIsSubmitting(false);
    }
  }

  function requestDeleteProject(project: Project, anchorRect: DOMRect) {
    setDeleteError("");
    setFeedbackConfirm({
      title: "Remove product?",
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

  function requestArchiveProject(project: Project, anchorRect: DOMRect) {
    setDeleteError("");
    setFeedbackConfirm({
      title: "Archive product?",
      body: `"${project.name}" will be moved out of your active projects. You can restore it later.`,
      tone: "warning",
      confirmLabel: "Archive",
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
        void archiveProject(project);
      },
    });
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

  function navigateToProject(project: Project, active: boolean) {
    if (active || isSubmitting || dragProductRef.current || Date.now() < suppressClickUntilRef.current) {
      return;
    }

    const hasCachedState = Boolean(readCachedMainPlannerStateSync(project.id));
    setSelectedProjectId(project.id);
    window.requestAnimationFrame(() => {
      announceProjectSwitch(project, hasCachedState);
      router.push(projectPlannerHref(project.id));
    });
  }

  const menuSiblings = contextMenu ? sortPortfolioProducts(projects.filter((item) => item.workspaceId === contextMenu.project.workspaceId
    && item.portfolioCategory === contextMenu.project.portfolioCategory)) : [];
  const menuIndex = contextMenu ? menuSiblings.findIndex((item) => item.id === contextMenu.project.id) : -1;

  return (
    <>
      <NavSelectionTrack persistenceKey="product-library" data-portfolio-scroll className={`${pathname === "/awi" ? "min-h-0 flex-1" : "max-h-[50dvh] shrink-0"} overflow-y-auto px-2 py-2`}>
        <div className="group flex min-h-8 items-center justify-between gap-1">
          <div className="ui-nav-section mb-0 px-2">Product Library</div>
          {status === "ready" && canEdit(role) ? (
            <button
              type="button"
              className="ui-btn-ghost h-8 w-8 shrink-0 px-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100"
              onClick={() => {
                setIsAdding((open) => !open);
                setCreateError("");
              }}
              title="Add product"
              aria-label="Add product"
              aria-expanded={isAdding}
            >
              <Plus size={14} />
            </button>
          ) : null}
        </div>

        <Link href={workspaceId ? `/awi?workspace=${encodeURIComponent(workspaceId)}` : "/awi"}
          className={`ui-nav-item mt-1 ${pathname.startsWith("/awi") ? "ui-nav-item-active" : "ui-nav-item-idle"}`}>
          <BookOpen size={15} strokeWidth={1.75} className="shrink-0 text-ink-tertiary" />
          <span className="truncate">AWI Master List</span>
        </Link>
          {status === "loading" ? (
            <div className="px-2 py-1.5 text-[11px] text-ink-tertiary">Loading products…</div>
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
              <span className="min-w-0 flex-1 truncate">Retry products</span>
            </button>
          ) : null}

        {[...PRODUCT_CATEGORIES, ...(projects.some((item) => !item.portfolioCategory) ? [{ id: "uncategorized", label: "Uncategorized" }] : [])].map((category) => {
          const categoryProducts = sortPortfolioProducts(projects.filter((item) => (item.portfolioCategory ?? "uncategorized") === category.id));
          const expanded = Boolean(expandedCategories[category.id]);
          return <div key={category.id} className="mt-0.5">
            <button type="button" className={`ui-nav-item ui-nav-item-idle ${dropTarget?.category === category.id && !dropTarget.productId ? "bg-surface-hover text-ink ring-1 ring-inset ring-border-strong" : ""}`} aria-expanded={expanded}
              data-portfolio-category={category.id}
              aria-controls={`portfolio-${category.id}`} onClick={() => toggleCategory(category.id)}>
              <FolderKanban size={15} strokeWidth={1.75} className="shrink-0 text-ink-tertiary" />
              <span className="min-w-0 flex-1 truncate">{category.label}</span>
              <ChevronDown size={13} className={`shrink-0 transition-transform duration-200 motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`} />
            </button>
            <div id={`portfolio-${category.id}`} className="ui-setup-accordion" data-open={expanded} inert={!expanded} aria-hidden={!expanded}>
              <div className="min-h-0 overflow-hidden">
                <NavSelectionTrack activeIndex={pathname !== "/awi" ? categoryProducts.findIndex((item) => item.id === selectedProjectId) : -1}
                  className="ui-portfolio-product-track ml-3 space-y-0.5 border-l border-line pl-2 pt-1">
                  {status === "ready" && !categoryProducts.length ? <div className="px-2 py-1.5 text-[11px] text-ink-tertiary">No products yet</div> : null}
                  {status === "ready"
            ? categoryProducts.map((project) => {
                const active = pathname !== "/awi" && project.id === selectedProjectId;
                const isRenaming = renamingProjectId === project.id;
                const projectRole = roleByWorkspaceId[project.workspaceId] ?? role;
                return (
                  <div
                    key={project.id}
                    data-project-row
                    data-product-id={project.id}
                    onPointerDown={(event) => {
                      if (event.button !== 0 || isRenaming || isSubmitting || !canEdit(projectRole) || project.accessLevel === "view" || project.portfolioPosition === undefined
                        || (event.target as HTMLElement).closest("[data-product-actions]")) return;
                      pointerDragRef.current = { id: project.id, pointerId: event.pointerId, x: event.clientX, y: event.clientY, started: false };
                    }}
                    onDragStart={(event) => event.preventDefault()}
                    style={{ touchAction: canEdit(projectRole) && project.accessLevel !== "view" ? "none" : undefined }}
                    className={`relative group/project ui-nav-item ${active ? "ui-nav-item-active" : "ui-nav-item-idle"} ${draggedProductId === project.id ? "opacity-40" : ""} ${canEdit(projectRole) && project.accessLevel !== "view" ? "select-none cursor-grab active:cursor-grabbing" : ""}`}
                  >
                    {dropTarget?.productId === project.id && draggedProductId !== project.id ? <span aria-hidden="true" className={`pointer-events-none absolute inset-x-1 h-px bg-accent ${dropTarget.after ? "bottom-0" : "top-0"}`} /> : null}
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
                      <button
                        type="button"
                        title={canEdit(projectRole) && project.accessLevel !== "view" ? `${project.name} — drag to move or reorder` : project.name}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left text-inherit"
                        onClick={() => navigateToProject(project, active)}
                        onPointerEnter={() => router.prefetch(projectPlannerHref(project.id))}
                        onFocus={() => router.prefetch(projectPlannerHref(project.id))}
                        disabled={isSubmitting}
                      >
                        <span className="relative h-[15px] w-[15px] shrink-0 text-ink-tertiary">
                          <FolderKanban size={15} strokeWidth={1.75} className={canEdit(projectRole) && project.accessLevel !== "view" ? "transition-opacity group-hover/project:opacity-0" : ""} />
                          {canEdit(projectRole) && project.accessLevel !== "view" ? <GripVertical size={15} strokeWidth={1.75} className="absolute inset-0 opacity-0 transition-opacity group-hover/project:opacity-100" /> : null}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{project.name}</span>
                      </button>
                    )}
                    {canManage(projectRole) && !isRenaming ? (
                      <button
                        type="button"
                        data-product-actions
                        className="inline-flex h-4 w-4 shrink-0 items-center justify-center self-center p-0 text-ink-secondary opacity-0 transition-opacity duration-200 hover:text-ink group-hover/project:opacity-100 group-focus-within/project:opacity-100 disabled:opacity-40"
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
                        aria-expanded={contextMenu?.project.id === project.id || movingProject?.project.id === project.id}
                      >
                        <MoreHorizontal size={14} strokeWidth={1.75} />
                      </button>
                    ) : null}
                  </div>
                );
              })
            : null}
                </NavSelectionTrack>
              </div>
            </div>
          </div>;
        })}

        {isAdding ? (
          <form className="mt-1 space-y-1" onSubmit={handleCreate}>
            <select className="ui-field-standalone h-7 w-full rounded-md px-2 text-[11px]" aria-label="Product category" value={newCategory} disabled={isSubmitting} onChange={(event) => setNewCategory(event.target.value as PortfolioCategory | "")}>
              <option value="">Uncategorized</option>
              {PRODUCT_CATEGORIES.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}
            </select>
            <div className="flex items-center gap-0.5">
            <input
              className="ui-field-standalone h-7 min-w-0 flex-1 rounded-md px-2 text-[11px] font-normal"
              placeholder="Product name"
              value={newProjectName}
              onChange={(event) => setNewProjectName(event.target.value)}
              disabled={isSubmitting}
              autoFocus
            />
            <button
              type="submit"
              className="ui-btn-ghost h-6 w-6 shrink-0 px-0 normal-case tracking-normal disabled:opacity-40"
              disabled={isSubmitting || !newProjectName.trim()}
              title="Create product"
              aria-label="Create product"
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
              aria-label="Cancel new product"
            >
              <X size={12} strokeWidth={2} />
            </button>
            </div>
          </form>
        ) : null}

        {createError ? <div className="mt-1 px-2 text-[10px] leading-snug text-danger">{createError}</div> : null}
        {deleteError ? <div className="mt-1 px-2 text-[10px] leading-snug text-danger">{deleteError}</div> : null}
      </NavSelectionTrack>

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

      {movingProject ? <UiContextMenu anchorRect={movingProject.anchorRect} menuWidth={200} density="comfortable" ariaLabel="Move product to category"
        onClose={() => setMovingProject(null)} items={[
          ...PRODUCT_CATEGORIES.map((category) => ({ id: category.id, label: category.label, disabled: isSubmitting || movingProject.project.portfolioCategory === category.id,
            onSelect: () => { void moveProduct(movingProject.project, category.id); } })),
          { id: "uncategorized", label: "Uncategorized", disabled: isSubmitting || !movingProject.project.portfolioCategory, onSelect: () => { void moveProduct(movingProject.project, null); } },
        ]} /> : null}
      {contextMenu ? (
        <UiContextMenu
          anchorRect={contextMenu.anchorRect}
          onClose={() => setContextMenu(null)}
          ariaLabel="Product actions"
          menuWidth={200}
          density="comfortable"
          items={[
            { id: "up", label: "Move up", disabled: isSubmitting || contextMenu.project.accessLevel === "view" || menuIndex <= 0,
              onSelect: () => { void dropProduct(contextMenu.project, contextMenu.project.portfolioCategory ?? "uncategorized", menuSiblings[menuIndex - 1], false); } },
            { id: "down", label: "Move down", disabled: isSubmitting || contextMenu.project.accessLevel === "view" || menuIndex < 0 || menuIndex === menuSiblings.length - 1,
              onSelect: () => { void dropProduct(contextMenu.project, contextMenu.project.portfolioCategory ?? "uncategorized", menuSiblings[menuIndex + 1], true); } },
            { id: "move", label: "Move to category…", disabled: isSubmitting || contextMenu.project.accessLevel === "view", onSelect: () => setMovingProject(contextMenu) },
            {
              id: "rename",
              label: "Rename product",
              onSelect: () => startRenameProject(contextMenu.project),
            },
            {
              id: "archive",
              label: "Archive product",
              disabled: isSubmitting,
              onSelect: () => requestArchiveProject(contextMenu.project, contextMenu.anchorRect),
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
