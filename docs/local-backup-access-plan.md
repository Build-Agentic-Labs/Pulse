# Local backup access plan

Current status: dedicated database, schema and Storage readers configured; Pro quota verified; first encrypted company export and isolated recovery pending. Historical preparation notes below precede the explicitly approved production setup.

## Source identity

Organization M-Tool; project Pulse; reference neaadefipcpxxcqszpud. Read-only catalog inspection on 2026-10-02 found 75 public tables, no named backup role, and 23 non-trigger public SECURITY DEFINER routines granting EXECUTE to PUBLIC. This is an inherited-access finding, not proof that every routine permits an unauthorized write. No routine was invoked to test mutations.

## Blocking access finding

Postgres grants to PUBLIC apply to new roles too. A role-specific REVOKE does not override a PUBLIC grant. Therefore creating a role with SELECT grants alone cannot meet the current exporter gate, which refuses callable privileged non-trigger routines. Existing application authorizations must not be broadly revoked to make backup setup succeed.

Before provisioning, review the 23 function bodies, owners, dependencies and effective caller access in an isolated recreation of the current schema. If narrow grant changes are proposed, preserve intended application callers and test authoring, approvals, membership, notifications and anonymous/authenticated behavior before any production change. Do not apply such changes automatically as part of backup provisioning. Alternatively use an independently enforced read-only source, with explicit verification of completeness and storage coverage; the exporter currently targets the same project, so this alternative requires implementation and testing.

## Required credential contract

Database role: dedicated LOGIN, no superuser, create-role, create-database, replication, or inherited/settable application writer roles. Complete RLS visibility must be explicitly established. Only SELECT on approved application tables and sequence counters; auth.users only id/email/created_at columns; storage inventory and buckets only fields used by source.mjs. No table or column writes, sequence USAGE/UPDATE, schema CREATE, or callable privileged routines. Excluded integration secrets and authentication tokens stay excluded. Future tables require explicit scope review and grants, not automatic blanket default grants.

File credential: dedicated Storage GET access to all included bucket originals, with no upload, replacement, deletion or other app RPC capability. The service-role key is not an acceptable replacement. Storage access must be verified independently of database role access, including negative mutation permission tests in isolated fixtures.

## Local configuration

Secret values are saved only locally, never via chat, process arguments, committed files or tool output. Configure PULSE_BACKUP_DATABASE_URL, PULSE_BACKUP_STORAGE_READ_TOKEN and PULSE_BACKUP_CA_CERT. The CA path points to the trusted Supabase database root certificate downloaded from project database settings. Direct or session database connection on 5432 only; verified TLS in both the SQL driver and pg_dump. No disabled certificate verification.

Keep PULSE_LOCAL_BACKUPS and PULSE_BACKUP_RESTORE_VALIDATED disabled until access and source review gates pass. Source changes need a reviewed commit before the worker can archive reproducible application code. Real company export and isolated company-data recovery remain outstanding; synthetic fixture success is not evidence of a successful real backup.

## Isolated grant preparation result

`scripts/backup/restrict-public-routines.sql` is a review-only administrator operation, never called by the backup runner. For currently PUBLIC-executable non-trigger SECURITY DEFINER functions in public, it grants execution explicitly to every existing role that already has effective access, removes the PUBLIC execution grant, and aborts the transaction if any existing role's effective execution permission changes. This preserves current access while making future role access explicit. It does not modify tables or data. It changes future role behavior and creates additional ACL entries; it is not a zero-risk production operation.

The updated workflow rehearsal applied all 139 local migrations to an owned synthetic Supabase fixture, recovered 75 public tables, verified all existing role/function EXECUTE permissions unchanged, created a synthetic SELECT-only reader that passed the exporter audit, and passed author/reviewer/Quality/signature/release tests afterward. Company rows, grants and roles remain unchanged. Local migration fixtures are not proof of exact production schema parity. Production application requires explicit operator approval, a fresh catalog/definition parity review, transactional execution and post-change permission checks; do not apply automatically.

## Approved production preparation completed

On 2026-10-02 the operator approved live permission preparation. Applied migrations 20261002124334 (routine grants) and 20261002124411 (dedicated database reader). The effective access digest across 31 existing roles and 55 public privileged non-trigger routines remained 62e1052fa94cfd916a89cb4928bf0a68 before and after the routine change. Reader catalog audit found no table/column write, sequence advance, schema-create or effective privileged routine execution access. No included public table SELECT grants were missing. Reader is NOLOGIN and NOINHERIT, BYPASSRLS for complete visibility, with no replication, superuser, create-role or create-database capability. This is catalog validation, not a successful login/export.

