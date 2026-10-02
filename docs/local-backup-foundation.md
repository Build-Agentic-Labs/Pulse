# Local backup foundation — not yet production-ready

This branch implements encrypted export plumbing, offline integrity tests and a
super-admin Settings panel. No production credential grants, migrations, exports,
restores or cleanup are executed by installation. Exports are disabled by default.
Do not enable until the gates below have been independently verified.

## Source boundary

Runner uses a separate PostgreSQL connection. It rejects superuser,
role-creation/database-creation and effective table INSERT/UPDATE/DELETE/TRUNCATE
privileges. Its transaction is REPEATABLE READ READ ONLY, with row_security=off
so an RLS-filtered table errors instead of silently exporting a subset. A dedicated
BYPASSRLS role with SELECT-only grants and complete read visibility must be provisioned in a separately reviewed
change. BYPASSRLS is needed for complete reads; it grants no table writes itself. Do not
reuse the application's service role, owner or normal user account.
Also review schema CREATE, sequence, function and membership privileges when
provisioning; grant no mutation capabilities. Never supply production credentials
to an untrusted local installation.

Storage transport performs GET only, with redirects rejected. Provision a distinct
read-only storage identity covering all buckets, with no upload/delete policies.
Use a server-managed credential lifecycle; ordinary user JWTs expire and must not
be treated as permanent backup credentials. Database grants and storage identity
creation are deliberately not automated here.

## Format and scope

.pulsebackup v1 is AES-256-GCM encrypted newline-delimited records, with random
salt/IV and scrypt-derived key. No password is retained. Data is encrypted before
writing; only encrypted partial files and non-content job statuses reach disk.
Every finished archive has an authenticated trailer and record SHA-256; media
have sizes, ordered chunks and SHA-256. Existing archives are never overwritten.

All public base tables are selected in a consistent database snapshot, except:
workspace_integrations (integration secrets), sop_approver_delivery_payloads
(active one-time setup links), sop_submission_locks, push_subscriptions and
transactional_emails and email_deliveries (provider delivery metadata). Additional credential-shaped columns cause a hard failure
pending explicit export policy. Exclusions are listed inside the archive.
Auth identity export includes only id/email/created_at: no passwords, sessions,
tokens. Account recovery must use re-invitation/reconciliation; this is not a
clone of live auth infrastructure. Public schema SQL, tracked migrations, Git
revision and a Git source archive are included. The source archive corresponds
to HEAD, not uncommitted local edits; credentials and certificates are excluded.
Infrastructure secrets/role grants/extensions are separate recovery prerequisites.

Storage metadata and all existing bucket objects are included. Known live document
references are checked against the inventory. Soft-deleted references are not
required to retain physically deleted originals. External document links are
preserved as links, not copied from third parties. Lost originals cannot be
recovered by this exporter. File metadata is compared again after copying; changes
fail the job. This detects concurrent mutations but does not create a transaction
across database and object storage; immutable file versions or coordinated capture
are still required before claiming a precisely synchronized recovery point.

## Enablement gates (not executed by this implementation)

1. Audit dedicated SELECT-only database and storage credentials and full visibility.
2. Install compatible pg_dump, then test against a disposable database/storage fixture.
3. Restore fixtures into an isolated database/storage project with email, invitation,
   cron and notification delivery disabled. Check IDs/FKs, revisions/signatures,
   BOMs, process/step ordering, original media, permissions and application startup.
4. Implement and validate an authenticated restore reader; current verify CLI is
   integrity-only, never a database restore. Do not mutate a target using callbacks
   before entire AES-GCM authentication and trailer validation have succeeded.
5. Set PULSE_LOCAL_BACKUPS=true, PULSE_BACKUP_DATABASE_URL,
   PULSE_BACKUP_STORAGE_READ_TOKEN, PULSE_BACKUP_PG_DUMP (optional executable path)
   and PULSE_BACKUP_RESTORE_VALIDATED=true only after the rehearsal is recorded.
   NEXT_PUBLIC_SUPABASE_URL/ANON_KEY must identify the same source project as SQL.

No production setup has been performed and no complete restore rehearsal has
passed yet. Settings therefore correctly shows “exports are locked.”

## Local workflow and failure behavior

