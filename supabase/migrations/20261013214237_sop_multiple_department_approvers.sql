-- Each approval assignment has its own identity. Existing assignments and signatures
-- retain their department/person routing; no review or signature history is rewritten.
-- Hold writes while comparing complete before/after rows in this transaction.
lock table public.sops, public.sop_review_seats, public.sop_approver_nominations
  in share row exclusive mode;
create temporary table sop_approver_upgrade_before on commit drop as
  select 'sops'::text as source, to_jsonb(s) as row_data from public.sops s
  union all select 'seats', to_jsonb(s) from public.sop_review_seats s
  union all select 'nominations', to_jsonb(n) from public.sop_approver_nominations n;

alter table public.sop_review_seats add column id uuid not null default gen_random_uuid();
alter table public.sop_approver_nominations add column seat_id uuid;
update public.sop_approver_nominations n set seat_id = s.id
from public.sop_review_seats s where s.sop_id=n.sop_id and s.department_id=n.department_id;
alter table public.sop_approver_nominations
  drop constraint sop_approver_nominations_sop_id_department_id_fkey,
  drop constraint sop_approver_nominations_pkey,
  alter column seat_id set not null;
alter table public.sop_review_seats drop constraint sop_review_seats_pkey;
alter table public.sop_review_seats
  add primary key (id),
  add constraint sop_review_seats_person_key unique (sop_id, department_id, signer_id),
  add constraint sop_review_seats_identity_key unique (id, sop_id, department_id);
alter table public.sop_approver_nominations
  add primary key (seat_id),
  add constraint sop_approver_nominations_seat_fkey foreign key (seat_id, sop_id, department_id)
    references public.sop_review_seats(id, sop_id, department_id) on delete cascade;
create index sop_review_seats_sop_idx on public.sop_review_seats(sop_id);

-- Preserve every existing authorization/content/review gate. Resolve the signing
-- assignment by department AND authenticated person, never an arbitrary first row.
do $$
declare definition text; original text;
begin
  original := pg_get_functiondef('public.sign_sop(text,text,text,text,text,text,integer)'::regprocedure);
  definition := replace(original,
    'where st.sop_id = p_sop and st.department_id = p_seat_department;',
    'where st.sop_id = p_sop and st.department_id = p_seat_department and st.signer_id = auth.uid();');
  if definition = original then raise exception 'Missing sign_sop assignment lookup'; end if;
  original := definition;
  definition := replace(definition,
    'where st.sop_id = p_sop and st.department_id = v_obj.seat_department_id;',
    'where st.sop_id = p_sop and st.department_id = v_obj.seat_department_id and st.signer_id = v_obj.signer_id;');
  if definition = original then raise exception 'Missing sign_sop objection lookup'; end if;
  execute definition;

  original := pg_get_functiondef('public.enforce_seat_freeze()'::regprocedure);
  definition := replace(original, '  if v_status = ''draft'' then',
    $patch$  if tg_op = 'UPDATE' and new.id is distinct from old.id then
    raise exception 'An approval assignment identity cannot change';
  end if;
  if v_status = 'draft' then$patch$);
  if definition = original then raise exception 'Missing assignment identity guard anchor'; end if;
  execute definition;
end $$;

-- Existing three-argument admin calls still work for a single assignment. Multiple
-- assignments require an explicit seat id and can never update the whole department.
do $$
declare definition text; original text;
begin
  original := pg_get_functiondef('public.reassign_sop_seat(text,text,uuid)'::regprocedure);
  definition := replace(original, 'p_new_signer uuid)', 'p_new_signer uuid, p_seat_id uuid DEFAULT NULL)');
  if definition = original then raise exception 'Missing reassignment function signature'; end if;
  definition := replace(definition, '  select * into st from public.sop_review_seats',
    $patch$  if p_seat_id is null and (select count(*) from public.sop_review_seats
      where sop_id=p_sop and department_id=p_department) > 1 then
    raise exception 'Choose the individual approval assignment to reassign';
  end if;
  select * into st from public.sop_review_seats$patch$);
  definition := replace(definition,
    'where sop_id = p_sop and department_id = p_department;',
    'where sop_id = p_sop and department_id = p_department and (p_seat_id is null or id = p_seat_id);');
  definition := replace(definition,
    'jsonb_build_object(''department_id'', p_department,',
    'jsonb_build_object(''seat_id'', st.id, ''department_id'', p_department,');
  execute definition;
