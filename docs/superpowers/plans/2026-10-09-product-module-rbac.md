# Product module RBAC implementation plan

Date: October 9, 2026
Branch: `codex/product-module-rbac`
Status: implemented on the feature branch; local verification completed. Production migration and deployment remain pending.

## Outcome

A person with Product access can see all Product projects and all AWI masters created by anyone in the same organization. Product categories and sections organize content; they do not create separate permission boundaries. This includes drafts, published revisions, and the supporting media needed to use those sections. New products and AWIs become available automatically under the same rule.

Organization membership remains mandatory. Access to another organization is never implied. Product access does not grant Planning, Production, Quality, Settings administration, or Quality workflow duties.

## Access contract

Approved permission: **Product — No access / View / Edit**, applying to the whole module.

| Effective permission | Browse all Product projects, sections and AWIs | Create and edit Product content | Manage access / delete projects |
| --- | --- | --- | --- |
| No access | No | No | No |
| View | Yes | No | No |
| Edit | Yes | Yes, across the module | No |
| Organization owner/admin | Yes | Yes | Existing manager rules |

Existing platform-superadmin behavior remains explicit. Product Edit controls ordinary authoring actions, including the existing Product publishing flow; immutable releases remain immutable. Existing destructive-action and document-lifecycle rules must not be broadened incidentally. Content creator identity remains attribution, not a visibility rule.

## Verified starting point

- The live audit earlier in this conversation found four AWIs. A read-only transaction using an existing editor identity returned two visible projects and zero AWIs.
- `has_project_access` currently permits organization managers or current members with an individual project grant. It does not implement Product module access.
- The project factory grants Edit to the creator. AWI creation uses that factory to build its backing project, product, scenario and task.
- `awi_masters`, the editable graph, published work-instruction releases and media policies depend on project access.
- `src/lib/planner/workspace-store.ts` independently filters the directory through the user's project-grant map. `access-store.ts` resolves editor permission from that same map.
- Product does not currently have the dedicated access control available for Planning and Quality. Legacy `workspace_members.modules = null` is not sufficient evidence that a user should receive Product access: the current invite model uses explicit resource grants, and a normal Member is stored as an editor.
- Planning, Quality and Product have shared consumers of project-related data. A globally widened helper or a shared, broadened directory could change other modules unintentionally.

Recheck live policy definitions and access counts during implementation; the audit is a snapshot, not a migration manifest.

## Phase 1 — Map the boundary and existing access

The implemented boundary map and conversion evidence are recorded at the end of this document. The production manifest must be refreshed at release.

- [x] Inventory Product routes, loaders, writes, RPCs, storage objects and database policies. Include the portfolio, AWI directory/builder, Product sections, print/export, mobile capture, SolidWorks integrations and background/retry saves.
- [x] Classify each underlying table/RPC as Product-owned, shared, or owned by another module. Include supporting task/scenario data, references, photos, videos, exploded views and release history. Separate Product AWIs from Quality's `quality_work_instructions` and SOPs.
- [x] Record each shared consumer and its current authorization/output. Include dashboard/sidebar groups and Quality's references to production tasks.
- [ ] Refresh and save the production before/after grant manifest for active members and pending invitations. Owners/admins inherit access. For other users, the default migration proposal is the highest existing non-None Product project grant, converted into one module grant. Identify creator/legacy-only cases separately.
- [x] Do not infer access from the generic editor role, a null legacy modules field, a department duty or a Quality/Planning grant. Resolve ambiguous records in the manifest before rollout.

Exit: a complete policy/consumer map and an explicit list of who gains module-wide View or Edit. This documents the intended expansion from access to some products to access to all products.

## Phase 2 — Add Product permission and enforce it in the database

- [x] Add a Product-specific organization/user grant with the existing `access_level` values, membership validation, manager-only administration and audit records. Suggested table: `product_module_access`; absence means No access. Avoid introducing a generalized replacement for every module's permissions.
- [x] Add one authoritative Product permission predicate and a project-to-organization adapter. Predicate checks authenticated identity, current membership, explicit module level and the existing manager/superadmin exceptions. Grant changes cannot promote organization roles or move resources between organizations.
- [x] Apply that predicate to Product-owned reads/writes and Product-specific RPCs. Cover creation, metadata updates, atomic AWI saves, task reorder, publishing and the full graph loaded by each Product section.
- [x] Keep the legacy `has_project_access` contract for remaining non-Product consumers. Do not blanket-replace it across the repository.
- [x] For shared tables, explicitly account for existing non-Product access paths. PostgreSQL RLS operates on resources, not the page URL: adding an allowed path makes those rows queryable by that identity from any client. If a table includes non-Product data, use a narrower projection or checked operation rather than granting the entire row graph. Review permissive-policy OR behavior so old policies cannot silently bypass the new Product rules.
- [x] Update Product attachment policies and signed-link authorization, validating that path organization/project identities match the resource. Cover reads, uploads, replacement and deletion according to View/Edit and existing lifecycle rules.
- [x] Extend invitation redemption, member removal, demotion handling and grant revocation. Legacy project grants must not restore Product access after an explicit Product revocation. Keep legacy grants only where another module still requires them.
- [x] Generate migrations through the Supabase CLI and keep schema, grants, functions and policies together in reviewable changes. Exercise candidate changes in a disposable/local database before any production application.

