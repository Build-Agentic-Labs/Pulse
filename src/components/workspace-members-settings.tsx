"use client";

import { ChevronRight, MailPlus, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ThemedSelect } from "@/components/themed-select";
import { resolveSupabaseSession } from "@/lib/supabase-auth";
import {
  createPlannerSupabaseClient,
  deleteWorkspaceAccessGrantFromSupabase,
  loadMembersAccessForWorkspace,
  loadWorkspaceAccessGrantsFromSupabase,
  loadWorkspaceProjectGroups,
  setOrgToolAccessInSupabase,
  setProjectAccessInSupabase,
  upsertWorkspaceAccessGrantInSupabase,
} from "@/domain/supabase-planner";
import type {
  AccessLevel,
  MemberAccess,
  PlannerProjectContext,
  Project,
  WorkspaceAccessGrant,
  WorkspaceRole,
} from "@/domain/types";

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

function Row({ label, description, children }: { label: string; description?: string; children: ReactNode }) {
  return (
    <div className="ui-settings-group-row">
      <div className="ui-settings-group-row-copy">
        <div className="ui-settings-group-row-label">{label}</div>
        {description ? <div className="ui-settings-group-row-desc">{description}</div> : null}
      </div>
      <div className="ui-settings-group-row-control">{children}</div>
    </div>
  );
}

const accessLevelOptions: Array<{ value: AccessLevel; label: string }> = [
  { value: "none", label: "None" },
  { value: "view", label: "View" },
  { value: "edit", label: "Edit" },
];

const workspaceRoleOptions: Array<{ value: WorkspaceRole; label: string }> = [
  { value: "viewer", label: "Viewer" },
  { value: "editor", label: "Editor" },
  { value: "admin", label: "Admin" },
  { value: "owner", label: "Owner" },
];

function isManagerRole(role?: WorkspaceRole) {
  return role === "owner" || role === "admin";
}

