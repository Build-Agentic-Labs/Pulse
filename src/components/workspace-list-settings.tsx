"use client";

import { Check } from "lucide-react";
import { formatDate } from "@/domain/formatting";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { resolveSupabaseSession } from "@/lib/supabase-auth";
import {
  createPlannerSupabaseClient,
  loadProfileNamesByIds,
  loadWorkspaceProjectGroups,
  updateWorkspaceInSupabase,
} from "@/domain/supabase-planner";
import type { WorkspaceProjectGroup } from "@/domain/types";

// Local copies of the settings primitives (kept here to avoid a circular import with
// app-settings-panel, which imports this component).
function Block({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="ui-settings-section">
      <h3 className="ui-settings-section-title">{title}</h3>
      {description ? <p className="ui-settings-section-desc">{description}</p> : null}
      <div className="ui-settings-group">{children}</div>
    </section>
  );
}


// Only owners/admins (and superadmins) can rename a workspace — mirrors the
// "workspaces admin update" RLS policy, so the listed rows are always editable.
function canManage(group: WorkspaceProjectGroup): boolean {
  return Boolean(group.isSuperAdmin) || group.role === "owner" || group.role === "admin";
}

export function WorkspaceListSettings() {
  const supabase = useMemo(() => createPlannerSupabaseClient(), []);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");
  const [groups, setGroups] = useState<WorkspaceProjectGroup[]>([]);
  const [creators, setCreators] = useState<Map<string, string>>(new Map());
  const [currentUserId, setCurrentUserId] = useState<string>();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string>();

  async function load() {
    try {
      const { session } = await resolveSupabaseSession(supabase);
      if (!session) {
        setStatus("error");
        setMessage("Sign in to manage organizations.");
        return;
      }
      setCurrentUserId(session.user.id);

      const all = await loadWorkspaceProjectGroups();
      const manageable = all.filter(canManage);
      setGroups(manageable);
      setDrafts(Object.fromEntries(manageable.map((group) => [group.workspace.id, group.workspace.name])));

      const ownerIds = manageable
        .map((group) => group.workspace.ownerId)
        .filter((id): id is string => Boolean(id));
      const names = await loadProfileNamesByIds(ownerIds).catch(() => new Map<string, string>());
      setCreators(names);

      setStatus("ready");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load organizations.");
      setStatus("error");
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveName(workspaceId: string) {
    const name = (drafts[workspaceId] ?? "").trim();
    if (!name) {
      setMessage("Organization name can't be empty.");
      return;
    }
    setSavingId(workspaceId);
    setMessage("");
    try {
      await updateWorkspaceInSupabase(workspaceId, { name });
      setGroups((current) =>
        current.map((group) =>
          group.workspace.id === workspaceId
            ? { ...group, workspace: { ...group.workspace, name } }
            : group,
        ),
      );
      setMessage("Organization name updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to rename organization.");
    } finally {
      setSavingId(undefined);
    }
  }

  if (status === "loading") {
    return (
      <Block title="Organizations">
        <div className="p-3.5 ui-settings-group-row-value">Loading organizations…</div>
      </Block>
    );
  }

  if (status === "error") {
    return (
      <Block title="Organizations">
        <div className="p-3.5">
          <p className="ui-settings-group-row-value text-danger">{message || "Failed to load organizations."}</p>
          <button type="button" className="ui-btn-ghost mt-2 h-8 px-3" onClick={() => void load()}>
            Retry
          </button>
        </div>
      </Block>
    );
  }

  return (
    <Block
      title="Organizations"
      description="Rename the organizations you manage, and see who created each one."
    >
      {message ? <p className="ui-settings-section-desc px-3.5 pt-2 text-ink-secondary">{message}</p> : null}

      {groups.length ? (
        groups.map((group) => {
          const workspace = group.workspace;
          const draft = drafts[workspace.id] ?? workspace.name;
          const isYours = Boolean(workspace.ownerId && workspace.ownerId === currentUserId);
          const creator = workspace.ownerId
            ? creators.get(workspace.ownerId) ?? (isYours ? "You" : "Unknown")
            : "Unknown";
          const created = formatDate(workspace.createdAt);
          const roleLabel = group.isSuperAdmin ? "superadmin" : group.role;
          const dirty = draft.trim().length > 0 && draft.trim() !== workspace.name;
          const saving = savingId === workspace.id;

          return (
            <div key={workspace.id} className="ui-settings-group-row">
              <div className="ui-settings-group-row-copy">
                <input
                  className="ui-field-standalone h-9 w-full max-w-xs px-3"
                  value={draft}
                  placeholder="Organization name"
                  disabled={saving}
                  onChange={(event) =>
                    setDrafts((current) => ({ ...current, [workspace.id]: event.target.value }))
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && dirty && !saving) {
                      void saveName(workspace.id);
                    }
                  }}
                />
                <div className="ui-settings-group-row-desc">
                  Created by {creator}
                  {isYours ? " (you)" : ""}
                  {created ? ` · ${created}` : ""}
                  {` · ${roleLabel}`}
                </div>
              </div>
              <div className="ui-settings-group-row-control">
                <button
                  type="button"
                  className="ui-btn-ghost h-9 gap-1.5 px-3 disabled:opacity-50"
                  disabled={!dirty || saving}
                  onClick={() => void saveName(workspace.id)}
                >
                  <Check size={13} />
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          );
        })
      ) : (
        <div className="p-3.5 ui-settings-group-row-value">No organizations you can manage.</div>
      )}
    </Block>
  );
}
