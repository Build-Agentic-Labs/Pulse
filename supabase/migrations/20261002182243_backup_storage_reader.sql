-- Dedicated JWT role: reads Storage only; no login or application role inheritance.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';
CREATE ROLE pulse_backup_storage_reader NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT USAGE ON SCHEMA storage TO pulse_backup_storage_reader;
GRANT SELECT ON storage.objects, storage.buckets TO pulse_backup_storage_reader;
CREATE POLICY pulse_backup_storage_object_reads ON storage.objects FOR SELECT TO pulse_backup_storage_reader USING (true);
CREATE POLICY pulse_backup_storage_bucket_reads ON storage.buckets FOR SELECT TO pulse_backup_storage_reader USING (true);
GRANT pulse_backup_storage_reader TO authenticator;
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%'
    AND c.relkind IN ('r','p','v','m','f')
    AND (has_any_column_privilege('pulse_backup_storage_reader',c.oid,'INSERT') OR has_any_column_privilege('pulse_backup_storage_reader',c.oid,'UPDATE')
      OR has_table_privilege('pulse_backup_storage_reader',c.oid,'DELETE') OR has_table_privilege('pulse_backup_storage_reader',c.oid,'TRUNCATE'))
  ) OR EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE p.prosecdef AND p.prorettype NOT IN ('trigger'::regtype,'event_trigger'::regtype)
    AND n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'
    AND has_schema_privilege('pulse_backup_storage_reader',n.oid,'USAGE') AND has_function_privilege('pulse_backup_storage_reader',p.oid,'EXECUTE')
  ) OR EXISTS (
    SELECT 1 FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema'
    AND has_schema_privilege('pulse_backup_storage_reader',oid,'CREATE')
  ) THEN RAISE EXCEPTION 'Storage reader permission audit failed'; END IF;
END $$;
COMMIT;