end $$;
drop function public.reassign_sop_seat(text,text,uuid);
revoke all on function public.reassign_sop_seat(text,text,uuid,uuid) from public,anon;
grant execute on function public.reassign_sop_seat(text,text,uuid,uuid) to authenticated;

-- Pending invitations belong to an individual assignment as well. Staging remains
-- draft-only and sends no email; delivery still occurs through the submission flow.
create or replace function public.stage_sop_approver(p_sop_id text, p_department_id text, p_email text, p_position_title text)
returns void language plpgsql security definer set search_path = '' as $$
declare doc public.sops%rowtype; dept public.departments%rowtype;
  normalized text := lower(btrim(p_email)); candidate uuid; assignment_id uuid;
begin
  select * into doc from public.sops where id=p_sop_id and deleted_at is null for update;
  if doc.id is null or doc.status <> 'draft' or not public.can_edit_sop_content(p_sop_id) then
    raise exception 'You can only add approvers to a draft you can edit.';
  end if;
  select * into dept from public.departments where id=p_department_id;
  if dept.id is null or dept.workspace_id is distinct from doc.workspace_id or dept.is_quality_gate then
    raise exception 'Choose a department in this organization. Quality final approvers are managed in settings.';
  end if;
  if normalized is null or normalized !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or not exists
    (select 1 from public.workspace_auto_join_domains r where r.workspace_id=doc.workspace_id and r.domain=split_part(normalized,'@',2)) then
    raise exception 'Enter a work email from an approved organization domain.';
  end if;
  if btrim(coalesce(p_position_title,''))='' or length(p_position_title)>120 then raise exception 'Enter a position title (120 characters max).'; end if;
  if exists (select 1 from public.workspace_revocations r where r.workspace_id=doc.workspace_id and r.email=normalized) then raise exception 'That address was removed by an admin.'; end if;
  select id into candidate from auth.users where lower(email)=normalized;
  if candidate=auth.uid() or candidate=doc.created_by or candidate=doc.submitted_by then raise exception 'The author or submitter cannot approve their own SOP.'; end if;
  if exists(select 1 from public.sop_review_seats where sop_id=p_sop_id and signer_id=candidate)
     or exists(select 1 from public.sop_approver_nominations where sop_id=p_sop_id and email=normalized) then
    raise exception 'This person is already assigned to approve this SOP.';
  end if;
  select s.id into assignment_id from public.sop_review_seats s
    where s.sop_id=p_sop_id and s.department_id=p_department_id and s.signer_id is null
      and not exists(select 1 from public.sop_approver_nominations n where n.seat_id=s.id)
    order by s.id limit 1;
  if assignment_id is null then
    insert into public.sop_review_seats(sop_id,department_id,rasic,signer_id)
      values(p_sop_id,p_department_id,'responsible',null) returning id into assignment_id;
  end if;
  insert into public.sop_approver_nominations(seat_id,sop_id,department_id,email,position_title)
    values(assignment_id,p_sop_id,p_department_id,normalized,btrim(p_position_title));
end $$;
revoke all on function public.stage_sop_approver(text,text,text,text) from public,anon;
grant execute on function public.stage_sop_approver(text,text,text,text) to authenticated;

-- Only the newly generated assignment IDs may differ. Any loss, reassignment,
-- content/status change or invitation change aborts and rolls back the migration.
do $$
begin
  if exists (
    with after_rows as (
      select 'sops'::text as source, to_jsonb(s) as row_data from public.sops s
      union all select 'seats', to_jsonb(s) - 'id' from public.sop_review_seats s
      union all select 'nominations', to_jsonb(n) - 'seat_id' from public.sop_approver_nominations n
    ), differences as (
      (select * from sop_approver_upgrade_before except all select * from after_rows)
      union all
      (select * from after_rows except all select * from sop_approver_upgrade_before)
    )
    select 1 from differences
  ) then
    raise exception 'Approval upgrade must preserve every existing SOP, assignment and invitation';
  end if;
end $$;
