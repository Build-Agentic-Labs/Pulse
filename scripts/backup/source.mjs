import pg from 'pg';
import { readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { digest } from './archive.mjs';
import { recoveryMetadata, sequenceState } from './recovery-metadata.mjs';
const exec = promisify(execFile);
export function storageReferences(value, output = []) {
  if (typeof value === 'string') {
    const match = /\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/?]+)\/([^?]+)/.exec(value);
    if (match) output.push(`${decodeURIComponent(match[1])}/${decodeURIComponent(match[2])}`);
  } else if (Array.isArray(value)) for (const item of value) storageReferences(item, output);
  else if (value && typeof value === 'object') for (const item of Object.values(value)) storageReferences(item, output);
  return output;
}
/** Reject mixing one project's database with another project's file inventory. */
export function assertSourceBinding(config) {
  const storage = new URL(config.storageUrl), database = new URL(config.databaseUrl);
  const match = /^([a-z0-9-]+)\.supabase\.co$/.exec(storage.hostname);
  if (storage.protocol !== 'https:' || !match || storage.pathname !== '/' || storage.username || storage.password) throw new Error('Backup storage must identify its Supabase source project.');
  const reference = match[1], user = decodeURIComponent(database.username);
  const direct = database.hostname === `db.${reference}.supabase.co`;
  const pooled = /\.pooler\.supabase\.(?:com|co)$/.test(database.hostname) && user.endsWith(`.${reference}`);
  if (!['postgres:','postgresql:'].includes(database.protocol) || (!direct && !pooled)) throw new Error('Backup database and storage source projects do not match.');
  if (database.port && database.port !== '5432') throw new Error('Backups require a direct or session connection on port 5432.');
  return reference;
}
export function rowStorageReferences(table, row) {
  if (row.deleted_at) return [];
  const references = storageReferences(row);
  const buckets = {sop_annex_files:'sop-annexes',task_videos:'task-videos',step_photos:'step-photos',step_exploded_views:'step-photos',tool_library:'step-photos',work_instruction_references:'wi-reference-files',problem_evidence:'problem-evidence'};
  const bucket = buckets[table];
  if (bucket) for (const field of ['storage_path','thumbnail_storage_path']) if (row[field]) references.push(`${bucket}/${row[field]}`);
  // Frozen release photos intentionally have empty URLs; the original path is canonical.
  if (table === 'work_instruction_releases') for (const card of row.content?.cards || []) if (card.photo?.storagePath) references.push(`step-photos/${card.photo.storagePath}`);
  return references;
}
const quote = (name) => `"${name.replaceAll('"', '""')}"`;
const EXCLUDED = new Set(['workspace_integrations', 'sop_approver_delivery_payloads', 'sop_submission_locks', 'push_subscriptions', 'transactional_emails', 'email_deliveries']);
export const CRITICAL = ['sops', 'sop_revisions', 'sop_signatures', 'sop_review_seats', 'sop_review_submissions', 'sop_review_annotations', 'sop_comment_replies', 'sop_annex_files', 'sop_event_log', 'sop_change_log', 'products', 'projects', 'tasks', 'manufacturing_steps', 'manufacturing_components', 'step_photos', 'step_tools', 'step_exploded_views', 'task_videos', 'tool_library', 'work_instruction_releases', 'work_instruction_references', 'departments', 'department_members', 'profiles', 'workspace_members'];
export async function assertReadOnly(client) {
  const { rows } = await client.query(`select rolsuper, rolcreaterole, rolcreatedb from pg_roles where rolname=current_user`);
  if (!rows[0] || Object.values(rows[0]).some(Boolean)) throw new Error('Backup credential must be a dedicated unprivileged read-only role.');
  const permissions = await client.query(`select n.nspname as table_schema, c.relname as table_name from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname not in ('pg_catalog','information_schema') and n.nspname not like 'pg_toast%' and c.relkind in ('r','p','v','m','f') and (has_any_column_privilege(c.oid,'INSERT') or has_any_column_privilege(c.oid,'UPDATE') or has_table_privilege(c.oid,'INSERT') or has_table_privilege(c.oid,'UPDATE') or has_table_privilege(c.oid,'DELETE') or has_table_privilege(c.oid,'TRUNCATE'))`);
  if (permissions.rows.length) throw new Error('Backup credential has write privileges. Export refused.');
  const sequencePermissions = await client.query(`select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='S' and n.nspname not like 'pg_%' and (has_sequence_privilege(c.oid,'USAGE') or has_sequence_privilege(c.oid,'UPDATE'))`);
  if (sequencePermissions.rows.length) throw new Error('Backup credential can advance sequence counters. Export refused.');
  const schemaPermissions = await client.query(`select nspname from pg_namespace where nspname not like 'pg_%' and nspname <> 'information_schema' and has_schema_privilege(oid,'CREATE')`);
  if (schemaPermissions.rows.length) throw new Error('Backup credential has schema-create privileges. Export refused.');
  // SELECT grants alone do not prevent inherited PUBLIC execution of privileged routines.
  // Do not invoke routines to probe them; catalog inspection is sufficient to fail closed.
  const privilegedRoutines = await client.query(`select n.nspname, p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.prosecdef and n.nspname not like 'pg_%' and n.nspname <> 'information_schema' and p.prorettype not in ('trigger'::regtype,'event_trigger'::regtype) and has_schema_privilege(n.oid,'USAGE') and has_function_privilege(p.oid,'EXECUTE')`);
  if (privilegedRoutines.rows.length) throw new Error('Backup credential can execute privileged routines. Export refused pending access review.');
}
export function verifiedConnection(config) {
  const url = new URL(config.databaseUrl);
  // URL SSL options override node-postgres SSL objects; remove every override.
  for (const key of [...url.searchParams.keys()]) if (/^ssl/i.test(key)) url.searchParams.delete(key);
  return { connectionString: url.toString(), ssl: { rejectUnauthorized: true, ...(config.caCertificate ? { ca: readFileSync(config.caCertificate, 'utf8') } : {}) } };
}
export async function assertSchemaReader(client) {
  await assertReadOnly(client);
  const flags=(await client.query('select rolbypassrls,rolinherit from pg_roles where rolname=current_user')).rows[0];
  if(!flags || flags.rolbypassrls || flags.rolinherit) throw new Error('Schema reader must not bypass row security or inherit roles.');
  const result=await client.query(`select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any($1::text[]) and c.relrowsecurity and c.relowner <> (select oid from pg_roles where rolname=current_user) and exists(select 1 from pg_policy p where p.polrelid=c.oid and not p.polpermissive and p.polcmd='r' and (select oid from pg_roles where rolname=current_user)=any(p.polroles) and pg_get_expr(p.polqual,p.polrelid)='false')`,[[...EXCLUDED]]);
  if(result.rows.length!==EXCLUDED.size) throw new Error('Schema reader lacks restrictive sensitive-row protection.');
}
export async function* productionRecords(config, progress, dependencies = {}) {
  if (!dependencies.syntheticSource) assertSourceBinding(config);
  const Client = dependencies.Client || pg.Client;
  const client = new Client({ ...(dependencies.syntheticSource ? { connectionString: config.databaseUrl } : verifiedConnection(config)), application_name: 'pulse-readonly-backup', connectionTimeoutMillis: 15000, options: '-c default_transaction_read_only=on -c statement_timeout=30000 -c lock_timeout=1000' });
  await client.connect();
  const sourceUrl = new URL(config.storageUrl);
  if (sourceUrl.protocol !== 'https:') { await client.end(); throw new Error('Storage must use HTTPS.'); }
  if (!config.storageReadToken || config.storageReadToken === process.env.SUPABASE_SERVICE_ROLE_KEY) { await client.end(); throw new Error('A dedicated storage-read credential is required.'); }
  try {
    await assertReadOnly(client);
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    // Refuse silent RLS-filtered exports: fail rather than claim completeness.
    await client.query('SET LOCAL row_security = off');
    const references = new Set();
    const snapshot = (await client.query('select pg_export_snapshot() as id')).rows[0].id;
    const tables = (await client.query(`select tablename from pg_tables where schemaname='public' order by tablename`)).rows.map((row) => row.tablename);
    for (const table of CRITICAL) if (!tables.includes(table)) throw new Error(`Critical table missing: ${table}`);
    // Live pg_dump needs a distinct non-bypass role whose sensitive rows are RLS-denied.
    const schemaUrl=config.schemaDatabaseUrl || (dependencies.syntheticSource ? config.databaseUrl : null);
    if(!schemaUrl && !dependencies.dumpSchema) throw new Error('Dedicated schema-read connection is required.');
    if(schemaUrl && !dependencies.syntheticSource) {
      assertSourceBinding({...config,databaseUrl:schemaUrl});
      const observer=new Client({...verifiedConnection({...config,databaseUrl:schemaUrl}),connectionTimeoutMillis:15000});
      try{await observer.connect();await assertSchemaReader(observer);}finally{await observer.end();}
    }
    const url = new URL(schemaUrl || config.databaseUrl);
    // No password or connection string appears in process arguments.
    const schema = await (dependencies.dumpSchema || exec)(config.pgDump, ['--schema-only', '--schema=public', '--no-owner', `--snapshot=${snapshot}`, '--host', url.hostname, '--port', url.port || '5432', '--username', decodeURIComponent(url.username), '--dbname', url.pathname.slice(1)], {
      env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password), PGSSLMODE: dependencies.syntheticSource ? (url.searchParams.get('sslmode') || 'require') : 'verify-full', ...(dependencies.syntheticSource ? {} : { PGSSLROOTCERT: config.caCertificate || 'system' }), PGOPTIONS: '-c default_transaction_read_only=on' }, maxBuffer: 32 * 1024 * 1024,
    });
    yield { type: 'schema', name: 'public.sql', sql: schema.stdout };
    const recovery = await recoveryMetadata(client);
    yield recovery;
    yield { type: 'scope', excludedTables: [...EXCLUDED], auth: 'Identity mapping only; no passwords, tokens, sessions or active setup links.', externalReferences: 'External links retained as references; external remote files are not copied.' };
    for (const table of tables.filter((table) => !EXCLUDED.has(table))) {
      progress('records');
      const columns = (await client.query('select column_name from information_schema.columns where table_schema=$1 and table_name=$2', ['public', table])).rows;
      if (columns.some((column) => /secret|password|access_token|refresh_token|api_key|webhook/i.test(column.column_name))) throw new Error('A table contains credentials and requires an explicit export policy.');
      await client.query(`DECLARE backup_rows NO SCROLL CURSOR FOR SELECT row_to_json(t) as row FROM public.${quote(table)} t`);
      let count = 0;
      while (true) {
        const result = await client.query('FETCH FORWARD 250 FROM backup_rows');
        if (!result.rows.length) break;
        for (const item of result.rows) {
          for (const ref of rowStorageReferences(table,item.row)) references.add(ref);
          count++; yield { type: 'row', table, row: item.row }; }
      }
      await client.query('CLOSE backup_rows');
      yield { type: 'table', name: table, rows: count };
    }
    // Explicit fields only: auth credentials never enter the archive.
    const identities = await client.query(`select id, email, created_at from ${dependencies.syntheticSource ? 'auth.users' : 'pulse_backup.auth_identities'} order by id`);
    for (const identity of identities.rows) yield { type: 'identity', identity };
    const objects = (await client.query('select bucket_id, name, updated_at, metadata from storage.objects order by bucket_id,name')).rows;
    const available = new Set(objects.map((object) => `${object.bucket_id}/${object.name}`));
    if ([...references].some((reference) => !available.has(reference))) throw new Error('A document references a missing storage file. Backup incomplete.');
    const buckets = (await client.query('select id,name,public,file_size_limit,allowed_mime_types from storage.buckets order by id')).rows;
    yield { type: 'buckets', buckets };
    // Schema, rows and file inventory are captured. Release the database snapshot
    // before potentially slow media reads so backup does not hold back vacuum.
    await client.query('COMMIT');
    progress('files');
    for (const object of objects) {
      const target = new URL(`/storage/v1/object/authenticated/${encodeURIComponent(object.bucket_id)}/${object.name.split('/').map(encodeURIComponent).join('/')}`, config.storageUrl);
      const response = await (dependencies.fetch || fetch)(target, { method: 'GET', redirect: 'error', headers: { Authorization: `Bearer ${config.storageReadToken}`, apikey: config.anonKey }, signal: AbortSignal.timeout(120000) });
      if (!response.ok || !response.body) throw new Error('A storage file could not be read. Backup incomplete.');
      let bytes = 0, chunk = 0;
      const { createHash } = await import('node:crypto'); const hash = createHash('sha256');
      yield { type: 'file-start', bucket: object.bucket_id, path: object.name, metadata: object.metadata };
      for await (const data of response.body) {
        bytes += data.length; hash.update(data);
        yield { type: 'file-chunk', chunk: chunk++, data: Buffer.from(data).toString('base64') };
      }
      if (object.metadata?.size != null && Number(object.metadata.size) !== bytes) throw new Error('A storage file changed size. Backup incomplete.');
      yield { type: 'file-end', bytes, chunks: chunk, sha256: hash.digest('hex') };
    }
    // Sequences are not MVCC snapshots. Refuse drift rather than claim consistency.
    if (digest(JSON.stringify(await sequenceState(client))) !== digest(JSON.stringify(recovery.sequences))) throw new Error('Sequence counters changed during backup. Retry during a quiet period.');
    // New snapshot detects file replacement/removal during copying; do not report success.
    const after = (await client.query('select bucket_id, name, updated_at, metadata from storage.objects order by bucket_id,name')).rows;
    if (digest(JSON.stringify(after)) !== digest(JSON.stringify(objects))) throw new Error('Files changed during backup. Retry when uploads and deletions are quiet.');
  } finally { await client.end(); }
}
