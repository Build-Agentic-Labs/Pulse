# Workspace Welcome Email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Email a branded welcome to every user added to a workspace (invited, auto-joined, or manually added), driven off the existing `audit_log` outbox through the existing notification drain.

**Architecture:** `audit_log` already records every `workspace_members.insert` transactionally. A new `workspace_notifications` ledger clones the SOP ledger's exactly-once claim pattern. A pure domain module parses/resolves/renders; the drain library gets defaulted generics so its loop serves a second store without behavior change; the route runs both stores. A shared email-shell helper is extracted so the SOP and welcome templates render one branded card.

**Tech Stack:** Existing: Supabase service-role drain, Resend REST via fetch, Vitest, Vercel cron. Zero new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-22-workspace-welcome-email-design.md` — the authority.

## Global Constraints

- Branch: `feat/workspace-welcome-email` (created; spec committed as `89b2926`).
- Zero new npm dependencies. No changes to `sop_notifications` (shipped table stays untouched).
- Ledger `workspace_notifications`: RLS enabled, ZERO policies, `revoke all ... from anon, authenticated`; idempotency anchors on unique `(event_id, recipient_id)`; stores `recipient_id`, never an email.
- Audience: the added member ONLY. Kind literal: `workspace_welcome`. No reminders (`reminder` concepts do not apply to this source).
- Skip-unless-now guards: recipient still a member of that workspace at drain time; workspace still exists. Malformed audit rows → skip, never throw.
- Wording: actor add → `{actorName} added you to {workspaceName}.`; self-caused (`actor_id` null OR equal to recipient) → `You joined {workspaceName} via your company email domain.` Subject exactly `Welcome to {workspaceName} on Pulse`.
- Drain-lib refactor must be type-only compatible: generics with defaults; every existing SOP test passes UNCHANGED (that is the proof of zero behavior change).
- One new kick call site: `ensureDefaultWorkspaceMembership` (covers invite redemption + auto-join at sign-in); cron is the backstop.
- Event lookback 30 days; attempts cap 3; 10-minute retry lease — inherited constants, do not redefine.
- Commit format `<type>(workspace|sop): ...`; gate per task: `npm run typecheck && npm run lint && npm run test`.

---

### Task 1: Migration — `workspace_notifications` ledger

**Files:**
- Create: `supabase/migrations/20260722150000_workspace_notifications_ledger.sql`
- Modify (generated): `src/lib/database.types.ts`

**Interfaces:**
- Consumes: `public.workspaces` (id text), `public.audit_log` (id bigint), `auth.users`.
- Produces: table `public.workspace_notifications` exactly as below.

- [ ] **Step 1: Write the migration**

```sql
-- Send ledger for workspace welcome emails. audit_log is the outbox (its
-- trigger already records every workspace_members.insert transactionally);
-- this table records what has been sent, and its unique index is the
-- exactly-once claim. Clone of the sop_notifications pattern — deliberately a
-- separate table so the shipped SOP ledger stays untouched.
-- Apply with: node --env-file=.env.local scripts/apply-migration-safely.mjs 20260722150000_workspace_notifications_ledger.sql
-- Spec: docs/superpowers/specs/2026-07-22-workspace-welcome-email-design.md

create table public.workspace_notifications (
  id                 bigint generated always as identity primary key,
  workspace_id       text not null references public.workspaces(id) on delete cascade,
  recipient_id       uuid not null references auth.users(id) on delete cascade,
  kind               text not null check (kind = 'workspace_welcome'),
  event_id           bigint not null references public.audit_log(id) on delete cascade,
  sent_at            timestamptz,
  attempts           integer not null default 0,
  last_error         text,
  resend_message_id  text,
  created_at         timestamptz not null default now()
);

create unique index workspace_notifications_event_recipient_key
  on public.workspace_notifications(event_id, recipient_id);

create index workspace_notifications_unsent_idx
  on public.workspace_notifications(created_at)
  where sent_at is null;

