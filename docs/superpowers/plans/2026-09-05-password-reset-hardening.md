# Password Reset Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the typed recovery code with a link-only password reset on the invite flow's fragment pattern, make every missing-config failure loud and observable, protect users from landing on the wrong deployment host, and prove the auth-mail path daily with a canary the health check watches.

**Architecture:** The reset email carries Supabase's `hashed_token` in the URL fragment of `/reset-password` (never sent to a server, never consumed by a link scanner); the page verifies the token only when the user submits a new password, exactly as `/invite` does today. The request logic moves out of the route into `src/lib/auth/password-recovery-request.ts` so the HTTP route and a cron-called canary share one code path and one ledger. The health endpoint gains an `authMail` section: missing config names plus the freshness/delivery of the latest canary send. `proxy.ts` redirects production `*.vercel.app` hosts to the canonical domain; a server-rendered banner marks preview deployments where service-role features are absent by design.

**Tech Stack:** Next 16 App Router (proxy.ts convention, Node runtime), React 19, Supabase auth admin API (`generateLink`, `verifyOtp` with `token_hash`), Resend via the existing `createEmailSenderFromEnv`, Vitest (+ jsdom for components).

## Global Constraints

- No new dependencies.
- Never log, ledger, or render a token, OTP, or secret — names of missing env vars only.
- `enforce_sop_transition` / `sign_sop` untouched; no migrations needed (ledger and deliveries tables already exist).
- Feature CSS lives in a component-scoped file, never `app/globals.css`.
- Public responses never reveal whether an account exists.
- Canary is enabled only when `AUTH_MAIL_CANARY_EMAIL` is set; unset = "not configured" (not unhealthy).
- Every task: failing test first, then code, then the whole affected suite green.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/domain/auth/password-recovery.ts` (modify) | `passwordResetUrl()`; link-only `renderPasswordRecoveryEmail({ actionLink, email, origin })` |
| `src/components/credential-link-panel.tsx` (create) | Shared fragment-token panel for `invite` and `reset` modes (verify on submit → `updateUser`) |
| `src/components/workspace-invite-acceptance.tsx` (modify) | Becomes a thin wrapper: `mode="invite"` |
| `app/reset-password/page.tsx` (create) | Mounts the panel in `reset` mode |
| `src/lib/auth/password-recovery-request.ts` (create) | `readPasswordRecoveryConfig()`, `requestPasswordRecovery()` — shared by route + canary, records ledger rows for every failure |
| `app/api/auth/password-reset/request/route.ts` (modify) | Thin HTTP adapter: validation, rate limit, config check with loud log + preview message |
| `app/api/auth/password-reset/canary/route.ts` (create) | CRON_SECRET-guarded GET that sends the canary reset |
| `src/domain/notifications/auth-mail-health.ts` (create) | Pure `assessAuthMailHealth()` |
| `src/lib/notifications/transactional-log.ts` (modify) | `latestTransactionalEmailFor(admin, recipientEmail)` |
| `app/api/notifications/health/route.ts` (modify) | Adds `authMail` section; overall verdict includes it |
| `src/components/app-flow-panels.tsx` (modify) | Reset mode becomes "Email me a reset link"; code entry removed |
| `src/lib/auth-form-actions.ts`, `src/components/auth-project-gate.tsx`, `src/components/sop/sop-workspace-provider.tsx` (modify) | Drop `onVerifyRecoveryCode` |
| `app/api/invites/route.ts` (modify) | Loud config log + preview message; ledger row when link generation fails |
| `src/domain/deployment/canonical-host.ts` (create) | Pure `resolveCanonicalRedirect()` + `deploymentBannerText()` |
| `proxy.ts` (modify) | Host redirect before session refresh |
| `src/components/deployment-banner.tsx` + `.css` (create) | Preview banner, mounted in `app/layout.tsx` |
| `scripts/create-auth-mail-canary.mjs` (create) | One-time: create the confirmed canary auth user |
| `vercel.json` (modify) | Daily canary cron |
| `docs/runbooks/notifications.md`, `.env.example` (modify) | Operate it |

---

### Task 1: Link-only recovery email

**Files:** modify `src/domain/auth/password-recovery.ts`, `src/domain/auth/password-recovery.test.ts`

**Interfaces:**
- Produces `passwordResetUrl(siteUrl: string, email: string, tokenHash: string): string` → `${origin}/reset-password#email=…&token_hash=…&type=recovery`
- Produces `renderPasswordRecoveryEmail({ actionLink, email, origin })` (the `code` field is gone)

