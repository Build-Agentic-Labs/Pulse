-- Step recovery records, targeted step delete/restore, and diff-based step tool changes.
--
-- Additive only: one new table, new functions, guard triggers on the new table. No existing row,
-- column, policy, grant, file or storage object is changed or removed. No compatibility guard on
-- existing tables is introduced here (see docs/tool-catalog-consistency-design.md §5b, awaiting
-- approval).
--
-- Why: the phone's "Restore Step" re-saved a whole planner snapshot, which deleted every step of
-- every task in the scenario (cascading away all step tools, photos and exploded views) and
-- reverted teammates' newer steps and edits (docs/restore-step-design.md). These functions delete
-- exactly one user-selected step, recording it first in the same transaction, and restore exactly
-- that record.

-- Recovery records. No foreign keys on purpose: a record must outlive the rows it describes, and
-- nothing here deletes or expires records.
create table if not exists public.deleted_manufacturing_steps (
  id text primary key default gen_random_uuid()::text,
  project_id text not null,
  task_id text not null,
  step_id text not null,
  step jsonb not null,
  tools jsonb not null default '[]'::jsonb,
  photos jsonb not null default '[]'::jsonb,
  exploded_views jsonb not null default '[]'::jsonb,
  step_custom_fields jsonb not null default '{}'::jsonb,
  deleted_by uuid,
  deleted_at timestamptz not null default now(),
  restored_by uuid,
  restored_at timestamptz
);

create index if not exists deleted_manufacturing_steps_step_idx
  on public.deleted_manufacturing_steps (step_id, deleted_at desc);
create index if not exists deleted_manufacturing_steps_task_idx
  on public.deleted_manufacturing_steps (task_id);

-- Readable with view access to the project. No insert/update/delete policies: records are written
-- only by the SECURITY DEFINER functions below, so a client can never forge one (a forged photo
-- storage path would otherwise be restorable into a readable step_photos row).
alter table public.deleted_manufacturing_steps enable row level security;
drop policy if exists "deleted steps readable with project view" on public.deleted_manufacturing_steps;
create policy "deleted steps readable with project view"
  on public.deleted_manufacturing_steps for select to authenticated
  using (public.has_project_access(project_id, 'view'::public.access_level));

-- Grants are not durable locally (seed.sql re-grants), so triggers are the real guard.
revoke insert, update, delete, truncate on public.deleted_manufacturing_steps from anon, authenticated;

-- SECURITY INVOKER on purpose: current_user must be the calling role.
create or replace function private.refuse_client_recovery_record_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    raise exception 'Deleted-step recovery records are kept and cannot be changed or removed directly.'
      using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists deleted_steps_refuse_client_change on public.deleted_manufacturing_steps;
create trigger deleted_steps_refuse_client_change
  before insert or update or delete on public.deleted_manufacturing_steps
  for each row execute function private.refuse_client_recovery_record_change();

drop trigger if exists deleted_steps_refuse_client_truncate on public.deleted_manufacturing_steps;
create trigger deleted_steps_refuse_client_truncate
  before truncate on public.deleted_manufacturing_steps
  for each statement execute function private.refuse_client_recovery_record_change();

-- Moves the given steps one sequence at a time, in an order that never collides with
-- UNIQUE (task_id, sequence). Only sequence changes; content is untouched.
create or replace function private.shift_step_sequences(p_task_id text, p_from integer, p_delta integer)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id text;
begin
  for v_id in
    select id from public.manufacturing_steps
     where task_id = p_task_id and sequence >= p_from
     order by case when p_delta > 0 then -sequence else sequence end
  loop
    update public.manufacturing_steps set sequence = sequence + p_delta where id = v_id;
  end loop;
end;
$$;

create or replace function private.task_step_positions(p_task_id text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'sequence', s.sequence, 'version', s.version) order by s.sequence), '[]'::jsonb)
    from public.manufacturing_steps s
   where s.task_id = p_task_id;
$$;

