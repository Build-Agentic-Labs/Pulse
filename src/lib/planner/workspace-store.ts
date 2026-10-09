// Planner workspace administration: the signed-in user's organization/product directory (membership
// bootstrap and concurrent-read sharing, both keyed by client so server requests never share state),
// product creation and edits, organization rename, profile names, members and the per-member access
// matrix, invitations and member offboarding. Moved verbatim from supabase-planner.ts (Phase 5); the
// facade re-exports the public names.

import { fetchIsSuperAdmin, fetchUserProjectAccessMap, loadProjectContext } from "./access-store";
import { getUserFromSession, plannerClient } from "./client";
import { isMissingRelationError, throwIfError } from "./query-helpers";
import {
  mapProject,
  mapWorkspace,
  mapWorkspaceAccessGrant,
  maybeText,
  normalizeAccessLevel,
} from "./row-mappers";
import type {
  AccessLevel,
  MemberAccess,
  PlannerProjectContext,
  Project,
  WorkspaceAccessGrant,
  WorkspaceMemberProfile,
  WorkspaceProjectGroup,
  WorkspaceRole,
} from "@/domain/types";
import {
  normalizedInviteEntitlements,
  type WorkspaceInviteEntitlements,
  workspaceRoleForOrganizationRole,
} from "@/domain/workspace/invite-access";
import { isAllowedSignupEmail, SIGNUP_DOMAIN_MESSAGE } from "@/lib/allowed-signup-domain";
import type { Database, Json, TablesUpdate } from "@/lib/database.types";
import { displayNameValidationMessage, normalizeDisplayName } from "@/lib/profile-name";
import { kickSopNotifications } from "@/lib/sop/notify-kick";
import { readAllPages, readRowsByIds } from "@/lib/supabase/read-all-pages";
import type { SupabaseClient } from "@supabase/supabase-js";

// Exact columns consumed by mapWorkspace/mapProject -- avoids select('*') on the hot
// sidebar load path (audit #9). Keep in sync with the mappers below.
const WORKSPACE_COLUMNS = "id, name, owner_id, created_at, updated_at";
const PROJECT_COLUMNS = "id, workspace_id, name, description, is_awi_master, portfolio_category, portfolio_position, status, created_by, created_at, updated_at";

// The profile upsert + grant redemption only need to run once per signed-in user per tab:
// both are idempotent, and a full page reload re-runs them. Repeat mounts (auth gate,
// sidebar, SOP provider, client-side navigations) skip the two write round-trips.
//
// Both dedupe structures are keyed BY CLIENT (WeakMap, same pattern as
// inflightSuperAdminChecks): in the browser the client is a tab-wide singleton so
// behavior is unchanged, while on a server a per-request client gets fresh state —
// an unkeyed module-level promise there would hand one user's workspace groups to
// a concurrently-loading different user (refactor plan, Stage 4).
const bootstrappedMembershipUserIdsByClient = new WeakMap<SupabaseClient, Set<string>>();
// Concurrent callers on the same client share one in-flight load instead of issuing
// duplicate query chains. The promise is cleared on settle: later calls (e.g. sidebar
// refresh after creating a project) still fetch fresh data.
export type WorkspaceDirectoryScope = "project" | "product";
const inflightMembershipLoads = new WeakMap<SupabaseClient, Map<string, Promise<WorkspaceProjectGroup[]>>>();

