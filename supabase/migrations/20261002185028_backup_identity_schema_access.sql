-- Auth schema USAGE cannot be granted by the hosted postgres role.
-- An invoker view uses the reader's existing three column grants, without exposing credentials.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
CREATE SCHEMA pulse_backup;
REVOKE ALL ON SCHEMA pulse_backup FROM PUBLIC;
CREATE VIEW pulse_backup.auth_identities WITH (security_invoker=true)
AS SELECT id,email,created_at FROM auth.users;
REVOKE ALL ON pulse_backup.auth_identities FROM PUBLIC;
GRANT USAGE ON SCHEMA pulse_backup TO pulse_backup_reader;
GRANT SELECT ON pulse_backup.auth_identities TO pulse_backup_reader;
COMMIT;