-- Deletes exactly one step. The complete recovery record (step row, its tools, photos, exploded
-- views and its step-keyed task custom fields) is written first, in the same transaction.
-- Later steps move up one position (as the app always did), with their content unchanged.
create or replace function public.delete_manufacturing_step(p_step_id text, p_expected_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_step public.manufacturing_steps;
  v_project_id text;
  v_record public.deleted_manufacturing_steps;
  v_record_id text;
begin
  if v_user_id is null then
    raise exception 'Sign in to delete a step.' using errcode = '42501';
  end if;
  if p_step_id is null or btrim(p_step_id) = '' then
    raise exception 'Choose a step to delete.' using errcode = '22023';
  end if;

  select * into v_step from public.manufacturing_steps where id = p_step_id;
  if not found then
    -- A retry after a lost response: report the open record instead of failing.
    select * into v_record
      from public.deleted_manufacturing_steps
     where step_id = p_step_id and restored_at is null
     order by deleted_at desc
     limit 1;
    if found and public.has_project_access(v_record.project_id, 'edit'::public.access_level) then
      return jsonb_build_object(
        'record_id', v_record.id, 'task_id', v_record.task_id, 'step_id', p_step_id,
        'already_deleted', true, 'steps', private.task_step_positions(v_record.task_id));
    end if;
    raise exception 'This step no longer exists.' using errcode = 'P0002';
  end if;

  v_project_id := public.task_project_id(v_step.task_id);
  if v_project_id is null or not public.has_project_access(v_project_id, 'edit'::public.access_level) then
    raise exception 'You do not have permission to delete this step.' using errcode = '42501';
  end if;

  -- Serialize with other step changes on this task, then re-read under the lock.
  perform 1 from public.manufacturing_steps where task_id = v_step.task_id order by sequence for update;
  select * into v_step from public.manufacturing_steps where id = p_step_id;
  if not found then
    raise exception 'This step no longer exists.' using errcode = 'P0002';
  end if;
  if p_expected_version is not null and v_step.version <> p_expected_version then
    raise exception 'This step changed on another device. Reload and try again.' using errcode = '40001';
  end if;

  insert into public.deleted_manufacturing_steps (
    project_id, task_id, step_id, step, tools, photos, exploded_views, step_custom_fields, deleted_by
  )
  values (
    v_project_id,
    v_step.task_id,
    v_step.id,
    to_jsonb(v_step),
    coalesce((select jsonb_agg(to_jsonb(t) order by t.sequence, t.id) from public.step_tools t where t.step_id = v_step.id), '[]'::jsonb),
    coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from public.step_photos p where p.step_id = v_step.id), '[]'::jsonb),
    coalesce((select jsonb_agg(to_jsonb(v) order by v.id) from public.step_exploded_views v where v.step_id = v_step.id), '[]'::jsonb),
    coalesce((
      select jsonb_strip_nulls(jsonb_build_object('stepPartMentions', t.custom_fields -> 'stepPartMentions' -> v_step.id))
        from public.tasks t where t.id = v_step.task_id
    ), '{}'::jsonb),
    v_user_id
  )
  returning id into v_record_id;

  -- Read by the step_tools write fence once it exists; harmless before.
  perform set_config('pulse.tool_write', 'rpc', true);
  -- The FK cascade removes exactly this step's tools, photos and exploded views. Storage objects
  -- are not touched, so the restore below can point at them again.
  delete from public.manufacturing_steps where id = v_step.id;
  perform private.shift_step_sequences(v_step.task_id, v_step.sequence + 1, -1);

  return jsonb_build_object(
    'record_id', v_record_id, 'task_id', v_step.task_id, 'step_id', v_step.id,
    'already_deleted', false, 'steps', private.task_step_positions(v_step.task_id));
end;
$$;

