// Operator-only setup. Uses existing admin connection only to activate the prepared role.
// Never exports data, changes application credentials, or prints secrets.
import pg from 'pg';
import {randomBytes,pbkdf2Sync,createHmac,createHash} from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync,appendFileSync} from 'node:fs';
import {verifiedConnection,assertReadOnly,assertSourceBinding} from './source.mjs';
const existing=readFileSync('.env.local','utf8');
if(/^PULSE_BACKUP_DATABASE_URL=.+/m.test(existing)) throw Error('Backup connection already configured; manual review required.');
const url=new URL(process.env.DATABASE_URL);
if(url.port==='6543') url.port='5432';
assertSourceBinding({databaseUrl:url.toString(),storageUrl:process.env.NEXT_PUBLIC_SUPABASE_URL});
const config={databaseUrl:url.toString(),caCertificate:process.env.PULSE_BACKUP_CA_CERT};
if(!config.caCertificate) throw Error('Trusted CA required.');
const admin=new pg.Client({...verifiedConnection(config),connectionTimeoutMillis:10000});
let reader;
try {
 await admin.connect();
 const role=(await admin.query("SELECT rolcanlogin,rolsuper,rolcreaterole,rolcreatedb FROM pg_roles WHERE rolname='pulse_backup_reader'")).rows[0];
 if(!role||Object.values(role).some(Boolean)) throw Error('Prepared disabled role required.');
 const password=randomBytes(48).toString('base64url'),salt=randomBytes(16),iterations=4096;
 const salted=pbkdf2Sync(password,salt,iterations,32,'sha256');
 const clientKey=createHmac('sha256',salted).update('Client Key').digest();
 const storedKey=createHash('sha256').update(clientKey).digest('base64');
 const serverKey=createHmac('sha256',salted).update('Server Key').digest('base64');
 const verifier=`SCRAM-SHA-256$${iterations}:${salt.toString('base64')}$${storedKey}:${serverKey}`;
 const backup=new URL(url);backup.username=url.hostname.includes('.pooler.')?'pulse_backup_reader.neaadefipcpxxcqszpud':'pulse_backup_reader';backup.password=password;
 for(const k of [...backup.searchParams.keys()])if(/^ssl/i.test(k))backup.searchParams.delete(k);
 backup.searchParams.set('sslmode','verify-full');
 mkdirSync('backups/access',{recursive:true,mode:0o700});
 // Preserve local recovery material before activation; never overwrite existing material.
 writeFileSync('backups/access/reader-activation.json',JSON.stringify({databaseUrl:backup.toString(),createdAt:new Date().toISOString()}),{flag:'wx',mode:0o600});
 await admin.query('BEGIN');
 await admin.query(`ALTER ROLE pulse_backup_reader LOGIN PASSWORD '${verifier}'`);
 await admin.query('COMMIT');
 reader=new pg.Client({...verifiedConnection({...config,databaseUrl:backup.toString()}),connectionTimeoutMillis:10000,options:'-c default_transaction_read_only=on'});
 await reader.connect();await assertReadOnly(reader);
 if(readFileSync('.env.local','utf8')!==existing)throw Error('Local configuration changed during activation; recovery material retained.');
 appendFileSync('.env.local',`\nPULSE_BACKUP_DATABASE_URL=${backup.toString()}\n`);
 console.log('Dedicated backup login verified and configured; real export remains locked.');
}catch(e){console.error('Activation did not complete. Code: '+(e.code||'setup_check_failed')+'. Any generated recovery material is retained locally; no secrets printed.');process.exitCode=1;}
finally{await reader?.end();await admin.end();}
