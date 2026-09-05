# RBAC review — September 4, 2026

The application has real database enforcement, but several rules disagreed across membership, resource grants, API authentication, and the UI. The highest-priority issue was a reproducible owner-privilege escalation. The database hardening in `20260904120000_rbac_membership_boundaries.sql` was applied on September 4, 2026; the application changes were then published from `main`.

## Confirmed findings and fixes

| Priority | Finding | Result after the local fix |
| --- | --- | --- |
| P0 | `has_workspace_role` trusted `workspaces.owner_id` in addition to membership roles. An admin could update that field to themselves and immediately pass owner-only checks. A demoted original owner also retained owner powers. | Organization membership is the role authority; the explicit platform-superadmin override remains. |
| P1 | `has_project_access` accepted grants without organization membership. A leftover grant could authorize reads and writes after removal. | A project grant requires current membership in the project's organization. |
| P1 | Historical SOP seats independently allowed reading documents after removal. Department/Quality helpers also accepted leftover department membership. | These helpers require current organization membership. Historical seats and signatures are preserved. |
| P1 | Direct membership deletion bypassed the offboarding RPC, leaving grants and no revocation record; domain auto-join could restore access. | Client deletion is disabled. The existing authorized RPC performs removal, grant cleanup, and revocation atomically. |
| P1 | The Members UI prevented admins from removing other admins, but `remove_workspace_member` allowed it. Admins could also create a Member invitation targeting an existing manager, and invitation redemption overwrote membership roles. | Only owners may remove managers or manage invitations targeting managers. Invitation redemption preserves existing manager roles; explicit membership changes handle demotion. |
| P1 | Project metadata updates used the organization role instead of the project grant. An editor with only View could rename a project; a viewer with Edit could not. | Metadata updates use the same project Edit permission as other project writes. Project and membership identity/organization columns cannot be moved to bypass authorization. |
| P1 | API authentication accepted cookies, then six routes rebuilt a database client using only the bearer header. Valid browser sessions became anonymous database requests. Malformed authorization headers could fall back to cookies. | `requireApiUser` returns the verified caller-scoped client and routes reuse it. Explicit malformed headers return 401. Bearer authentication remains supported for SolidWorks. |
| P1 | SOP conversion reimplemented Quality authorization from raw grant/member rows, omitting the membership requirement on the grant path. | Conversion calls the database's `has_org_tool_access` predicate and denies false, missing, or errored results. |
| P2 | Seeded SOP detail cached a boolean edit permission on first render. Later permission changes did not update it, and permission from the selected organization could be used for another organization's document. | Editing is derived from current workspace permissions and document organization, with the existing department restriction retained. |

The migration also serializes owner-removal checks on the organization row and locks invitations during redemption. Sequential lifecycle behavior is tested; concurrent multi-session races were not exercised.

## Verification

- Read the live definitions of 77 public functions and 187 public/storage policies, with targeted inspection of authorization predicates and write paths.
- Every public base table has RLS enabled. The five checked internal write functions (`append_sop_event`, `close_moot_objections`, `mint_sop_number_internal`, `next_sop_number`, and `snapshot_sop_revision`) deny direct execution to both `anon` and `authenticated`.
- The live snapshot contained **zero** orphaned non-None project grants, former-member review seats, or legacy owners without an Owner membership. These checks identify current inconsistent data; they do not establish whether an exploit was used previously.
- The initial 18-case database regression set reproduced 11 failures against the existing rules. The final expanded suite passes **21/21** with the proposed migration, including authorized owner/admin actions, normal invitation redemption, and organization isolation.
- Database tests use synthetic users and records in a transaction and always roll back fixtures and migration DDL. They send no invitations and do not commit production authorization changes. PostgreSQL sequence values can advance during rolled-back tests.
- Targeted application tests cover API identity propagation, invite handling, conversion authorization, seeded SOP permissions, and existing auth/isolation regressions.
- TypeScript and ESLint checks pass.

Run the database regressions from the repository root:

```sh
node --env-file=.env.local scripts/test-rbac-boundaries.mjs
node --env-file=.env.local scripts/test-rbac-boundaries.mjs --with-fix
```

The first command is expected to fail until the migration is deployed. The second installs the candidate definitions only inside its rolled-back test transaction. It requires a database connection with fixture/DDL privileges; use a disposable or staging database for routine CI.

## Deployment and remaining work

1. The live structured-invitation schema was verified before its missing `20260811120000` ledger entry was recorded. The new `20260904120000` migration is also recorded, so later migration tooling will not replay either change.
2. Run browser acceptance checks using dedicated Owner, Admin, Member-with-View, and Member-with-Edit accounts, including revoked access in an already-open tab. This review used database identities and component tests, not interactive browser sessions for each role.
3. Permission providers still need a consistent refresh/invalidation strategy across tabs and after changes by another manager. The database now checks membership on each request, but an open UI can still display cached controls/data until its next refresh. Already-loaded information cannot be retroactively hidden by RLS.
4. A full SOP lifecycle/concurrency review and complete endpoint-by-endpoint security audit remain separate follow-up work. These results are targeted RBAC hardening, not a certification of every application path.