Exit: database allow/deny tests pass without relying on hidden UI controls.

## Phase 3 — Make the application use the same permission

- [x] Add a Product access resolver and expose the effective level in Product route context. Update types and mappings from the validated schema.
- [x] Give Product an organization-scoped directory that returns all products for authorized members. Remove individual project filtering from the Product path, while preserving other callers' directory contracts.
- [x] Gate both Product project routes and `/awi` routes on Product permission; handle direct URLs and API requests as well as navigation.
- [x] Allow Product entry with no existing products. Show an empty portfolio/AWI state instead of disabling the module because no preferred project exists.
- [x] Use the module level for Product edit controls and save paths. View users must be able to open all sections, instructions and media without writes triggered by initialization, repair or autosave.
- [x] Update the Product card, sidebar, AWI directory, editor, print/export and integration permission checks consistently.
- [x] Scope permission/data caches by user, organization and Product context. Refresh after access changes and on existing revalidation events; purge Product cache on sign-out, removal or detected revocation. Already downloaded information cannot be revoked retroactively; subsequent reads/writes must be denied immediately by the database.

Primary files: `src/lib/planner/{workspace-store,access-store,read-store}.ts`, `src/lib/awi/`, `src/lib/supabase/server-data.ts`, `src/domain/types.ts`, `src/lib/database.types.ts`, `src/components/{auth-project-gate,project-route-shells,company-dashboard,sidebar-workspace-panel,awi-directory}.tsx`, `src/components/line-workspace/`, `app/awi/`, `app/projects/`, and affected Product API routes.

Exit: Product shows the same content for different authorized users, with controls matching their effective permission and the persistent navigation behavior preserved.

## Phase 4 — Update member access and invitations

- [x] Add one Product module control to member settings and the invitation composer. Explain that it covers all products and AWIs in the organization.
- [x] Remove per-product selection from Product access management. Retain any legacy project control required by another module only with an accurate label and scope.
- [x] Add `productAccess` to invitation validation, persistence, summaries, redemption and access-change notifications. Verify both pending and newly created invitations.
- [x] Preserve the existing meanings of role presets; include Product only where the preset explicitly intends it. Custom, Quality-only and Planning-only invitations must not gain Product by default.
- [ ] Apply the reviewed migration manifest once in production, with idempotency and a record of the prior grants. The one-time conversion has been tested locally. Avoid repeated fallback rules that recreate revoked access.

Primary files: `src/domain/workspace/invite-access.ts`, `src/lib/planner/workspace-store.ts`, `src/components/workspace-members-settings.tsx`, `src/components/workspace-invite-composer.tsx`, `app/api/invites/route.ts`, invitation database functions and notification descriptions.

Exit: managers grant the module once; existing users and invitees receive the documented access without selecting individual products.

## Phase 5 — Acceptance and regression verification

- [x] User A creates a Product project and an AWI. User B with Product View sees both, including the AWI draft, steps, media and published revision, without any grant for those projects.
- [ ] User B can open every Product section but cannot create, update, publish, upload or delete through the UI, API, direct table calls or RPCs.
- [x] User C with Product Edit can create and edit across the Product module, subject to existing release/destructive-action rules.
- [x] New products/AWIs become visible without generating per-user project grants. Category moves and creator changes do not affect visibility.
- [x] Users without Product access, removed members, anonymous callers and users from another organization cannot use Product paths. Old grants and stale tabs do not authorize new operations after revocation.
- [x] Owner/admin access, admin demotion, manager protections, invite redemption and member offboarding behave consistently.
- [ ] Planning, Production, Quality/SOPs, general Quality WIs, department duties and Settings administration retain their baseline permissions. Test direct requests and shared directory consumers as well as navigation.
- [ ] Check desktop/mobile opening, refresh, deep links, organization switching, empty portfolios, media, print/export and permission changes during an open session using distinct role accounts.
- [x] Run targeted database and application tests, then the full relevant suite, lint, typecheck, build and browser acceptance. Run build and typecheck sequentially; isolate build output from any running development server.

