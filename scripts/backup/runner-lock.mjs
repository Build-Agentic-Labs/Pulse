import {mkdir,readFile,writeFile,unlink,rmdir} from 'node:fs/promises';
import path from 'node:path';
const validId=value=>typeof value==='string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
/** Local job metadata only. Never removes an archive, status or business file. */
export async function acquireRunnerLock(root,id,owner){
 if(!validId(id)||!validId(owner))throw Error('Invalid backup lock identity.');
 const directory=path.join(root,'runner.lock');
 await mkdir(directory,{mode:0o700});
 try{await writeFile(path.join(directory,'owner.json'),JSON.stringify({id,owner}),{flag:'wx',mode:0o600});}
 catch(error){await rmdir(directory).catch(()=>{});throw error;}
}
export async function ownsRunnerLock(root,id,owner){
 try{const record=JSON.parse(await readFile(path.join(root,'runner.lock','owner.json'),'utf8'));return validId(id)&&validId(owner)&&record.id===id&&record.owner===owner;}
 catch{return false;}
}
export async function releaseRunnerLock(root,id,owner){
 if(!await ownsRunnerLock(root,id,owner))return false;
 const directory=path.join(root,'runner.lock');
 await unlink(path.join(directory,'owner.json'));
 await rmdir(directory);
 return true;
}