- [ ] **Step 1: Replace the test file**

```ts
import { describe, expect, it } from "vitest";
import { passwordResetUrl, renderPasswordRecoveryEmail } from "./password-recovery";

describe("passwordResetUrl", () => {
  it("puts the token in the fragment of /reset-password, never in path or query", () => {
    const url = passwordResetUrl("https://pulse.example/", " Person@Example.com ", "hash-123");
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/reset-password");
    expect(parsed.search).toBe("");
    expect(parsed.hash).toBe("#email=person%40example.com&token_hash=hash-123&type=recovery");
  });
});

describe("renderPasswordRecoveryEmail", () => {
  const content = renderPasswordRecoveryEmail({
    actionLink: "https://pulse.example/reset-password#email=person%40example.com&token_hash=hash-123&type=recovery",
    email: "person@example.com",
    origin: "https://pulse.example/",
  });

  it("is a single call to action with no code to type", () => {
    expect(content.subject).toBe("Reset your Pulse password");
    expect(content.html).toContain('href="https://pulse.example/reset-password#email=person%40example.com&token_hash=hash-123&type=recovery"');
    expect(content.html).toContain("Set a new password");
    expect(content.text).toContain("https://pulse.example/reset-password#");
    expect(content.html).not.toMatch(/recovery code|paste code|one-time code/i);
    expect(content.html).not.toContain("supabase.co");
  });

  it("explains expiry and what to do if the request was not theirs", () => {
    expect(content.text).toMatch(/expires/i);
    expect(content.text).toMatch(/did not request/i);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/domain/auth/password-recovery.test.ts` → FAIL (`passwordResetUrl` not exported; `code` required)
- [ ] **Step 3: Implement** — replace the module body:

```ts
export interface PasswordRecoveryEmailInput { actionLink: string; email: string; origin: string; }

export function passwordResetUrl(siteUrl: string, email: string, tokenHash: string): string {
  const url = new URL("/reset-password", siteUrl);
  url.hash = new URLSearchParams({ email: email.trim().toLowerCase(), token_hash: tokenHash, type: "recovery" }).toString();
  return url.toString();
}

export function renderPasswordRecoveryEmail({ actionLink, email, origin }: PasswordRecoveryEmailInput): PasswordRecoveryEmailContent {
  const normalizedOrigin = origin.replace(/\/$/, "");
  const body =
    `<p style="…">Someone asked to reset the password for <strong>${escapeHtml(email)}</strong>. Choose a new one with the button below.</p>` +
    `<p style="…">The link expires and works once. If you did not request a reset, you can ignore this email — your password stays as it is.</p>`;
  return { subject: "Reset your Pulse password", text: [...].join("\n\n"), html: renderEmailShell({ …, ctaLabel: "Set a new password", ctaHref: actionLink, … }) };
}
```

- [ ] **Step 4: Run** the test → PASS. **Step 5: Commit** `feat(auth): link-only password reset email`

### Task 2: Shared credential-link panel + /reset-password page

**Files:** create `src/components/credential-link-panel.tsx`, `src/components/credential-link-panel.test.tsx`, `app/reset-password/page.tsx`; modify `src/components/workspace-invite-acceptance.tsx` (wrapper), keep its test passing.

**Interfaces:** `CredentialLinkPanel({ mode: "invite" | "reset" })`; `PasswordResetPanel()`; `WorkspaceInviteAcceptancePanel()` unchanged signature.

