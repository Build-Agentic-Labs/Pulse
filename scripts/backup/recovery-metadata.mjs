// Read-only recovery metadata. No restore connection or credential handling here.
export const identifier = value => `"${String(value).replaceAll('"', '""')}"`;
export async function sequenceState(client) {
  const { rows } = await client.query(`select c.relname as name from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='S' order by c.relname`);
  const states = [];
  for (const { name } of rows) {
    const result = await client.query(`select last_value::text as value,is_called from public.${identifier(name)}`);
    states.push({ name, ...result.rows[0] });
  }
  return states;
}
export async function recoveryMetadata(client) {
  const owners = (await client.query(`select 'relation' as kind,c.relname as name,c.relkind,pg_get_userbyid(c.relowner) as owner from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p','v','m','S','f') order by c.relname`)).rows;
  const routines = (await client.query(`select p.proname as name,pg_get_function_identity_arguments(p.oid) as arguments,p.prokind as kind,pg_get_userbyid(p.proowner) as owner,p.prosecdef as security_definer from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by p.proname,arguments`)).rows;
  const schemaOwner = (await client.query(`select pg_get_userbyid(nspowner) as owner from pg_namespace where nspname='public'`)).rows[0]?.owner;
  // pg_dump(public) omits application hooks on Supabase-managed schemas.
  const managedTriggers = (await client.query(`select pg_get_triggerdef(t.oid) as sql,n.nspname as schema,c.relname as table,t.tgname as name,t.tgenabled as enabled from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace join pg_proc p on p.oid=t.tgfoid join pg_namespace fn on fn.oid=p.pronamespace where n.nspname in ('auth','storage') and fn.nspname='public' and not t.tgisinternal order by n.nspname,c.relname,t.tgname`)).rows;
  const typeOwners = (await client.query(`select t.typname as name,t.typtype as kind,pg_get_userbyid(t.typowner) as owner from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typtype in ('e','d','r','m') and not exists (select 1 from pg_depend d where d.classid='pg_type'::regclass and d.objid=t.oid and d.deptype='e') order by t.typname`)).rows;
  const storagePolicies = (await client.query(`select schemaname,tablename,policyname,permissive,roles::text[] as roles,cmd,qual,with_check from pg_policies where schemaname='storage' order by tablename,policyname`)).rows;
  return { type:'recovery-metadata', version:1, schemaOwner, owners, routines, typeOwners, managedTriggers, storagePolicies, sequences:await sequenceState(client), identityRecovery:'preserve-existing-auth-or-reviewed-id-mapping' };
}
/** For an administrator to review and apply to an isolated recovery target ONLY. */
export function metadataRestoreSql(metadata) {
  if (metadata.version !== 1 || !metadata.schemaOwner) throw Error('Recovery metadata is missing or unsupported.');
  const lines = [`ALTER SCHEMA public OWNER TO ${identifier(metadata.schemaOwner)};`];
  for (const item of metadata.owners) {
    const kind = {r:'TABLE',p:'TABLE',v:'VIEW',m:'MATERIALIZED VIEW',S:'SEQUENCE',f:'FOREIGN TABLE'}[item.relkind];
    if (!kind) throw Error('Unsupported recovery object.');
    lines.push(`ALTER ${kind} public.${identifier(item.name)} OWNER TO ${identifier(item.owner)};`);
  }
  for (const item of metadata.routines) {
    if (!['f','p'].includes(item.kind)) throw Error('Unsupported routine kind.');
    // Signature is PostgreSQL-generated catalog SQL, never user-entered text.
    lines.push(`ALTER ${item.kind==='p'?'PROCEDURE':'FUNCTION'} public.${identifier(item.name)}(${item.arguments}) OWNER TO ${identifier(item.owner)};`);
  }
  for (const type of metadata.typeOwners || []) {
    if (!['e','d','r','m'].includes(type.kind)) throw Error('Unsupported recovery type.');
    lines.push(`ALTER ${type.kind === 'd' ? 'DOMAIN' : 'TYPE'} public.${identifier(type.name)} OWNER TO ${identifier(type.owner)};`);
  }
  for (const trigger of metadata.managedTriggers || []) {
    if (!/^CREATE (?:CONSTRAINT )?TRIGGER /.test(trigger.sql)) throw Error('Invalid managed-schema trigger.');
    lines.push(`${trigger.sql};`);
    if (trigger.enabled != null) {
      const action = {O:'ENABLE',D:'DISABLE',R:'ENABLE REPLICA',A:'ENABLE ALWAYS'}[trigger.enabled];
      if (!action || !['auth','storage'].includes(trigger.schema) || !trigger.table || !trigger.name) throw Error('Invalid managed-trigger state.');
      lines.push(`ALTER TABLE ${identifier(trigger.schema)}.${identifier(trigger.table)} ${action} TRIGGER ${identifier(trigger.name)};`);
    }
  }
  for (const policy of metadata.storagePolicies || []) {
    if (policy.schemaname !== 'storage' || !['ALL','SELECT','INSERT','UPDATE','DELETE'].includes(policy.cmd) || !['PERMISSIVE','RESTRICTIVE'].includes(policy.permissive)) throw Error('Invalid storage policy.');
    const roles = policy.roles.map(role => role === 'public' ? 'PUBLIC' : identifier(role)).join(', ');
    lines.push(`CREATE POLICY ${identifier(policy.policyname)} ON storage.${identifier(policy.tablename)} AS ${policy.permissive} FOR ${policy.cmd} TO ${roles}${policy.qual ? ` USING (${policy.qual})` : ''}${policy.with_check ? ` WITH CHECK (${policy.with_check})` : ''};`);
  }
  for (const item of metadata.sequences) {
    if (!/^-?\d+$/.test(item.value) || typeof item.is_called !== 'boolean') throw Error('Invalid sequence state.');
    const qualified = `public.${identifier(item.name)}`.replaceAll("'","''");
    lines.push(`SELECT pg_catalog.setval('${qualified}'::regclass, ${item.value}, ${item.is_called});`);
  }
  return lines.join('\n');
}