export async function ensureDefaultWorkspaceMembership(
  client?: ReturnType<typeof plannerClient>,
  scope: WorkspaceDirectoryScope = "project",
): Promise<WorkspaceProjectGroup[]> {
  const supabase = client ?? plannerClient();
  const { data: userData } = await getUserFromSession(supabase);
  if (!userData.user) throw new Error("Sign in before loading organizations.");
  const user = userData.user;
  const key = `${user.id}:${scope}`;
  let pendingLoads = inflightMembershipLoads.get(supabase);
  if (!pendingLoads) { pendingLoads = new Map(); inflightMembershipLoads.set(supabase, pendingLoads); }
  const inflight = pendingLoads.get(key);
  if (inflight) {
    return inflight;
  }

  const load = (async () => {
    let bootstrappedUserIds = bootstrappedMembershipUserIdsByClient.get(supabase);
    if (!bootstrappedUserIds) {
      bootstrappedUserIds = new Set<string>();
      bootstrappedMembershipUserIdsByClient.set(supabase, bootstrappedUserIds);
    }
    const didBootstrap = !bootstrappedUserIds.has(user.id);
    if (didBootstrap) {
      // The two writes are independent of each other, but grant redemption must land
      // before memberships are read -- it can mint the membership rows a new user's
      // first load depends on -- so both complete before loadWorkspaceProjectGroups.
      const [, redeemResult] = await Promise.all([
        throwIfError(
          supabase.from("profiles").upsert({
            id: user.id,
            full_name: user.user_metadata?.full_name ?? user.email ?? "Pulse User",
            avatar_url: user.user_metadata?.avatar_url ?? null,
          }),
        ),
        supabase.rpc("redeem_workspace_access_grants"),
      ]);

      if (redeemResult.error) {
        if (redeemResult.error.code !== "PGRST202") {
          throw redeemResult.error;
        }
        // Function missing = migrations not applied in this environment. Memberships
        // can't be minted, which looks like "signed in but no projects" — leave a
        // trace instead of failing silently.
        console.warn(
          "redeem_workspace_access_grants is missing — apply database migrations so invites and domain auto-join can mint memberships.",
        );
      }

      bootstrappedUserIds.add(user.id);
      // Reads begun before redemption must not supply the post-invite snapshot.
      const rowReads = inflightDirectoryRows.get(supabase);
      for (const key of rowReads?.keys() ?? []) {
        if (key === `members:${user.id}` || key.startsWith(`workspaces:${user.id}:`) || key.startsWith(`projects:${user.id}:`)) rowReads?.delete(key);
      }

      // A redemption may have just minted memberships (invite or domain
      // auto-join) — nudge the notification drain so the welcome email lands in
      // seconds instead of at the next cron. Browser-only no-op elsewhere.
      kickSopNotifications();
    }

    // Grant redemption may have added access while a notification read was
    // already running. The first post-bootstrap read must start after those
    // writes, rather than join a snapshot captured before the new membership.
    return didBootstrap
      ? readWorkspaceProjectGroups(user.id, supabase, scope)
      : loadWorkspaceProjectGroups(user.id, supabase, scope);
  })();

  const tracked = load.finally(() => {
    pendingLoads.delete(key);
  });
  pendingLoads.set(key, tracked);

  return tracked;
}

// Navigation mounts the gate, sidebar and notification bell together. Share only
// concurrent reads, never settled access results. Both client and user scope are
// required: server clients belong to requests, and browser accounts can change.
const inflightWorkspaceGroupReads = new WeakMap<SupabaseClient, Map<string, Promise<WorkspaceProjectGroup[]>>>();

export async function loadWorkspaceProjectGroups(
  knownUserId?: string,
  client?: ReturnType<typeof plannerClient>,
  scope: WorkspaceDirectoryScope = "project",
): Promise<WorkspaceProjectGroup[]> {
  const supabase = client ?? plannerClient();
  let userId = knownUserId;

  if (!userId) {
    const { data: userData } = await getUserFromSession(supabase);

    if (!userData.user) {
      throw new Error("Sign in before loading organizations.");
    }

    userId = userData.user.id;
  }

  let reads = inflightWorkspaceGroupReads.get(supabase);
  if (!reads) {
    reads = new Map();
    inflightWorkspaceGroupReads.set(supabase, reads);
  }
  const key = `${userId}:${scope}`;
  const pending = reads.get(key);
  if (pending) return pending;
  const userReads = reads;
  const tracked = readWorkspaceProjectGroups(userId, supabase, scope).finally(() => {
    if (userReads.get(key) === tracked) userReads.delete(key);
  });
  userReads.set(key, tracked);
  return tracked;
}

// Product and legacy directories apply different permissions to the same raw
// rows. Share only concurrent identical reads, keyed by client and caller.
const inflightDirectoryRows = new WeakMap<SupabaseClient, Map<string, Promise<unknown>>>();
function shareDirectoryRead<T>(client: SupabaseClient, key: string, read: () => Promise<T>): Promise<T> {
  let reads = inflightDirectoryRows.get(client);
  if (!reads) { reads = new Map(); inflightDirectoryRows.set(client, reads); }
  const pending = reads.get(key);
  if (pending) return pending as Promise<T>;
  const currentReads = reads;
  const result = read().finally(() => {
    if (currentReads.get(key) === result) currentReads.delete(key);
  });
  currentReads.set(key, result);
  return result;
}

