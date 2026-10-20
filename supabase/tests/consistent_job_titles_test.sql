-- Transactional integration checks; fixtures and all writes are rolled back.
begin;
select '1..1';
do $$
declare
  ws text := 'title-test-' || gen_random_uuid()::text;
  dept text := gen_random_uuid()::text;
  sop text := gen_random_uuid()::text;
  actor uuid;
  seats_before bigint;
begin
  -- Reuse only an identity, never its existing memberships or assignments.
  select id into actor from auth.users limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', actor, 'role', 'authenticated')::text, true);
  insert into public.workspaces(id, name) values(ws, 'Temporary title verification');
  insert into public.workspace_auto_join_domains(domain, workspace_id) values('title-check.invalid', ws);
  if actor is null then
    actor := gen_random_uuid();
    insert into auth.users(id,aud,role,email) values(actor,'authenticated','authenticated','actor@title-check.invalid');
    perform set_config('request.jwt.claims', json_build_object('sub', actor, 'role', 'authenticated')::text, true);
  end if;
  insert into public.workspace_members(workspace_id, user_id, role) values(ws, actor, 'owner')
    on conflict (workspace_id,user_id) do update set role='owner';
  insert into public.departments(id, workspace_id, code, name) values(dept, ws, 'MFG', 'Title checks');
  insert into public.department_members(department_id,user_id,dept_role,position_title)
    values(dept,actor,'author','  Calibration   Lead  ');
  if not exists(select 1 from public.sop_job_titles where workspace_id=ws and name='Calibration Lead')
     or not exists(select 1 from public.department_members where department_id=dept and position_title='Calibration Lead')
    then raise exception 'Membership did not save normalized title and vocabulary together'; end if;

  insert into public.sops(id,workspace_id,sop_number,title,document,status,created_by,department_id)
    values(sop,ws,'TEST-001','Temporary title checks','{}','draft',actor,dept);
  perform public.stage_sop_approver(sop,dept,'title-check-a@title-check.invalid','Custom Inspector');
  if not exists(select 1 from public.sop_job_titles where workspace_id=ws and name='Custom Inspector')
    then raise exception 'Staged title missing from vocabulary'; end if;
  perform public.stage_sop_approver(sop,dept,'title-check-b@title-check.invalid','custom inspector');
  if (select count(*) from public.sop_job_titles where workspace_id=ws and lower(name)='custom inspector') <> 1
    then raise exception 'Case variants created duplicate vocabulary entries'; end if;

  select count(*) into seats_before from public.sop_review_seats where sop_id=sop;
  begin
    perform public.stage_sop_approver(sop,dept,'title-check-invalid@title-check.invalid',repeat('A',61));
    raise exception 'Invalid title was accepted';
  exception when raise_exception then
    if sqlerrm = 'Invalid title was accepted' then raise; end if;
  end;
  if (select count(*) from public.sop_review_seats where sop_id=sop) <> seats_before
    or exists(select 1 from public.sop_approver_nominations where sop_id=sop and email='title-check-invalid@title-check.invalid')
    then raise exception 'Failed title left a partial assignment'; end if;

  insert into public.workspace_access_grants(workspace_id,email,role,granted_by,department_access)
    values(ws,'title-check-grant@anacorp.com','editor',actor,
      jsonb_build_array(jsonb_build_object('department_id',dept,'role','reviewer','position_title','Invitation Specialist')));
  if not exists(select 1 from public.sop_job_titles where workspace_id=ws and name='Invitation Specialist')
    then raise exception 'Workspace invitation title missing from vocabulary'; end if;

  update public.sop_job_titles set name='Renamed Vocabulary Only' where workspace_id=ws and name='Calibration Lead';
  if (select position_title from public.department_members where department_id=dept and user_id=actor) <> 'Calibration Lead'
    then raise exception 'Vocabulary rename rewrote existing membership'; end if;
  if has_function_privilege('authenticated','private.save_job_title_vocabulary()','EXECUTE')
    or has_function_privilege('anon','private.save_job_title_vocabulary()','EXECUTE')
    then raise exception 'Internal trigger function is callable'; end if;
end $$;
select 'ok 1 - titles save atomically across membership, SOP and workspace invitations';
rollback;
