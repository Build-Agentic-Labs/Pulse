-- Let editors delete DRAFT work orders (owner/admin may still delete any).
-- Apply with: node --env-file=.env.local scripts/apply-migration-safely.mjs 20260706130000_editor_delete_draft_work_orders.sql
--
-- Why: the Gen<->PM paired-create rolls the just-inserted Main back if the PM insert loses a
-- number race. Editors are the primary set-creators, but the original delete policy was
-- owner/admin only, so that rollback silently affected zero rows for an editor -- stranding an
-- orphan Main and letting the retry create a duplicate set. A Main under rollback is always a
-- fresh 'draft', and letting editors delete their own drafts is a reasonable rule on its own
-- (released/in-production/shipped orders stay owner/admin-only, protecting the floor's record).

drop policy if exists "work_orders write delete" on public.work_orders;
create policy "work_orders write delete" on public.work_orders
for delete to authenticated
using (
  public.has_space_access(workspace_id, 'planning')
  and (
    public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[])
    or (
      public.has_workspace_role(workspace_id, array['editor']::public.workspace_role[])
      and status = 'draft'
    )
  )
);