Create backup starts a detached local Node worker. Status survives browser refresh;
production deployments refuse to run it. The password travels over same-origin
POST and child stdin, never process arguments, URLs or status files. Keep it in a
password manager. After integrity verification use Save file to choose a location
(the browser may use Downloads according to its preferences). Server encryption
copies stay in ignored backups/local; no automatic deletion or retention is enabled.
No job ever restores, deletes or writes source business data.

A filesystem lock prevents overlapping jobs; an abruptly terminated worker can
leave a lock and encrypted partial file. These require operator inspection rather
than an automatic potentially unsafe deletion. Status older than three minutes
is marked interrupted and not downloadable. Jobs record integrityVerified separately
from restoreTested; a new snapshot is never declared restore-tested automatically.

Offline integrity command (no network):
PULSE_BACKUP_PASSWORD=… node scripts/backup/verify.mjs file.pulsebackup
Use a secure environment injection rather than putting a real password in shell
history. Do not use the old backup-complete-app.mjs as a complete data backup.

## Isolated validation performed (2026-10-02)

See local-backup-validation-report.json. Rehearsal uses PGlite 0.5.8 installed
into a disposable /tmp runtime with lifecycle scripts disabled, not into the app.
Both source and recovery PostgreSQL instances are in memory and cannot have a
production connection URL. Global fetch is disabled; an explicit synthetic storage
adapter supplies only fixture bytes. No .env files are loaded by the rehearsal.

27 synthetic records across 26 tables and two media byte streams were exported,
authenticated, imported into the separate fixture database and compared exactly.
Step ordering, BOM quantities, revisions, signatures, comments and released work
instructions passed; foreign keys rejected invalid references. Fixture source
business rows stayed unchanged after normal and failing operations. Tampering,
wrong passwords, truncation, overwrite attempts, unavailable storage, interrupted
downloads, concurrent file metadata changes and missing references were rejected.

A verification defect was corrected: bounded record callbacks now run only after
all AES-GCM authentication and manifest checks pass. They buffer at most 64 MiB;
a larger callback-based recovery fails before exposing any record. Integrity-only
verification still streams. This reader is not a production restore implementation.

The fixture schema replaces real pg_dump, and the single embedded connection
substitutes the snapshot-sharing token. This validates data/crypto/recovery plumbing,
not the full real Supabase schema, schema dump, auth reconstruction, RLS, infrastructure
roles, sequences, application startup or complete production data coverage. The
PULSE_BACKUP_RESTORE_VALIDATED enablement gate remains unset. Do not equate this
fixture result with permission to enable real company exports.

Repeat using a disposable runtime containing @electric-sql/pglite@0.5.8:
node scripts/backup/rehearse.mjs /tmp/runtime /tmp/rehearsal-report.json
The fixture databases and files are removed automatically; only the report remains.

## Real local Supabase rehearsal (2026-10-02)

See local-supabase-backup-validation-report.json. Two disposable PostgreSQL 17
containers ran Supabase Auth and Storage services, with synthetic credentials only.
The source used all repository migrations. No production connection, environment
file, SMTP service or mail-provider configuration was used. Host-facing services
were bound to localhost; test resources were removed after validation.

Actual pg_dump shared the source's exported read-only snapshot. A dedicated
SELECT-only database role and a SELECT-only Storage JWT role exported synthetic
SOPs, revisions, signatures, comments, a product, manufacturing steps, BOM content,
a released work instruction and a photo. The encrypted archive was authenticated
and restored into the separate target. All 69 exported public tables matched
exactly, and source rows were unchanged. Original photo bytes matched through
target Storage; public RLS definitions matched; every restored public foreign key
was explicitly rescanned; attempted updates through the export role were denied.

The real schema exposed email_deliveries.webhook_event_id, which the credential
column guard correctly refused to export pending an explicit policy. Provider
webhook delivery payloads are now excluded alongside operational transactional
mail records. These are outside the business-document recovery scope.

This is still NOT full recovery validation. Schema-only dumping omits ACLs and
sequence values. Identity records do not reconstruct login credentials. The
rehearsal supplied target identities explicitly and used the Supabase baseline
roles. Application startup and signed-in user access have not been validated.
The local Storage adapter bypassed the gateway and HTTPS transport only for the
fixture; production code still requires HTTPS. Production exports remain locked.
Next work must capture and restore sequence state and security permissions, define
the identity recovery procedure, then test application access against a disposable
restored environment before enabling company exports.