export function WorkspaceMembersSettings({ project }: { project?: PlannerProjectContext }) {
  const supabase = useMemo(() => createPlannerSupabaseClient(), []);
  const [status, setStatus] = useState<"loading" | "ready" | "forbidden" | "error">("loading");
  const [message, setMessage] = useState("");
  const [signedInEmail, setSignedInEmail] = useState("");
  const [detectedRole, setDetectedRole] = useState<WorkspaceRole | "superadmin" | "none">("none");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [workspaceId, setWorkspaceId] = useState<string>();
  const [projects, setProjects] = useState<Project[]>([]);
  const [members, setMembers] = useState<MemberAccess[]>([]);
  const [grants, setGrants] = useState<WorkspaceAccessGrant[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>("editor");

  async function load() {
    try {
      const { session } = await resolveSupabaseSession(supabase);
      if (!session) {
        setStatus("forbidden");
        return;
      }
      setSignedInEmail(session.user.email ?? "");

      const groups = await loadWorkspaceProjectGroups();
      const group =
        groups.find((entry) => entry.workspace.id === project?.workspaceId) ??
        groups.find((entry) => entry.isSuperAdmin || isManagerRole(entry.role)) ??
        groups[0];

      if (!group) {
        setDetectedRole("none");
        setStatus("forbidden");
        return;
      }

      const superAdmin = Boolean(group.isSuperAdmin);
      setDetectedRole(superAdmin ? "superadmin" : group.role);

      if (!(superAdmin || isManagerRole(group.role))) {
        setStatus("forbidden");
        return;
      }

      setWorkspaceId(group.workspace.id);
      setProjects(group.projects);

      const [nextMembers, nextGrants] = await Promise.all([
        loadMembersAccessForWorkspace(group.workspace.id),
        loadWorkspaceAccessGrantsFromSupabase(group.workspace.id).catch(() => []),
      ]);
      setMembers(nextMembers);
      setGrants(nextGrants);
      setStatus("ready");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load members.");
      setStatus("error");
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.workspaceId]);

  async function changeProjectAccess(projectId: string, userId: string, level: AccessLevel) {
    setMembers((current) =>
      current.map((member) =>
        member.userId === userId
          ? { ...member, projectLevels: { ...member.projectLevels, [projectId]: level } }
          : member,
      ),
    );
    try {
      await setProjectAccessInSupabase(projectId, userId, level);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to update access.");
      await load();
    }
  }

  async function changeOrgToolAccess(userId: string, level: AccessLevel) {
    setMembers((current) =>
      current.map((member) => (member.userId === userId ? { ...member, orgTools: level } : member)),
    );
    try {
      await setOrgToolAccessInSupabase(userId, level);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to update Org tools access.");
      await load();
    }
  }

  async function invite() {
    const email = inviteEmail.trim();
    if (!email || !workspaceId) {
      setMessage("Add a work email first.");
      return;
    }
    setIsSubmitting(true);
    setMessage("");
    try {
      await upsertWorkspaceAccessGrantInSupabase(workspaceId, email, inviteRole);
      setInviteEmail("");
      await load();
      setMessage("Invite sent. They'll appear as a member after they sign in.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to invite user.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function removeGrant(email: string) {
    if (!workspaceId) return;
    setIsSubmitting(true);
    setMessage("");
    try {
      await deleteWorkspaceAccessGrantFromSupabase(workspaceId, email);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to remove invite.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (status === "loading") {
    return (
      <Block title="Members">
        <div className="p-3.5 ui-settings-group-row-value">Loading members…</div>
      </Block>
    );
  }

  if (status === "forbidden") {
    return (
      <Block title="Members" description="Only organization managers can manage members and access.">
        <div className="p-3.5 ui-settings-group-row-value">
          Signed in as <strong>{signedInEmail || "unknown"}</strong> (detected access: {detectedRole}). This account
          can&apos;t manage members. Sign in as an owner/admin or superadmin.
        </div>
      </Block>
    );
  }

  if (status === "error") {
    return (
      <Block title="Members">
        <div className="p-3.5">
          <p className="ui-settings-group-row-value text-danger">{message || "Failed to load members."}</p>
          <button type="button" className="ui-btn-ghost mt-2 h-8 px-3" onClick={() => void load()}>
            Retry
          </button>
        </div>
      </Block>
    );
  }

  const selected = members.find((member) => member.userId === selectedUserId);
  const pendingGrants = grants.filter((grant) => !grant.redeemedAt);

  return (
    <>
      {message ? <p className="ui-settings-section-desc px-1 text-ink-secondary">{message}</p> : null}

      <Block title="Members" description="Pick a member to set their access.">
        {members.length ? (
          members.map((member) => {
            const manager = isManagerRole(member.role);
            const active = member.userId === selectedUserId;
            return (
              <button
                key={member.userId}
                type="button"
                onClick={() => setSelectedUserId(active ? undefined : member.userId)}
                className={`ui-settings-group-row w-full text-left transition-colors hover:bg-surface-hover ${
                  active ? "bg-surface-active" : ""
                }`}
              >
                <div className="ui-settings-group-row-copy">
                  <div className="ui-settings-group-row-label">
                    {member.fullName || member.userId}
                    {member.isSelf ? " (you)" : ""}
                  </div>
                  <div className="ui-settings-group-row-desc capitalize">
                    {manager ? `${member.role} · full access` : member.role}
                  </div>
                </div>
                <div className="ui-settings-group-row-control">
                  <ChevronRight
                    size={14}
                    className={`text-ink-tertiary transition-transform ${active ? "rotate-90" : ""}`}
                  />
                </div>
              </button>
            );
          })
        ) : (
          <div className="p-3.5 ui-settings-group-row-value">No members yet.</div>
        )}
      </Block>

      {selected ? (
        <Block
          title={`Access · ${selected.fullName || selected.userId}`}
          description={
            isManagerRole(selected.role) ? undefined : "Set this member's access to each workspace and Org tools."
          }
        >
          {isManagerRole(selected.role) ? (
            <div className="flex items-center gap-2 p-3.5 ui-settings-group-row-value">
              <ShieldCheck size={14} className="text-ink-tertiary" />
              Full access to all workspaces and Org tools (manager role).
            </div>
          ) : (
            <>
              {projects.map((proj) => (
                <Row key={proj.id} label={proj.name}>
                  <ThemedSelect
                    triggerClassName="h-9 px-3"
                    value={selected.projectLevels[proj.id] ?? "none"}
                    options={accessLevelOptions}
                    onChange={(value) => void changeProjectAccess(proj.id, selected.userId, value as AccessLevel)}
                    disabled={isSubmitting}
                  />
                </Row>
              ))}
              <Row label="Org tools" description="SOP builder">
                <ThemedSelect
                  triggerClassName="h-9 px-3"
                  value={selected.orgTools}
                  options={accessLevelOptions}
                  onChange={(value) => void changeOrgToolAccess(selected.userId, value as AccessLevel)}
                  disabled={isSubmitting}
                />
              </Row>
            </>
          )}
        </Block>
      ) : null}

      <Block title="Invite a user" description="Anacorp emails only. New users start with no access until you grant it.">
        <div className="space-y-2 p-3.5">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_140px_auto]">
            <input
              className="ui-field-standalone h-9 px-3"
              type="email"
              placeholder="name@anacorp.com"
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              disabled={isSubmitting}
            />
            <ThemedSelect
              triggerClassName="h-9 px-3"
              value={inviteRole}
              options={workspaceRoleOptions}
              onChange={(value) => setInviteRole(value as WorkspaceRole)}
              disabled={isSubmitting}
            />
            <button
              type="button"
              className="ui-btn-ghost h-9 gap-1.5 px-3 disabled:opacity-50"
              onClick={() => void invite()}
              disabled={isSubmitting}
            >
              <Plus size={13} />
              Invite
            </button>
          </div>

          {pendingGrants.length ? (
            <div className="divide-y divide-line rounded-lg border border-line">
              {pendingGrants.map((grant) => (
                <div key={grant.email} className="flex items-center justify-between gap-2 px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <MailPlus size={13} className="shrink-0 text-ink-tertiary" />
                    <span className="truncate ui-settings-group-row-value">{grant.email}</span>
                    <span className="ui-chip shrink-0 capitalize">{grant.role}</span>
                  </div>
                  <button
                    type="button"
                    className="ui-btn-ghost h-7 w-7 shrink-0 px-0 text-danger disabled:opacity-50"
                    onClick={() => void removeGrant(grant.email)}
                    disabled={isSubmitting}
                    title="Cancel invite"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </Block>
    </>
  );
}