alter table public.workspace_notifications enable row level security;
revoke all on public.workspace_notifications from anon, authenticated;
```

- [ ] **Step 2: Apply to the live database**

Run: `node --env-file=.env.local scripts/apply-migration-safely.mjs 20260722150000_workspace_notifications_ledger.sql`
Expected: applies cleanly, zero row-count changes. (Never `supabase db push` in this repo.)

- [ ] **Step 3: Verify RLS posture**

```bash
node --env-file=.env.local --input-type=module -e "
import pg from 'pg';
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const r = await c.query(\"select (select relrowsecurity from pg_class where relname='workspace_notifications') as rls, (select count(*)::int from pg_policies where tablename='workspace_notifications') as policies\");
console.log(JSON.stringify(r.rows[0]));
await c.end();
"
```

Expected: `{"rls":true,"policies":0}`.

- [ ] **Step 4: Regenerate types**

Run: `npx supabase gen types typescript --project-id neaadefipcpxxcqszpud --schema public > src/lib/database.types.ts`
Confirm `grep -c "workspace_notifications" src/lib/database.types.ts` > 0 and `git diff --stat src/lib/database.types.ts` shows additions only. Then `npm run typecheck` — clean.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260722150000_workspace_notifications_ledger.sql src/lib/database.types.ts
git commit -m "feat(workspace): workspace_notifications welcome ledger (service-role only)"
```

---

### Task 2: Domain — shared email shell + welcome module

**Files:**
- Create: `src/domain/notification-email-shell.ts`
- Modify: `src/domain/sop/notifications.ts` (refactor `renderSopNotificationEmail`'s html assembly onto the shell — behavior-identical)
- Create: `src/domain/workspace/welcome.ts`
- Test: `src/domain/workspace/welcome.test.ts` (new); `src/domain/sop/notifications.test.ts` must pass UNCHANGED

**Interfaces:**
- Consumes: `SopEmailContent` type from `@/domain/sop/notifications`.
- Produces:
  - `notification-email-shell.ts`: `interface EmailShellInput { accent: string; eyebrow: string; heading: string; bodyParagraphsHtml: string; ctaLabel: string; ctaHref: string; reason: string; origin: string }`, `function renderEmailShell(input: EmailShellInput): string` (the full html document string: wordmark header, white card with accent stripe, cta button, footer), and `function escapeHtml(value: string): string` (moved here; SOP module re-imports it).
  - `welcome.ts`: `interface MemberAddedEvent { id: number; workspaceId: string; recipientId: string; actorId: string | null; createdAt: string }`, `function parseMemberAddedEvent(row: { id: number; action: string; workspace_id: string | null; target_id: string | null; actor_id: string | null; created_at: string }): MemberAddedEvent | null`, `interface WorkspaceWelcomeContext { isStillMember: boolean; workspaceName: string | null; actorName: string | null }`, `interface WorkspaceWelcomePending { recipientId: string; kind: "workspace_welcome"; workspaceId: string; eventId: number }`, `function resolveWorkspaceWelcome(event: MemberAddedEvent, ctx: WorkspaceWelcomeContext): WorkspaceWelcomePending | null`, `function renderWorkspaceWelcomeEmail(input: { workspaceName: string; actorName: string | null; selfCaused: boolean; origin: string }): SopEmailContent`.

- [ ] **Step 1: Write the failing tests**

Create `src/domain/workspace/welcome.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  parseMemberAddedEvent,
  renderWorkspaceWelcomeEmail,
  resolveWorkspaceWelcome,
  type MemberAddedEvent,
} from "./welcome";

const row = (over: Partial<Parameters<typeof parseMemberAddedEvent>[0]> = {}) => ({
  id: 7,
  action: "workspace_members.insert",
  workspace_id: "ws-1",
  target_id: "5f9d2f6e-1c1a-4b7e-9d3e-2a6b8c0d4e1f",
  actor_id: "admin-uuid",
  created_at: "2026-07-22T12:00:00Z",
  ...over,
});

describe("parseMemberAddedEvent", () => {
  it("parses a member insert row", () => {
    expect(parseMemberAddedEvent(row())).toEqual({
      id: 7,
      workspaceId: "ws-1",
      recipientId: "5f9d2f6e-1c1a-4b7e-9d3e-2a6b8c0d4e1f",
      actorId: "admin-uuid",
      createdAt: "2026-07-22T12:00:00Z",
    });
  });

  it("rejects other actions, missing workspace, and non-uuid targets", () => {
    expect(parseMemberAddedEvent(row({ action: "workspace_members.delete" }))).toBeNull();
    expect(parseMemberAddedEvent(row({ action: "org_tool_access.insert" }))).toBeNull();
    expect(parseMemberAddedEvent(row({ workspace_id: null }))).toBeNull();
    expect(parseMemberAddedEvent(row({ target_id: "someone@anacorp.com" }))).toBeNull();
    expect(parseMemberAddedEvent(row({ target_id: null }))).toBeNull();
  });
});

describe("resolveWorkspaceWelcome", () => {
  const event: MemberAddedEvent = {
    id: 7,
    workspaceId: "ws-1",
    recipientId: "user-1",
    actorId: "admin-1",
    createdAt: "2026-07-22T12:00:00Z",
  };

  it("resolves to a pending welcome for a current member", () => {
    const pending = resolveWorkspaceWelcome(event, {
      isStillMember: true,
      workspaceName: "Anacorp",
      actorName: "Rosendo Lopez",
    });
    expect(pending).toEqual({
      recipientId: "user-1",
      kind: "workspace_welcome",
      workspaceId: "ws-1",
      eventId: 7,
    });
  });

  it("self-cancels when the member was removed or the workspace is gone", () => {
    expect(
      resolveWorkspaceWelcome(event, { isStillMember: false, workspaceName: "Anacorp", actorName: null }),
    ).toBeNull();
    expect(
      resolveWorkspaceWelcome(event, { isStillMember: true, workspaceName: null, actorName: null }),
    ).toBeNull();
  });
});

describe("renderWorkspaceWelcomeEmail", () => {
  const base = { workspaceName: "Anacorp", actorName: "Rosendo Lopez", selfCaused: false, origin: "https://pulse.example.com" };

  it("subject is exact", () => {
    expect(renderWorkspaceWelcomeEmail(base).subject).toBe("Welcome to Anacorp on Pulse");
  });

  it("actor add names the actor; self-caused uses the domain wording", () => {
    expect(renderWorkspaceWelcomeEmail(base).text).toContain("Rosendo Lopez added you to Anacorp.");
    const self = renderWorkspaceWelcomeEmail({ ...base, actorName: null, selfCaused: true });
    expect(self.text).toContain("You joined Anacorp via your company email domain.");
  });

  it("links to the app root in text and html, with the branded shell", () => {
    const out = renderWorkspaceWelcomeEmail(base);
    expect(out.text).toContain("https://pulse.example.com/");
    expect(out.html).toContain('href="https://pulse.example.com/"');
    expect(out.html).toContain(">Pulse</span>");
    expect(out.html).toContain("you were added to this workspace");
  });

  it("escapes user-controlled names", () => {
    const out = renderWorkspaceWelcomeEmail({ ...base, workspaceName: '<b>"Ana"</b>' });
    expect(out.html).not.toContain("<b>");
    expect(out.html).toContain("&lt;b&gt;");
    expect(out.subject).toBe('Welcome to <b>"Ana"</b> on Pulse'); // subjects are plain text, never html-escaped
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/domain/workspace/welcome.test.ts`
Expected: FAIL — cannot resolve `./welcome`.

- [ ] **Step 3: Extract the shell, refactor SOP templates onto it**

Create `src/domain/notification-email-shell.ts`:

```ts
/**
 * The one branded email layout: Pulse wordmark header, white card with a
 * kind-colored accent stripe, squared 4px geometry, cta button, and a
 * why-you-received-this footer. Extracted from the SOP templates so every
 * notification source renders the identical card. Inline styles + table
 * markup only (email-client compatibility). Pure module — no imports.
 */

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export interface EmailShellInput {
  accent: string;
  /** Already plain text; escaped here. */
  eyebrow: string;
  /** Already plain text; escaped here. */
  heading: string;
  /** Pre-rendered, pre-escaped paragraph/notes html for the card body. */
  bodyParagraphsHtml: string;
  ctaLabel: string;
  ctaHref: string;
  /** Already plain text; escaped here. */
  reason: string;
  origin: string;
}

export function renderEmailShell(input: EmailShellInput): string {
  const host = input.origin.replace(/^https?:\/\//, "");
  return (
    `<div style="margin:0;padding:32px 16px;background:#f4f4f5;font-family:-apple-system,'Segoe UI',system-ui,sans-serif;">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" width="100%" style="max-width:560px;margin:0 auto;">` +
    `<tr><td style="padding:0 2px 14px;">` +
    `<span style="font-size:17px;font-weight:700;letter-spacing:0.02em;color:#111111;">Pulse</span>` +
    `<span style="font-size:12px;color:#71717a;">&nbsp;&middot;&nbsp;SOP document control</span>` +
    `</td></tr>` +
    `<tr><td style="background:#ffffff;border:1px solid #e4e4e7;border-top:3px solid ${input.accent};border-radius:4px;padding:28px 32px;">` +
    `<p style="margin:0 0 6px;font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${input.accent};">${escapeHtml(input.eyebrow)}</p>` +
    `<p style="margin:0 0 16px;font-size:17px;font-weight:600;line-height:1.4;color:#111111;">${escapeHtml(input.heading)}</p>` +
    input.bodyParagraphsHtml +
    `<p style="margin:20px 0 0;"><a href="${input.ctaHref}" ` +
    `style="display:inline-block;padding:10px 18px;background:#111111;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:4px;">` +
    `${escapeHtml(input.ctaLabel)}</a></p>` +
    `</td></tr>` +
    `<tr><td style="padding:16px 2px 0;font-size:12px;line-height:1.6;color:#71717a;">` +
    `${escapeHtml(input.reason)}<br>` +
    `<a href="${input.origin}" style="color:#71717a;">${escapeHtml(host)}</a>&nbsp;&middot;&nbsp;Automated notification from Pulse &mdash; replies are not monitored.` +
    `</td></tr>` +
    `</table></div>`
  );
}
```

In `src/domain/sop/notifications.ts`: delete the local `escapeHtml` and import `{ escapeHtml, renderEmailShell }` from `@/domain/notification-email-shell`; replace the html assembly at the bottom of `renderSopNotificationEmail` (from `const html =` through the closing `</table></div>`) with:

```ts
  const html = renderEmailShell({
    accent,
    eyebrow: eyebrowText,
    heading,
    bodyParagraphsHtml: bodyParagraph(happened) + bodyParagraph(needed) + waitingNote,
    ctaLabel: "Open in Pulse",
    ctaHref: link,
    reason,
    origin: input.origin,
  });
