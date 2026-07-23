-- Retry hardening for the SOP notification pipeline.
--   1) last_attempt_at powers an attempt-scaled retry lease (notifications-drain
--      isRetryDue): a provider outage now spreads MAX_SEND_ATTEMPTS across hours
--      instead of burning them in minutes, because the old lease keyed off the
--      immutable created_at and never advanced between attempts.
--   2) An index for the drain's collect() scan of sop_event_log, which filters
--      by event_type + a created_at window (and orders by created_at) with no
--      supporting index today — sop_event_log_sop_created_idx leads with sop_id,
--      which that predicate never constrains, so the scan reads the whole table.
-- Additive + idempotent: safe to re-run, backward compatible with the shipped
-- created_at-based retry lane (last_attempt_at is null until the first attempt).

alter table public.sop_notifications
  add column if not exists last_attempt_at timestamptz;

create index if not exists sop_event_log_event_type_created_idx
  on public.sop_event_log(event_type, created_at);
