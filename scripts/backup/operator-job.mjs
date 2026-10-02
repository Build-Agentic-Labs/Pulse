// Operator-only launcher for a system-managed first-backup validation job.
// Arguments contain private file paths, never credential values or passwords.
import {readFile,stat,writeFile,rename} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {acquireRunnerLock} from './runner-lock.mjs';
const [jobFile,keyFile]=process.argv.slice(2);
if(!jobFile||!keyFile)throw Error('Private job and recovery-key files required.');
for(const file of [jobFile,keyFile])if((await stat(file)).mode&0o077)throw Error('Operator files must be private.');
const job=JSON.parse(await readFile(jobFile,'utf8'));
await acquireRunnerLock('backups/local',job.id,job.owner);
const child=spawn(process.execPath,['scripts/backup/worker.mjs',job.id,job.owner],{stdio:['pipe','ignore','ignore'],env:{...process.env,NODE_ENV:'development',PULSE_LOCAL_BACKUPS:'true',PULSE_BACKUP_RESTORE_VALIDATED:'true',PULSE_BACKUP_PG_DUMP:'/opt/homebrew/opt/libpq/bin/pg_dump'}});
child.stdin.on('error',()=>{});
child.stdin.end((await readFile(keyFile,'utf8')).trim());
await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});
const statusPath='backups/local/'+job.id+'.json',status=JSON.parse(await readFile(statusPath,'utf8'));
if(status.state!=='complete'||!status.integrityVerified)throw Error('Export did not finish; archive and key retained.');
const reportPath='backups/access/'+job.id+'-recovery-report.json';
const recovery=spawn(process.execPath,['scripts/backup/company-recovery-rehearse.mjs','backups/local/'+job.id+'.pulsebackup',keyFile,reportPath],{stdio:['ignore','ignore','ignore'],env:{PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR}});
await new Promise((resolve,reject)=>{recovery.on('error',reject);recovery.on('exit',resolve);});
const report=JSON.parse(await readFile(reportPath,'utf8'));
if(!report.passed||report.cleanupFailure)throw Error('Isolated recovery did not finish; export preserved for investigation.');
await writeFile(statusPath+'.validated',JSON.stringify({...status,restoreTested:true,recoveryReport:reportPath,updatedAt:new Date().toISOString()}),{flag:'wx',mode:0o600});
await rename(statusPath+'.validated',statusPath);
