import { expect,it } from 'vitest';
import { metadataRestoreSql, sequenceState } from '../../../scripts/backup/recovery-metadata.mjs';
it('keeps large sequence values exact and preserves whether nextval has been called',async()=>{
 const queries:string[]=[];
 const client={query:async(sql:string)=>{queries.push(sql);return {rows:sql.includes('pg_class')?[{name:'counter"test'}]:[{value:'9007199254740993',is_called:false}]};}};
 const sequences=await sequenceState(client);
 const sql=metadataRestoreSql({version:1,schemaOwner:'owner',owners:[],routines:[],sequences});
 expect(sql).toContain(`setval('public."counter""test"'::regclass, 9007199254740993, false)`);
 expect(queries.every(q=>q.startsWith('select'))).toBe(true);
});
it('refuses malformed sequence values before producing restore SQL',()=>{
 expect(()=>metadataRestoreSql({version:1,schemaOwner:'owner',owners:[],routines:[],sequences:[{name:'counter',value:'1); DROP TABLE sops;',is_called:true}]})).toThrow('Invalid sequence');
});
it('restores managed application hooks and private storage policies',()=>{
 const sql=metadataRestoreSql({version:1,schemaOwner:'owner',owners:[],routines:[],sequences:[],managedTriggers:[{sql:'CREATE TRIGGER profile_hook AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_user()'}],storagePolicies:[{schemaname:'storage',tablename:'objects',policyname:'private photos',permissive:'PERMISSIVE',roles:['authenticated'],cmd:'SELECT',qual:"bucket_id = 'step-photos'",with_check:null}]});
 expect(sql).toContain('CREATE TRIGGER profile_hook');
 expect(sql).toContain('CREATE POLICY "private photos" ON storage."objects" AS PERMISSIVE FOR SELECT TO "authenticated" USING');
});
it('refuses policies outside the managed storage scope',()=>{
 expect(()=>metadataRestoreSql({version:1,schemaOwner:'owner',owners:[],routines:[],sequences:[],storagePolicies:[{schemaname:'auth',cmd:'SELECT',permissive:'PERMISSIVE'}]})).toThrow('Invalid storage policy');
});

it('preserves disabled and replica-only managed hooks and enum/domain owners',()=>{
 const sql=metadataRestoreSql({version:1,schemaOwner:'owner',owners:[],routines:[],sequences:[],typeOwners:[{name:'status',kind:'e',owner:'author'},{name:'label',kind:'d',owner:'author'}],managedTriggers:[{sql:'CREATE TRIGGER hook BEFORE INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.hook()',schema:'auth',table:'users',name:'hook',enabled:'D'},{sql:'CREATE TRIGGER replica_hook BEFORE INSERT ON storage.objects FOR EACH ROW EXECUTE FUNCTION public.hook()',schema:'storage',table:'objects',name:'replica_hook',enabled:'R'}]});
 expect(sql).toContain('ALTER TYPE public."status" OWNER TO "author";');
 expect(sql).toContain('ALTER DOMAIN public."label" OWNER TO "author";');
 expect(sql).toContain('ALTER TABLE "auth"."users" DISABLE TRIGGER "hook";');
 expect(sql).toContain('ALTER TABLE "storage"."objects" ENABLE REPLICA TRIGGER "replica_hook";');
});
