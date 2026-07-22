-- Atomic set approval: allocate the official order number and release the GEN+PM pair together.
-- Apply with: node --env-file=.env.local scripts/apply-migration-safely.mjs 20260721150000_approve_work_order_set.sql
--
-- Under decision N1 a draft has NO order_no; the official GEN-MMYY-NN is minted here, at
-- approval, which is what keeps the sequence production builds against contiguous — discarding a
-- draft then costs nothing.
--
-- This is the ONE multi-row invariant in Planning, and the only reason it is a database function
-- rather than a store call: done as two client updates, a failure between them leaves a numbered
-- Main married to an unnumbered PM — a broken set and a permanent hole in the sequence.

-- ── 1. Released implies numbered ────────────────────────────────────────────
-- The guard previously checked only status legality, so `transitionWorkOrder` could release a
-- null-numbered draft and bypass this function entirely, producing a released order with no
-- number on the floor. N1's core invariant now holds in the database.
create or replace function public.enforce_work_order_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  is_manager boolean;
  from_idx integer;
  to_idx integer;
begin
  if new.status = old.status then
    return new;
  end if;

  -- N1: an order that has reached the floor must carry an official number. Approval sets
  -- order_no and status in a single UPDATE, so NEW already holds the freshly minted number.
  if new.status in ('released', 'in_production', 'shipped')
     and (new.order_no is null or btrim(new.order_no) = '') then
    raise exception 'A work order cannot be % without an official order number -- approve it to mint one', new.status;
  end if;

  is_manager := public.has_workspace_role(old.workspace_id, array['owner', 'admin']::public.workspace_role[]);
  from_idx := array_position(array['draft', 'released', 'in_production', 'shipped'], old.status);
  to_idx := array_position(array['draft', 'released', 'in_production', 'shipped'], new.status);
  if new.status = 'cancelled' then
    if old.status in ('shipped', 'cancelled') then
      raise exception 'A % work order cannot be cancelled', old.status;
    end if;
    return new;
  end if;
  if old.status = 'cancelled' then
    if new.status = 'draft' and is_manager then
      return new;
    end if;
    raise exception 'Only a workspace admin can revive a cancelled work order';
  end if;
  if to_idx = from_idx + 1 then
    return new;
  end if;
  if to_idx = from_idx - 1 and is_manager then
    return new;
  end if;
  raise exception 'Invalid work order status transition from % to %', old.status, new.status;
end;
$$;

drop trigger if exists work_orders_enforce_transition on public.work_orders;
create trigger work_orders_enforce_transition
before update of status on public.work_orders
for each row execute function public.enforce_work_order_transition();

-- ── 2. The approval itself ──────────────────────────────────────────────────
-- SECURITY INVOKER so RLS still applies: a caller without Planning write access cannot approve
-- anything, exactly as if they had issued the UPDATEs themselves.
create or replace function public.approve_work_order_set(
  p_workspace_id text,
  p_main_id text
)
returns table (order_no text, pm_order_no text, set_no text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_main public.work_orders%rowtype;
  v_mmyy text;
  v_next integer;
  v_seq text;
  v_order_no text;
  v_pm_order_no text;
  v_pm_id text;
begin
  select * into v_main
    from public.work_orders
   where id = p_main_id and workspace_id = p_workspace_id
   for update;

  if not found then
    raise exception 'Work order not found in this workspace';
  end if;
  if v_main.status <> 'draft' then
    raise exception 'Only a draft work order can be approved (this one is %)', v_main.status;
  end if;

  v_mmyy := to_char(v_main.order_date, 'MMYY');

  -- Serialize number allocation per workspace+month. The unique index guarantees uniqueness but
  -- NOT contiguity: two concurrent approvals could both read max=4, and one would retry to 6,
  -- leaving 5 permanently empty. Production builds in number order, so a hole is a real defect.
  perform pg_advisory_xact_lock(hashtext(p_workspace_id || ':' || v_mmyy));

  -- GEN and PM share one per-month pool so a set's NN is never reused by either side.
  select coalesce(max((substring(w.order_no from '[0-9]+$'))::integer), 0) + 1
    into v_next
    from public.work_orders w
   where w.workspace_id = p_workspace_id
     and w.order_no is not null
     and (w.order_no like 'GEN-' || v_mmyy || '-%' or w.order_no like 'PM-' || v_mmyy || '-%');

  v_seq := lpad(v_next::text, 2, '0');
  v_order_no := 'GEN-' || v_mmyy || '-' || v_seq;
  v_pm_order_no := 'PM-' || v_mmyy || '-' || v_seq;

  select w.id into v_pm_id
    from public.work_orders w
   where w.workspace_id = p_workspace_id
     and w.main_order_id = p_main_id
     and w.order_type = 'power_module'
   limit 1;

  update public.work_orders w
     set order_no = v_order_no,
         set_no = v_seq,
         status = 'released',
         released_at = now()
   where w.id = p_main_id and w.workspace_id = p_workspace_id;

  if v_pm_id is not null then
    update public.work_orders w
       set order_no = v_pm_order_no,
           set_no = v_seq,
           status = 'released',
           released_at = now()
     where w.id = v_pm_id and w.workspace_id = p_workspace_id;
  else
    v_pm_order_no := null;
  end if;

  return query select v_order_no, v_pm_order_no, v_seq;
end;
$$;