- [ ] Test (jsdom, same mocks as `workspace-invite-acceptance.test.tsx`): reset mode with `#email=…&token_hash=h&type=recovery` renders heading "Set a new password" and does **not** call `verifyOtp` until submit; on submit calls `verifyOtp({ token_hash: "h", type: "recovery" })` then `updateUser({ password })`, then `router.replace("/")`; an `invite`-typed hash on the reset page is rejected ("This reset link is incomplete"); expired error maps to "This reset link has expired or was already used. Request a new one from Forgot password."; missing hash → error panel with "Go to sign in".
- [ ] Run → FAIL (module missing). Implement by moving the body of `WorkspaceInviteAcceptancePanel` into `CredentialLinkPanel` with a `COPY[mode]` table (loading title, incomplete-link copy, expired copy, `PasswordUpdatePanel mode`), and `acceptance.type` must equal the mode's expected type (`invite` accepts `invite` or `recovery` — resend links are recovery-typed; `reset` accepts only `recovery`). Invite wrapper: `export function WorkspaceInviteAcceptancePanel() { return <CredentialLinkPanel mode="invite" />; }`. Page: `export default function ResetPasswordPage() { return <PasswordResetPanel />; }`.
- [ ] Run both component tests → PASS. Commit `feat(auth): /reset-password page on the invite fragment-token pattern`

### Task 3: Shared request core with a ledger row for every failure

**Files:** create `src/lib/auth/password-recovery-request.ts` + test.

**Interfaces:**
```ts
export const PASSWORD_RECOVERY_ENV = ["NEXT_PUBLIC_SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","RESEND_API_KEY","RESEND_FROM"] as const;
export interface RecoveryConfigCheck { ok: boolean; missing: string[]; }
export function readPasswordRecoveryConfig(env: NodeJS.ProcessEnv, origin: string): RecoveryConfigCheck; // origin "" counts as missing "site origin"
export function describeUnavailable(vercelEnv: string | undefined): string; // preview → "Password recovery is disabled on preview deployments. Use the production site." else "Password recovery is temporarily unavailable."
export type RecoveryOutcome = { kind: "sent"; ledgerRecorded: boolean; resendMessageId: string } | { kind: "unknown_user" } | { kind: "failed"; stage: "generate_link" | "send"; detail: string };
export async function requestPasswordRecovery(input: { email: string; origin: string; admin: AdminClient; send: EmailSender; log?: (message: string, meta: Record<string, unknown>) => void }): Promise<RecoveryOutcome>;
```
- [ ] Tests: unknown user → `unknown_user`, no send, no ledger; generateLink error → `failed/generate_link` AND ledger row `{ kind: "password_recovery", status: "failed", error: "generate_link: <code>" }`; missing `hashed_token` → failed with detail `missing_token`; happy path → email `to` = normalized email, html contains `/reset-password#email=…&token_hash=HASH&type=recovery`, ledger row sent with resend id, idempotency key starts `recovery:`; send failure → ledger failed row + outcome `failed/send`; the log callback never receives the token (assert `JSON.stringify(calls)` lacks `HASH`).
- [ ] Implement (fake admin `{ auth: { admin: { generateLink } }, from: () => insertBuilder }` in tests). Commit `feat(auth): password recovery request core records every failure`

### Task 4: Route becomes a thin adapter with loud config failures

**Files:** modify `app/api/auth/password-reset/request/route.ts` + `route.test.ts`.

- [ ] Tests: missing `SUPABASE_SERVICE_ROLE_KEY` → 503, body `{ error: describeUnavailable(...) }`, and `console.error` called with `{ missing: ["SUPABASE_SERVICE_ROLE_KEY"], environment }` (spy) — never the value; with `VERCEL_ENV=preview` the message names preview deployments; happy path body message becomes `"If an account exists, a reset link has been sent."`; html contains `/reset-password#email=person%40example.com&token_hash=hash-1&type=recovery` and no `supabase.co`; unknown user unchanged; rate limit unchanged.
- [ ] Implement: keep `passwordRecoveryOrigin`, validation, rate limits; then `readPasswordRecoveryConfig` → on failure `console.error("password recovery unavailable", { missing, environment: process.env.VERCEL_ENV ?? "unknown" })` + 503; else `requestPasswordRecovery(...)` → `failed` → `console.error("password recovery failed", { stage, detail })` + 503; `sent`/`unknown_user` → accepted. Commit `fix(auth): password reset route logs missing config and names preview deployments`

