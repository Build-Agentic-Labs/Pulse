-- SECURITY FIX: duplicate_scenario and delete_scenario were created SECURITY DEFINER. Because a
-- SECURITY DEFINER function runs as its owner and bypasses RLS, and EXECUTE defaults to PUBLIC, any
-- authenticated caller could duplicate or (worse) permanently DELETE *any* product's scenario in *any*
-- project by passing an arbitrary scenario id -- a cross-tenant RLS bypass. delete_scenario also
-- cascades to all child rows, so this was irreversible cross-tenant data destruction.
--
-- Fix: convert both to SECURITY INVOKER so the caller's per-project RLS (has_project_access('edit'))
-- gates every SELECT/INSERT/DELETE inside the function -- exactly how the repo's other mutating RPCs
-- (e.g. public.replace_task_children, public.reorder_manufacturing_steps) are written. The Main/only
-- guards inside the functions are integrity checks, NOT authorization; RLS is the authorization layer.
-- ALTER FUNCTION keeps each body and its `search_path = ''` setting untouched -- only the security mode
-- changes.

alter function public.duplicate_scenario(text, text) security invoker;
alter function public.delete_scenario(text) security invoker;
