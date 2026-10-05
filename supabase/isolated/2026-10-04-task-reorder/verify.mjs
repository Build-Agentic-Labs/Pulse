// Retained isolated DB only. No start/reset/stop or production connection; keys never printed.
import { spawnSync } from 'node:child_process';
const result=spawnSync('npx',['--yes','supabase@2.119.0','status','--workdir','scratch/browser-db','-o','json'],{encoding:'utf8'});
if(result.status!==0) throw new Error('Start the retained isolated database first.');
const local=JSON.parse(result.stdout);
if(local.API_URL!=='http://127.0.0.1:56321'||!local.ANON_KEY||!local.SERVICE_ROLE_KEY) throw new Error('Wrong database identity.');
const run=spawnSync('npx',['vitest','run','--config','supabase/isolated/2026-10-04-task-reorder/vitest.config.ts'],{
 stdio:'inherit',env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:local.API_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY:local.ANON_KEY,E2E_SERVICE_ROLE_KEY:local.SERVICE_ROLE_KEY},
});
process.exitCode=run.status??1;