async function readWorkspaceProjectGroups(
  userId: string,
  supabase: ReturnType<typeof plannerClient>,
  scope: WorkspaceDirectoryScope,
): Promise<WorkspaceProjectGroup[]> {

  // The role probe, membership read, and per-project access map only need the user id, so
  // they run together; the extra queries on the (rare) superadmin path are far cheaper
  // than serializing every load behind the probe.
  const [isSuperAdmin, memberships, accessMap, productGrants] = await Promise.all([
    fetchIsSuperAdmin(supabase),
    shareDirectoryRead(supabase, `members:${userId}`, () => readAllPages((from, to) => throwIfError(
      supabase
        .from("workspace_members")
        .select("workspace_id, role")
        .eq("user_id", userId)
        .order("created_at").order("workspace_id").range(from, to),
    ))),
    scope === "project" ? fetchUserProjectAccessMap(supabase, userId) : Promise.resolve(undefined),
    scope === "product" ? readAllPages((from, to) => throwIfError(supabase.from("product_module_access").select("workspace_id, level").eq("user_id", userId).order("workspace_id").range(from, to))) : Promise.resolve([]),
  ]);

  // Superadmins see every workspace and project (RLS grants full read access), acting as
  // owner with no module restrictions, regardless of membership rows.
  if (isSuperAdmin) {
    const [workspaces, projects] = await Promise.all([
      readAllPages((from, to) => throwIfError(supabase.from("workspaces").select(WORKSPACE_COLUMNS).order("created_at").order("id").range(from, to))),
      readAllPages((from, to) => throwIfError(supabase.from("projects").select(PROJECT_COLUMNS).order("created_at").order("id").range(from, to))),
    ]);

    const projectsByWorkspaceId = new Map<string, Project[]>();
    (projects ?? []).forEach((project) => {
      const mappedProject = mapProject(project);
      projectsByWorkspaceId.set(mappedProject.workspaceId, [
        ...(projectsByWorkspaceId.get(mappedProject.workspaceId) ?? []),
        mappedProject,
      ]);
    });

    return (workspaces ?? []).map((workspace) => {
      const mappedWorkspace = mapWorkspace(workspace);
      return {
        workspace: mappedWorkspace,
        role: "owner" as WorkspaceRole,
        isSuperAdmin: true,
        ...(scope === "product" ? { productAccess: "edit" as const } : {}),
        projects: projectsByWorkspaceId.get(mappedWorkspace.id) ?? [],
      };
    });
  }

  const workspaceIds = [...new Set((memberships ?? []).map((membership) => String(membership.workspace_id)))];

  if (!workspaceIds.length) {
    return [];
  }

  const [workspaces, projects] = await Promise.all([
    shareDirectoryRead(supabase, `workspaces:${userId}:${JSON.stringify(workspaceIds)}`, () =>
      readRowsByIds(workspaceIds, (ids, from, to) => throwIfError(supabase.from("workspaces").select(WORKSPACE_COLUMNS).in("id", ids).order("created_at").order("id").range(from, to)))),
    shareDirectoryRead(supabase, `projects:${userId}:${JSON.stringify(workspaceIds)}`, () =>
      readRowsByIds(workspaceIds, (ids, from, to) => throwIfError(supabase.from("projects").select(PROJECT_COLUMNS).in("workspace_id", ids).order("created_at").order("id").range(from, to)))),
  ]);

  // IN filters are batched, but the directory still follows one global creation order.
  const creationOrder = (left: { created_at: string; id: string }, right: { created_at: string; id: string }) =>
    left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id);
  workspaces.sort(creationOrder);
  projects.sort(creationOrder);

  const membershipByWorkspaceId = new Map(
    (memberships ?? []).map((membership) => [String(membership.workspace_id), membership]),
  );
  const projectsByWorkspaceId = new Map<string, Project[]>();

  (projects ?? []).forEach((project) => {
    const mappedProject = mapProject(project);
    projectsByWorkspaceId.set(mappedProject.workspaceId, [
      ...(projectsByWorkspaceId.get(mappedProject.workspaceId) ?? []),
      mappedProject,
    ]);
  });

  // accessMap (fetched above): the user's per-project access. Managers (owner/admin) see
  // every project in workspaces they manage; other members see only projects they've been
  // granted view/edit on. undefined map = pre-migration: don't filter (legacy behavior).
  return (workspaces ?? []).map((workspace) => {
    const mappedWorkspace = mapWorkspace(workspace);
    const membership = membershipByWorkspaceId.get(mappedWorkspace.id);
    const role = membership?.role ? (String(membership.role) as WorkspaceRole) : "viewer";
    const isManager = role === "owner" || role === "admin";
    const allProjects = projectsByWorkspaceId.get(mappedWorkspace.id) ?? [];

    const productAccess: AccessLevel = isManager ? "edit" : normalizeAccessLevel(productGrants.find((grant) => grant.workspace_id === mappedWorkspace.id)?.level);
    let visibleProjects: Project[];
    if (scope === "product") {
      visibleProjects = productAccess === "none" ? [] : allProjects.map((project) => ({ ...project, accessLevel: productAccess }));
    } else if (isManager || !accessMap) {
      visibleProjects = allProjects.map((project) => ({
        ...project,
        accessLevel: isManager ? "edit" : project.accessLevel,
      }));
    } else {
      visibleProjects = allProjects
        .map((project) => ({ ...project, accessLevel: accessMap.get(project.id) ?? "none" }))
        .filter((project) => project.accessLevel !== "none");
    }

    return {
      workspace: mappedWorkspace,
      role,
      isSuperAdmin: false,
      ...(scope === "product" ? { productAccess } : {}),
      projects: visibleProjects,
    };
  });
}