## Recovery metadata phase

New archives include public-schema privileges and default privileges in pg_dump,
plus object ownership (including SECURITY DEFINER function owners) and sequence
last_value/is_called in authenticated recovery metadata. Sequence values stay
strings to preserve bigint precision. The exporter requires SELECT-only sequence
permissions and rejects USAGE/UPDATE, which can advance counters. It compares
sequence state again after export and refuses detected drift; sequences are not
MVCC snapshots, so a quiet export window is still required. Grant SELECT on all
public sequences to the dedicated read-only role; never grant USAGE or UPDATE.

metadataRestoreSql produces reviewable target-only statements; it does not connect
to or modify a database. Apply sequence state only after rows are loaded, with the
target closed to users. Required database roles must exist in the target. Role
passwords, memberships and privileged role creation are not restored automatically.
Earlier archives lacking this metadata cannot claim this recovery coverage.

Login recovery is deliberately separate from business-document backup. For an
in-place data recovery, preserve the existing auth system and UUIDs. For a new
project, build a reviewed source-to-target identity map before loading dependent
rows; preserve source UUIDs where the chosen supported recovery method permits,
or consistently remap every dependent reference. Do not silently recreate users
by email or assume a matching email gives the same UUID. Re-establish authentication
through a separately authorized auth recovery process; reset credentials/sessions,
configure SSO/MFA as applicable, and send no invitations from the restore tool.
Test sign-in, workspace membership, departmental access and Quality final approval
in the isolated recovered app. App settings/secrets, Auth/Storage customizations,
extensions, migration history and role prerequisites need a separate deployment
recovery checklist. This archive alone is not a full app/disaster-recovery image.

Production exports remain locked pending the combined recovered-application test.
No enablement flags or production credentials were changed during this phase.

## Recovered application validation (2026-10-02)

See local-backup-app-recovery-report.json. A temporary copy of the app used only
synthetic Supabase credentials and separate PostgreSQL, Auth, Storage and REST
containers. The existing app server and .env files were not changed or copied.
Test services were published only on localhost. Email-provider credentials were
absent; no real invitation or notification emails were sent.

The source used all 138 repository migrations with the Supabase public-schema
baseline grants established before migrations, allowing migration-specific revokes
to remain authoritative. Fixtures included a canonical createEmptySop document,
three identities, workspace/department memberships, Quality module access, a
product master BOM using the actual masterBom structure, steps and a private photo.
The current encrypted exporter, snapshot-sharing pg_dump, ownership/counter
metadata and original bytes were restored together. Synthetic login identities
were separately prepared with preserved UUIDs, never read from credential archives.

This rehearsal found and fixed a recovery omission: public-only pg_dump does not
capture app-owned triggers on auth/storage tables or Storage RLS policies. Those
are now explicitly captured in recovery metadata and included in reviewed target
restore SQL. Four managed-table application hooks and 19 Storage policies were
recovered in this test. Database role prerequisites still require separate review.

Real Auth password sign-ins passed for author, Quality approver and outsider.
Authenticated REST reads enforced workspace boundaries and Quality approval
eligibility. Ordered steps and the private photo were accessible. All source rows
matched the archive. Target business data matched before browser edit tests, except
expected startup notification-health records and profile refresh timestamps.
The browser loaded the workspace dashboard, SOP list/editor and mobile process
builder. Saving an edited SOP title and step description succeeded; reload kept
the step description. Direct database checks confirmed only the target fixtures
changed, with source SOP and step unchanged.

The fixture app and test containers were removed after validation. This passes
the synthetic recovered-app smoke test, not the complete production disaster
recovery checklist: SSO/MFA, real identity transfer, Realtime, review/signature
lifecycle, external integrations and production-scale media still need explicit
coverage. PULSE_BACKUP_RESTORE_VALIDATED remains unset; no production exports were
enabled and no production credentials or data were used.

## Larger archives and interruption validation

