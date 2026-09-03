"use client";

import { formatDate } from "@/domain/formatting";
import { ChevronRight, MailPlus, RotateCw, Search, ShieldCheck, Trash2, UserMinus } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ThemedSelect } from "@/components/themed-select";
import { WorkspaceInviteComposer } from "@/components/workspace-invite-composer";
import { resolveSupabaseSession } from "@/lib/supabase-auth";
import {
  createPlannerSupabaseClient,
  deleteWorkspaceAccessGrantFromSupabase,
  loadMembersAccessForWorkspace,
  loadWorkspaceAccessGrantsFromSupabase,
  loadWorkspaceProjectGroups,
  removeWorkspaceMemberInSupabase,
  setOrgToolAccessInSupabase,
  setProjectAccessInSupabase,
  updateWorkspaceMemberRoleInSupabase,
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
import { grantSpaceAccess, listSpaceAccess, revokeSpaceAccess, type SpaceAccessRow } from "@/lib/planning/store";
import { listDepartments } from "@/lib/departments/store";
import type { Department } from "@/domain/departments";
import {
  compactInviteEntitlementSummary,
  entitlementsFromWorkspaceAccessGrant,
  organizationRoleLabel,
  type WorkspaceInviteEntitlements,
} from "@/domain/workspace/invite-access";

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

const ROLE_DESCRIPTIONS: Record<WorkspaceRole, string> = {
  owner: "Full control: members, roles, owners, and organization settings.",
  admin: "Manages members and automatically has full module and project access.",
  editor: "Uses only the modules, projects, and SOP duties explicitly assigned.",
  viewer: "Uses only the modules, projects, and SOP duties explicitly assigned.",
};

const workspaceRoleOptions: Array<{ value: WorkspaceRole; label: string; description: string }> = [
  { value: "editor", label: "Member", description: ROLE_DESCRIPTIONS.editor },
  { value: "admin", label: "Admin", description: ROLE_DESCRIPTIONS.admin },
  { value: "owner", label: "Owner", description: ROLE_DESCRIPTIONS.owner },
];

function isManagerRole(role?: WorkspaceRole) {
  return role === "owner" || role === "admin";
}


function memberLabel(member: MemberAccess) {
  return member.fullName || member.email || member.userId;
}

type InviteResult = { text: string; tone: "info" | "error" };

export function WorkspaceMembersSettings({ project }: { project?: PlannerProjectContext }) {
  const supabase = useMemo(() => createPlannerSupabaseClient(), []);
  const [status, setStatus] = useState<"loading" | "ready" | "forbidden" | "error">("loading");
  const [message, setMessage] = useState("");
  const [signedInEmail, setSignedInEmail] = useState("");
  const [detectedRole, setDetectedRole] = useState<WorkspaceRole | "superadmin" | "none">("none");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [workspaceId, setWorkspaceId] = useState<string>();
  const [projects, setProjects] = useState<Project[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [members, setMembers] = useState<MemberAccess[]>([]);
  const [grants, setGrants] = useState<WorkspaceAccessGrant[]>([]);
  const [spaceAccess, setSpaceAccess] = useState<SpaceAccessRow[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>();
  const [search, setSearch] = useState("");
  // Two-step confirmation targets for destructive actions.
  const [confirmRemoveUserId, setConfirmRemoveUserId] = useState<string>();
  const [confirmCancelEmail, setConfirmCancelEmail] = useState<string>();

  const callerIsOwner = detectedRole === "owner" || detectedRole === "superadmin";

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

      const [nextMembers, nextGrants, nextSpaceAccess, nextDepartments] = await Promise.all([
        loadMembersAccessForWorkspace(group.workspace.id),
        loadWorkspaceAccessGrantsFromSupabase(group.workspace.id).catch(() => []),
        listSpaceAccess(group.workspace.id).catch(() => []),
        listDepartments(group.workspace.id).catch(() => []),
      ]);
      setMembers(nextMembers);
      setGrants(nextGrants);
      setSpaceAccess(nextSpaceAccess);
      setDepartments(nextDepartments);
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
      if (!workspaceId) return;
      await setOrgToolAccessInSupabase(workspaceId, userId, level);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to update Quality Module access.");
      await load();
    }
  }

  async function changeMemberRole(userId: string, role: WorkspaceRole) {
    if (!workspaceId) return;
    const previous = members;
    setMembers((current) => current.map((member) => (member.userId === userId ? { ...member, role } : member)));
    try {
      await updateWorkspaceMemberRoleInSupabase(workspaceId, userId, role);
    } catch (error) {
      setMembers(previous);
      setMessage(error instanceof Error ? error.message : "Unable to change the role.");
    }
  }

  function hasPlanningAccess(userId: string): boolean {
    return spaceAccess.some((row) => row.space === "planning" && row.userId === userId);
  }

  async function togglePlanningAccess(userId: string, granted: boolean) {
    if (!workspaceId) return;
    const previous = spaceAccess;
    setSpaceAccess((current) =>
      granted
        ? current.filter((row) => !(row.space === "planning" && row.userId === userId))
        : [...current, { userId, space: "planning", grantedBy: null, createdAt: new Date().toISOString() }],
    );
    try {
      if (granted) {
        await revokeSpaceAccess(workspaceId, userId, "planning");
      } else {
        await grantSpaceAccess(workspaceId, userId, "planning");
      }
    } catch (error) {
      setSpaceAccess(previous);
      setMessage(error instanceof Error ? error.message : "Unable to update Planning access.");
    }
  }

  // Writes the grant and asks the server to send the invitation email. Falls back to a
  // grant-only write when the API route is unreachable, and says so honestly.
  async function sendInvite(
    email: string,
    entitlements: WorkspaceInviteEntitlements,
  ): Promise<InviteResult> {
    if (!workspaceId) {
      return { text: "Select an organization first.", tone: "error" };
    }

    const { data } = await supabase.auth.getSession();
    const accessToken = data.session?.access_token;
    if (!accessToken) {
      return { text: "Sign in again to invite members.", tone: "error" };
    }

    let response: Response;
    try {
      response = await fetch("/api/invites", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, email, ...entitlements }),
      });
    } catch {
      await upsertWorkspaceAccessGrantInSupabase(workspaceId, email, entitlements);
      return {
        text: `Access granted for ${email}, but the invitation email could not be sent — ask them to sign in with this address.`,
        tone: "info",
      };
    }

    const payload = (await response.json().catch(() => ({}))) as {
      alreadyRegistered?: boolean;
      error?: string;
      emailSent?: boolean;
      reason?: string;
    };

    if (!response.ok) {
      return { text: payload.error ?? "Unable to invite user.", tone: "error" };
    }

    if (payload.emailSent && payload.alreadyRegistered) {
      return {
        text: `${email} already has a Pulse account, so we emailed them a sign-in reminder instead of a setup link. Their access applies as soon as they sign in.`,
        tone: "info",
      };
    }

    if (payload.emailSent) {
      return {
        text: `Invitation email sent to ${email}. They'll create a password to finish setup; the secure setup link expires in 24 hours.`,
        tone: "info",
      };
    }

    return {
      text: payload.reason ? `Access granted for ${email}. ${payload.reason}` : `Access granted for ${email}.`,
      tone: "info",
    };
  }

  async function invite(email: string, entitlements: WorkspaceInviteEntitlements): Promise<boolean> {
    const normalized = email.trim().toLowerCase();

    setIsSubmitting(true);
    setMessage("");
    try {
      const result = await sendInvite(normalized, entitlements);
      if (result.tone === "info") {
        await load();
      }
      setMessage(result.text);
      return result.tone === "info";
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to invite user.");
      return false;
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
      setConfirmCancelEmail(undefined);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to remove invite.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function removeMember(userId: string) {
    if (!workspaceId) return;
    setIsSubmitting(true);
    setMessage("");
    try {
      await removeWorkspaceMemberInSupabase(workspaceId, userId);
      setConfirmRemoveUserId(undefined);
      setSelectedUserId(undefined);
      await load();
      setMessage("Member removed. They can no longer sign in to this organization; re-invite them to restore access.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to remove the member.");
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
      <Block title="Members" description="Only organization owners and admins can manage members and access.">
        <div className="p-3.5 ui-settings-group-row-value">
          Signed in as <strong>{signedInEmail || "unknown"}</strong> (role: {detectedRole}). This account
          can&apos;t manage members. Ask an owner or admin if you need access changed.
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

  const query = search.trim().toLowerCase();
  const filteredMembers = query
    ? members.filter((member) =>
        [member.fullName, member.email, member.userId].some((value) => value?.toLowerCase().includes(query)),
      )
    : members;
  const selected = members.find((member) => member.userId === selectedUserId);
  const pendingGrants = grants.filter(
    (grant) => !grant.redeemedAt && (!query || grant.email.toLowerCase().includes(query)),
  );
  const selectedIsManager = isManagerRole(selected?.role);
  // Ownership controls elevation: admins may manage Member access but cannot mint or demote managers.
  const canEditSelectedRole = Boolean(selected && !selected.isSelf && (callerIsOwner || !selectedIsManager));
  const roleOptionsForSelected = callerIsOwner
    ? workspaceRoleOptions
    : workspaceRoleOptions.filter((option) => option.value === "editor");

  return (
    <>
      {message ? <p className="ui-settings-section-desc px-1 text-ink-secondary">{message}</p> : null}

      <Block title="Members" description="Everyone in this organization, including invites that haven't been accepted yet.">
        <div className="flex items-center gap-2 border-b border-line px-3.5 py-1.5">
          <Search size={13} className="shrink-0 text-ink-tertiary" />
          <input
            className="w-full bg-transparent text-[13px] outline-none placeholder:text-ink-tertiary"
            type="search"
            placeholder="Search by name or email"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        {filteredMembers.length || pendingGrants.length ? (
          <>
            {filteredMembers.map((member) => {
              const manager = isManagerRole(member.role);
              const active = member.userId === selectedUserId;
              const joined = formatDate(member.joinedAt);
              return (
                <button
                  key={member.userId}
                  type="button"
                  onClick={() => {
                    setSelectedUserId(active ? undefined : member.userId);
                    setConfirmRemoveUserId(undefined);
                  }}
                  aria-expanded={active}
                  className="ui-settings-group-row ui-settings-member-list-row ui-settings-member-row"
                >
                  <div className="ui-settings-group-row-copy">
                    <div className="ui-settings-group-row-label">
                      {memberLabel(member)}
                      {member.isSelf ? " (you)" : ""}
                    </div>
                    <div className="ui-settings-group-row-desc">
                      <span title={ROLE_DESCRIPTIONS[member.role]}>
                        {organizationRoleLabel(member.role)}
                      </span>
                      {manager ? " · full access" : ""}
                      {member.email ? ` · ${member.email}` : ""}
                      {joined ? ` · joined ${joined}` : ""}
                    </div>
                  </div>
                  <div className="ui-settings-group-row-control ui-settings-member-row-chevron">
                    <ChevronRight
                      size={14}
                      className={`text-ink-tertiary transition-transform ${active ? "rotate-90" : ""}`}
                    />
                  </div>
                </button>
              );
            })}

            {pendingGrants.map((grant) => {
              const expires = formatDate(grant.expiresAt);
              const expired = grant.expiresAt ? new Date(grant.expiresAt).getTime() < Date.now() : false;
              const confirming = confirmCancelEmail === grant.email;
              return (
                <div key={grant.email} className="ui-settings-group-row ui-settings-member-list-row">
                  <div className="ui-settings-group-row-copy">
                    <div className="flex items-center gap-2">
                      <MailPlus size={13} className="shrink-0 text-ink-tertiary" />
                      <span className="ui-settings-group-row-label truncate">{grant.email}</span>
                      <span className="ui-chip shrink-0">{expired ? "Expired" : "Pending"}</span>
                    </div>
                    <div className="ui-settings-group-row-desc">
                      <span>{compactInviteEntitlementSummary(entitlementsFromWorkspaceAccessGrant(grant))}</span>
                      {expires ? ` · ${expired ? "expired" : "expires"} ${expires}` : ""}
                    </div>
                  </div>
                  <div className="ui-settings-group-row-control flex items-center gap-1.5">
                    {confirming ? (
                      <>
                        <button
                          type="button"
                          className="ui-btn-ghost h-7 px-2 text-danger disabled:opacity-50"
                          onClick={() => void removeGrant(grant.email)}
                          disabled={isSubmitting}
                        >
                          Cancel invite
                        </button>
                        <button
                          type="button"
                          className="ui-btn-ghost h-7 px-2 disabled:opacity-50"
                          onClick={() => setConfirmCancelEmail(undefined)}
                          disabled={isSubmitting}
                        >
                          Keep
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="ui-btn-ghost h-7 w-7 shrink-0 px-0 disabled:opacity-50"
                          onClick={() => void invite(grant.email, entitlementsFromWorkspaceAccessGrant(grant))}
                          disabled={isSubmitting}
                          title="Resend invite (new 24-hour setup link; refreshes the 30-day access window)"
                        >
                          <RotateCw size={13} />
                        </button>
                        <button
                          type="button"
                          className="ui-btn-ghost h-7 w-7 shrink-0 px-0 text-danger disabled:opacity-50"
                          onClick={() => setConfirmCancelEmail(grant.email)}
                          disabled={isSubmitting}
                          title="Cancel invite"
                        >
                          <Trash2 size={13} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </>
        ) : (
          <div className="p-3.5 ui-settings-group-row-value">
            {query ? "No members match your search." : "No members yet."}
          </div>
        )}
      </Block>

      {selected ? (
        <Block
          title={`Access · ${memberLabel(selected)}`}
          description={
            isManagerRole(selected.role)
              ? "Owners and admins automatically have full module and project access."
              : "Set this Member's module and project access. SOP workflow duties remain department-specific."
          }
        >
          <Row label="Organization role" description={ROLE_DESCRIPTIONS[selected.role]}>
            {canEditSelectedRole ? (
              <ThemedSelect
                triggerClassName="h-9 px-3"
                value={selected.role}
                options={roleOptionsForSelected}
                selectedLabel={organizationRoleLabel(selected.role)}
                onChange={(value) => void changeMemberRole(selected.userId, value as WorkspaceRole)}
                disabled={isSubmitting}
              />
            ) : (
              <span className="ui-settings-group-row-value">
                {organizationRoleLabel(selected.role)}
                {selected.isSelf ? " (you)" : ""}
              </span>
            )}
          </Row>

          <Row label="Planning" description="Work orders, schedules and capacity for the production plan.">
            {isManagerRole(selected.role) ? (
              <span className="ui-chip">Included</span>
            ) : (
              <button
                type="button"
                className="ui-btn-ghost h-8 px-3 disabled:opacity-50"
                onClick={() => void togglePlanningAccess(selected.userId, hasPlanningAccess(selected.userId))}
                disabled={isSubmitting}
              >
                {hasPlanningAccess(selected.userId) ? "Revoke" : "Grant"}
              </button>
            )}
          </Row>

          {isManagerRole(selected.role) ? (
            <div className="flex items-center gap-2 p-3.5 ui-settings-group-row-value">
              <ShieldCheck size={14} className="text-ink-tertiary" />
              Full module and project access (organization role).
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
              <Row label="Quality Module" description="SOPs, reviews and controlled documents">
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

          {!selected.isSelf && (callerIsOwner || !selectedIsManager) ? (
            <div className="flex items-center justify-between gap-2 p-3.5">
              {confirmRemoveUserId === selected.userId ? (
                <>
                  <span className="ui-settings-group-row-desc">
                    Remove {memberLabel(selected)}? They lose all access and won&apos;t rejoin automatically.
                  </span>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      className="ui-btn-ghost h-8 px-3 text-danger disabled:opacity-50"
                      onClick={() => void removeMember(selected.userId)}
                      disabled={isSubmitting}
                    >
                      Remove member
                    </button>
                    <button
                      type="button"
                      className="ui-btn-ghost h-8 px-3 disabled:opacity-50"
                      onClick={() => setConfirmRemoveUserId(undefined)}
                      disabled={isSubmitting}
                    >
                      Keep
                    </button>
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  className="ui-btn-ghost h-8 gap-1.5 px-3 text-danger disabled:opacity-50"
                  onClick={() => setConfirmRemoveUserId(selected.userId)}
                  disabled={isSubmitting}
                >
                  <UserMinus size={13} />
                  Remove from organization
                </button>
              )}
            </div>
          ) : null}
        </Block>
      ) : null}

      <Block
        title="Invite a user"
        description="Anacorp work emails only. Configure organization, resource, project, and SOP workflow access before sending."
      >
        <WorkspaceInviteComposer
          callerIsOwner={callerIsOwner}
          departments={departments}
          isSubmitting={isSubmitting}
          onSubmit={invite}
          projects={projects}
        />
      </Block>
    </>
  );
}