```

(`bodyParagraph`, `waitingNote`, `heading`, `accent`, `eyebrowText`, `reason`, `link` all already exist in that function; the `host` computation moves into the shell — delete the local one.)

- [ ] **Step 4: Implement the welcome module**

Create `src/domain/workspace/welcome.ts`:

```ts
/**
 * Workspace welcome decisions — parse the audit_log outbox row, decide whether
 * a welcome is still due, render the email. Pure: no Supabase, no clocks. The
 * drain's welcome store assembles plain-value context; these functions only
 * decide. audit_log's trigger writes the fact transactionally with EVERY
 * membership insert (invite redemption, domain auto-join, manual add), so no
 * add path can be missed.
 * Spec: docs/superpowers/specs/2026-07-22-workspace-welcome-email-design.md
 */

import { escapeHtml, renderEmailShell } from "@/domain/notification-email-shell";
import type { SopEmailContent } from "@/domain/sop/notifications";

const MEMBER_INSERT_ACTION = "workspace_members.insert";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WELCOME_ACCENT = "#0891b2";

export interface MemberAddedEvent {
  id: number;
  workspaceId: string;
  recipientId: string;
  actorId: string | null;
  createdAt: string;
}

/**
 * audit_log.target_id is "user id or email when the row has one" — for
 * workspace_members rows it is the member's uuid. The uuid check screens out
 * any email-shaped target defensively; unparseable rows resolve to null.
 */
