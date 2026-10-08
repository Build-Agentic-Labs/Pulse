-- Additive general WIs. No SOP/AWI writer replacement, data cleanup, or file deletion.
create table public.quality_work_instructions (
  id uuid primary key,
  workspace_id text not null references public.workspaces(id) on delete restrict,
  department_id text not null references public.departments(id) on delete restrict,
  title text not null default '',
  purpose text not null default '',
  responsibilities text not null default '',
  document_number text,
  version integer not null default 1 check(version>0),
  has_changes boolean not null default true,
  published_revision_id uuid,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quality_wi_title_length check(length(title)<=300)
);
create unique index quality_wi_number_unique on public.quality_work_instructions(workspace_id,lower(document_number)) where document_number is not null;
create index quality_wi_department_list on public.quality_work_instructions(workspace_id,department_id,updated_at desc,id);
create table public.quality_wi_steps (
  id uuid primary key,
  wi_id uuid not null references public.quality_work_instructions(id) on delete restrict,
  position integer not null check(position>0),
  title text not null default '',
  instruction text not null default '',
  image jsonb,
  removed_at timestamptz,
  constraint quality_wi_step_title_length check(length(title)<=300)
);
create unique index quality_wi_step_order on public.quality_wi_steps(wi_id,position) where removed_at is null;
create table public.quality_wi_revisions (
  id uuid primary key,
  wi_id uuid not null references public.quality_work_instructions(id) on delete restrict,
  revision_index integer not null check(revision_index>0),
  snapshot jsonb not null,
  change_description text not null check(length(btrim(change_description)) between 1 and 500),
  published_by uuid not null references auth.users(id) on delete restrict,
  published_at timestamptz not null default now(),
  unique(wi_id,revision_index)
);
alter table public.quality_work_instructions add foreign key(published_revision_id) references public.quality_wi_revisions(id) on delete restrict;
create table public.quality_wi_operations (
  id uuid primary key,
  wi_id uuid not null references public.quality_work_instructions(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict,
  request jsonb not null,
  result jsonb not null
);
create index quality_wi_operations_document on public.quality_wi_operations(wi_id);

create function public.can_edit_quality_wi_department(p_department text) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.departments d where d.id=p_department
   and public.has_org_tool_access(d.workspace_id,'edit'::public.access_level)
   and (public.is_department_member(d.id) or public.has_workspace_role(d.workspace_id,array['owner','admin']::public.workspace_role[])));
$$;
revoke all on function public.can_edit_quality_wi_department(text) from public,anon;
grant execute on function public.can_edit_quality_wi_department(text) to authenticated;
create function public.can_read_quality_wi(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.quality_work_instructions w where w.id=p_id
  and public.has_org_tool_access(w.workspace_id,'view'::public.access_level));
$$;
revoke all on function public.can_read_quality_wi(uuid) from public,anon;
grant execute on function public.can_read_quality_wi(uuid) to authenticated;

alter table public.quality_work_instructions enable row level security;
alter table public.quality_wi_steps enable row level security;
alter table public.quality_wi_revisions enable row level security;
alter table public.quality_wi_operations enable row level security;
revoke all on public.quality_work_instructions,public.quality_wi_steps,public.quality_wi_revisions,public.quality_wi_operations from public,anon,authenticated;
grant select on public.quality_work_instructions,public.quality_wi_steps,public.quality_wi_revisions to authenticated;
create policy quality_wi_read on public.quality_work_instructions for select to authenticated using(public.has_org_tool_access(workspace_id,'view'::public.access_level));
create policy quality_wi_steps_read on public.quality_wi_steps for select to authenticated using(public.can_read_quality_wi(wi_id));
create policy quality_wi_revisions_read on public.quality_wi_revisions for select to authenticated using(public.can_read_quality_wi(wi_id));

create function public.quality_wi_storage_access(p_name text,p_edit boolean) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and array_length(string_to_array(p_name,'/'),1)=4 and exists(
  select 1 from public.quality_work_instructions w join public.quality_wi_steps s on s.wi_id=w.id
  where w.workspace_id=split_part(p_name,'/',1) and w.id::text=split_part(p_name,'/',2) and s.id::text=split_part(p_name,'/',3)
  and case when p_edit then s.removed_at is null and public.can_edit_quality_wi_department(w.department_id)
    else public.has_org_tool_access(w.workspace_id,'view'::public.access_level) end);