See local-backup-stress-report.json. Streaming export and integrity verification
passed with 512 synthetic originals totaling 128 MiB. A force-killed subprocess
could not publish a completed archive; its encrypted partial could not verify.
Destination collision preserved the verified large archive. The worker now retains
an archive even if post-export verification fails, rather than unlinking it in its
catch handler. Failed archives remain unavailable for download.

The existing callback recovery reader correctly refuses more than 64 MiB without
exposing records. This is a remaining recovery-capacity gate, not a successful
large-media restore. A scalable authenticated reader must be validated before
claiming large backups are recoverable. Dedicated company backup credentials were
not configured during this check; no production export or grant was attempted.

A two-pass verifiedRecords reader now supports large encrypted archives without
plaintext staging or the 64 MiB callback buffer. Pass one validates the complete
GCM tag, manifest and media, retaining bounded per-record digests (250,000 record
maximum). Pass two checks each replayed plaintext record against its authenticated
first-pass digest before yielding it. Consumers must commit only after successful
iteration and roll back/stage target writes on error. Concurrent changes or
truncation during replay must fail; yielded records still match authenticated
first-pass content. The 128 MiB fixture replay returned all 512 files with original
hashes matching. This reader is not itself a production database restore command.

## Overnight continuation requirements

The active task remains: complete large-media/interruption checks, recovered
review/approval lifecycle, scope/completeness and read-only permission audit, then
prepare the first real local export only if all gates pass. Do not delete company
data. All write rehearsals must stay in owned disposable fixtures. Do not commit,
push, change production grants or enable exports merely because unit tests pass.
Remaining: exercise review/signature/release transitions in a restored fixture;
validate large reader replay mutation handling and real file reconstruction;
audit source binding, complete file references, worker failure behavior and current
application source capture. Dedicated backup DB/file-read credentials are absent
from .env.local (only ordinary DATABASE_URL is present). Do not reuse that database
URL or the application service key as backup credentials. This configuration gap
cannot be bypassed by setting the restore flag; complete independent work first.


## Additional recovery and safety validation

The larger-media rehearsal now reconstructs 512 actual files (128 MiB) into an
owned temporary recovery directory and rereads every on-disk SHA-256 hash. It
passed without a database or network connection. Unit tests also mutate and
truncate ciphertext after the authenticated reader starts replay; neither can
finish recovery or expose an altered record. All synthetic files were cleaned up.

The read-only privilege audit now includes views and column-specific INSERT/UPDATE
grants. A real isolated PostgreSQL rehearsal confirmed a SELECT-only role passes
and a role with only UPDATE(title) is refused. These are test roles only; no company
grants were changed.

The worker independently enforces local-only execution. Application source and
migrations are captured from one fixed Git commit, including the recovery scripts.
An export refuses uncommitted changes in the source paths rather than pairing a
running edited app with an older recovery source. This work remains uncommitted;
no commit or production export has been performed. Missing dedicated credentials
and the incomplete review/signature lifecycle rehearsal still prevent enabling
real backups.


## Restored SOP workflow and source completeness checks

See local-backup-workflow-report.json and scripts/backup/workflow-rehearse.mjs.
A new isolated PostgreSQL/Auth/Storage fixture applied all current migrations,
then an encrypted archive restored all 75 public tables, schema, owners, counters
and managed hooks. The recovered author submitted the SOP, its assigned approver
returned No changes needed, the author requested signatures, the department
signed, and independent Quality signed and released it. Numbering, immutable
revision creation and the event outbox worked. Unauthorized/premature actions
were refused. Source public rows were compared before and after and unchanged.
No provider emails were sent. This is database workflow validation; the prior
browser smoke test is separate and does not prove email/provider recovery.

This test reproduced a pre-existing signature lock defect: sign_sop_with_mark
ran as SECURITY INVOKER, so an assigned reviewer with read/seat access but no SOP
UPDATE RLS could not acquire FOR UPDATE. The prepared local migration
20261002060000_sop_signature_lock_authorization.sql makes only the transactional
helper SECURITY DEFINER and checks can_read_sop first. The underlying sign_sop
still checks live seat membership, hash/cycle, author separation and Quality
eligibility. The fix has NOT been applied to the company database.

The exporter now refuses a database/storage project mismatch. It accepts a direct
Supabase DB hostname or a Supabase pooler username naming the same project as the
HTTPS Storage URL. Non-Supabase/custom gateway sources require a separately reviewed
binding implementation. Synthetic adapters explicitly opt into their fixture mode.