-- Restores exactly one recovery record: the step at its original position (later steps move down
-- one), and the same tool, photo and exploded-view rows it had. Nothing else is written, except
-- the step's task custom-field entries where they are missing. Restoring twice is a no-op.
create or replace function public.restore_manufacturing_step(p_record_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_record public.deleted_manufacturing_steps;
  v_target integer;
  v_max integer;
  v_mentions jsonb;
begin
  if v_user_id is null then
    raise exception 'Sign in to restore a step.' using errcode = '42501';
  end if;

  select * into v_record from public.deleted_manufacturing_steps where id = p_record_id for update;
  if not found then
    raise exception 'There is nothing to restore.' using errcode = 'P0002';
  end if;
  if not public.has_project_access(v_record.project_id, 'edit'::public.access_level) then
    raise exception 'You do not have permission to restore this step.' using errcode = '42501';
  end if;

  if v_record.restored_at is not null
     or exists (select 1 from public.manufacturing_steps where id = v_record.step_id) then
    return jsonb_build_object('record_id', v_record.id, 'step_id', v_record.step_id, 'task_id', v_record.task_id,
      'restored', false, 'already_restored', true, 'steps', private.task_step_positions(v_record.task_id));
  end if;

  if not exists (select 1 from public.tasks where id = v_record.task_id)
     or public.task_project_id(v_record.task_id) is distinct from v_record.project_id then
    raise exception 'This process was deleted, so the step cannot be restored.' using errcode = 'P0002';
  end if;

  perform 1 from public.manufacturing_steps where task_id = v_record.task_id order by sequence for update;
  select coalesce(max(sequence), 0) into v_max from public.manufacturing_steps where task_id = v_record.task_id;
  v_target := least((v_record.step ->> 'sequence')::integer, v_max + 1);
  perform private.shift_step_sequences(v_record.task_id, v_target, 1);

  insert into public.manufacturing_steps
  select * from jsonb_populate_record(null::public.manufacturing_steps,
    jsonb_set(v_record.step, '{sequence}', to_jsonb(v_target)));

  perform set_config('pulse.tool_write', 'rpc', true);
  insert into public.step_tools select * from jsonb_populate_recordset(null::public.step_tools, v_record.tools);
  insert into public.step_photos select * from jsonb_populate_recordset(null::public.step_photos, v_record.photos);
  insert into public.step_exploded_views select * from jsonb_populate_recordset(null::public.step_exploded_views, v_record.exploded_views);

  v_mentions := v_record.step_custom_fields -> 'stepPartMentions';
  if v_mentions is not null then
    update public.tasks t
       set custom_fields = jsonb_set(
             coalesce(t.custom_fields, '{}'::jsonb),
             '{stepPartMentions}',
             coalesce(t.custom_fields -> 'stepPartMentions', '{}'::jsonb) || jsonb_build_object(v_record.step_id, v_mentions))
     where t.id = v_record.task_id
       and (t.custom_fields -> 'stepPartMentions' -> v_record.step_id) is null;
  end if;

  update public.deleted_manufacturing_steps
     set restored_at = now(), restored_by = v_user_id
   where id = v_record.id;

  return jsonb_build_object('record_id', v_record.id, 'step_id', v_record.step_id, 'task_id', v_record.task_id,
    'restored', true, 'already_restored', false, 'steps', private.task_step_positions(v_record.task_id));
end;
$$;

-- Adds and removes named tools on one step. Diff-based and idempotent: a caller only ever affects
-- the names it lists, so a stale caller cannot wipe or resurrect other assignments. Same access rule
-- as the step_tools policies (edit access to the task's project); RLS also applies (INVOKER).
create or replace function public.apply_step_tool_changes(
  p_task_id text,
  p_step_id text,
  p_add text[],
  p_remove text[]
)
returns text[]
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_project_id text;
  v_name text;
  v_next integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in to change step tools.' using errcode = '42501';
  end if;
  if coalesce(array_length(p_add, 1), 0) + coalesce(array_length(p_remove, 1), 0) > 200 then
    raise exception 'Too many tool changes at once.' using errcode = '22023';
  end if;

  v_project_id := public.task_project_id(p_task_id);
  if v_project_id is null or not public.has_project_access(v_project_id, 'edit'::public.access_level) then
    raise exception 'You do not have permission to change tools on this step.' using errcode = '42501';
  end if;
  perform 1 from public.manufacturing_steps where id = p_step_id and task_id = p_task_id for update;
  if not found then
    raise exception 'This step no longer exists.' using errcode = 'P0002';
  end if;

  perform set_config('pulse.tool_write', 'rpc', true);

  delete from public.step_tools
   where step_id = p_step_id
     and lower(tool_name) in (
       select lower(regexp_replace(name, '^[[:space:]]+|[[:space:]]+$', '', 'g')) from unnest(coalesce(p_remove, '{}'::text[])) as name
     );

  foreach v_name in array coalesce(p_add, '{}'::text[]) loop
    v_name := regexp_replace(coalesce(v_name, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g');
    continue when v_name = '';
    if length(v_name) > 200 then
      raise exception 'Tool names must be 200 characters or fewer.' using errcode = '22023';
    end if;
    -- The client builds ids per UTF-16 unit; characters outside the BMP would get a different id.
    if v_name ~ '[\U00010000-\U0010FFFF]' then
      raise exception 'Tool names cannot contain emoji or other rare symbols.' using errcode = '22023';
    end if;
    select coalesce(max(sequence), 0) + 1 into v_next from public.step_tools where step_id = p_step_id;
    insert into public.step_tools (id, task_id, step_id, tool_name, sequence)
    -- The client's stepToolId (src/domain/supabase-planner.ts): 'tool-' + safe(stepId) + '-' +
    -- safe(lower(trim(name))), safe replacing [^a-zA-Z0-9._-] with '-'. Same format, so the client's
    -- id-based reads and removals keep working. Inlined: this function runs as the caller, who has
    -- no access to the private schema.
    values (
      'tool-' || regexp_replace(p_step_id, '[^a-zA-Z0-9._-]', '-', 'g') || '-'
        || regexp_replace(lower(v_name), '[^a-zA-Z0-9._-]', '-', 'g'),
      p_task_id, p_step_id, v_name, v_next)
    on conflict do nothing;
  end loop;

  return array(
    select tool_name from public.step_tools where step_id = p_step_id order by sequence, tool_name
  );
end;
$$;

revoke all on function public.delete_manufacturing_step(text, integer) from public, anon;
revoke all on function public.restore_manufacturing_step(text) from public, anon;
revoke all on function public.apply_step_tool_changes(text, text, text[], text[]) from public, anon;
grant execute on function public.delete_manufacturing_step(text, integer) to authenticated;
grant execute on function public.restore_manufacturing_step(text) to authenticated;
grant execute on function public.apply_step_tool_changes(text, text, text[], text[]) to authenticated;
revoke all on function private.shift_step_sequences(text, integer, integer) from public, anon, authenticated;
revoke all on function private.task_step_positions(text) from public, anon, authenticated;
