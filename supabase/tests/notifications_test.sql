-- pgTAP: notification ledgers, run log, digests, and the two event triggers the
-- notification drain consumes (migration 20260905100000_notification_core).
--
-- Pins:
--   * ledgers/runs/digests are service-role only: an authenticated user sees zero
--     rows even when rows exist, and cannot insert (RLS on, zero policies — seed.sql
--     re-grants table privileges locally, so RLS is the only durable gate)
--   * the reminder unique index includes review_cycle: the same nudge in a later
--     cycle is a distinct row, the same nudge in the same cycle is refused
--   * the kind CHECKs admit the new kinds and still refuse garbage
--   * inserting a signature appends a `signature_added` event carrying its meaning
--   * reassigning a seat appends a `seat_reassigned` event carrying both signers
--   * notification_digests dedupes on (workspace, recipient, kind, period)

begin;
select plan(29);

-- ---------------------------------------------------------------------------
-- Fixtures (owner context: RLS bypassed)
-- ---------------------------------------------------------------------------
insert into public.workspaces (id, name) values ('ws_notif', 'Notif Org');
insert into public.workspace_auto_join_domains (domain, workspace_id) values ('test.dev', 'ws_notif');

insert into auth.users (id, aud, role, email)
values
  ('a1000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'n-admin@test.dev'),
  ('a1000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'n-author@test.dev'),
  ('a1000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'n-reviewer@test.dev'),
  ('a1000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'n-reviewer2@test.dev');

insert into public.workspace_members (workspace_id, user_id, role) values
  ('ws_notif', 'a1000000-0000-0000-0000-000000000001', 'admin'),
  ('ws_notif', 'a1000000-0000-0000-0000-000000000002', 'editor'),
  ('ws_notif', 'a1000000-0000-0000-0000-000000000003', 'editor'),
  ('ws_notif', 'a1000000-0000-0000-0000-000000000004', 'editor');

insert into public.org_tool_access (workspace_id, user_id, level)
select 'ws_notif', u.id, 'edit'::public.access_level from (values
  ('a1000000-0000-0000-0000-000000000002'::uuid),
  ('a1000000-0000-0000-0000-000000000003'::uuid),
  ('a1000000-0000-0000-0000-000000000004'::uuid)) as u(id);

insert into public.departments (id, workspace_id, code, name, is_quality_gate) values
  ('dept_n_prd', 'ws_notif', 'PRD', 'Production', false),
  ('dept_n_eng', 'ws_notif', 'ENG', 'Engineering', false);

insert into public.department_members (department_id, user_id, dept_role) values
  ('dept_n_prd', 'a1000000-0000-0000-0000-000000000002', 'author'),
  ('dept_n_eng', 'a1000000-0000-0000-0000-000000000003', 'approver'),
  ('dept_n_eng', 'a1000000-0000-0000-0000-000000000004', 'approver');

insert into public.sops (id, workspace_id, sop_number, title, document, status, created_by, department_id)
values ('sop_n_1', 'ws_notif', 'PRD-SOP-001', 'Notifiable', '{"body":"n1"}'::jsonb, 'draft',
        'a1000000-0000-0000-0000-000000000002', 'dept_n_prd');

insert into public.sop_review_seats (sop_id, department_id, rasic, signer_id) values
  ('sop_n_1', 'dept_n_eng', 'responsible', 'a1000000-0000-0000-0000-000000000003');

-- Helper: act as a given user with the authenticated role.
create or replace function test_as(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- ---------------------------------------------------------------------------
-- 1/2. sop_notifications is invisible and unwritable to authenticated users.
-- ---------------------------------------------------------------------------
insert into public.sop_notifications (sop_id, recipient_id, kind, event_id, reminder_index, review_cycle)
values ('sop_n_1', 'a1000000-0000-0000-0000-000000000003', 'review_requested', null, 1, 0);

select test_as('a1000000-0000-0000-0000-000000000003');
select is(
  (select count(*) from public.sop_notifications),
  0::bigint,
  'an authenticated user sees zero ledger rows even when rows exist'
);
select throws_ok(
  $$ insert into public.sop_notifications (sop_id, recipient_id, kind, reminder_index, review_cycle)
     values ('sop_n_1', 'a1000000-0000-0000-0000-000000000003', 'review_requested', 2, 0) $$,
  '42501',
  null,
  'an authenticated user cannot write the ledger'
);
reset role;

-- ---------------------------------------------------------------------------
-- 3/4. The reminder key includes review_cycle.
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ insert into public.sop_notifications (sop_id, recipient_id, kind, reminder_index, review_cycle)
     values ('sop_n_1', 'a1000000-0000-0000-0000-000000000003', 'review_requested', 1, 1) $$,
  'the same nudge in a later review cycle is a distinct ledger row'
);
select throws_ok(
  $$ insert into public.sop_notifications (sop_id, recipient_id, kind, reminder_index, review_cycle)
     values ('sop_n_1', 'a1000000-0000-0000-0000-000000000003', 'review_requested', 1, 1) $$,
  '23505',
  null,
  'the same nudge in the same cycle is refused by the unique index'
);

-- ---------------------------------------------------------------------------
-- 5/6. Kind CHECK admits the new kinds and refuses garbage.
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ insert into public.sop_notifications (sop_id, recipient_id, kind, reminder_index, review_cycle, content)
     values ('sop_n_1', 'a1000000-0000-0000-0000-000000000002', 'review_complete', 0, 0,
             '{"subject":"s","text":"t","html":"<p>h</p>"}'::jsonb) $$,
  'review_complete is an accepted kind and carries a content snapshot'
);
select throws_ok(
  $$ insert into public.sop_notifications (sop_id, recipient_id, kind, reminder_index, review_cycle)
     values ('sop_n_1', 'a1000000-0000-0000-0000-000000000002', 'not_a_kind', 0, 0) $$,
  '23514',
  null,
  'an unknown kind is refused'
);

-- ---------------------------------------------------------------------------
-- 7/8. notification_drain_runs: owner writes, authenticated sees nothing.
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ insert into public.notification_drain_runs (caller, started_at, healthy, problems, report)
     values ('cron', now(), true, '{}', '{"sop":{"sent":1}}'::jsonb) $$,
  'a drain run is recorded'
);
select test_as('a1000000-0000-0000-0000-000000000001');
select is(
  (select count(*) from public.notification_drain_runs),
  0::bigint,
  'even an admin cannot read drain runs through PostgREST (service-role only)'
);
reset role;

-- ---------------------------------------------------------------------------
-- 9/10/11. notification_digests dedupes on the period key and is service-role only.
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ insert into public.notification_digests (workspace_id, recipient_id, kind, period_key)
     values ('ws_notif', 'a1000000-0000-0000-0000-000000000001', 'stalled_weekly', '2026-W36') $$,
  'a weekly digest claim is recorded'
);
select throws_ok(
  $$ insert into public.notification_digests (workspace_id, recipient_id, kind, period_key)
     values ('ws_notif', 'a1000000-0000-0000-0000-000000000001', 'stalled_weekly', '2026-W36') $$,
  '23505',
  null,
  'the same recipient cannot be claimed twice for one period'
);
select test_as('a1000000-0000-0000-0000-000000000001');
select is(
  (select count(*) from public.notification_digests),
  0::bigint,
  'digest claims are invisible to authenticated users'
);
reset role;

-- ---------------------------------------------------------------------------
-- 12/13. Inserting a signature appends a signature_added event.
-- ---------------------------------------------------------------------------
insert into public.sop_signatures (sop_id, signer_id, meaning, signed_content_hash, seat_department_id, review_cycle, rejected_reason)
values ('sop_n_1', 'a1000000-0000-0000-0000-000000000003', 'rejection', 'hash-n1', 'dept_n_eng', 0, 'unclear scope');

select is(
  (select details->>'meaning' from public.sop_event_log
    where sop_id = 'sop_n_1' and event_type = 'signature_added' order by id desc limit 1),
  'rejection',
  'a signature insert appends signature_added carrying its meaning'
);
select is(
  (select details->>'signer_id' from public.sop_event_log
    where sop_id = 'sop_n_1' and event_type = 'signature_added' order by id desc limit 1),
  'a1000000-0000-0000-0000-000000000003',
  'the signature_added event names the signer'
);

-- ---------------------------------------------------------------------------
-- 14. Reassigning a seat appends seat_reassigned with both signers.
-- ---------------------------------------------------------------------------
select test_as('a1000000-0000-0000-0000-000000000001');
select public.reassign_sop_seat('sop_n_1', 'dept_n_eng', 'a1000000-0000-0000-0000-000000000004'::uuid);
reset role;
select is(
  (select (details->>'from_signer_id') || '>' || (details->>'to_signer_id') from public.sop_event_log
    where sop_id = 'sop_n_1' and event_type = 'seat_reassigned' order by id desc limit 1),
  'a1000000-0000-0000-0000-000000000003>a1000000-0000-0000-0000-000000000004',
  'a seat reassignment appends seat_reassigned with the old and new signer'
);

-- ---------------------------------------------------------------------------
-- 15. workspace_notifications accepts the membership kinds.
-- ---------------------------------------------------------------------------
insert into public.audit_log (workspace_id, actor_id, actor_email, action, target_type, target_id, details)
values ('ws_notif', 'a1000000-0000-0000-0000-000000000001', 'n-admin@test.dev', 'workspace_members.update',
        'workspace_members', 'a1000000-0000-0000-0000-000000000002', '{}'::jsonb);
select lives_ok(
  $$ insert into public.workspace_notifications (workspace_id, recipient_id, kind, event_id)
     values ('ws_notif', 'a1000000-0000-0000-0000-000000000002', 'role_changed',
             (select max(id) from public.audit_log where action = 'workspace_members.update')) $$,
  'role_changed is an accepted workspace notification kind'
);

-- ---------------------------------------------------------------------------
-- 16-19. Inbox: recipients read only their own rows, cannot edit content, and
--        mark read only through the RPC (which touches only their own rows).
-- ---------------------------------------------------------------------------
insert into public.notifications (recipient_id, workspace_id, source, kind, title, body, link)
values
  ('a1000000-0000-0000-0000-000000000002', 'ws_notif', 'sop', 'review_complete', 'Ready for final approval', 'body', '/sops/sop_n_1'),
  ('a1000000-0000-0000-0000-000000000003', 'ws_notif', 'sop', 'review_requested', 'Review requested', 'body', '/sops/sop_n_1');

select test_as('a1000000-0000-0000-0000-000000000002');
select is(
  (select count(*) from public.notifications),
  1::bigint,
  'a recipient sees only their own inbox rows'
);
update public.notifications set title = 'hacked';
select is(
  (select count(*) from public.notifications where title = 'hacked'),
  0::bigint,
  'a recipient cannot edit inbox content (no update policy)'
);
select is(
  public.mark_notifications_read(array(select id from public.notifications)),
  1,
  'mark_notifications_read marks the caller''s own rows'
);
reset role;
select is(
  (select count(*) from public.notifications where read_at is not null),
  1::bigint,
  'the RPC left the other recipient''s row unread'
);

-- ---------------------------------------------------------------------------
-- 20/21. Preferences: own rows only, enforced on write.
-- ---------------------------------------------------------------------------
select test_as('a1000000-0000-0000-0000-000000000002');
select lives_ok(
  $$ insert into public.notification_preferences (user_id, workspace_id, kind, channel, mode)
     values ('a1000000-0000-0000-0000-000000000002', '', 'remark_added', 'email', 'immediate') $$,
  'a user can write their own preference'
);
select throws_ok(
  $$ insert into public.notification_preferences (user_id, workspace_id, kind, channel, mode)
     values ('a1000000-0000-0000-0000-000000000003', '', 'remark_added', 'email', 'off') $$,
  '42501',
  null,
  'a user cannot write another user''s preference'
);
reset role;

-- ---------------------------------------------------------------------------
-- 22-24. Delivery tracking tables are service-role only.
-- ---------------------------------------------------------------------------
insert into public.email_deliveries (webhook_event_id, resend_message_id, event_type, recipient_email, occurred_at)
values ('msg_1', 're_1', 'email.delivered', 'n-reviewer@test.dev', now());
insert into public.email_suppressions (email, reason) values ('bounced@test.dev', 'hard_bounce');
insert into public.transactional_emails (kind, recipient_email, status) values ('invite', 'n-reviewer@test.dev', 'sent');

select test_as('a1000000-0000-0000-0000-000000000001');
select is((select count(*) from public.email_deliveries), 0::bigint, 'deliveries are invisible to authenticated users');
select is((select count(*) from public.email_suppressions), 0::bigint, 'suppressions are invisible to authenticated users');
select is((select count(*) from public.transactional_emails), 0::bigint, 'the transactional ledger is invisible to authenticated users');
reset role;

-- ---------------------------------------------------------------------------
-- 25-27. Integrations: owners/admins manage, editors cannot even see them.
-- ---------------------------------------------------------------------------
select test_as('a1000000-0000-0000-0000-000000000001');
select lives_ok(
  $$ insert into public.workspace_integrations (workspace_id, kind, config, enabled, updated_by)
     values ('ws_notif', 'teams_webhook', '{"webhookUrl":"https://example.webhook.office.com/x"}'::jsonb, true,
             'a1000000-0000-0000-0000-000000000001') $$,
  'an admin can configure a Teams webhook'
);
reset role;
select test_as('a1000000-0000-0000-0000-000000000002');
select is((select count(*) from public.workspace_integrations), 0::bigint, 'an editor cannot read the webhook config');
-- RLS makes a disallowed UPDATE match zero rows rather than raise.
update public.workspace_integrations set enabled = false where workspace_id = 'ws_notif';
reset role;
select is(
  (select enabled from public.workspace_integrations where workspace_id = 'ws_notif' and kind = 'teams_webhook'),
  true,
  'an editor cannot change it'
);

-- ---------------------------------------------------------------------------
-- 28/29. Push subscriptions: own rows only.
-- ---------------------------------------------------------------------------
select test_as('a1000000-0000-0000-0000-000000000002');
select lives_ok(
  $$ insert into public.push_subscriptions (endpoint, user_id, p256dh, auth)
     values ('https://push.example/abc', 'a1000000-0000-0000-0000-000000000002', 'p', 'a') $$,
  'a user can register their own push subscription'
);
select throws_ok(
  $$ insert into public.push_subscriptions (endpoint, user_id, p256dh, auth)
     values ('https://push.example/def', 'a1000000-0000-0000-0000-000000000003', 'p', 'a') $$,
  '42501',
  null,
  'a user cannot register a subscription for someone else'
);
reset role;

select * from finish();
rollback;