Exit: the original cross-user AWI failure passes, the complete permission matrix passes, and cross-module baselines remain intact.

## Release and rollback

1. Finish code, migrations, grant manifest and tests on this branch. Record the final changed resources and validation evidence.
2. Stage additive schema and compatible application support before permission cutover. Coordinate policy/grant activation and the Product UI release so users do not temporarily get an empty directory or misleading controls. Test the exact sequence in staging.
3. Release the validated sequence and repeat the cross-user Product checks plus cross-module smoke tests against the deployed version.
4. Keep pre-change permission definitions and grant snapshots for rollback. Revert the application and policies together while retaining projects, AWIs, releases and media created during the rollout. Reconcile grants for new resources if returning to the old per-project model; deleting module grants alone is not a complete rollback.

Production remains unchanged. The migration has been applied only to disposable local databases; no real invitations were sent.

## Implementation evidence and boundary map

Migration: `supabase/migrations/20261009144351_product_module_access.sql`.

| Resource / consumer | Implemented boundary |
| --- | --- |
| Product portfolio, AWI directory, Product route gate and editor | Explicit Product directory scope and effective module permission; all organization projects visible |
| Products, scenarios, tasks, stations, zones, components, steps, dependencies, part references and custom columns | Product View reads; Product Edit writes |
| AWI creation, metadata, atomic save, task reorder and project factory | Named RPCs patched in place; no creator-only project grant minted |
| Tool library, step photos/tools/exploded views, task videos, document codes and WI references/releases | Product permission; existing immutable release/destructive rules retained |
| Storage: step-photos, task-videos, wi-reference-files | Module permission plus project/organization path validation; linked legacy media still supported |
| Production actual_events | Existing write policies retained; additive Product read for Product dashboards |
| Planning, Quality/SOPs, general Quality work instructions and organization administration | Existing module permission helpers retained; no Product grant is added to their authorization predicates |
| Legacy project directory consumers | Keep individual project filtering; Product callers explicitly opt into the new directory scope |
| Membership, invitations, offboarding and activity | One Product setting, validated invitation snapshot, redemption, membership-cascade cleanup and audit description |

RLS protects shared resources independently of page URLs. Product access authorizes reading the Product graph wherever it is queried; it does not independently authorize non-Product workflows. Shared Production actuals writes continue to require their existing permission. Stored `project_access` rows remain for legacy consumers and never act as a Product fallback.

Existing access conversion: highest non-None project grant becomes the ordinary member's module level. Managers inherit Edit without a synthetic grant. Generic editor role, null legacy modules, department duties and grants to other modules do not imply Product access. The live audit snapshot found three ordinary members mapping to Edit and one to View; eighteen other ordinary members had no qualifying project grant. These counts must be refreshed before release.

The local pre-migration replay checked mixed View/Edit grants, View-only grants, manager inheritance, generic members with no grant, orphan grants for nonmembers, and pending invitations. Only the two eligible ordinary-member fixtures received grants; the pending project invitation received Edit and the unrelated invitation retained None.

Validation recorded October 9, 2026:

- Application: 297 suites, 2,473 tests passed; the directory concurrency and post-redemption freshness checks also passed all 12 focused tests.
- Database: all 24 suites, 485 assertions passed, including 40 Product-specific allow/deny assertions and existing SOP/Quality tests.
- Cross-user browser acceptance: View, Edit, revocation and empty portfolio passed with distinct local accounts and zero per-project grants.
- Lint and typecheck passed. Production build passed against isolated local Supabase.
- Browser regression: all 31 Product/AWI, mobile recovery, task reorder and zero-zone save scenarios passed. This includes publishing, immutable revisions, private media, revision browsing with View, same-tab Edit-to-View refresh, revocation and empty portfolios. Navigation made 61 directory reads across six transitions, within the existing limit of 72; the count includes Product permission reads.

Product permission/data directories no longer reuse the old unscoped localStorage group cache. Authenticated server seeds and the mounted shell supply the first paint; concurrent permission results are scoped by client, user and directory kind. Identical underlying directory reads are shared in flight across scopes without sharing their permission filtering; invitation redemption invalidates pre-redemption reads. Sign-out and detected permission changes clear planner caches. Data already downloaded or a previously issued signed URL cannot be retroactively withdrawn; database requests use current permission.

Before production release, refresh the grant manifest and save pre-change policy/function definitions. Coordinate the schema/policy migration and app release: the old app still uses per-project filters and will not display the full newly shared directory. Roll back app and policies together, retaining content and reconciling legacy grants for resources created after cutover. Production verification, a refreshed live grant manifest, a staging rehearsal and the broader manual organization-switching/print-export smoke checklist remain release work. Existing identity-protection triggers still forbid moving project identities between organizations.
