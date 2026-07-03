# User Access Model — Gap Analysis & Remediation (2026-07-03)

Comparison of Pulse's access model (backend, UI/UX, and user lifecycle) against mature
SaaS patterns, and the remediation shipped in the "Sprint 1–2" change set. Pulse is a
single-company deployment: access remains **gated to the approved company domain**
(anacorp.com) by design; that gate is now single-sourced, not removed.

## Issues found and their status

| # | Priority | Area | Issue | Status |
|---|---|---|---|---|
| 1 | P0 | Invites | "Invite sent" wrote a DB grant row but sent no email | **Fixed** — `/api/invites` sends a real invitation via Supabase admin API; UI copy is honest when email can't be sent |
| 2 | P0 | Offboarding | No way to remove a member from the app | **Fixed** — `remove_workspace_member()` RPC + Remove action in Settings → Members |
| 3 | P0 | Offboarding | Removed users silently re-joined via domain auto-join | **Fixed** — `workspace_revocations` blocks both auto-join and stale grants; re-inviting lifts the revocation |
| 4 | P0 | Auth | No password reset or confirmation resend | **Fixed** — Forgot-password flow (reset email → PASSWORD_RECOVERY → new-password panel) + resend confirmation |
| 5 | P0 | Permission UX | View-only users got a fully editable planner; writes failed silently at RLS | **Fixed** — view-only banner + autosave/write gating with a one-time notice |
| 6 | P0 | Joining | Domain auto-join has no admin approval | **Accepted** — single-company app; the domain IS the approval boundary. Auto-joins are now audit-logged (see #8) and revocable (#3) |
| 7 | P1 | Roles | Member role immutable after invite; no owner transfer | **Fixed** — inline role select (owner ceiling mirrored client-side); owner transfer = promote other member to owner, then demote self; last-owner protection trigger prevents orphaned workspaces |
| 8 | P1 | Audit | No audit log of role/grant/access changes | **Fixed** — `audit_log` table written by triggers on all six access tables; immutable to clients; manager/superadmin read |
| 9 | P1 | Backend | `modules` scope is UI-only, not RLS-enforced | **Retired as a control** — `modules` is read by no UI code and cannot be table-enforced (all planner modules share the same tables). The DB-enforced axes are `project_access` and `org_tool_access`. Columns kept for compatibility; do not treat them as security |
| 10 | P1 | Multi-tenant | `@anacorp.com` hardcoded in CHECK constraints + 4 code sites | **Fixed** — CHECKs replaced by triggers validating against `workspace_auto_join_domains` (single source of truth, still anacorp-only); client code uses the `allowed-signup-domain` mirror |
| 11 | P1 | Invites | No expiry, resend, or invite links | **Fixed** — `expires_at` (30 days), redemption skips expired grants, Resend refreshes the window. Email invite link comes from Supabase's `inviteUserByEmail` |
| 12 | P1 | Account | No profile editing (name/password) | **Fixed** — Settings → General → Account: display name + change password (password accounts only) |
| 13 | P1 | Auth | OAuth path skipped the friendly domain check | **Fixed** — redirect `error_description` is parsed and the DB trigger error mapped to the friendly domain message |
| 14 | P1 | Onboarding | Auto-joined viewer landed on an empty planner | **Fixed** — "No project access yet" panel with guidance, Check again, and Sign out |
| 15 | P1 | Reliability | Grant-redemption RPC errors swallowed | **Fixed** — real errors throw; missing-function degrades with an explicit console warning |
| 16 | P2 | Member UI | No search, emails, or join dates in roster | **Fixed** — search box, `profiles.email` (synced from auth, client-tamper-proof), joined dates |
| 17 | P2 | Member UI | Pending invites segregated; redeemed grants vanish silently | **Fixed** — pending invites inline in the roster with Pending/Expired chips |
| 18 | P2 | Terminology | Organization/Workspace/Project used interchangeably; no role descriptions | **Fixed** — Organization = the company workspace, Project = a planner project; role descriptions shown in the invite and role controls |
| 19 | P2 | Permission UX | Inconsistent hide/disable/forbid patterns | **Partially fixed** — members panel and planner now explain restricted state; SOP module already disabled controls; full sweep left for later |
| 20 | P2 | Safety | No confirmation on destructive actions | **Fixed** — two-step confirmation for member removal and invite cancellation |
| 21 | P2 | Backend | In-memory per-instance API rate limiting | **Open** — needs shared infrastructure (e.g. Upstash/Redis) — a deployment decision, not a code-only fix |
| 22 | P2 | Governance | Superadmin has no MFA/step-up | **Open** — enable MFA enforcement in the Supabase dashboard; app-side step-up needs product design. Superadmin-visible actions are now audit-logged |
| 23 | P2 | Lifecycle | Removed user's data has no reassignment story | **Open** — content rows keep `created_by`; removal does not delete content. Reassignment/retention policy needs a product decision |

## What shipped where

- **Migration `20260703120000_access_lifecycle_and_audit.sql`** — audit log + triggers,
  invite expiry, revocations, `remove_workspace_member()`, `profiles.email` (with
  tamper protection), last-owner protection, domain gate single-sourcing.
- **`app/api/invites/route.ts`** — grant upsert under caller RLS + invitation email via
  service role (graceful, honest fallback when `SUPABASE_SERVICE_ROLE_KEY` is absent).
- **`src/lib/auth-form-actions.ts`** — shared sign-in/up, reset, resend, OAuth actions
  used by both auth surfaces; maps OAuth redirect errors to friendly copy.
- **`src/components/app-flow-panels.tsx`** — three-mode auth card (sign in / create
  account with name / reset) + `PasswordUpdatePanel` for recovery.
- **`src/components/workspace-members-settings.tsx`** — roster with search, emails,
  join dates, inline pending invites (resend/cancel), editable roles, member removal.
- **`src/components/account-settings.tsx`** — display name + password management.
- **`src/components/line-workspace.tsx`** — view-only banner + write gating.
- **`src/components/auth-project-gate.tsx`** — recovery mode, `accessLevel` in project
  context, no-project-access empty state.

## Operational notes

- **Fresh environments:** seed the auto-join domain before superadmins/grants
  (`scripts/seed-workspace-defaults.mjs` now enforces this order) — the new domain
  triggers validate grant and platform-admin emails against
  `workspace_auto_join_domains`.
- **Invitation emails** require `SUPABASE_SERVICE_ROLE_KEY` in the Next.js server
  environment. Without it, invites still grant access and the UI says no email was sent.
- **Session revocation:** removing a member revokes access via RLS immediately (every
  query re-checks membership), but their JWT stays valid until expiry for the API
  routes' cheap `getUser` check. Keep Supabase access-token TTL short (≤1h default).