export function parseMemberAddedEvent(row: {
  id: number;
  action: string;
  workspace_id: string | null;
  target_id: string | null;
  actor_id: string | null;
  created_at: string;
}): MemberAddedEvent | null {
  if (row.action !== MEMBER_INSERT_ACTION) return null;
  if (!row.workspace_id) return null;
  if (!row.target_id || !UUID_PATTERN.test(row.target_id)) return null;
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    recipientId: row.target_id,
    actorId: row.actor_id,
    createdAt: row.created_at,
  };
}

export interface WorkspaceWelcomeContext {
  /** Recipient is still in workspace_members for this workspace at drain time. */
  isStillMember: boolean;
  /** Null when the workspace no longer exists. */
  workspaceName: string | null;
  actorName: string | null;
}

export interface WorkspaceWelcomePending {
  recipientId: string;
  kind: "workspace_welcome";
  workspaceId: string;
  eventId: number;
}

/** Skip-unless-now: a welcome to someone already removed (or to a deleted workspace) is noise. */
export function resolveWorkspaceWelcome(
  event: MemberAddedEvent,
  ctx: WorkspaceWelcomeContext,
): WorkspaceWelcomePending | null {
  if (!ctx.isStillMember || !ctx.workspaceName) return null;
  return {
    recipientId: event.recipientId,
    kind: "workspace_welcome",
    workspaceId: event.workspaceId,
    eventId: event.id,
  };
}