export async function createProjectWithStarterPlan(
  workspaceId: string,
  name: string,
  client?: ReturnType<typeof plannerClient>,
): Promise<PlannerProjectContext> {
  const supabase = client ?? plannerClient();
  const projectName = name.trim();
  const projectId = await throwIfError(
    supabase.rpc("create_project_with_starter_plan", {
      p_workspace_id: workspaceId,
      p_name: projectName,
    }),
  );

  if (typeof projectId !== "string" || !projectId) {
    throw new Error("Project creation did not return a project id.");
  }

  return loadProjectContext(supabase, projectId);
}

export async function updateWorkspaceInSupabase(workspaceId: string, patch: { name?: string }) {
  const name = patch.name?.trim();
  if (!name) {
    throw new Error("Organization name is required.");
  }

  const supabase = plannerClient();
  await throwIfError(supabase.from("workspaces").update({ name }).eq("id", workspaceId));
}

/**
 * Resolve display names for a set of user ids via the profiles table. Managers can read
 * fellow profiles (the "profiles workspace manager read" policy), so this powers the
 * "Created by …" label on each workspace. Returns userId -> full name (absent if unknown).
 */
export async function loadProfileNamesByIds(userIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) {
    return new Map();
  }

  const supabase = plannerClient();
  const rows = await throwIfError(supabase.from("profiles").select("id,full_name").in("id", ids));

  const names = new Map<string, string>();
  (rows ?? []).forEach((row) => {
    const name = maybeText(row.full_name);
    if (name) {
      names.set(String(row.id), name);
    }
  });
  return names;
}

export async function updateProjectInSupabase(
  projectId: string,
  patch: {
    name?: string;
    description?: string | null;
    status?: Project["status"];
    portfolioCategory?: Project["portfolioCategory"] | null;
    portfolioPosition?: number;
  },
) {
  const row: TablesUpdate<"projects"> = {};

  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) {
      throw new Error("Workspace name is required.");
    }
    row.name = name;
  }

  if (patch.description !== undefined) {
    row.description = patch.description?.trim() ? patch.description.trim() : null;
  }

  if (patch.portfolioPosition !== undefined) {
    if (!Number.isFinite(patch.portfolioPosition)) throw new Error("Invalid product order.");
    row.portfolio_position = patch.portfolioPosition;
  }

  if (patch.portfolioCategory !== undefined) {
    row.portfolio_category = patch.portfolioCategory;
  }

  if (patch.status !== undefined) {
    row.status = patch.status;
  }

  if (!Object.keys(row).length) {
    return;
  }

  const supabase = plannerClient();
  await throwIfError(supabase.from("projects").update(row).eq("id", projectId).select("id").single());
}

export async function deleteProjectFromSupabase(projectId: string) {
  const supabase = plannerClient();

  await throwIfError(supabase.from("products").delete().eq("project_id", projectId));
  await throwIfError(supabase.from("projects").delete().eq("id", projectId));
}