$$;
revoke all on function public.quality_wi_storage_access(text,boolean) from public,anon;
grant execute on function public.quality_wi_storage_access(text,boolean) to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('quality-wi-images','quality-wi-images',false,12582912,array['image/jpeg','image/png','image/webp']);
create policy quality_wi_images_read on storage.objects for select to authenticated using(bucket_id='quality-wi-images' and public.quality_wi_storage_access(name,false));
create policy quality_wi_images_insert on storage.objects for insert to authenticated with check(bucket_id='quality-wi-images' and public.quality_wi_storage_access(name,true));
-- No UPDATE/DELETE policy: published references remain readable and uploads use new object ids.

create function public.create_quality_wi(p_id uuid,p_workspace text,p_department text,p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_doc public.quality_work_instructions;
begin
 if auth.uid() is null or auth.uid() is distinct from p_actor then raise exception 'Account changed. Your draft has been retained.' using errcode='42501'; end if;
 if not public.can_edit_quality_wi_department(p_department) or not exists(select 1 from public.departments where id=p_department and workspace_id=p_workspace) then
  raise exception 'You cannot create a work instruction in this department.' using errcode='42501';
 end if;
 insert into public.quality_work_instructions(id,workspace_id,department_id,created_by) values(p_id,p_workspace,p_department,auth.uid()) on conflict(id) do nothing;
 select * into v_doc from public.quality_work_instructions where id=p_id;
 if (v_doc.workspace_id,v_doc.department_id,v_doc.created_by) is distinct from (p_workspace,p_department,auth.uid()) then
  raise exception 'The draft id already belongs to another request.' using errcode='22023';
 end if;
 return jsonb_build_object('id',v_doc.id,'version',v_doc.version);
end;
$$;
revoke all on function public.create_quality_wi(uuid,text,text,uuid) from public,anon;
grant execute on function public.create_quality_wi(uuid,text,text,uuid) to authenticated;

create function public.edit_quality_wi(p_id uuid,p_expected_version integer,p_operation uuid,p_kind text,p_payload jsonb,p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 v_doc public.quality_work_instructions; v_old public.quality_wi_operations;
 v_request jsonb:=jsonb_build_object('version',p_expected_version,'kind',p_kind,'payload',p_payload);
 v_step uuid; v_position integer; v_order jsonb; v_item jsonb; v_result jsonb;
begin
 if auth.uid() is null or auth.uid() is distinct from p_actor then raise exception 'Account changed. Your draft has been retained.' using errcode='42501'; end if;
 select * into v_doc from public.quality_work_instructions where id=p_id for update;
 if not found or not public.can_edit_quality_wi_department(v_doc.department_id) then raise exception 'You cannot edit this work instruction.' using errcode='42501'; end if;
 if p_operation is null or p_expected_version is null or p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Invalid work instruction edit.' using errcode='22023'; end if;
 select * into v_old from public.quality_wi_operations where id=p_operation;
 if found then
  if (v_old.wi_id,v_old.actor_id,v_old.request) is distinct from (p_id,auth.uid(),v_request) then raise exception 'The operation id was reused.' using errcode='22023'; end if;
  return v_old.result;
 end if;
 if v_doc.version<>p_expected_version then raise exception 'This work instruction changed elsewhere. Your draft has been retained.' using errcode='40001'; end if;
 case p_kind
 when 'details' then
  if exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('title','purpose','responsibilities'))
    or exists(select 1 from jsonb_each(p_payload) where jsonb_typeof(value)<>'string') then raise exception 'Invalid document fields.' using errcode='22023'; end if;
  update public.quality_work_instructions set title=coalesce(p_payload->>'title',title),purpose=coalesce(p_payload->>'purpose',purpose),responsibilities=coalesce(p_payload->>'responsibilities',responsibilities) where id=p_id;
 when 'add_step' then
  v_step:=(p_payload->>'id')::uuid;
  select coalesce(max(position),0)+1 into v_position from public.quality_wi_steps where wi_id=p_id and removed_at is null;
  insert into public.quality_wi_steps(id,wi_id,position,title,instruction) values(v_step,p_id,v_position,coalesce(p_payload->>'title',''),coalesce(p_payload->>'instruction',''));
 when 'step','remove_step','image' then
  v_step:=(p_payload->>'id')::uuid;
  if not exists(select 1 from public.quality_wi_steps where id=v_step and wi_id=p_id and removed_at is null) then raise exception 'This step is no longer in the draft.' using errcode='40001'; end if;
  if p_kind='step' then
   if exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('id','title','instruction'))
    or exists(select 1 from jsonb_each(p_payload) where jsonb_typeof(value)<>'string') then raise exception 'Invalid step fields.' using errcode='22023'; end if;
   update public.quality_wi_steps set title=coalesce(p_payload->>'title',title),instruction=coalesce(p_payload->>'instruction',instruction) where id=v_step;
  elsif p_kind='remove_step' then
   update public.quality_wi_steps set removed_at=now() where id=v_step;
   -- Rows/assets are retained. Number gaps are harmless; reorder validates a full active set.
  else
   v_item:=p_payload->'image';
   if v_item is not null and v_item<>'null'::jsonb then
    if jsonb_typeof(v_item)<>'object' or coalesce((v_item->>'width')::integer,0)<1 or coalesce((v_item->>'height')::integer,0)<1
     or v_item->>'storagePath' is distinct from v_doc.workspace_id||'/'||p_id::text||'/'||v_step::text||'/'||(v_item->>'id')||'.jpg'
     or not exists(select 1 from storage.objects where bucket_id='quality-wi-images' and name=v_item->>'storagePath' and (owner_id=auth.uid()::text or (select image->>'storagePath' from public.quality_wi_steps where id=v_step)=v_item->>'storagePath')) then
      raise exception 'Save the image before attaching it to this step.' using errcode='22023';
    end if;
   end if;
   update public.quality_wi_steps set image=case when v_item is null or v_item='null'::jsonb then null else jsonb_build_object('id',v_item->>'id','name',coalesce(v_item->>'name','Step photo.jpg'),'storagePath',v_item->>'storagePath','width',(v_item->>'width')::integer,'height',(v_item->>'height')::integer,'annotations',v_item->'annotations') end where id=v_step;
  end if;
 when 'reorder' then
  v_order:=p_payload->'ids';
  if jsonb_typeof(v_order) is distinct from 'array' then raise exception 'Invalid step order.' using errcode='22023'; end if;
  if jsonb_array_length(v_order)<>(select count(*) from public.quality_wi_steps where wi_id=p_id and removed_at is null)
   or exists(select 1 from jsonb_array_elements_text(v_order) x where not exists(select 1 from public.quality_wi_steps s where s.id::text=x and s.wi_id=p_id and s.removed_at is null))
   or jsonb_array_length(v_order)<>(select count(distinct x) from jsonb_array_elements_text(v_order) x) then raise exception 'The step list changed. Your draft has been retained.' using errcode='40001'; end if;
  -- Park above all current numbers, then install the full intended ordering atomically.
  select coalesce(max(position),0)+jsonb_array_length(v_order)+1 into v_position from public.quality_wi_steps where wi_id=p_id;
  update public.quality_wi_steps set position=position+v_position where wi_id=p_id and removed_at is null;
  for v_item,v_position in select to_jsonb(value),ordinality::integer from jsonb_array_elements_text(v_order) with ordinality loop
   update public.quality_wi_steps set position=v_position where id=(v_item#>>'{}')::uuid and wi_id=p_id;
  end loop;
 else raise exception 'Unknown work instruction edit.' using errcode='22023';
 end case;
 update public.quality_work_instructions set version=version+1,has_changes=true,updated_at=now() where id=p_id returning * into v_doc;
 v_result:=jsonb_build_object('id',p_id,'version',v_doc.version,'operation',p_operation);
 insert into public.quality_wi_operations values(p_operation,p_id,auth.uid(),v_request,v_result);
 return v_result;
end;
$$;
revoke all on function public.edit_quality_wi(uuid,integer,uuid,text,jsonb,uuid) from public,anon;
grant execute on function public.edit_quality_wi(uuid,integer,uuid,text,jsonb,uuid) to authenticated;

create function public.publish_quality_wi(p_id uuid,p_expected_version integer,p_operation uuid,p_description text,p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 v_doc public.quality_work_instructions; v_old public.quality_wi_operations;
 v_request jsonb:=jsonb_build_object('version',p_expected_version,'description',p_description,'kind','publish');
 v_number text; v_code text; v_seq integer; v_revision integer; v_snapshot jsonb; v_result jsonb;
begin
 if auth.uid() is null or auth.uid() is distinct from p_actor then raise exception 'Account changed. Your draft has been retained.' using errcode='42501'; end if;
 select * into v_doc from public.quality_work_instructions where id=p_id for update;
 if not found or not public.can_edit_quality_wi_department(v_doc.department_id) then raise exception 'You cannot publish this work instruction.' using errcode='42501'; end if;
 if p_operation is null then raise exception 'A publish operation id is required.' using errcode='22023'; end if;
 select * into v_old from public.quality_wi_operations where id=p_operation;
 if found then
  if (v_old.wi_id,v_old.actor_id,v_old.request) is distinct from (p_id,auth.uid(),v_request) then raise exception 'The operation id was reused.' using errcode='22023'; end if;
  return v_old.result;
 end if;
 if p_expected_version is null or v_doc.version<>p_expected_version then raise exception 'This work instruction changed elsewhere. Your draft has been retained.' using errcode='40001'; end if;
 if not v_doc.has_changes then raise exception 'There are no changes to publish.' using errcode='22023'; end if;
 if length(btrim(coalesce(p_description,''))) not between 1 and 500 or btrim(v_doc.title)='' or btrim(v_doc.purpose)='' or btrim(v_doc.responsibilities)=''
  or not exists(select 1 from public.quality_wi_steps where wi_id=p_id and removed_at is null)
  or exists(select 1 from public.quality_wi_steps where wi_id=p_id and removed_at is null and (btrim(title)='' or btrim(instruction)='')) then
  raise exception 'Complete the title, purpose, responsibilities and every step before publishing.' using errcode='22023';
 end if;
 if exists(select 1 from public.quality_wi_steps s where s.wi_id=p_id and s.removed_at is null and s.image is not null and not exists(select 1 from storage.objects o where o.bucket_id='quality-wi-images' and o.name=s.image->>'storagePath')) then
  raise exception 'A step image is unavailable. Your draft has been retained.' using errcode='22023';
 end if;
 v_number:=v_doc.document_number;
 if v_number is null then
  select code into v_code from public.departments where id=v_doc.department_id and workspace_id=v_doc.workspace_id;
  loop
   insert into public.doc_number_counter(workspace_id,department_id,doc_type,next_seq) values(v_doc.workspace_id,v_doc.department_id,'WI',2)
    on conflict(workspace_id,department_id,doc_type) do update set next_seq=public.doc_number_counter.next_seq+1 returning next_seq-1 into v_seq;
   v_number:='WI-'||upper(v_code)||'-'||lpad(v_seq::text,greatest(3,length(v_seq::text)),'0');
   exit when not exists(select 1 from public.quality_work_instructions where workspace_id=v_doc.workspace_id and lower(document_number)=lower(v_number))
    and not exists(select 1 from public.sops where workspace_id=v_doc.workspace_id and lower(btrim(sop_number))=lower(v_number));
  end loop;
 end if;
 select coalesce(max(revision_index),0)+1 into v_revision from public.quality_wi_revisions where wi_id=p_id;
 select jsonb_build_object('title',v_doc.title,'purpose',v_doc.purpose,'responsibilities',v_doc.responsibilities,'documentNumber',v_number,'revisionIndex',v_revision,'revisionDate',to_char(now(),'YYYY-MM-DD'),'revisionDescription',p_description,
  'steps',jsonb_agg(jsonb_build_object('id',id,'title',title,'instruction',instruction,'image',image) order by position,id)) into v_snapshot from public.quality_wi_steps where wi_id=p_id and removed_at is null;
 insert into public.quality_wi_revisions values(p_operation,p_id,v_revision,v_snapshot,p_description,auth.uid(),now());
 update public.quality_work_instructions set document_number=v_number,published_revision_id=p_operation,version=version+1,has_changes=false,updated_at=now() where id=p_id returning * into v_doc;
 v_result:=jsonb_build_object('id',p_id,'version',v_doc.version,'operation',p_operation,'revisionId',p_operation,'documentNumber',v_number);
 insert into public.quality_wi_operations values(p_operation,p_id,auth.uid(),v_request,v_result);
 return v_result;
end;
$$;
revoke all on function public.publish_quality_wi(uuid,integer,uuid,text,uuid) from public,anon;
grant execute on function public.publish_quality_wi(uuid,integer,uuid,text,uuid) to authenticated;

create function private.refuse_quality_wi_revision_change() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Published work instruction revisions are immutable.' using errcode='42501'; end;
$$;
revoke all on function private.refuse_quality_wi_revision_change() from public,anon,authenticated;
create trigger quality_wi_revision_immutable before update or delete on public.quality_wi_revisions for each row execute function private.refuse_quality_wi_revision_change();

-- One MVCC statement reads document and steps consistently; caller RLS applies.
create function public.load_quality_wi_document(p_id uuid,p_workspace text) returns jsonb
language sql stable security invoker set search_path='' as $$
 select to_jsonb(w)||jsonb_build_object('department',jsonb_build_object('code',d.code,'name',d.name),
  'steps',coalesce((select jsonb_agg(to_jsonb(s) order by position,id) from public.quality_wi_steps s where s.wi_id=w.id and s.removed_at is null),'[]'::jsonb))
 from public.quality_work_instructions w join public.departments d on d.id=w.department_id where w.id=p_id and w.workspace_id=p_workspace;
$$;
revoke all on function public.load_quality_wi_document(uuid,text) from public,anon;
grant execute on function public.load_quality_wi_document(uuid,text) to authenticated;