Completeness validation now also recognizes raw paths for work-instruction
reference files and problem evidence, and frozen release photos whose URLs are
intentionally empty. All existing Storage objects are still copied. These checks
refuse a missing live referenced original rather than reporting a complete backup.


Current verification checkpoint: 214 test files / 1,728 tests passed; TypeScript
passed after source-binding/reference changes. Restored workflow retry checks
also passed: no duplicate signature, no profile mutation on a rejected signature,
and no source-row change. All owned workflow fixture containers/networks and
synthetic temporary archive files were removed. No company connection was used.

Remaining before a real export: finish worker crash/lock and metadata completeness
handling; validate dedicated live read-only credentials and project visibility;
review the new signing migration for deployment; record the final isolated recovery
gate against the reviewed committed source. Do not set the validation flag merely
to unlock the UI. First real export remains conditional on these checks and the
user's chosen backup password. No company credentials have been provisioned here.


## Runner and final build checkpoint

Runner locks now contain job/owner identities. Only that job can release its lock;
real subprocess tests verified a mismatched worker cannot touch another job's
status/archive, and a gated worker preserves an existing archive while recording
failure and releasing its own lock. Concurrent lock attempts admit one worker.
A killed worker's lock is deliberately retained for operator review: elapsed time
alone never proves a process is dead, and no archive/partial is removed to retry.

Status reads reject mismatched IDs, owners, invalid timestamps and unknown states.
Stale status is presented as interrupted without overwriting the recorded status.
Malformed start bodies and missing local archive files return controlled errors.

Recovery metadata now also captures enum/domain/range ownership and managed hook
enabled state, including disabled, replica-only and always-enabled variants. A
real isolated PostgreSQL rehearsal preserved those properties; the 139-migration
restored SOP review-to-release rehearsal passed again after this change.

The exporter releases its read-only database snapshot after schema/rows/file
inventory capture, before slow media reads, to reduce impact on database vacuum.
It still compares sequence state and object inventory afterward and refuses drift.
Connection establishment now has a 15-second timeout.

Latest checks: 216 test files / 1,737 tests passed; lint and typecheck passed.
A production Turbopack build passed in a private temporary copy with separate
copied dependencies, no .env files, no company credentials, and the backup API
present in the build manifest. Temporary build copies were removed; the running
company development app was left alone.

The current .env.local has no local-backup enablement, dedicated DB connection,
dedicated Storage read token or restore-validation flag. Those missing credentials
are a real remaining dependency, not a test failure to bypass. No production
export, grant, migration or restore was executed. The first real local backup
cannot start until the read-only credential audit and reviewed-source enablement
are complete and the super-admin chooses a backup password.

### Connected source inspection and transport safeguards (2026-10-02)

The M-Tool connector now exposes Pulse (`neaadefipcpxxcqszpud`). Read-only catalog inspection found 75 public tables and no role whose name contains backup. No company rows or permissions were changed. Dedicated database and storage credentials remain required. Configure `PULSE_BACKUP_CA_CERT` with the trusted Supabase database root certificate path; certificate verification remains enabled. Production export connections remove URL SSL overrides, require verified TLS in both node-postgres and pg_dump, and reject non-5432 connections to avoid transaction poolers. Synthetic rehearsal adapters remain explicitly separate. Source changes remain uncommitted, and real export is still locked.

### Effective privileged routine access gate (2026-10-02)

Read-only production catalog inspection found 23 non-trigger public SECURITY DEFINER routines with PUBLIC EXECUTE. The backup account would inherit these grants; per-role REVOKE cannot negate PUBLIC. Four mutation routine definitions were inspected without invocation; they contain user-identity scoping or authentication checks, so the catalog finding is not evidence of an unauthenticated app exploit. Direct database credentials have different trust boundaries and still require a complete review. The exporter now refuses effective callable privileged routines before snapshot/export. A fresh networkless synthetic PostgreSQL rehearsal passed, including refusal of a SELECT-only reader inheriting a privileged writer, with fixture source rows unchanged. 21 targeted tests and typecheck passed. No production account, grant or policy was changed. See local-backup-access-plan.md for remaining provisioning gates.
