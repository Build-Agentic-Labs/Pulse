alter table public.awi_masters add column category text not null default ''
  check (length(category) <= 80 and category = btrim(category));

-- Only this scoped routine can edit master metadata. Never grant general master UPDATE.
create or replace function public.update_awi_metadata(
  p_master_id uuid, p_document_number text, p_category text,
  p_expected_number text, p_expected_category text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_master public.awi_masters%rowtype;
  v_number text := upper(btrim(coalesce(p_document_number, '')));
  v_category text := btrim(coalesce(p_category, ''));
  v_task text;
begin
  select task_id into v_task from public.awi_masters where id = p_master_id;
  if auth.uid() is null or v_task is null or not public.has_project_access(public.task_project_id(v_task), 'edit'::public.access_level) then
    raise exception 'You do not have permission to edit this AWI.' using errcode = '42501';
  end if;
  if length(v_number) not between 1 and 64 or length(v_category) > 80 then
    raise exception 'Enter an AWI number (up to 64 characters) and category (up to 80 characters).' using errcode = '22023';
  end if;
  -- Match procedure save lock order: task before master (task triggers update master).
  perform id from public.tasks where id = v_task for update;
  select * into strict v_master from public.awi_masters where id = p_master_id for update;
  if v_master.document_number is distinct from p_expected_number or v_master.category is distinct from p_expected_category then
    raise exception 'AWI details changed in another session. Reload before editing.' using errcode = '40001';
  end if;
  if v_master.document_number = v_number and v_master.category = v_category then return; end if;
  update public.awi_masters set document_number = v_number, category = v_category,
    draft_updated_at = clock_timestamp() where id = p_master_id;
  if v_master.document_number <> v_number then
    update public.tasks set manufacturing_code = v_number,
      custom_fields = coalesce(custom_fields, '{}'::jsonb) || jsonb_build_object('awiDocumentNumber', v_number)
      where id = v_task;
  end if;
end $$;
revoke all on function public.update_awi_metadata(uuid,text,text,text,text) from public, anon;
grant execute on function public.update_awi_metadata(uuid,text,text,text,text) to authenticated;