export function renderWorkspaceWelcomeEmail(input: {
  workspaceName: string;
  actorName: string | null;
  /** actor_id was null or equal to the recipient — an auto-join. */
  selfCaused: boolean;
  origin: string;
}): SopEmailContent {
  const happened =
    !input.selfCaused && input.actorName
      ? `${input.actorName} added you to ${input.workspaceName}.`
      : `You joined ${input.workspaceName} via your company email domain.`;
  const what = `Pulse is where this team plans production, controls SOP documents, and tracks review work.`;
  const reason = "You are receiving this because you were added to this workspace.";
  const link = `${input.origin}/`;

  const paragraph = (line: string): string =>
    `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#3f3f46;">${escapeHtml(line)}</p>`;

  return {
    subject: `Welcome to ${input.workspaceName} on Pulse`,
    text: [happened, what, `Open it: ${link}`, "—", reason, input.origin].join("\n\n"),
    html: renderEmailShell({
      accent: WELCOME_ACCENT,
      eyebrow: "Welcome",
      heading: `Welcome to ${input.workspaceName}`,
      bodyParagraphsHtml: paragraph(happened) + paragraph(what),
      ctaLabel: "Open Pulse",
      ctaHref: link,
      reason,
      origin: input.origin,
    }),
  };
}
```

- [ ] **Step 5: Run to verify pass — including the UNCHANGED SOP tests**

Run: `npx vitest run src/domain/workspace/welcome.test.ts src/domain/sop/notifications.test.ts`
Expected: ALL pass; `git diff --stat src/domain/sop/notifications.test.ts` shows ZERO changes (the refactor's proof).
Then `npm run typecheck && npm run lint` — clean.

- [ ] **Step 6: Commit**

```bash
git add src/domain/notification-email-shell.ts src/domain/sop/notifications.ts src/domain/workspace/welcome.ts src/domain/workspace/welcome.test.ts
git commit -m "feat(workspace): welcome email decisions + shared branded email shell"
```

---

### Task 3: Drain generics, welcome store, route wiring, kick

**Files:**
- Modify: `src/lib/sop/notifications-drain.ts` (defaulted generics only)
- Create: `src/lib/workspace/welcome-store.ts`
- Modify: `app/api/sops/notifications/drain/route.ts` (run both stores)
- Modify: `src/domain/supabase-planner.ts` (~line 1866 region: one kick after redemption)
- Test: existing `src/lib/sop/notifications-drain.test.ts` must pass UNCHANGED

**Interfaces:**
- Consumes: Task 2's domain exports; `DrainStore`/`DrainItem`/`DrainBatch`/`RetryItem`/`runSopNotificationDrain`/`MAX_SEND_ATTEMPTS`/`createResendSender`/`isAuthorizedCronRequest` from `@/lib/sop/notifications-drain`; `kickSopNotifications` from `@/lib/sop/notify-kick`.
- Produces: `createWorkspaceWelcomeDrainStore(admin: SupabaseClient<Database>): DrainStore<WorkspaceWelcomePending>`; route response shape `{ configured: boolean; sop: DrainReport; workspace: DrainReport }`.

- [ ] **Step 1: Widen the drain lib with defaulted generics**

In `src/lib/sop/notifications-drain.ts`, change ONLY these declarations (bodies untouched):

```ts
export interface DrainItem<P = PendingNotification> {
  pending: P;
  email: string | null;
  content: SopEmailContent;
}

