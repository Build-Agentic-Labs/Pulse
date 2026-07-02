-- Audit 2026-07-01 remediation (M5): the approved-domain rule was enforced only at
-- signup (BEFORE INSERT on auth.users, 20260612120000). A member could later change
-- their email to any domain via supabase.auth.updateUser and keep their membership.
-- Reuse the same enforce_signup_domain() check on email updates.

drop trigger if exists before_auth_user_email_change_domain_check on auth.users;
create trigger before_auth_user_email_change_domain_check
before update of email on auth.users
for each row
when (new.email is distinct from old.email)
execute function public.enforce_signup_domain();