No company records were changed. The earlier plan status above describes the pre-approval phase. Storage credential, trusted CA file and database login activation remain missing. Ordinary application credentials were not reused. No real archive has been created. Local migration filenames were aligned with the verified remote migration versions.

## Local credential activation and live-test hold

Downloaded the root CA through the signed-in Pulse Dashboard and configured its local path. A certificate-verified local administrator connection activated the prepared database reader using a locally generated password and SCRAM verifier. An initial permission audit failed resolving an inaccessible extensions schema, after activation had committed; follow-up checks identified this correctly. The audit now checks relation OIDs in pg_class, avoiding schema-name resolution and inspecting all relation privileges. Dedicated login, verified TLS and the corrected effective privilege audit passed. The connection is stored in ignored .env.local; recovery material is in ignored backups/access with restrictive permissions. No password was printed or sent in tool arguments.

The M-Tool Dashboard showed free-plan egress 5.48 / 5 GB and a grace-period-over warning. Do not initiate a company media export while this service availability warning is unresolved. File-read credential provisioning remains outstanding. No real archive or company-data recovery test has run.

## Storage role provisioning (2026-10-02)

Applied migration 20261002182243_backup_storage_reader. The new pulse_backup_storage_reader role is NOLOGIN, NOINHERIT, NOBYPASSRLS, and has no administrative flags. It receives SELECT only on storage.objects and storage.buckets, with SELECT-only policies, and authenticator can assume it for signed requests. No membership in anon/authenticated/application roles was granted. The migration transaction refuses effective writes, schema CREATE, or privileged routine execution. Existing company rows, originals, and existing policies were not changed.

An owned networkless synthetic Supabase PostgreSQL container verified reads and rejected INSERT, UPDATE, DELETE, and TRUNCATE; its original fixture stayed unchanged. The container was removed after testing. Live catalog verification confirmed read grants, denied file writes, and all role flags false.

The existing legacy JWT secret is still accepted by Pulse according to its Dashboard. It has not been revealed, changed, or rotated. The operator must place it into the private ignored file backups/access/storage-signing-secret.txt (mode 600; never chat/Git). Run `node --env-file=.env.local scripts/backup/configure-storage-token.mjs backups/access/storage-signing-secret.txt` to audit the role, mint a 24-hour custom-role token, verify a single original with HEAD only (no file-content download), and append the token to ignored .env.local. Setup refuses an existing token or changed configuration; it does not enable exports. This helper is syntax checked, but live token verification awaits the private signing input.
### Live credential verification completed

The operator supplied the existing signing secret through the private ignored local file. The helper initially refused .env.local mode 644; permissions were tightened to 600 without changing its contents. It then passed the dedicated role audit and a single authenticated Storage HEAD request and saved the 24-hour token locally. No original file bodies were downloaded, and no company records, files, or application signing keys were changed. Export and restore-validation flags remain disabled. Token renewal is required after expiry; the signing secret and token remain excluded from Git and backup archives.
## Live preflight corrections (2026-10-02)

Pulse moved to Agentic Labs Pro (org usygmyienkkkcridvbnv). Dashboard showed no quota exceeded and 0.454 / 250 GB egress. No billing settings were changed by this task.

The initial live metadata preflight exposed pg_dump requiring table locks on the six excluded tables. Granting secret-row access to the BYPASSRLS reader was rejected. Migration 20261002184612 instead creates a separate NOBYPASSRLS schema-only reader, with restrictive SELECT false policies on those already RLS-enabled tables. Existing application roles are unaffected. It receives only SELECT and cannot mutate tables or advance sequences. The exporter independently checks all six restrictive policies, RLS and non-ownership before invoking pg_dump. A networkless PostgreSQL fixture verified schema export, denied sensitive reads even with PUBLIC policies and row_security=off, denied writes, and rejected a weakened policy.

The original GRANT USAGE on hosted auth did not take effect: postgres has no grant option on that schema. Existing id/email/created_at column grants are intact. Migration 20261002185028 adds pulse_backup.auth_identities, a SECURITY INVOKER view containing only those three columns, accessible solely to the reader. No SECURITY DEFINER privilege escalation or secret column grants were added. The same isolated fixture verified view access without underlying schema access, with credential columns inaccessible. Live identity count and the reader's effective read-only audit passed. No company rows or originals changed.

Use PULSE_BACKUP_SCHEMA_DATABASE_URL for the independently audited schema connection and /opt/homebrew/opt/libpq/bin/pg_dump for this computer. Local activation material stays in ignored mode-600 files. First-backup encryption uses an operator-authorized generated recovery key in backups/access/first-backup-recovery-key.txt; retain it separately from shared archive copies. UI exports remain disabled until company recovery validation completes.