export interface DrainBatch<P = PendingNotification> {
  items: DrainItem<P>[];
  oldestUnnotifiedEventAgeHours: number | null;
}

export interface DrainStore<P = PendingNotification> {
  collect(now: Date, origin: string): Promise<DrainBatch<P>>;
  retryItems(now: Date, origin: string): Promise<RetryItem[]>;
  claim(pending: P): Promise<{ claimed: boolean; ledgerId: number | null }>;
  markSent(ledgerId: number, messageId: string): Promise<void>;
  markFailed(ledgerId: number, error: string, attemptsAfter: number): Promise<void>;
}

export async function runSopNotificationDrain<P = PendingNotification>(deps: {
  store: DrainStore<P>;
  send: EmailSender | null;
  now: () => Date;
  origin: string;
}): Promise<DrainReport> {
```

The loop body reads only `item.email`, `item.content`, and passes `item.pending` opaquely to `store.claim` — no other change is needed or allowed. Existing imports compile unchanged via the defaults.

- [ ] **Step 2: Verify zero behavior change**

Run: `npx vitest run src/lib/sop/notifications-drain.test.ts`
Expected: all pass with `git diff --stat src/lib/sop/notifications-drain.test.ts` showing ZERO changes.

- [ ] **Step 3: Implement the welcome store**

Create `src/lib/workspace/welcome-store.ts`:

```ts
/**
 * Supabase-backed DrainStore for workspace welcome emails. Scans audit_log
 * (the outbox — its trigger records every workspace_members.insert
 * transactionally), resolves against CURRENT membership so removals
 * self-cancel, and claims into workspace_notifications. Service-role only —
 * construct exclusively inside the drain route. All queries batched by id set.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  parseMemberAddedEvent,
  renderWorkspaceWelcomeEmail,
  resolveWorkspaceWelcome,
  type MemberAddedEvent,
  type WorkspaceWelcomePending,
} from "@/domain/workspace/welcome";
import { MAX_SEND_ATTEMPTS, type DrainBatch, type DrainItem, type DrainStore, type RetryItem } from "@/lib/sop/notifications-drain";

const EVENT_WINDOW_DAYS = 30;
const RETRY_LEASE_MINUTES = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

interface WelcomeBundle {
  workspaceNameById: Map<string, string>;
  memberKeySet: Set<string>; // `${workspaceId}:${userId}`
  profileById: Map<string, { fullName: string | null; email: string | null }>;
}

export function createWorkspaceWelcomeDrainStore(admin: SupabaseClient<Database>): DrainStore<WorkspaceWelcomePending> {
  async function loadBundle(events: MemberAddedEvent[]): Promise<WelcomeBundle> {
    const workspaceIds = Array.from(new Set(events.map((event) => event.workspaceId)));
    const userIds = Array.from(
      new Set(events.flatMap((event) => (event.actorId ? [event.recipientId, event.actorId] : [event.recipientId]))),
    );
    const [workspaces, members, profiles] = await Promise.all([
      workspaceIds.length
        ? admin.from("workspaces").select("id, name").in("id", workspaceIds)
        : Promise.resolve({ data: [], error: null }),
      workspaceIds.length
        ? admin.from("workspace_members").select("workspace_id, user_id").in("workspace_id", workspaceIds)
        : Promise.resolve({ data: [], error: null }),
      userIds.length
        ? admin.from("profiles").select("id, full_name, email").in("id", userIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    for (const result of [workspaces, members, profiles]) {
      if (result.error) throw new Error(result.error.message);
    }
    return {
      workspaceNameById: new Map((workspaces.data ?? []).map((row) => [row.id, row.name])),
      memberKeySet: new Set((members.data ?? []).map((row) => `${row.workspace_id}:${row.user_id}`)),
      profileById: new Map(
        (profiles.data ?? []).map((row) => [row.id, { fullName: row.full_name, email: row.email }]),
      ),
    };
  }

  function toItem(
    bundle: WelcomeBundle,
    event: MemberAddedEvent,
    pending: WorkspaceWelcomePending,
    origin: string,
  ): DrainItem<WorkspaceWelcomePending> {
    const selfCaused = event.actorId === null || event.actorId === event.recipientId;
    const actorName = event.actorId ? (bundle.profileById.get(event.actorId)?.fullName ?? null) : null;
    return {
      pending,
      email: bundle.profileById.get(pending.recipientId)?.email ?? null,
      content: renderWorkspaceWelcomeEmail({
        workspaceName: bundle.workspaceNameById.get(pending.workspaceId) ?? "your workspace",
        actorName,
        selfCaused,
        origin,
      }),
    };
  }

  return {
    async collect(now, origin): Promise<DrainBatch<WorkspaceWelcomePending>> {
      const windowStart = new Date(now.getTime() - EVENT_WINDOW_DAYS * DAY_MS).toISOString();
      const { data: rows, error } = await admin
        .from("audit_log")
        .select("id, action, workspace_id, target_id, actor_id, created_at")
        .eq("action", "workspace_members.insert")
        .gte("created_at", windowStart)
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);

      const events = (rows ?? [])
        .map((row) => parseMemberAddedEvent(row))
        .filter((event): event is MemberAddedEvent => event !== null);

      const eventIds = events.map((event) => event.id);
      const { data: ledgerRows, error: ledgerError } = eventIds.length
        ? await admin.from("workspace_notifications").select("event_id, recipient_id").in("event_id", eventIds)
        : { data: [], error: null };
      if (ledgerError) throw new Error(ledgerError.message);
      const covered = new Set((ledgerRows ?? []).map((row) => `${row.event_id}:${row.recipient_id}`));

      const fresh = events.filter((event) => !covered.has(`${event.id}:${event.recipientId}`));
      const bundle = await loadBundle(fresh);

      const items: DrainItem<WorkspaceWelcomePending>[] = [];
      let oldestMs: number | null = null;
      for (const event of fresh) {
        const pending = resolveWorkspaceWelcome(event, {
          isStillMember: bundle.memberKeySet.has(`${event.workspaceId}:${event.recipientId}`),
          workspaceName: bundle.workspaceNameById.get(event.workspaceId) ?? null,
          actorName: null,
        });
        if (!pending) continue;
        items.push(toItem(bundle, event, pending, origin));
        const age = now.getTime() - new Date(event.createdAt).getTime();
        oldestMs = oldestMs === null ? age : Math.max(oldestMs, age);
      }
      return {
        items,
        oldestUnnotifiedEventAgeHours: oldestMs === null ? null : Math.round(oldestMs / (60 * 60 * 1000)),
      };
    },

    async retryItems(now, origin): Promise<RetryItem[]> {
      const lease = new Date(now.getTime() - RETRY_LEASE_MINUTES * 60 * 1000).toISOString();
      const { data, error } = await admin
        .from("workspace_notifications")
        .select("id, workspace_id, recipient_id, event_id, attempts")
        .is("sent_at", null)
        .lt("attempts", MAX_SEND_ATTEMPTS)
        .lt("created_at", lease);
      if (error) throw new Error(error.message);
      const rows = data ?? [];
      if (rows.length === 0) return [];

      const pseudoEvents: MemberAddedEvent[] = rows.map((row) => ({
        id: Number(row.event_id),
        workspaceId: row.workspace_id,
        recipientId: row.recipient_id,
        actorId: null,
        createdAt: "",
      }));
      const bundle = await loadBundle(pseudoEvents);
      return rows.map((row) => ({
        ledgerId: Number(row.id),
        email: bundle.profileById.get(row.recipient_id)?.email ?? null,
        content: renderWorkspaceWelcomeEmail({
          workspaceName: bundle.workspaceNameById.get(row.workspace_id) ?? "your workspace",
          actorName: null,
          selfCaused: true,
          origin,
        }),
        attempts: row.attempts,
      }));
    },

    async claim(pending) {
      const { data, error } = await admin
        .from("workspace_notifications")
        .insert({
          workspace_id: pending.workspaceId,
          recipient_id: pending.recipientId,
          kind: pending.kind,
          event_id: pending.eventId,
        })
        .select("id")
        .single();
      if (error) {
        if (error.code === "23505") return { claimed: false, ledgerId: null };
        throw new Error(error.message);
      }
      return { claimed: true, ledgerId: Number(data.id) };
    },

    async markSent(ledgerId, messageId) {
      const { error } = await admin
        .from("workspace_notifications")
        .update({ sent_at: new Date().toISOString(), resend_message_id: messageId })
        .eq("id", ledgerId);
      if (error) throw new Error(error.message);
    },

    async markFailed(ledgerId, message, attemptsAfter) {
      const { error } = await admin
        .from("workspace_notifications")
        .update({ attempts: attemptsAfter, last_error: message.slice(0, 1000) })
        .eq("id", ledgerId);
      if (error) throw new Error(error.message);
    },
  };
}
```

Note: `toItem` passes `actorName` from the bundle at render time; the `resolveWorkspaceWelcome` ctx's `actorName` field is not used for the decision — only the two guards are. Retried welcomes fall back to the domain wording (actor lookup is not persisted in the ledger) — same accepted cosmetic trade-off as SOP retries.

- [ ] **Step 4: Wire the route**

In `app/api/sops/notifications/drain/route.ts`: add imports:

```ts
import { createWorkspaceWelcomeDrainStore } from "@/lib/workspace/welcome-store";
```

Replace the body of `drain(request)` from the `try {` block onward with:

```ts
  try {
    const send = resendApiKey && resendFrom ? createResendSender(resendApiKey, resendFrom) : null;
    const now = () => new Date();
    const sopReport = await runSopNotificationDrain({
      store: createSopNotificationDrainStore(admin),
      send,
      now,
      origin,
    });
    const workspaceReport = await runSopNotificationDrain({
      store: createWorkspaceWelcomeDrainStore(admin),
      send,
      now,
      origin,
    });
    return NextResponse.json({ configured: send !== null, sop: sopReport, workspace: workspaceReport });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Drain failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
```

(`origin` is the existing trusted-chain value already computed above the try block; do not move it.)

- [ ] **Step 5: Add the kick at the redemption chokepoint**

In `src/domain/supabase-planner.ts`, `ensureDefaultWorkspaceMembership` (~line 1857-1884): after the `Promise.all` containing the `redeem_workspace_access_grants` rpc resolves and its error handling passes, and before `return loadWorkspaceProjectGroups(user.id, supabase);`, insert:

```ts
    // A redemption may have just minted memberships (invite or domain
    // auto-join) — nudge the notification drain so the welcome email lands in
    // seconds instead of at the next cron. Browser-only no-op elsewhere.
    kickSopNotifications();
```

with the import added at the top of the file:

```ts
import { kickSopNotifications } from "@/lib/sop/notify-kick";
```

- [ ] **Step 6: Gate**

Run: `npm run typecheck && npm run lint && npm run test`
Expected: all green; `git diff --stat` shows exactly 4 files changed (drain lib, welcome store, route, supabase-planner).

- [ ] **Step 7: Commit**

```bash
git add src/lib/sop/notifications-drain.ts src/lib/workspace/welcome-store.ts app/api/sops/notifications/drain/route.ts src/domain/supabase-planner.ts
git commit -m "feat(workspace): welcome emails through the notification drain"
```

---

### Task 4: Live verification + finish (controller-run)

**Files:** none.

- [ ] **Step 1: Full gate + build** — `npm run typecheck && npm run lint && npm run test && npm run build`, all green.
- [ ] **Step 2: Live verification** — with the dev server and the local drain (dev CRON_SECRET):
  1. GET drain with bearer → 200, response has `sop` and `workspace` report objects; `workspace.configured` reflects Resend env.
  2. Check live DB: recent `audit_log` rows with `action='workspace_members.insert'` within 30 days; if the current member set predates the window, expected `workspace` items = 0 (no backfill by design) — verify counts line up with the anti-join.
  3. If a fresh add is feasible (re-add a test member or use the members-settings flow), verify the welcome lands and the ledger row is stamped; otherwise verify the rendered template through the domain tests and confirm ledger stays empty (correct-zero, cross-checked in SQL like the SOP feature's Task 8).
  4. Confirm SOP drain still reports correctly under the new response shape.
- [ ] **Step 3: Final whole-branch review** (most capable model), then superpowers:finishing-a-development-branch: push → CI green → merge to main → delete branch. Update memory.
