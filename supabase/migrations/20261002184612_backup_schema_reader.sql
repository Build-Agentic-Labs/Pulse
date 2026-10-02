-- pg_dump schema-only still requires ACCESS SHARE locks, hence table SELECT.
-- This separate role cannot bypass RLS; excluded sensitive rows are always denied.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
CREATE ROLE pulse_backup_schema_reader NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT CONNECT ON DATABASE postgres TO pulse_backup_schema_reader;
GRANT USAGE ON SCHEMA public TO pulse_backup_schema_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO pulse_backup_schema_reader;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO pulse_backup_schema_reader;
ALTER ROLE pulse_backup_schema_reader SET default_transaction_read_only=on;
ALTER ROLE pulse_backup_schema_reader SET statement_timeout='30s';
DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['workspace_integrations','sop_approver_delivery_payloads','sop_submission_locks','push_subscriptions','transactional_emails','email_deliveries'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=name AND c.relrowsecurity) THEN
      RAISE EXCEPTION 'Sensitive table RLS prerequisite missing';
    END IF;
    EXECUTE format('CREATE POLICY pulse_backup_schema_denies_rows ON public.%I AS RESTRICTIVE FOR SELECT TO pulse_backup_schema_reader USING (false)',name);
  END LOOP;
END $$;
COMMIT;
