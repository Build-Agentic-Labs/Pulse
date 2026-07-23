-- Retry hardening for the workspace welcome-email pipeline (mirror of
-- 20260722150000's SOP counterpart, 20260723122000).
--   1) last_attempt_at powers an attempt-scaled retry lease (notifications-drain
--      isRetryDue): a provider outage now spreads MAX_SEND_ATTEMPTS across hours
--      instead of burning them in minutes, because the old lease keyed off the
--      immutable created_at and never advanced between attempts.
--   2) An index for the drain's collect() scan of audit_log, which filters by
--      action + a created_at window (and orders by created_at) with no
--      supporting index today — audit_log_workspace_created_idx leads with
--      workspace_id, which that predicate never constrains, so the scan reads
--      the whole table.
-- Additive + idempotent: safe to re-run, backward compatible with the shipped
-- created_at-based retry lane (last_attempt_at is null until the first attempt).
-- Apply with: node --env-file=.env.local scripts/apply-migration-safely.mjs 20260723130000_workspace_notifications_retry_hardening.sql

alter table public.workspace_notifications
  add column if not exists last_attempt_at timestamptz;

create index if not exists audit_log_action_created_idx
  on public.audit_log(action, created_at);
