-- Authors may permanently remove their own WIs, without department or Quality approval.
-- Children are removed in the same transaction, so no orphaned steps or releases remain.
alter table public.quality_wi_steps drop constraint quality_wi_steps_wi_id_fkey,
 add constraint quality_wi_steps_wi_id_fkey foreign key(wi_id) references public.quality_work_instructions(id) on delete cascade;
alter table public.quality_wi_revisions drop constraint quality_wi_revisions_wi_id_fkey,
 add constraint quality_wi_revisions_wi_id_fkey foreign key(wi_id) references public.quality_work_instructions(id) on delete cascade;
alter table public.quality_wi_operations drop constraint quality_wi_operations_wi_id_fkey,
 add constraint quality_wi_operations_wi_id_fkey foreign key(wi_id) references public.quality_work_instructions(id) on delete cascade;

-- Revisions stay immutable while their parent exists. Only parent deletion may cascade.
create or replace function private.refuse_quality_wi_revision_change() returns trigger
language plpgsql set search_path='' as $$
begin
 if TG_OP='DELETE' and not exists(select 1 from public.quality_work_instructions where id=old.wi_id) then
  return old;
 end if;
 raise exception 'Published work instruction revisions are immutable.' using errcode='42501';
end;
$$;

create function public.delete_quality_wi(p_id uuid,p_workspace text,p_expected_version integer,p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_doc public.quality_work_instructions;
begin
 if auth.uid() is null or auth.uid() is distinct from p_actor then
  raise exception 'Account changed. Reload before deleting this work instruction.' using errcode='42501';
 end if;
 if p_expected_version is null or p_expected_version < 1 then
  raise exception 'A document version is required.' using errcode='22023';
 end if;
 select * into v_doc from public.quality_work_instructions where id=p_id for update;
 -- A retry after a lost response is already complete; no second deletion is performed.
 if not found then return jsonb_build_object('id',p_id,'version',p_expected_version); end if;
 if v_doc.workspace_id is distinct from p_workspace or v_doc.created_by is distinct from auth.uid() then
  raise exception 'You can only delete work instructions you authored.' using errcode='42501';
 end if;
 if v_doc.version <> p_expected_version then
  raise exception 'This work instruction changed. Refresh the list before deleting it.' using errcode='PT409';
 end if;
 delete from public.quality_work_instructions where id=p_id;
 return jsonb_build_object('id',v_doc.id,'version',v_doc.version);
end;
$$;
revoke all on function public.delete_quality_wi(uuid,text,integer,uuid) from public,anon;
grant execute on function public.delete_quality_wi(uuid,text,integer,uuid) to authenticated;
