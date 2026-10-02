import {afterEach,expect,it} from 'vitest';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir} from 'node:fs/promises';
import {acquireRunnerLock,ownsRunnerLock,releaseRunnerLock} from '../../../scripts/backup/runner-lock.mjs';
const roots:string[]=[];
async function fixture(){const root=await mkdtemp(path.join(tmpdir(),'pulse-lock-fixture-'));roots.push(root);return root;}
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
it('only its owning job can release a lock; archives and interrupted files stay untouched',async()=>{
 const root=await fixture(),id=randomUUID(),owner=randomUUID();
 await writeFile(path.join(root,'saved.pulsebackup'),'existing archive');
 await writeFile(path.join(root,'interrupted.partial'),'existing encrypted partial');
 await acquireRunnerLock(root,id,owner);
 expect(await ownsRunnerLock(root,id,owner)).toBe(true);
 expect(await releaseRunnerLock(root,randomUUID(),owner)).toBe(false);
 expect(await releaseRunnerLock(root,id,randomUUID())).toBe(false);
 expect(await ownsRunnerLock(root,id,owner)).toBe(true);
 await expect(acquireRunnerLock(root,randomUUID(),owner)).rejects.toThrow();
 expect(await releaseRunnerLock(root,id,owner)).toBe(true);
 expect(await readFile(path.join(root,'saved.pulsebackup'),'utf8')).toBe('existing archive');
 expect(await readFile(path.join(root,'interrupted.partial'),'utf8')).toBe('existing encrypted partial');
 await acquireRunnerLock(root,randomUUID(),owner);
});
it('concurrent starts admit exactly one runner',async()=>{
 const root=await fixture(),owner=randomUUID(),ids=Array.from({length:16},()=>randomUUID());
 const results=await Promise.allSettled(ids.map(id=>acquireRunnerLock(root,id,owner)));
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 const winner=ids[results.findIndex(r=>r.status==='fulfilled')];
 expect(await ownsRunnerLock(root,winner,owner)).toBe(true);
});
it('invalid identities and unowned legacy locks fail closed',async()=>{
 const root=await fixture();await expect(acquireRunnerLock(root,'../../file',randomUUID())).rejects.toThrow('identity');
 expect(await releaseRunnerLock(root,randomUUID(),randomUUID())).toBe(false);
});

it('a real worker refuses another job lock without altering its status or archive',async()=>{
 const root=await fixture(),backupRoot=path.join(root,'backups/local');await mkdir(backupRoot,{recursive:true});
 const owner=randomUUID(),first=randomUUID(),second=randomUUID();await acquireRunnerLock(backupRoot,first,owner);
 await writeFile(path.join(backupRoot,`${first}.json`),'original status');
 await writeFile(path.join(backupRoot,`${first}.pulsebackup`),'original archive');
 await expect(promisify(execFile)(process.execPath,[path.resolve('scripts/backup/worker.mjs'),second,owner],{cwd:root,env:{PATH:process.env.PATH,NODE_ENV:'production'},timeout:5000})).rejects.toThrow();
 expect(await ownsRunnerLock(backupRoot,first,owner)).toBe(true);
 expect(await readFile(path.join(backupRoot,`${first}.json`),'utf8')).toBe('original status');
 expect(await readFile(path.join(backupRoot,`${first}.pulsebackup`),'utf8')).toBe('original archive');
});
it('a gated real worker reports failure, releases only its own lock and preserves an existing archive',async()=>{
 const root=await fixture(),backupRoot=path.join(root,'backups/local');await mkdir(backupRoot,{recursive:true});
 const owner=randomUUID(),id=randomUUID();await acquireRunnerLock(backupRoot,id,owner);
 await writeFile(path.join(backupRoot,`${id}.pulsebackup`),'original archive');
 const child=execFile(process.execPath,[path.resolve('scripts/backup/worker.mjs'),id,owner],{cwd:root,env:{PATH:process.env.PATH,NODE_ENV:'production'},timeout:5000});
 const completed=new Promise<void>((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('Worker failed')));});
 child.stdin!.end('fixture-only-backup-password');await completed;
 expect(await ownsRunnerLock(backupRoot,id,owner)).toBe(false);
 expect(JSON.parse(await readFile(path.join(backupRoot,`${id}.json`),'utf8')).state).toBe('failed');
 expect(await readFile(path.join(backupRoot,`${id}.pulsebackup`),'utf8')).toBe('original archive');
});
