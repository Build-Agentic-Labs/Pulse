-- Draft nominations do not create accounts, grant access, or send email.
create table public.sop_approver_nominations (
  sop_id text not null,
  department_id text not null,
  email text not null,
  position_title text not null,
  delivery_id uuid not null default gen_random_uuid(),
  delivered_at timestamptz,
  delivery_started_at timestamptz,
  created_by uuid not null default auth.uid(),
  primary key (sop_id, department_id),
  foreign key (sop_id, department_id) references public.sop_review_seats(sop_id, department_id) on delete cascade
);
alter table public.sop_approver_nominations enable row level security;
create policy nominations_read on public.sop_approver_nominations for select to authenticated
using (exists (select 1 from public.sops s where s.id=sop_id));
revoke all on public.sop_approver_nominations from anon, authenticated;
grant select on public.sop_approver_nominations to authenticated;
grant all on public.sop_approver_nominations to service_role;

create function public.stage_sop_approver(p_sop_id text, p_department_id text, p_email text, p_position_title text)
returns void language plpgsql security definer set search_path = '' as $$
declare doc public.sops%rowtype; dept public.departments%rowtype; normalized text := lower(btrim(p_email)); candidate uuid;
begin
  select * into doc from public.sops where id=p_sop_id and deleted_at is null for update;
  if doc.id is null or doc.status <> 'draft' or not public.can_edit_sop_content(p_sop_id) then
    raise exception 'You can only add approvers to a draft you can edit.';
  end if;
  select * into dept from public.departments where id=p_department_id;
  if dept.workspace_id is distinct from doc.workspace_id or dept.is_quality_gate then
    raise exception 'Choose a department in this organization. Quality final approvers are managed in settings.';
  end if;
  if normalized !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or not exists
    (select 1 from public.workspace_auto_join_domains r where r.workspace_id=doc.workspace_id and r.domain=split_part(normalized,'@',2)) then
    raise exception 'Enter a work email from an approved organization domain.';
  end if;
  if btrim(coalesce(p_position_title,''))='' or length(p_position_title)>120 then raise exception 'Enter a position title (120 characters max).'; end if;
  if exists (select 1 from public.workspace_revocations r where r.workspace_id=doc.workspace_id and r.email=normalized) then raise exception 'That address was removed by an admin.'; end if;
  select id into candidate from auth.users where lower(email)=normalized;
  if candidate=auth.uid() or candidate=doc.created_by or candidate=doc.submitted_by then raise exception 'The author or submitter cannot approve their own SOP.'; end if;
  if exists(select 1 from public.sop_review_seats where sop_id=p_sop_id and department_id=p_department_id and signer_id is not null)
     or exists(select 1 from public.sop_approver_nominations where sop_id=p_sop_id and department_id=p_department_id) then
    raise exception 'Remove the existing approver before adding a replacement.';
  end if;
  insert into public.sop_review_seats(sop_id,department_id,rasic,signer_id) values(p_sop_id,p_department_id,'responsible',null)
    on conflict(sop_id,department_id) do nothing;
  insert into public.sop_approver_nominations(sop_id,department_id,email,position_title)
    values(p_sop_id,p_department_id,normalized,btrim(p_position_title));
end $$;
revoke all on function public.stage_sop_approver(text,text,text,text) from public,anon;
grant execute on function public.stage_sop_approver(text,text,text,text) to authenticated;
-- Store the exact email only on the server so retries retain the same one-time link and body.
alter table public.sop_approver_nominations add constraint sop_approver_delivery_id_unique unique(delivery_id);
create table public.sop_approver_delivery_payloads (
  delivery_id uuid primary key references public.sop_approver_nominations(delivery_id) on delete cascade,
  content jsonb not null
);
alter table public.sop_approver_delivery_payloads enable row level security;
revoke all on public.sop_approver_delivery_payloads from public,anon,authenticated;
grant all on public.sop_approver_delivery_payloads to service_role;
