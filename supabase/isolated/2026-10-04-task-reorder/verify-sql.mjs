// Read-only definition check plus transaction-rolled-back pgTAP fixtures. No remote URL accepted.
import pg from 'pg';
import {readFileSync} from 'node:fs';
const db=new pg.Client({connectionString:'postgresql://postgres:postgres@127.0.0.1:56322/postgres'});
await db.connect();
try {
 const sql=readFileSync(new URL('./20261005022000_atomic_task_reorder.sql',import.meta.url),'utf8');
 for(const [name,signature] of [['reorder_scenario_tasks','text,text,uuid,jsonb,jsonb,uuid'],['load_task_reorder_baseline','text,text,uuid']]) {
 const expected=sql.slice(sql.indexOf(`create function public.${name}(`)).split('as $$')[1].split('$$;')[0].trim();
 const {rows}=await db.query('select prosrc from pg_proc where oid=$1::regprocedure',[`public.${name}(${signature})`]);
 if(rows[0]?.prosrc.trim()!==expected) throw new Error(`Installed isolated ${name} differs from the review candidate.`);
 }
 await db.query('begin');
 await db.query('create extension if not exists pgtap with schema extensions; set search_path=public,extensions');
 const results=await db.query(readFileSync(new URL('./task-reorder.test.sql',import.meta.url),'utf8'));
 const lines=results.flatMap(result=>result.rows.flatMap(row=>Object.values(row).filter(value=>typeof value==='string'&&/^(ok |not ok |#|1\.\.)/.test(value))));
 console.log(lines.join('\n'));
 if(lines.some(line=>line.startsWith('not ok ')||line.startsWith('# Looks like')))process.exitCode=1;
}finally{await db.query('rollback');await db.end()}
