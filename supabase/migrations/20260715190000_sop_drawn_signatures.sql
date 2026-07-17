-- Reusable handwritten signature profile plus an immutable snapshot on each formal SOP signature.
-- The profile belongs only to its user. A copied snapshot prevents a later redraw from changing
-- the appearance of an SOP that was already signed.

create table if not exists public.user_signature_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  signature_strokes jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint signature_strokes_array check (jsonb_typeof(signature_strokes) = 'array'),
  constraint signature_strokes_size check (octet_length(signature_strokes::text) <= 100000)
);

alter table public.user_signature_profiles enable row level security;

revoke all on table public.user_signature_profiles from public, anon;
grant select, insert, update, delete on table public.user_signature_profiles to authenticated;

drop policy if exists user_signature_profiles_read_own on public.user_signature_profiles;
create policy user_signature_profiles_read_own
on public.user_signature_profiles for select
to authenticated
using (user_id = auth.uid());

drop policy if exists user_signature_profiles_insert_own on public.user_signature_profiles;
create policy user_signature_profiles_insert_own
on public.user_signature_profiles for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists user_signature_profiles_update_own on public.user_signature_profiles;
create policy user_signature_profiles_update_own
on public.user_signature_profiles for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists user_signature_profiles_delete_own on public.user_signature_profiles;
create policy user_signature_profiles_delete_own
on public.user_signature_profiles for delete
to authenticated
using (user_id = auth.uid());

drop trigger if exists user_signature_profiles_set_updated_at on public.user_signature_profiles;
create trigger user_signature_profiles_set_updated_at
before update on public.user_signature_profiles
for each row execute function public.set_updated_at();

alter table public.sop_signatures
  add column if not exists signature_strokes jsonb,
  add constraint sop_signature_strokes_array
    check (signature_strokes is null or jsonb_typeof(signature_strokes) = 'array'),
  add constraint sop_signature_strokes_size
    check (signature_strokes is null or octet_length(signature_strokes::text) <= 100000);

-- Keep the existing authorization and lifecycle behavior inside sign_sop. Add only the
-- handwritten-signature prerequisite and immutable snapshot at insert time.
do $migration$
declare v_definition text;
begin
  select pg_get_functiondef('public.sign_sop(text,text,text,text,text)'::regprocedure)
  into v_definition;

  if position($from$  select sg.id into v_existing from public.sop_signatures sg$from$ in v_definition) = 0 then
    raise exception 'sign_sop idempotency block changed';
  end if;
  v_definition := replace(
    v_definition,
    $from$  select sg.id into v_existing from public.sop_signatures sg$from$,
    $to$  if p_meaning in ('dept_approval', 'quality_approval')
     and not exists (
       select 1 from public.user_signature_profiles usp where usp.user_id = auth.uid()
     ) then
    raise exception 'Save your handwritten signature before signing this SOP';
  end if;

  select sg.id into v_existing from public.sop_signatures sg$to$
  );

  if position($from$    (id, sop_id, signer_id, meaning, signer_printed_name, signed_content_hash,
     rejected_reason, seat_department_id, review_cycle, resolves_signature_id)
  values (v_id, p_sop, auth.uid(), p_meaning, coalesce(v_name, ''), v_hash,
          p_reason, p_seat_department, v_cycle, p_resolves);$from$ in v_definition) = 0 then
    raise exception 'sign_sop insert block changed';
  end if;
  v_definition := replace(
    v_definition,
    $from$    (id, sop_id, signer_id, meaning, signer_printed_name, signed_content_hash,
     rejected_reason, seat_department_id, review_cycle, resolves_signature_id)
  values (v_id, p_sop, auth.uid(), p_meaning, coalesce(v_name, ''), v_hash,
          p_reason, p_seat_department, v_cycle, p_resolves);$from$,
    $to$    (id, sop_id, signer_id, meaning, signer_printed_name, signed_content_hash,
     rejected_reason, seat_department_id, review_cycle, resolves_signature_id, signature_strokes)
  values (v_id, p_sop, auth.uid(), p_meaning, coalesce(v_name, ''), v_hash,
          p_reason, p_seat_department, v_cycle, p_resolves,
          (select usp.signature_strokes from public.user_signature_profiles usp where usp.user_id = auth.uid()));$to$
  );

  execute v_definition;
end;
$migration$;
