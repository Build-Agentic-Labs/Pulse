import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ sql: [] as string[], table: "", fetched: false, missingFile: false, ended: false, sequenceDrift: false, sequenceReads: 0, sequenceWritable: false, privilegedRoutine: false, schemaBypass:false, missingSchemaProtection:false, fileCount:1 }));
vi.mock("node:child_process", () => ({ execFile: (_file: string, _args: string[], _options: unknown, callback: (e: null, out: string, err: string) => void) => callback(null, "-- disposable schema fixture", "") }));
vi.mock("pg", () => ({ default: { Client: class {
  async connect() {} async end() { state.ended = true; }
  async query(sql: string) {
    state.sql.push(sql);
    if (sql.includes("pg_get_expr(p.polqual")) return {rows:state.missingSchemaProtection?[]:['workspace_integrations','sop_approver_delivery_payloads','sop_submission_locks','push_subscriptions','transactional_emails','email_deliveries'].map(relname=>({relname}))};
    if (sql.includes("has_function_privilege")) return {rows:state.privilegedRoutine?[{proname:"unsafe_fixture"}]:[]};
    if(sql.includes("has_sequence_privilege")) return {rows:state.sequenceWritable?[{relname:"fixture_counter"}]:[]};
    if(sql.includes("relkind='S'") && sql.includes("order by")) return {rows:[{name:"fixture_counter"}]};
    if(sql.includes("last_value::text")) return {rows:[{value:state.sequenceDrift && state.sequenceReads++>0?"42":"41",is_called:true}]};
    if(sql.startsWith('select rolbypassrls'))return {rows:[{rolbypassrls:state.schemaBypass,rolinherit:false}]};
    if (sql.includes("pg_roles")) return { rows: [{ rolsuper: false, rolcreaterole: false, rolcreatedb: false }] };
    if (sql.includes("information_schema")) return { rows: [] };
    if (sql.includes("pg_export_snapshot")) return { rows: [{ id: "fixture-snapshot" }] };
    if (sql.includes("pg_tables")) return { rows: CRITICAL.map((tablename) => ({ tablename })) };
    if (sql.startsWith("DECLARE")) { state.table = /public\."([^"]+)"/.exec(sql)![1]; state.fetched = false; }
    if (sql.startsWith("FETCH")) {
      if (state.fetched) return { rows: [] }; state.fetched = true;
      return { rows: state.table === "step_photos" ? [{ row: { id: "photo-1", step_id: "step-1", storage_path: "fixture.jpg" } }] : state.table === "sops" ? [{ row: { id: "sop-1", title: "SOP fixture" } }] : [] };
    }
    if (sql.includes("storage.objects")) return { rows: state.missingFile ? [] : Array.from({length:state.fileCount},(_,i)=>({ bucket_id: "step-photos", name:i ? `fixture-${i}.jpg` : "fixture.jpg", updated_at: "fixture", metadata: { size: 5 } })) };
    if (sql.includes("storage.buckets")) return { rows: [{ id: "step-photos", public: false }] };
    if (sql.includes("auth.users") || sql.includes('pulse_backup.auth_identities')) return { rows: [{ id: "user-1", email: "fixture@example.test" }] };
    return { rows: [] };
  }
} } }));
import { CRITICAL, productionRecords, assertSourceBinding, rowStorageReferences, verifiedConnection } from "../../../scripts/backup/source.mjs";
afterEach(() => { vi.unstubAllGlobals(); state.sql = []; state.missingFile = false; state.ended = false; state.sequenceDrift = false; state.sequenceReads = 0; state.sequenceWritable = false; state.privilegedRoutine = false; state.schemaBypass=false;state.missingSchemaProtection=false;state.fileCount=1; });
const config = { databaseUrl: "postgres://fixture:fixture@db.fixture.supabase.co/fixture", schemaDatabaseUrl:"postgres://schema_fixture:fixture@db.fixture.supabase.co/fixture", storageUrl: "https://fixture.supabase.co", storageReadToken: "fixture-read-token", anonKey: "fixture-anon", pgDump: "fixture-pg-dump" };
it("exports database and original media using only read SQL and GET", async () => {
  const fetch = vi.fn(async (_input: unknown, _init: unknown) => { expect(state.sql).toContain("COMMIT"); return new Response(new Uint8Array([1, 2, 3, 4, 5])); }); vi.stubGlobal("fetch", fetch);
  const records = []; for await (const record of productionRecords(config, () => {})) records.push(record);
  expect(state.sql).toContain("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  expect(state.sql).toContain("SET LOCAL row_security = off");
  expect(state.sql.some((sql) => /^(INSERT|UPDATE|DELETE|TRUNCATE|CREATE|ALTER|DROP)\b/i.test(sql))).toBe(false);
  expect(records).toContainEqual(expect.objectContaining({ type: "row", table: "sops" }));
  expect(records).toContainEqual(expect.objectContaining({ type: "file-end", bytes: 5 }));
  expect(fetch.mock.calls[0][1]).toMatchObject({ method: "GET", redirect: "error" });
  expect(state.ended).toBe(true);
});
it("fails before downloading when a live document references a missing file", async () => {
  state.missingFile = true; const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  await expect((async () => { for await (const record of productionRecords(config, () => {})) void record; })()).rejects.toThrow("missing storage file");
  expect(fetch).not.toHaveBeenCalled(); expect(state.ended).toBe(true);
});

it("refuses sequence drift instead of reporting a complete export",async()=>{
 state.sequenceDrift=true;vi.stubGlobal("fetch",async()=>new Response(new Uint8Array([1,2,3,4,5])));
 await expect((async()=>{for await(const r of productionRecords(config,()=>{})) void r;})()).rejects.toThrow("Sequence counters changed");
 expect(state.ended).toBe(true);
});
it("refuses an export role that can advance counters",async()=>{
 state.sequenceWritable=true;const fetch=vi.fn();vi.stubGlobal("fetch",fetch);
 await expect((async()=>{for await(const r of productionRecords(config,()=>{})) void r;})()).rejects.toThrow("advance sequence");
 expect(fetch).not.toHaveBeenCalled();expect(state.ended).toBe(true);
});

it("binds database and storage to the same project for direct and pooled connections", () => {
  expect(assertSourceBinding(config)).toBe("fixture");
  expect(assertSourceBinding({...config,databaseUrl:"postgres://backup_reader.fixture:secret@aws-0-us-east-1.pooler.supabase.com/postgres"})).toBe("fixture");
  expect(()=>assertSourceBinding({...config,databaseUrl:"postgres://backup_reader.other:secret@aws-0-us-east-1.pooler.supabase.com/postgres"})).toThrow("do not match");
  expect(()=>assertSourceBinding({...config,storageUrl:"https://other.supabase.co"})).toThrow("do not match");
  expect(()=>assertSourceBinding({...config,databaseUrl:"postgres://fixture:secret@localhost/postgres"})).toThrow("do not match");
});
it("checks reference files, problem evidence and frozen release originals with empty URLs", () => {
  expect(rowStorageReferences("work_instruction_references",{storage_path:"manual.pdf"})).toEqual(["wi-reference-files/manual.pdf"]);
  expect(rowStorageReferences("problem_evidence",{storage_path:"evidence.jpg"})).toEqual(["problem-evidence/evidence.jpg"]);
  expect(rowStorageReferences("work_instruction_releases",{content:{cards:[{photo:{storagePath:"released/original.jpg",url:""}}]}})).toEqual(["step-photos/released/original.jpg"]);
  expect(rowStorageReferences("step_photos",{storage_path:"removed.jpg",deleted_at:"2026-10-02"})).toEqual([]);
});

it("cannot weaken certificate verification through connection URL options", () => {
 const connection = verifiedConnection({...config,databaseUrl:config.databaseUrl+"?sslmode=disable&sslcert=unsafe&sslrootcert=unsafe"});
 expect(connection.ssl.rejectUnauthorized).toBe(true);
 expect(connection.connectionString).not.toContain("ssl");
 expect(()=>assertSourceBinding({...config,databaseUrl:"postgres://backup.fixture:secret@aws-0-us-east-1.pooler.supabase.com:6543/postgres"})).toThrow("port 5432");
});

it("refuses inherited privileged routine access without invoking the routine",async()=>{
 state.privilegedRoutine=true;
 await expect((async()=>{for await(const r of productionRecords(config,()=>{})) void r;})()).rejects.toThrow("privileged routines");
 expect(state.sql.some(sql=>sql.includes("unsafe_fixture("))).toBe(false);
 expect(state.ended).toBe(true);
});
it("refuses schema credentials that bypass sensitive-row protections",async()=>{
 state.schemaBypass=true;
 await expect((async()=>{for await(const r of productionRecords(config,()=>{})) void r;})()).rejects.toThrow("must not bypass");
});
it("refuses absent restrictive schema policies before file downloads",async()=>{
 state.missingSchemaProtection=true;const fetch=vi.fn();vi.stubGlobal("fetch",fetch);
 await expect((async()=>{for await(const r of productionRecords(config,()=>{})) void r;})()).rejects.toThrow("restrictive sensitive-row protection");
 expect(fetch).not.toHaveBeenCalled();
});
it("requires separate live schema credentials",async()=>{
 await expect((async()=>{for await(const r of productionRecords({...config,schemaDatabaseUrl:undefined},()=>{})) void r;})()).rejects.toThrow("schema-read connection");
});
it('bounds concurrent originals at four and preserves inventory order',async()=>{
 state.fileCount=5;let active=0,maximum=0;
 vi.stubGlobal('fetch',async()=>{active++;maximum=Math.max(maximum,active);await new Promise(r=>setTimeout(r,5));active--;return new Response(new Uint8Array(5));});
 const files=[];for await(const r of productionRecords(config,()=>{}))if(r.type==='file-start' && 'path' in r)files.push(r.path);
 expect(maximum).toBe(4);expect(files).toEqual(['fixture.jpg','fixture-1.jpg','fixture-2.jpg','fixture-3.jpg','fixture-4.jpg']);
});
it('refuses oversized response bodies instead of unbounded small-file buffering',async()=>{
 vi.stubGlobal('fetch',async()=>new Response(new Uint8Array(8*1024*1024+1)));
 await expect((async()=>{for await(const r of productionRecords(config,()=>{}))void r;})()).rejects.toThrow('bounded download allowance');
});