export async function loadWorkspaceMembersFromSupabase(
  workspaceId: string,
  client?: SupabaseClient<Database>,
): Promise<WorkspaceMemberProfile[]> {
  const supabase = client ?? plannerClient();
  // Fetch members and profiles separately and merge in JS. There is no direct foreign key
  // between workspace_members and profiles (both only reference auth.users), so a PostgREST
  // embed (`profiles(...)`) fails with PGRST200. Profile names for fellow members are
  // visible thanks to the "profiles workspace manager read" policy.
  const rows = await throwIfError(
    supabase
      .from("workspace_members")
      .select("workspace_id,user_id,role,created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at"),
  );
  const members = rows ?? [];

  const userIds = [...new Set(members.map((row) => String(row.user_id)))];
  const profileRows = userIds.length
    ? await throwIfError(supabase.from("profiles").select("id,full_name,avatar_url,email").in("id", userIds))
    : [];
  const profileById = new Map((profileRows ?? []).map((profile) => [String(profile.id), profile]));

  return members.map((row) => {
    const profile = profileById.get(String(row.user_id));
    return {
      workspaceId: String(row.workspace_id),
      userId: String(row.user_id),
      role: String(row.role) as WorkspaceRole,
      createdAt: String(row.created_at),
      fullName: maybeText(profile?.full_name),
      avatarUrl: maybeText(profile?.avatar_url),
      email: maybeText(profile?.email),
    };
  });
}

export async function loadWorkspaceAccessGrantsFromSupabase(workspaceId: string): Promise<WorkspaceAccessGrant[]> {
  const supabase = plannerClient();
  const rows = await throwIfError(
    supabase
      .from("workspace_access_grants")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at"),
  );

  return (rows ?? []).map(mapWorkspaceAccessGrant);
}

// How long an invite stays redeemable. Mirrors the column default in the
// 20260703120000 migration; re-inviting ("resend") refreshes the window.
const GRANT_EXPIRY_DAYS = 30;

export async function upsertWorkspaceAccessGrantInSupabase(
  workspaceId: string,
  email: string,
  entitlements: WorkspaceInviteEntitlements,
): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase();

  if (!isAllowedSignupEmail(normalizedEmail)) {
    throw new Error(SIGNUP_DOMAIN_MESSAGE);
  }
  const normalizedEntitlements = normalizedInviteEntitlements(entitlements);

  const supabase = plannerClient();
  const { data: userData } = await getUserFromSession(supabase);

  // Re-inviting someone a manager previously removed lifts the revocation, so the
  // grant can mint a membership again on their next sign-in.
  const { error: revocationError } = await supabase
    .from("workspace_revocations")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("email", normalizedEmail);
  if (revocationError && !isMissingRelationError(revocationError)) {
    throw revocationError;
  }

  await throwIfError(
    supabase.from("workspace_access_grants").upsert(
      {
        workspace_id: workspaceId,
        email: normalizedEmail,
        role: workspaceRoleForOrganizationRole(normalizedEntitlements.organizationRole),
        quality_access: normalizedEntitlements.qualityAccess,
        product_access: normalizedEntitlements.productAccess ?? "none",
        access_package: normalizedEntitlements.accessPackage,
        planning_access: normalizedEntitlements.planningAccess,
        project_access: normalizedEntitlements.projectAccess.map((grant) => ({
          project_id: grant.projectId,
          level: grant.level,
        })) as Json,
        department_access: normalizedEntitlements.departmentAccess.map((grant) => ({
          department_id: grant.departmentId,
          role: grant.role,
          position_title: grant.positionTitle,
        })) as Json,
        granted_by: userData.user?.id ?? null,
        expires_at: new Date(Date.now() + GRANT_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString(),
        redeemed_by: null,
        redeemed_at: null,
      },
      { onConflict: "workspace_id,email" },
    ),
  );
}

// Offboard a member: the RPC deletes the membership + per-project access + pending
// invites and records a revocation so domain auto-join cannot silently re-add them.
export async function removeWorkspaceMemberInSupabase(workspaceId: string, userId: string): Promise<void> {
  const supabase = plannerClient();
  const { error } = await supabase.rpc("remove_workspace_member", {
    target_workspace_id: workspaceId,
    target_user_id: userId,
  });
  if (error) {
    if (isMissingRelationError(error)) {
      throw new Error("Member removal requires the latest database migration. Apply migrations and retry.");
    }
    throw error;
  }
}

