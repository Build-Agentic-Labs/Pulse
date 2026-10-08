-- Private conversion reservations; only the requester can inspect or finish a job.
-- An imported WI inherits the existing Quality read/edit rules and authenticated creator.
alter table public.quality_work_instructions add column conversion_source jsonb;
create table public.quality_wi_conversions (
 id uuid primary key,
 workspace_id text not null references public.workspaces(id),
 department_id text not null references public.departments(id),
 actor_id uuid not null references auth.users(id),
 source_path text not null,
 file_name text not null,
 status text not null default 'processing' check(status in ('processing','ready','imported','failed')),
 payload jsonb,
 error text,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '24 hours',
 imported_at timestamptz,
 constraint quality_wi_conversion_payload_limit check(octet_length(payload::text)<=1000000)
);
create index quality_wi_conversion_actor_time on public.quality_wi_conversions(actor_id,created_at desc);
alter table public.quality_wi_conversions enable row level security;
revoke all on public.quality_wi_conversions from public,anon,authenticated;
grant select on public.quality_wi_conversions to authenticated;
create policy quality_wi_conversion_read on public.quality_wi_conversions for select to authenticated
 using(actor_id=(select auth.uid()) and public.can_edit_quality_wi_department(department_id));

create function public.begin_quality_wi_conversion(p_id uuid,p_workspace text,p_department text,p_path text,p_name text) returns boolean
language plpgsql security definer set search_path='' as $$
declare v_job public.quality_wi_conversions;
begin
 if auth.uid() is null or not public.can_edit_quality_wi_department(p_department)
 or not exists(select 1 from public.departments where id=p_department and workspace_id=p_workspace) then
  raise exception 'You cannot convert a work instruction in this department.' using errcode='42501'; end if;
 if p_id is null or p_path is null or p_name is null or length(p_name) not between 1 and 255 or p_name !~* '\.docx$'
 or array_length(string_to_array(p_path,'/'),1)<>4
 or split_part(p_path,'/',1)<>'users' or split_part(p_path,'/',2)<>auth.uid()::text
 or split_part(p_path,'/',3)<>p_workspace or p_path !~* '\.docx$' then
  raise exception 'Invalid conversion source.' using errcode='22023'; end if;
 -- Serialize per-user claims across serverless instances, including rate accounting.
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,731));
 select * into v_job from public.quality_wi_conversions where id=p_id;
 if found then
  if (v_job.actor_id,v_job.workspace_id,v_job.department_id,v_job.source_path,v_job.file_name)
    is distinct from (auth.uid(),p_workspace,p_department,p_path,p_name) then
   raise exception 'This conversion belongs to another request.' using errcode='42501'; end if;
  return false;
 end if;
 if (select count(*) from public.quality_wi_conversions where actor_id=auth.uid() and created_at>now()-interval '5 minutes')>=3 then
  raise exception 'Too many conversions. Wait a few minutes and try again.' using errcode='P0001'; end if;
 if exists(select 1 from public.quality_work_instructions where id=p_id) then
  raise exception 'The document id is already in use.' using errcode='22023'; end if;
 insert into public.quality_wi_conversions(id,workspace_id,department_id,actor_id,source_path,file_name)
 values(p_id,p_workspace,p_department,auth.uid(),p_path,p_name);
 return true;
end $$;

-- Only canonical reserved object names are permitted before the WI exists.
create function public.quality_wi_conversion_image_access(p_name text,p_write boolean) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(
  select 1 from public.quality_wi_conversions j,
   lateral jsonb_array_elements(coalesce(j.payload->'uploads','[]'::jsonb)) a
  where j.actor_id=auth.uid() and j.expires_at>now()
  and public.can_edit_quality_wi_department(j.department_id)
  and (not p_write or j.status='processing')
  and a->>'storagePath'=p_name
  and p_name=j.workspace_id||'/'||j.id::text||'/'||(a->>'stepId')||'/'||(a->>'id')||'.jpg'
 );
