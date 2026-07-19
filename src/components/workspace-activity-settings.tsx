"use client";

import { History } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  createPlannerSupabaseClient,
  loadAuditLogFromSupabase,
  loadProfileNamesByIds,
  loadWorkspaceProjectGroups,
  type AuditLogEntry,
} from "@/domain/supabase-planner";
import type { PlannerProjectContext, Project } from "@/domain/types";

const PAGE_SIZE = 30;

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) {
    return "";
  }
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function detailText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Render one audit row as a human sentence. `names` maps user ids -> display names
 * (falls back to the raw value the row carries — an email or a user id).
 */
function describeEntry(
  entry: AuditLogEntry,
  names: Map<string, string>,
  projectNames: Map<string, string>,
): string {
  const target = entry.targetId ? names.get(entry.targetId) ?? entry.targetId : "someone";
  const next = entry.details?.new ?? {};
  const op = entry.action.split(".").pop() ?? "";

  switch (entry.targetType) {
    case "workspace_members": {
      if (op === "insert") return `${target} joined as ${detailText(next.role) || "member"}`;
      if (op === "update") return `changed ${target}'s role to ${detailText(next.role) || "member"}`;
      return `removed ${target} from the organization`;
    }
    case "workspace_access_grants": {
      if (op === "insert") return `invited ${target} as ${detailText(next.role) || "member"}`;
      if (op === "delete") return `cancelled the invite for ${target}`;
      return next.redeemed_at ? `${target} accepted their invite` : `updated the invite for ${target}`;
    }
    case "project_access": {
      const projectId = detailText(next.project_id) || detailText(entry.details?.old?.project_id);
      const projectName = projectNames.get(projectId) ?? "a project";
      if (op === "delete") return `cleared ${target}'s access to ${projectName}`;
      return `set ${target}'s access to ${projectName} to ${detailText(next.level) || "none"}`;
    }
    case "org_tool_access": {
      if (op === "delete") return `cleared ${target}'s Org tools access`;
      return `set ${target}'s Org tools access to ${detailText(next.level) || "none"}`;
    }
    case "workspace_auto_join_domains": {
      const domain = detailText(next.domain) || detailText(entry.details?.old?.domain);
      return op === "delete" ? `removed auto-join domain @${domain}` : `allowed auto-join for @${domain}`;
    }
    case "workspace_revocations": {
      if (op === "delete") return `lifted the access revocation for ${target}`;
      return `revoked access for ${target}`;
    }
    case "platform_admins": {
      return op === "delete" ? `removed platform admin ${target}` : `added platform admin ${target}`;
    }
    default:
      return `${entry.action} ${entry.targetId ?? ""}`.trim();
  }
}

export function WorkspaceActivitySettings({ project }: { project?: PlannerProjectContext }) {
  const supabase = useMemo(() => createPlannerSupabaseClient(), []);
  const [status, setStatus] = useState<"loading" | "ready" | "hidden" | "error">("loading");
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [projects, setProjects] = useState<Project[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [message, setMessage] = useState("");

  async function resolveNames(rows: AuditLogEntry[]) {
    // target_id holds a user id for member/access rows and an email for grant rows;
    // profile lookup resolves the ids, emails pass through as-is.
    const candidateIds = rows
      .map((row) => row.targetId)
      .filter((value): value is string => Boolean(value && !value.includes("@")));
    if (!candidateIds.length) {
      return;
    }
    try {
      const resolved = await loadProfileNamesByIds(candidateIds);
      setNames((current) => new Map([...current, ...resolved]));
    } catch {
      // Names are cosmetic — raw ids still render.
    }
  }

  useEffect(() => {
    let mounted = true;

    void (async () => {
      try {
        const groups = await loadWorkspaceProjectGroups();
        const group =
          groups.find((entry) => entry.workspace.id === project?.workspaceId) ??
          groups.find((entry) => entry.isSuperAdmin || entry.role === "owner" || entry.role === "admin");

        if (!mounted) return;
        if (!group || !(group.isSuperAdmin || group.role === "owner" || group.role === "admin")) {
          // Not a manager: the RLS policy would return nothing anyway — hide the section.
          setStatus("hidden");
          return;
        }

        setProjects(group.projects);
        const rows = await loadAuditLogFromSupabase(group.workspace.id, { limit: PAGE_SIZE });
        if (!mounted) return;
        setEntries(rows);
        setHasMore(rows.length === PAGE_SIZE);
        setStatus("ready");
        void resolveNames(rows);
      } catch (error) {
        if (!mounted) return;
        setMessage(error instanceof Error ? error.message : "Unable to load activity.");
        setStatus("error");
      }
    })();

    return () => {
      mounted = false;
    };
     
  }, [project?.workspaceId, supabase]);

  async function loadMore() {
    const oldest = entries[entries.length - 1];
    if (!oldest || !project?.workspaceId) return;
    setIsLoadingMore(true);
    try {
      const rows = await loadAuditLogFromSupabase(project.workspaceId, {
        beforeId: oldest.id,
        limit: PAGE_SIZE,
      });
      setEntries((current) => [...current, ...rows]);
      setHasMore(rows.length === PAGE_SIZE);
      void resolveNames(rows);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load more activity.");
    } finally {
      setIsLoadingMore(false);
    }
  }

  if (status === "hidden") {
    return null;
  }

  const projectNames = new Map(projects.map((proj) => [proj.id, proj.name]));

  return (
    <section className="ui-settings-section">
      <h3 className="ui-settings-section-title">Activity</h3>
      <p className="ui-settings-section-desc">
        Membership, invite, and access changes in this organization. Recorded automatically and immutable.
      </p>
      <div className="ui-settings-group">
        {status === "loading" ? (
          <div className="p-3.5 ui-settings-group-row-value">Loading activity…</div>
        ) : status === "error" ? (
          <div className="p-3.5 ui-settings-group-row-value text-danger">{message || "Failed to load activity."}</div>
        ) : entries.length ? (
          <>
            {entries.map((entry) => (
              <div key={entry.id} className="flex items-start gap-2.5 px-3.5 py-2.5">
                <History size={13} className="mt-0.5 shrink-0 text-ink-tertiary" />
                <div className="min-w-0">
                  <div className="ui-settings-group-row-value">
                    <span className="font-medium">{entry.actorEmail ?? "System"}</span>{" "}
                    {describeEntry(entry, names, projectNames)}
                  </div>
                  <div
                    className="ui-settings-group-row-desc"
                    title={new Date(entry.createdAt).toLocaleString()}
                  >
                    {relativeTime(entry.createdAt)}
                  </div>
                </div>
              </div>
            ))}
            {hasMore ? (
              <div className="p-2.5">
                <button
                  type="button"
                  className="ui-btn-ghost h-8 w-full disabled:opacity-50"
                  onClick={() => void loadMore()}
                  disabled={isLoadingMore}
                >
                  {isLoadingMore ? "Loading…" : "Load older activity"}
                </button>
              </div>
            ) : null}
          </>
        ) : (
          <div className="p-3.5 ui-settings-group-row-value">
            No activity recorded yet. Invites, role changes, and access changes will appear here.
          </div>
        )}
      </div>
    </section>
  );
}