### Task 5: Client — request a link, no code entry

**Files:** modify `src/components/app-flow-panels.tsx`, `src/components/app-flow-panels.test.tsx`, `src/lib/auth-form-actions.ts`, `src/components/auth-project-gate.tsx`, `src/components/sop/sop-workspace-provider.tsx`.

- [ ] Test rewrite (`AuthFormPanel password recovery`): click "Forgot password?" → heading "Reset password", subtitle mentions a link; submit "Email me a reset link" → `onResetPassword("person@example.com")`; afterwards the form stays on reset mode, button reads "Send another link", and a "Back to sign in" control exists; no element labelled "Recovery code" anywhere; the `#auth=recovery` hash test is deleted.
- [ ] Implement: `AUTH_MODE_COPY.reset = { title: "Reset password", subtitle: "We'll email you a link to set a new password.", submit: "Email me a reset link", busy: "Sending link" }`; drop `recoveryCode*` state, `pasteRecoveryCode`, the hash effect, the code field, `onVerifyRecoveryCode` prop; after a successful request set `linkRequested` → submit label "Send another link". Remove `handleVerifyRecoveryCode` from `useAuthFormActions`; remove the prop at both mount sites. Messages: `"If an account exists, a reset link has been sent."` also added to the success regex in `normalizeAuthMessage` (`reset link`).
- [ ] `npx vitest run src/components src/lib/auth-form-actions*` → PASS; `npm run typecheck` → clean. Commit `feat(auth): reset form requests a link instead of a code`

### Task 6: Canary endpoint + cron + creation script

**Files:** create `app/api/auth/password-reset/canary/route.ts` + `route.test.ts`, `scripts/create-auth-mail-canary.mjs`; modify `vercel.json`, `.env.example`.

- [ ] Tests: no bearer → 401; `AUTH_MAIL_CANARY_EMAIL` unset → 503 `{ error: "AUTH_MAIL_CANARY_EMAIL is not set." }`; config missing → 503 naming missing; happy path → 200 `{ ok: true, recipient, resendMessageId }` and `requestPasswordRecovery` called with the canary email; `unknown_user` → 503 `{ error: "Canary account does not exist. Run scripts/create-auth-mail-canary.mjs." }`.
- [ ] Implement with `isAuthorizedCronRequest`; origin from `passwordRecoveryOrigin`; `createEmailSenderFromEnv().send`.
- [ ] `vercel.json`: add `{ "path": "/api/auth/password-reset/canary", "schedule": "30 12 * * *" }`.
- [ ] Script: reads `.env.local`, `admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { pulse_canary: true } })` if `listUsers` shows none with that email; prints the id only. `.env.example`: `AUTH_MAIL_CANARY_EMAIL=delivered@resend.dev` with a comment. Commit `feat(auth): daily password-reset canary`

### Task 7: Auth-mail health

**Files:** create `src/domain/notifications/auth-mail-health.ts` + test; modify `src/lib/notifications/transactional-log.ts` (+ test), `app/api/notifications/health/route.ts`.

**Interfaces:**
```ts
export const CANARY_STALE_HOURS = 26; export const CANARY_DELIVERY_GRACE_MINUTES = 15;
export interface CanaryObservation { requestedAt: string; status: "sent" | "failed"; error: string | null; deliveredAt: string | null; }
export interface AuthMailHealthInput { now: Date; missingConfig: string[]; canaryEmail: string | null; latestCanary: CanaryObservation | null; }
export interface AuthMailHealth { healthy: boolean; problems: string[]; canary: "not_configured" | "never_ran" | "ok" | "stale" | "failed" | "undelivered"; }
export function assessAuthMailHealth(input: AuthMailHealthInput): AuthMailHealth;
export async function latestTransactionalEmailFor(admin, recipientEmail): Promise<{ createdAt; status; error; resendMessageId } | null>;
```
- [ ] Domain tests: missing config → problems list the names; canaryEmail null → `not_configured`, healthy (config permitting); never ran → unhealthy "auth-mail canary has never run"; failed → "auth-mail canary failed: <error>"; sent 20 min ago without delivered → `undelivered`; sent 3 min ago without delivered → ok (grace); sent 30h ago delivered → `stale`; recent + delivered → ok.
- [ ] Route: compute `missingConfig` via `readPasswordRecoveryConfig(process.env, origin)`; read latest canary row + `latestDeliveryStatuses([id])` (delivered when `latestEvent === "email.delivered"`); response `{ ...drainVerdict, authMail, healthy: both, problems: [...drain, ...authMail] }`. Commit `feat(notifications): health reports auth-mail readiness and the canary`

