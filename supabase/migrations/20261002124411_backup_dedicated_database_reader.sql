CREATE ROLE pulse_backup_reader NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS;
ALTER ROLE pulse_backup_reader SET default_transaction_read_only=on;
ALTER ROLE pulse_backup_reader SET statement_timeout='30s';
GRANT CONNECT ON DATABASE postgres TO pulse_backup_reader;
GRANT USAGE ON SCHEMA public,auth,storage TO pulse_backup_reader;
DO $grants$ DECLARE t record; BEGIN
 FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('workspace_integrations','sop_approver_delivery_payloads','sop_submission_locks','push_subscriptions','transactional_emails','email_deliveries') LOOP
  EXECUTE format('GRANT SELECT ON TABLE public.%I TO pulse_backup_reader',t.tablename);
 END LOOP;
END $grants$;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO pulse_backup_reader;
GRANT SELECT(id,email,created_at) ON auth.users TO pulse_backup_reader;
GRANT SELECT(bucket_id,name,updated_at,metadata) ON storage.objects TO pulse_backup_reader;
GRANT SELECT(id,name,public,file_size_limit,allowed_mime_types) ON storage.buckets TO pulse_backup_reader;