$$;
create policy quality_wi_conversion_images_insert on storage.objects for insert to authenticated
 with check(bucket_id='quality-wi-images' and public.quality_wi_conversion_image_access(name,true));
create policy quality_wi_conversion_images_read on storage.objects for select to authenticated
 using(bucket_id='quality-wi-images' and public.quality_wi_conversion_image_access(name,false));

create function public.prepare_quality_wi_conversion(p_id uuid,p_payload jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare j public.quality_wi_conversions; a jsonb; s jsonb;
begin
 select * into j from public.quality_wi_conversions where id=p_id for update;
 if not found or auth.uid() is null or j.actor_id<>auth.uid() or not public.can_edit_quality_wi_department(j.department_id)
 or j.status<>'processing' or j.expires_at<=now() then raise exception 'Conversion is unavailable.' using errcode='42501'; end if;
 if j.payload is not null then
  if j.payload is distinct from p_payload then raise exception 'Conversion data already saved.' using errcode='22023'; end if;
  return;
 end if;
 if jsonb_typeof(p_payload) is distinct from 'object' or jsonb_typeof(p_payload->'steps') is distinct from 'array'
 or jsonb_array_length(p_payload->'steps') not between 1 and 150
 or jsonb_typeof(p_payload->'uploads') is distinct from 'array' or jsonb_array_length(p_payload->'uploads')>190
 or jsonb_typeof(p_payload->'title') is distinct from 'string' or length(btrim(p_payload->>'title')) not between 1 and 300
 or jsonb_typeof(p_payload->'purpose') is distinct from 'string' or jsonb_typeof(p_payload->'responsibilities') is distinct from 'string'
 or jsonb_typeof(p_payload->'source') is distinct from 'object'
 or jsonb_typeof(p_payload->'source'->'metadata') is distinct from 'object'
 or jsonb_typeof(p_payload->'source'->'warnings') is distinct from 'array'
 or length(coalesce(p_payload->>'purpose',''))>12000 or length(coalesce(p_payload->>'responsibilities',''))>12000 then
  raise exception 'Invalid converted document.' using errcode='22023'; end if;
 for a in select value from jsonb_array_elements(p_payload->'uploads') loop
  if jsonb_typeof(a) is distinct from 'object' or jsonb_typeof(a->'name') is distinct from 'string' or length(a->>'name') not between 1 and 255 or (a->>'id')::uuid is null or (a->>'stepId')::uuid is null
   or a->>'storagePath' is distinct from j.workspace_id||'/'||j.id::text||'/'||(a->>'stepId')||'/'||(a->>'id')||'.jpg'
   or coalesce((a->>'width')::integer,0) not between 1 and 2000 or coalesce((a->>'height')::integer,0) not between 1 and 2000 then
   raise exception 'Invalid imported image.' using errcode='22023'; end if;
 end loop;
 for s in select value from jsonb_array_elements(p_payload->'steps') loop
  if jsonb_typeof(s->'title') is distinct from 'string' or jsonb_typeof(s->'instruction') is distinct from 'string' or (s->>'id')::uuid is null or length(btrim(coalesce(s->>'title',''))) not between 1 and 300
   or length(btrim(coalesce(s->>'instruction',''))) not between 1 and 12000 then raise exception 'Invalid imported step.' using errcode='22023'; end if;
  if s->'image' is not null and s->'image'<>'null'::jsonb and not exists(
   select 1 from jsonb_array_elements(p_payload->'uploads') u(value) where u.value->>'stepId'=s->>'id'
    and u.value = s->'image') then
   raise exception 'Unreserved step image.' using errcode='22023'; end if;
 end loop;
 if (select count(distinct v.value->>'id') from jsonb_array_elements(p_payload->'steps') v(value))<>jsonb_array_length(p_payload->'steps') then
  raise exception 'Duplicate imported steps.' using errcode='22023'; end if;
 if (select count(distinct v.value->>'storagePath') from jsonb_array_elements(p_payload->'uploads') v(value))<>jsonb_array_length(p_payload->'uploads') then
  raise exception 'Duplicate imported images.' using errcode='22023'; end if;
 update public.quality_wi_conversions set payload=p_payload where id=p_id;
end $$;

create function public.finish_quality_wi_conversion(p_id uuid,p_error text default null) returns void
language plpgsql security definer set search_path='' as $$
declare j public.quality_wi_conversions;
begin
 select * into j from public.quality_wi_conversions where id=p_id for update;
 if not found or auth.uid() is null or j.actor_id<>auth.uid() or not public.can_edit_quality_wi_department(j.department_id)
 then raise exception 'Conversion is unavailable.' using errcode='42501'; end if;
 if j.status<>'processing' then return; end if;
 if p_error is not null then update public.quality_wi_conversions set status='failed',error=left(p_error,500) where id=p_id;return;end if;
 if j.expires_at<=now() or j.payload is null or exists(select 1 from jsonb_array_elements(j.payload->'uploads') a where not exists(
  select 1 from storage.objects o where bucket_id='quality-wi-images' and o.name=a->>'storagePath' and o.owner_id=auth.uid()::text)) then
  raise exception 'Conversion images have not finished saving.' using errcode='22023'; end if;
 update public.quality_wi_conversions set status='ready' where id=p_id;
end $$;

create function public.import_quality_wi_conversion(p_id uuid,p_title text,p_purpose text,p_responsibilities text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.quality_wi_conversions; s jsonb; n integer:=0;
begin
 select * into j from public.quality_wi_conversions where id=p_id for update;
 if not found or auth.uid() is null or j.actor_id<>auth.uid() or not public.can_edit_quality_wi_department(j.department_id)
 then raise exception 'Conversion is unavailable.' using errcode='42501'; end if;
 if j.status='imported' then
  if not exists(select 1 from public.quality_work_instructions where id=p_id and created_by=auth.uid()) then
   raise exception 'This imported work instruction was deleted.' using errcode='22023'; end if;
  return jsonb_build_object('id',p_id);
 end if;
 if j.status<>'ready' or j.expires_at<=now() then raise exception 'Convert the source again before creating a draft.' using errcode='22023'; end if;
 if p_title is null or length(btrim(p_title)) not between 1 and 300 or p_purpose is null or length(p_purpose)>12000
 or p_responsibilities is null or length(p_responsibilities)>12000 then raise exception 'Check the imported document fields.' using errcode='22023'; end if;
 if exists(select 1 from jsonb_array_elements(j.payload->'uploads') a where not exists(
  select 1 from storage.objects where bucket_id='quality-wi-images' and name=a->>'storagePath' and owner_id=auth.uid()::text)) then
  raise exception 'An imported image is unavailable. Convert the source again.' using errcode='22023'; end if;
 insert into public.quality_work_instructions(id,workspace_id,department_id,created_by,title,purpose,responsibilities,conversion_source)
 values(p_id,j.workspace_id,j.department_id,auth.uid(),btrim(p_title),p_purpose,p_responsibilities,j.payload->'source');
 for s in select value from jsonb_array_elements(j.payload->'steps') loop
  n:=n+1;
  insert into public.quality_wi_steps(id,wi_id,position,title,instruction,image)
  values((s->>'id')::uuid,p_id,n,s->>'title',s->>'instruction',nullif(s->'image','null'::jsonb));
 end loop;
 update public.quality_wi_conversions set status='imported',imported_at=now() where id=p_id;
 return jsonb_build_object('id',p_id);
end $$;
revoke all on function public.begin_quality_wi_conversion(uuid,text,text,text,text),public.quality_wi_conversion_image_access(text,boolean),public.prepare_quality_wi_conversion(uuid,jsonb),public.finish_quality_wi_conversion(uuid,text),public.import_quality_wi_conversion(uuid,text,text,text) from public,anon;
grant execute on function public.begin_quality_wi_conversion(uuid,text,text,text,text),public.quality_wi_conversion_image_access(text,boolean),public.prepare_quality_wi_conversion(uuid,jsonb),public.finish_quality_wi_conversion(uuid,text),public.import_quality_wi_conversion(uuid,text,text,text) to authenticated;