### Task 8: Invites — same treatment

**Files:** modify `app/api/invites/route.ts` + `route.test.ts`.

- [ ] Tests: `SUPABASE_SERVICE_ROLE_KEY` missing → response reason uses `describeUnavailable`-style text (preview aware) and `console.error` called with missing names; `generateSetupLink` returning `unavailable` → ledger row `{ kind: "invite", status: "failed", error: "generate_link: …" }`.
- [ ] Implement: shared helper `logMissingConfig(feature, missing)` in `src/lib/auth/password-recovery-request.ts` (rename file scope: `src/lib/auth/mail-config.ts` if cleaner — keep one module). Commit `fix(invites): loud config failures and ledger rows for link generation failures`

### Task 9: Canonical host redirect + preview banner

**Files:** create `src/domain/deployment/canonical-host.ts` + test, `src/components/deployment-banner.tsx`, `src/components/deployment-banner.css`; modify `proxy.ts`, `app/layout.tsx`.

**Interfaces:**
```ts
export function resolveCanonicalRedirect(input: { requestUrl: string; vercelEnv: string | undefined; siteUrl: string | undefined }): string | null;
export function deploymentBannerText(vercelEnv: string | undefined): string | null; // preview → text, else null
```
- [ ] Tests: production + `*.vercel.app` host + siteUrl → redirect to same path+search on canonical host; production + canonical host → null; preview → null; missing siteUrl → null; non-vercel host (custom secondary domain) → null; banner: preview → "Preview deployment — invitations and password reset are disabled here. Use pulse.agenticlabs.studio." (uses siteUrl host if provided), production/undefined → null.
- [ ] `proxy.ts`: first lines `const redirect = resolveCanonicalRedirect({ requestUrl: request.url, vercelEnv: process.env.VERCEL_ENV, siteUrl: process.env.NEXT_PUBLIC_SITE_URL }); if (redirect) return NextResponse.redirect(redirect, 308);`
- [ ] Banner: server component reading `process.env.VERCEL_ENV`, renders `<div className="deployment-banner" role="status">` or null; CSS in its own file; mounted at the top of `<body>` in `app/layout.tsx`. Commit `feat(deploy): redirect production vercel.app hosts and flag preview deployments`

### Task 10: Docs + verification + hand-off

- [ ] `docs/runbooks/notifications.md`: §1 add `AUTH_MAIL_CANARY_EMAIL` to the env table and a step "create the canary user (`node scripts/create-auth-mail-canary.mjs`), run `GET /api/auth/password-reset/canary` once with the CRON_SECRET header, confirm `/api/notifications/health` shows `authMail.canary: "ok"`"; §2 add the reset flow + `/reset-password`; §3 symptom rows: "Password recovery temporarily unavailable" → check Host (preview?) then Vercel logs `missing`; "canary undelivered" → Resend/webhook; "redirected to pulse.agenticlabs.studio unexpectedly" → by design for production vercel.app hosts.
- [ ] Audit follow-up: append "2026-09-05 evening incident" paragraph linking this plan.
- [ ] `npm run typecheck && npm run lint && npx vitest run && npm run build` → all green. Push branch; CI green; report UI changes (reset form copy, `/reset-password`, preview banner) and wait for the user's review before merge.
- [ ] Go-live (after merge, user-gated where noted): set `AUTH_MAIL_CANARY_EMAIL=delivered@resend.dev` in Vercel Production (user), run the creation script (service role from `.env.local`), hit the canary once, verify health `authMail.canary === "ok"`, verify the user's own reset end to end on pulse.agenticlabs.studio.
