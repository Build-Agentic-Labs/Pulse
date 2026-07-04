-- Server-side work-order status-transition legality, mirroring
-- canTransitionWorkOrder in src/domain/work-orders.ts:
-- forward one step for any writer; cancel from any active status;
-- one step back or revive-to-draft for owners/admins only.
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
for each row execute function enforce_work_order_transition();
