/** Synthetic-only larger-file and process interruption checks. No DB or network. */
import {mkdtemp,readFile,writeFile,rm,mkdir,open} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';import {tmpdir} from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {writeArchive,verifyArchive,digest,verifiedRecords} from './archive.mjs';
const root=await mkdtemp(path.join(tmpdir(),'pulse-backup-stress-'));const password=randomBytes(32).toString('hex');
const report={performedAt:new Date().toISOString(),productionConnected:false,environment:'Synthetic encrypted files in an owned temporary directory; no database or network',checks:[]};
try{
 const file=path.join(root,'large.pulsebackup'),chunk=randomBytes(256*1024),hash=digest(chunk);let bytes=0;
 async function* records(){for(let i=0;i<512;i++){yield{type:'file-start',bucket:'step-photos',path:`synthetic/${i}.bin`};yield{type:'file-chunk',chunk:0,data:chunk.toString('base64')};yield{type:'file-end',bytes:chunk.length,chunks:1,sha256:hash};bytes+=chunk.length;}}
 await writeArchive(file,password,records());const verified=await verifyArchive(file,password);assert.equal(verified.files,512);report.checks.push({name:'512 synthetic files, 128 MiB original media, streamed integrity verification',result:'passed',originalBytes:bytes});
 let callbacks=0;await assert.rejects(verifyArchive(file,password,()=>{callbacks++;}),/64 MiB/);assert.equal(callbacks,0);report.checks.push({name:'Bounded recovery reader rejects oversized use before exposing any records',result:'passed'});
 const partial=path.join(root,'interrupted.pulsebackup');const script=`import {writeArchive} from ${JSON.stringify(new URL('./archive.mjs',import.meta.url).href)};async function* rows(){yield{type:'row',table:'sops',row:{id:'fixture-only'}};process.stdout.write('started\\n');await new Promise(()=>{});}await writeArchive(${JSON.stringify(partial)},${JSON.stringify(password)},rows());`;
 const child=spawn(process.execPath,['--input-type=module','-e',script],{stdio:['ignore','pipe','pipe']});await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);child.once('exit',()=>reject(Error('Fixture worker exited early')));});child.kill('SIGKILL');await new Promise(resolve=>child.once('exit',resolve));await assert.rejects(readFile(partial));await assert.rejects(verifyArchive(`${partial}.partial`,password));report.checks.push({name:'Force-killed writer never publishes a completed archive; encrypted partial cannot verify',result:'passed'});
 const recovered=path.join(root,'recovered');await mkdir(recovered);let restoredFiles=0,restoredBytes=0,output;
 try{for await(const record of verifiedRecords(file,password)){
  if(record.type==='file-start'){assert.equal(record.bucket,'step-photos');assert.match(record.path,/^synthetic\/\d+\.bin$/);output=await open(path.join(recovered,path.basename(record.path)),'wx',0o600);}
  if(record.type==='file-chunk'){const original=Buffer.from(record.data,'base64');await output.writeFile(original);restoredBytes+=original.length;}
  if(record.type==='file-end'){await output.sync();await output.close();output=undefined;restoredFiles++;}
 }}finally{if(output)await output.close();}
 assert.equal(restoredFiles,512);assert.equal(restoredBytes,bytes);
 for(let i=0;i<512;i++)assert.equal(digest(await readFile(path.join(recovered,`${i}.bin`))),hash);
 report.checks.push({name:'Two-pass authenticated recovery reconstructs 512 actual files totaling 128 MiB; every on-disk hash matches',result:'passed'});
 const original=await readFile(file);await assert.rejects(writeArchive(file,password,records()));assert.deepEqual(await readFile(file),original);report.checks.push({name:'Verified larger archive preserved on destination collision',result:'passed'});
 report.passed=true;
}catch(e){report.passed=false;report.failure=e.message;process.exitCode=1;}finally{await rm(root,{recursive:true,force:true});await writeFile(new URL('../../docs/local-backup-stress-report.json',import.meta.url),JSON.stringify(report,null,2));}
console.log(JSON.stringify(report,null,2));