export async function updateWorkspaceMemberRoleInSupabase(
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
): Promise<void> {
  const supabase = plannerClient();
  const { data, error } = await supabase
    .from("workspace_members")
    .update({ role })
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .select("user_id");
  if (error) {
    throw error;
  }
  // RLS silently filters rows the caller may not update (e.g. an admin touching an
  // owner row) — surface that instead of pretending the change landed.
  if (!data?.length) {
    throw new Error("You don't have permission to change this member's role.");
  }
}

export async function updateOwnProfileNameInSupabase(fullName: string): Promise<void> {
  const supabase = plannerClient();
  const { data: userData } = await getUserFromSession(supabase);
  if (!userData.user) {
    throw new Error("Sign in first.");
  }

  const name = normalizeDisplayName(fullName);
  const validationError = displayNameValidationMessage(name);
  if (validationError) {
    throw new Error(validationError);
  }

  const profile = await throwIfError(
    supabase
      .from("profiles")
      .upsert({ id: userData.user.id, full_name: name }, { onConflict: "id" })
      .select("id")
      .maybeSingle(),
  );
  if (!profile) {
    throw new Error("Unable to update the display name.");
  }

  // Keep auth metadata in sync so the next profile bootstrap doesn't revert the name.
  const { error } = await supabase.auth.updateUser({ data: { full_name: name } });
  if (error) {
    throw error;
  }
}

export async function deleteWorkspaceAccessGrantFromSupabase(workspaceId: string, email: string): Promise<void> {
  const supabase = plannerClient();
  await throwIfError(
    supabase
      .from("workspace_access_grants")
      .delete()
      .eq("workspace_id", workspaceId)
      .eq("email", email.trim().toLowerCase()),
  );
}

// Per-member access matrix for a workspace: each member's role plus their per-project level
// and Quality Module level. Readable by workspace managers and superadmins.
export async function loadMembersAccessForWorkspace(
  workspaceId: string,
  client?: SupabaseClient<Database>,
): Promise<MemberAccess[]> {
  const supabase = client ?? plannerClient();
  const { data: userData } = await getUserFromSession(supabase);
  const selfId = userData.user?.id;

  // Members and the workspace's project list are independent — fetch them together.
  const [members, projectRows] = await Promise.all([
    loadWorkspaceMembersFromSupabase(workspaceId, supabase),
    throwIfError(supabase.from("projects").select("id").eq("workspace_id", workspaceId).order("created_at")),
  ]);
  const projectIds = (projectRows ?? []).map((row) => String(row.id));
  const userIds = members.map((member) => member.userId);

  // Project and Quality grants are independent, but both are scoped to this organization.
  const [productRows, accessRows, orgRows] = await Promise.all([
    throwIfError(supabase.from("product_module_access").select("user_id, level").eq("workspace_id", workspaceId)),
    projectIds.length
      ? throwIfError(supabase.from("project_access").select("project_id, user_id, level").in("project_id", projectIds))
      : Promise.resolve([]),
    userIds.length
      ? throwIfError(
          supabase
            .from("org_tool_access")
            .select("user_id, level")
            .eq("workspace_id", workspaceId)
            .in("user_id", userIds),
        )
      : Promise.resolve([]),
  ]);

  const levelByUserProject = new Map<string, AccessLevel>();
  (accessRows ?? []).forEach((row) => {
    levelByUserProject.set(`${row.user_id}|${row.project_id}`, normalizeAccessLevel(row.level));
  });
  const orgByUser = new Map<string, AccessLevel>();
  (orgRows ?? []).forEach((row) => {
    orgByUser.set(String(row.user_id), normalizeAccessLevel(row.level));
  });

  return members.map((member) => {
    const projectLevels: Record<string, AccessLevel> = {};
    projectIds.forEach((projectId) => {
      projectLevels[projectId] = levelByUserProject.get(`${member.userId}|${projectId}`) ?? "none";
    });
    return {
      userId: member.userId,
      fullName: member.fullName,
      email: member.email,
      role: member.role,
      isSelf: member.userId === selfId,
      joinedAt: member.createdAt,
      projectLevels,
      orgTools: orgByUser.get(member.userId) ?? "none",
      productAccess: normalizeAccessLevel((productRows ?? []).find((row) => row.user_id === member.userId)?.level),
    };
  });
}
