-- Future writes only: no backfill, no changes to existing titles or assignments.
begin;
-- Verify this migration never rewrites existing business records.
lock table public.sops, public.sop_review_seats, public.sop_approver_nominations,
  public.department_members, public.workspace_access_grants, public.sop_job_titles in share mode;
create temporary table job_title_preservation on commit drop as
select 'sops' name, to_jsonb(t) row from public.sops t
union all select 'seats', to_jsonb(t) from public.sop_review_seats t
union all select 'nominations', to_jsonb(t) from public.sop_approver_nominations t
union all select 'members', to_jsonb(t) from public.department_members t
union all select 'grants', to_jsonb(t) from public.workspace_access_grants t
union all select 'titles', to_jsonb(t) from public.sop_job_titles t;

create or replace function private.normalize_job_title(p_title text)
returns text language plpgsql immutable set search_path = '' as $$
declare title text := regexp_replace(coalesce(p_title, ''), '^\s+|\s+$', '', 'g');
begin
  if title ~ E'[\n\r\t]' then
    raise exception 'Enter a single-line job title (60 characters max).';
  end if;
  title := regexp_replace(title, '\s+', ' ', 'g');
  if title = '' or char_length(title) > 60 or title !~ '^[[:alpha:]]' or title ~ '[^[:alnum:] /&().,\-]' then
    raise exception 'Enter a valid job title (60 characters max).';
  end if;
  return title;
end $$;
revoke all on function private.normalize_job_title(text) from public, anon, authenticated;

-- Trigger-only: permissions for the parent write still apply. Publishing its title is part
-- of that same transaction, including writes made by invitation/redemption functions.
create or replace function private.save_job_title_vocabulary()
returns trigger language plpgsql security definer set search_path = '' as $$
declare ws text; title text; entry jsonb; entries jsonb := '[]'::jsonb; previous_entries jsonb := '[]'::jsonb;
begin
  if tg_table_name = 'sop_job_titles' then
    if tg_op = 'UPDATE' and new.name is not distinct from old.name then return new; end if;
    new.name := private.normalize_job_title(new.name);
    return new;
  elsif tg_table_name = 'workspace_access_grants' then
    if tg_op = 'UPDATE' then
      if new.department_access is not distinct from old.department_access then return new; end if;
      previous_entries := coalesce(old.department_access, '[]'::jsonb);
    end if;
    for entry in select value from jsonb_array_elements(new.department_access) loop
      -- Leave historical entries untouched when another department's access is edited.
      if exists(select 1 from jsonb_array_elements(previous_entries) previous
        where previous->>'department_id' = entry->>'department_id'
          and previous->>'position_title' is not distinct from entry->>'position_title') then
        entries := entries || jsonb_build_array(entry);
        continue;
      end if;
      if coalesce(btrim(entry->>'position_title'), '') <> '' then
        title := private.normalize_job_title(entry->>'position_title');
        entry := jsonb_set(entry, '{position_title}', to_jsonb(title));
        insert into public.sop_job_titles(workspace_id, name) values(new.workspace_id, title)
          on conflict (workspace_id, lower(btrim(name))) do nothing;
      end if;
      entries := entries || jsonb_build_array(entry);
    end loop;
    new.department_access := entries;
    return new;
  else
    if tg_op = 'UPDATE' and new.position_title is not distinct from old.position_title then return new; end if;
    -- Existing membership creation paths may omit the optional title.
    if tg_table_name = 'department_members' and tg_op = 'INSERT' and coalesce(new.position_title, '') = '' then return new; end if;
    title := private.normalize_job_title(new.position_title);
    select workspace_id into ws from public.departments where id = new.department_id;
    insert into public.sop_job_titles(workspace_id, name) values(ws, title)
      on conflict (workspace_id, lower(btrim(name))) do nothing;
    new.position_title := title;
    return new;
  end if;
end $$;
revoke all on function private.save_job_title_vocabulary() from public, anon, authenticated;

create trigger save_job_title_vocabulary before insert or update of position_title
  on public.department_members for each row execute function private.save_job_title_vocabulary();
create trigger save_job_title_vocabulary before insert or update of position_title
  on public.sop_approver_nominations for each row execute function private.save_job_title_vocabulary();
create trigger save_job_title_vocabulary before insert or update of department_access
  on public.workspace_access_grants for each row execute function private.save_job_title_vocabulary();
create trigger normalize_job_title before insert or update of name
  on public.sop_job_titles for each row execute function private.save_job_title_vocabulary();

do $$
begin
  if exists (
    with current_rows as (
      select 'sops' name, to_jsonb(t) row from public.sops t
      union all select 'seats', to_jsonb(t) from public.sop_review_seats t
      union all select 'nominations', to_jsonb(t) from public.sop_approver_nominations t
      union all select 'members', to_jsonb(t) from public.department_members t
      union all select 'grants', to_jsonb(t) from public.workspace_access_grants t
      union all select 'titles', to_jsonb(t) from public.sop_job_titles t
    )
    (select * from job_title_preservation except all select * from current_rows)
    union all
    (select * from current_rows except all select * from job_title_preservation)
  ) then raise exception 'Job title migration changed existing records'; end if;
end $$;
commit;
