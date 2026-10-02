-- REVIEW ONLY: never executed by the backup runner.
-- Run inside an administrator-owned transaction after isolated validation.
-- Preserve effective EXECUTE for every existing role before removing PUBLIC.
-- New roles will require explicit grants for these routines.
DO $backup_access$
DECLARE routine record; existing_role record;
BEGIN
  CREATE TEMP TABLE backup_execute_before ON COMMIT DROP AS
    SELECT p.oid AS routine_oid,r.oid AS role_oid,has_function_privilege(r.oid,p.oid,'EXECUTE') AS allowed
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN pg_roles r
    WHERE n.nspname='public' AND p.prosecdef
      AND p.prorettype NOT IN ('trigger'::regtype,'event_trigger'::regtype)
      AND EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE');
  FOR routine IN SELECT DISTINCT routine_oid, routine_oid::regprocedure AS identity FROM backup_execute_before LOOP
    FOR existing_role IN SELECT r.rolname FROM pg_roles r JOIN backup_execute_before b ON b.role_oid=r.oid WHERE b.routine_oid=routine.routine_oid AND b.allowed LOOP
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I',routine.identity,existing_role.rolname);
    END LOOP;
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC',routine.identity);
  END LOOP;
  IF EXISTS (SELECT 1 FROM backup_execute_before b WHERE b.allowed IS DISTINCT FROM has_function_privilege(b.role_oid,b.routine_oid,'EXECUTE')) THEN
    RAISE EXCEPTION 'Existing routine access changed; abort backup access preparation';
  END IF;
END
$backup_access$;
