-- Apply the querying user's table permissions and project RLS policies.
alter view public.planner_tasks set (security_invoker = true);

-- Planner data is only available to authenticated project members.
revoke all on public.planner_tasks from anon;

notify pgrst, 'reload schema';
