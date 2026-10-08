-- Expose only the creator display name to readers of this WI, matching SOP attribution.
create function public.quality_wi_author_display_name(p_wi uuid) returns text
language sql stable security definer set search_path='' as $$
 select nullif(btrim(p.full_name),'')
 from public.quality_work_instructions w join public.profiles p on p.id=w.created_by
 where w.id=p_wi and auth.uid() is not null and public.can_read_quality_wi(w.id);
$$;
revoke all on function public.quality_wi_author_display_name(uuid) from public,anon;
grant execute on function public.quality_wi_author_display_name(uuid) to authenticated;

create or replace function public.load_quality_wi_document(p_id uuid,p_workspace text) returns jsonb
language sql stable security invoker set search_path='' as $$
 select to_jsonb(w)||jsonb_build_object('author_name',public.quality_wi_author_display_name(w.id),
  'department',jsonb_build_object('code',d.code,'name',d.name),
  'steps',coalesce((select jsonb_agg(to_jsonb(s) order by position,id) from public.quality_wi_steps s where s.wi_id=w.id and s.removed_at is null),'[]'::jsonb))
 from public.quality_work_instructions w join public.departments d on d.id=w.department_id where w.id=p_id and w.workspace_id=p_workspace;
$$;
