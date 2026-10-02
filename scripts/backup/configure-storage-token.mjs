// Operator-only: mint a 24-hour Storage-only JWT from a private local signing-key file.
// Does not change company records or download file contents. Never prints credentials.
import {readFileSync,statSync,appendFileSync} from 'node:fs';
import {createHmac,randomUUID} from 'node:crypto';
import pg from 'pg';
import {assertSourceBinding,verifiedConnection} from './source.mjs';
const role='pulse_backup_storage_reader';
let client;
try {
  const path=process.argv[2];
  if(!path) throw Error('Private signing-key file path required.');
  const info=statSync(path);
  if(!info.isFile() || (info.mode & 0o077) || info.uid!==process.getuid()) throw Error('Signing-key file must be owned by you with mode 600.');
  const existing=readFileSync('.env.local','utf8');
  if(/^PULSE_BACKUP_STORAGE_READ_TOKEN=.+/m.test(existing)) throw Error('Storage token already configured; review renewal separately.');
  if(statSync('.env.local').mode & 0o077) throw Error('Local environment file must have mode 600.');
  const config={databaseUrl:process.env.PULSE_BACKUP_DATABASE_URL,storageUrl:process.env.NEXT_PUBLIC_SUPABASE_URL,caCertificate:process.env.PULSE_BACKUP_CA_CERT};
  const project=assertSourceBinding(config);
  if(project!=='neaadefipcpxxcqszpud') throw Error('Unexpected source project.');
  client=new pg.Client({...verifiedConnection(config),connectionTimeoutMillis:10000,options:'-c default_transaction_read_only=on'});
  await client.connect();
  const audit=(await client.query(`select rolcanlogin,rolinherit,rolsuper,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls from pg_roles where rolname=$1`,[role])).rows[0];
  if(!audit || Object.values(audit).some(Boolean)) throw Error('Storage role flags are not read-only.');
  const writes=(await client.query(`select count(*)::int as count from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname not in ('pg_catalog','information_schema') and n.nspname not like 'pg_toast%' and c.relkind in ('r','p','v','m','f') and (has_any_column_privilege($1,c.oid,'INSERT') or has_any_column_privilege($1,c.oid,'UPDATE') or has_table_privilege($1,c.oid,'DELETE') or has_table_privilege($1,c.oid,'TRUNCATE'))`,[role])).rows[0];
  const routines=(await client.query(`select count(*)::int as count from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.prosecdef and p.prorettype not in ('trigger'::regtype,'event_trigger'::regtype) and n.nspname not like 'pg_%' and n.nspname <> 'information_schema' and has_schema_privilege($1,n.oid,'USAGE') and has_function_privilege($1,p.oid,'EXECUTE')`,[role])).rows[0];
  if(writes.count || routines.count) throw Error('Storage role has unsafe effective permissions.');
  const object=(await client.query('select bucket_id,name from storage.objects order by bucket_id,name limit 1')).rows[0];
  if(!object) throw Error('No file available for a read-only HEAD verification.');
  const secret=readFileSync(path,'utf8').trim();
  if(secret.length<32 || /\s/.test(secret)) throw Error('Invalid signing-key file.');
  const now=Math.floor(Date.now()/1000), encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
  const body=encode({alg:'HS256',typ:'JWT'})+'.'+encode({role,sub:randomUUID(),aud:'authenticated',iss:'supabase',iat:now,exp:now+86400});
  const token=body+'.'+createHmac('sha256',secret).update(body).digest('base64url');
  const url=new URL('/storage/v1/object/authenticated/'+encodeURIComponent(object.bucket_id)+'/'+object.name.split('/').map(encodeURIComponent).join('/'),config.storageUrl);
  const response=await fetch(url,{method:'HEAD',redirect:'error',headers:{Authorization:'Bearer '+token,apikey:process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY},signal:AbortSignal.timeout(15000)});
  if(!response.ok) throw Error('Storage HEAD verification failed; token not saved.');
  if(readFileSync('.env.local','utf8')!==existing) throw Error('Local configuration changed; token not saved.');
  appendFileSync('.env.local','\nPULSE_BACKUP_STORAGE_READ_TOKEN='+token+'\n');
  console.log('Read-only Storage token verified and saved locally. Expires in 24 hours. Backup export remains disabled.');
} catch { console.error('Storage credential setup did not complete. Check the private signing-key file, role audit, and Storage availability. No secrets printed.'); process.exitCode=1; }
finally {await client?.end();}
