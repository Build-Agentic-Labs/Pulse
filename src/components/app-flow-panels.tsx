"use client";

import { Moon, RefreshCw, Sun } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { NothingLoadingBlock, NothingSpinner, NothingStatus } from "@/components/nothing-ui";
import { useTheme } from "@/components/theme-provider";
import { SIGNUP_DOMAIN_MESSAGE } from "@/lib/allowed-signup-domain";

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// ── Line-balancing brand animation: an overloaded line (Station 2 over takt)
// rebalances into an even, within-takt layout, looping. ────────────────────
const LB_START = 34;
const LB_SLOT = 54;
const LB_W = 46;
const LB_LANEY = [8, 58, 108];
const LB_BAD = [[0], [1, 2, 3, 4, 5], [6, 7]];
const LB_GOOD = [[0, 1, 2], [3, 4], [5, 6, 7]];

type LbPos = Record<number, { left: number; top: number; hot: boolean }>;

function lbPositions(layout: number[][]): LbPos {
  const pos: LbPos = {};
  layout.forEach((ids, lane) => {
    ids.forEach((id, slot) => {
      // Centre the 22px block in the 42px lane band.
      pos[id] = { left: LB_START + slot * LB_SLOT, top: LB_LANEY[lane] + 10, hot: slot >= 3 };
    });
  });
  return pos;
}

const LB_POS_BAD = lbPositions(LB_BAD);
const LB_POS_GOOD = lbPositions(LB_GOOD);

function LineBalanceArt() {
  const [good, setGood] = useState(false);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setGood(true);
      return;
    }
    const timer = window.setInterval(() => setGood((value) => !value), 4800);
    return () => window.clearInterval(timer);
  }, []);

  const pos = good ? LB_POS_GOOD : LB_POS_BAD;

  return (
    <div className={`ui-lb ${good ? "is-good" : ""}`} aria-hidden="true">
      <div className="ui-lb-head">
        <div className="ui-lb-status">
          <span className="ui-lb-badge" />
          <div>
            <div className="ui-lb-title">{good ? "Balanced" : "Unbalanced"}</div>
            <div className="ui-lb-sub">{good ? "All stations within takt" : "Station 2 exceeds takt"}</div>
          </div>
        </div>
        <div className="ui-lb-metric">
          <div className="ui-lb-metric-v">{good ? "96%" : "61%"}</div>
          <div className="ui-lb-metric-l">Balance</div>
        </div>
      </div>
      <div className="ui-lb-chart">
        {LB_LANEY.map((y, i) => (
          <div key={i} className="ui-lb-lane" style={{ top: y }}>
            <span className="ui-lb-tag">S{i + 1}</span>
            <span className="ui-lb-rail" />
          </div>
        ))}
        <div className="ui-lb-takt" />
        {Array.from({ length: 8 }, (_, id) => {
          const p = pos[id];
          return (
            <div
              key={id}
              className={`ui-lb-blk ${!good && p.hot ? "is-hot" : ""}`}
              style={{ width: LB_W, left: p.left, top: p.top }}
            />
          );
        })}
      </div>
    </div>
  );
}

const GLOSSARY: Array<[string, string]> = [
  ["Takt Time", "The pace production must hold to meet demand — available time divided by the units required."],
  ["Line Balancing", "Distributing work evenly across stations so no single operator becomes the bottleneck."],
  ["Work Order", "A released instruction to build a specific quantity of a product by a due date."],
  ["Cycle Time", "The time to complete one unit at a station, from the first touch to the last."],
  ["Traveler", "The record that moves with a work order, capturing what happened at every step."],
  ["Throughput", "The number of finished units a line completes over a given period."],
];

function GlossaryCarousel() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (prefersReducedMotion()) {
      return;
    }
    const timer = window.setInterval(() => setIndex((value) => (value + 1) % GLOSSARY.length), 4600);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="ui-auth-gloss">
      <div className="ui-auth-gloss-label ui-eyebrow">
        <span className="ui-auth-gloss-dot" /> Manufacturing glossary
      </div>
      <div className="ui-auth-gloss-stack">
        {GLOSSARY.map(([term, definition], n) => (
          <article key={term} className={`ui-auth-term ${n === index ? "is-active" : ""}`}>
            <h2>{term}</h2>
            <p>{definition}</p>
          </article>
        ))}
      </div>
      <div className="ui-auth-dots">
        {GLOSSARY.map(([term], n) => (
          <button
            key={term}
            type="button"
            aria-label={`Show ${term}`}
            className={n === index ? "is-active" : ""}
            onClick={() => setIndex(n)}
          />
        ))}
      </div>
    </div>
  );
}

function FlowShell({ children }: { children: ReactNode }) {
  const { theme, toggleTheme } = useTheme();

  return (
    <main className="ui-flow-shell">
      <div className="ui-flow-shell-actions">
        <button type="button" onClick={toggleTheme} className="ui-btn-ghost h-9 w-9 px-0" title="Toggle theme">
          {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
        </button>
      </div>
      {children}
    </main>
  );
}

function normalizeAuthMessage(message: string) {
  const trimmed = message.trim();
  if (!trimmed || /auth session missing/i.test(trimmed)) {
    return null;
  }

  return trimmed;
}

function authMessageTone(message: string): "error" | "info" {
  if (/account created|confirm the email|email sent|check your inbox|password updated/i.test(message)) {
    return "info";
  }

  return "error";
}

function formatAuthMessage(message: string) {
  const normalized = message.trim().replace(/\.$/, "");
  const rewrites: Record<string, string> = {
    "invalid login credentials": "Invalid email or password.",
    "anonymous sign-ins are disabled": "Anonymous sign-ins are disabled.",
    "email not confirmed": "Confirm your email before signing in.",
    "user already registered": "An account with this email already exists.",
    // The signup-domain trigger surfaces as an opaque DB error through some auth paths.
    "database error saving new user": SIGNUP_DOMAIN_MESSAGE,
  };

  const rewrite = rewrites[normalized.toLowerCase()];
  if (rewrite) {
    return rewrite;
  }

  if (normalized === normalized.toUpperCase()) {
    const sentence = normalized.charAt(0) + normalized.slice(1).toLowerCase();
    return sentence.endsWith(".") ? sentence : `${sentence}.`;
  }

  return message.trim().endsWith(".") ? message.trim() : `${message.trim()}.`;
}

export function AppLoadingShell({
  title = "Loading…",
}: {
  title?: string;
}) {
  return (
    <FlowShell>
      <section className="ui-auth-card ui-auth-card-compact">
        <div className="ui-auth-card-body">
          <NothingLoadingBlock title={title} />
        </div>
      </section>
    </FlowShell>
  );
}

function MicrosoftLogo() {
  return (
    <svg width="16" height="16" viewBox="0 0 21 21" aria-hidden="true" focusable="false">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

type AuthFormMode = "signin" | "signup" | "reset";

const AUTH_MODE_COPY: Record<AuthFormMode, { title: string; subtitle: string; submit: string; busy: string }> = {
  signin: { title: "Sign in", subtitle: "Welcome back. Use your work email.", submit: "Sign in", busy: "Signing in" },
  signup: {
    title: "Create account",
    subtitle: "Create your account with your work email.",
    submit: "Create account",
    busy: "Creating account",
  },
  reset: {
    title: "Reset password",
    subtitle: "We'll email you a link to set a new password.",
    submit: "Send reset link",
    busy: "Sending link",
  },
};

export function AuthFormPanel({
  message,
  isSubmitting,
  onSignIn,
  onCreateAccount,
  onMicrosoftSignIn,
  onResetPassword,
  onResendConfirmation,
}: {
  /** Retained for API compatibility; the split screen derives its heading per mode. */
  eyebrow?: string;
  title?: string;
  message: string;
  isSubmitting: boolean;
  onSignIn: (email: string, password: string) => void;
  onCreateAccount: (email: string, password: string, fullName?: string) => void;
  onMicrosoftSignIn?: () => void;
  onResetPassword?: (email: string) => void;
  onResendConfirmation?: (email: string) => void;
}) {
  const { theme, toggleTheme } = useTheme();
  const [mode, setMode] = useState<AuthFormMode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const visibleMessage = normalizeAuthMessage(message);
  const messageTone = visibleMessage ? authMessageTone(visibleMessage) : null;
  const copy = AUTH_MODE_COPY[mode];
  // Offer a resend only where it helps: after signup or an unconfirmed sign-in attempt.
  const showResend = Boolean(
    onResendConfirmation && visibleMessage && /confirm/i.test(visibleMessage) && messageTone !== null,
  );

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode === "signin") {
      onSignIn(email, password);
    } else if (mode === "signup") {
      onCreateAccount(email, password, fullName);
    } else {
      onResetPassword?.(email);
    }
  }

  return (
    <div className="ui-auth-split">
      <div className="ui-auth-theme">
        <button type="button" onClick={toggleTheme} className="ui-btn-ghost h-9 w-9 px-0" title="Toggle theme">
          {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
        </button>
      </div>

      <aside className="ui-auth-brand">
        <div>
          <span className="ui-auth-wordmark">Pulse</span>
        </div>
        <div className="ui-auth-art">
          <LineBalanceArt />
        </div>
        <GlossaryCarousel />
        <div className="ui-auth-foot ui-eyebrow">
          <span className="ui-auth-foot-dot" /> Anacorp Manufacturing
        </div>
      </aside>

      <main className="ui-auth-form-side">
        <div className="ui-auth-form-wrap">
          <p className="ui-eyebrow">Organization access</p>
          <h1 className="ui-auth-h1">{copy.title}</h1>
          <p className="ui-auth-subtitle">{copy.subtitle}</p>

          <form className="ui-auth-form" onSubmit={submit}>
            {mode === "signup" ? (
              <div className="ui-auth-field">
                <label htmlFor="auth-name">Full name</label>
                <input
                  id="auth-name"
                  className="ui-auth2-input"
                  type="text"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  autoComplete="name"
                  placeholder="Your name"
                  required
                />
              </div>
            ) : null}

            <div className="ui-auth-field">
              <label htmlFor="auth-email">Work email</label>
              <input
                id="auth-email"
                className="ui-auth2-input"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                placeholder="you@anacorp.com"
                required
              />
            </div>

            {mode !== "reset" ? (
              <div className="ui-auth-field">
                <div className="ui-auth-field-row">
                  <label htmlFor="auth-password">Password</label>
                  {mode === "signin" && onResetPassword ? (
                    <button
                      type="button"
                      className="ui-auth-forgot"
                      onClick={() => setMode("reset")}
                      disabled={isSubmitting}
                    >
                      Forgot password?
                    </button>
                  ) : null}
                </div>
                <input
                  id="auth-password"
                  className="ui-auth2-input"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  placeholder={mode === "signup" ? "Choose a password" : "Enter your password"}
                  required
                />
              </div>
            ) : null}

            {visibleMessage ? (
              <p className={`ui-auth-msg ${messageTone === "info" ? "ui-auth-msg-info" : "ui-auth-msg-error"}`} role="alert">
                {formatAuthMessage(visibleMessage)}
              </p>
            ) : null}

            {showResend ? (
              <button
                type="button"
                className="ui-auth-btn ui-auth-btn-ghost"
                disabled={isSubmitting}
                onClick={() => onResendConfirmation?.(email)}
              >
                Resend confirmation email
              </button>
            ) : null}

            <button className="ui-auth-btn ui-auth-btn-primary" type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <span className="flex items-center gap-3">
                  <NothingSpinner inline />
                  <NothingStatus>{copy.busy}</NothingStatus>
                </span>
              ) : (
                copy.submit
              )}
            </button>

            {mode !== "reset" ? (
              <>
                <div className="ui-auth-or">
                  <span>Or</span>
                </div>
                {onMicrosoftSignIn ? (
                  <button
                    className="ui-auth-btn ui-auth-btn-ghost"
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => onMicrosoftSignIn()}
                  >
                    <MicrosoftLogo />
                    Continue with Microsoft
                  </button>
                ) : null}
              </>
            ) : null}

            <button
              className="ui-auth-btn ui-auth-btn-ghost"
              type="button"
              disabled={isSubmitting}
              onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            >
              {mode === "signin" ? "Create account" : "Back to sign in"}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}

/**
 * Shown when the user lands from a password-reset email (Supabase fires PASSWORD_RECOVERY).
 * Sets the new password on the recovery session, then hands back to the app.
 */
export function PasswordUpdatePanel({
  message,
  isSubmitting,
  onUpdatePassword,
}: {
  message: string;
  isSubmitting: boolean;
  onUpdatePassword: (password: string) => void;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [localError, setLocalError] = useState("");
  const visibleMessage = normalizeAuthMessage(localError || message);
  const messageTone = visibleMessage ? authMessageTone(visibleMessage) : null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password.length < 8) {
      setLocalError("Use at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setLocalError("Passwords do not match.");
      return;
    }
    setLocalError("");
    onUpdatePassword(password);
  }

  return (
    <FlowShell>
      <section className="ui-auth-card">
        <header className="ui-auth-card-header">
          <div className="ui-auth-brand font-display">Pulse</div>
          <p className="ui-eyebrow mt-3">Password reset</p>
          <h1 className="ui-section-title mt-2">Set a new password</h1>
          <p className="ui-section-subtitle mt-1">Choose a new password for your account.</p>
        </header>

        <div className="ui-auth-card-body">
          <form className="ui-field-group" onSubmit={submit}>
            <label className="block">
              <span className="ui-field-label">New password</span>
              <input
                className="ui-field-standalone font-mono"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                placeholder="At least 8 characters"
                required
              />
            </label>

            <label className="block">
              <span className="ui-field-label">Confirm password</span>
              <input
                className="ui-field-standalone font-mono"
                type="password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                autoComplete="new-password"
                placeholder="Repeat the password"
                required
              />
            </label>

            {visibleMessage ? (
              <p
                className={`ui-auth-message ${messageTone === "info" ? "ui-auth-message-info" : "ui-auth-message-error"}`}
                role="alert"
              >
                {formatAuthMessage(visibleMessage)}
              </p>
            ) : null}

            <div className="pt-1">
              <button className="ui-btn-primary font-mono h-11 w-full" type="submit" disabled={isSubmitting}>
                {isSubmitting ? (
                  <span className="flex items-center gap-3">
                    <NothingSpinner inline />
                    <NothingStatus>Updating password</NothingStatus>
                  </span>
                ) : (
                  "Update password"
                )}
              </button>
            </div>
          </form>
        </div>
      </section>
    </FlowShell>
  );
}

export function ErrorRecoveryPanel({
  title,
  body,
  actionLabel = "Retry",
  onRetry,
}: {
  title: string;
  body: string;
  actionLabel?: string;
  onRetry: () => void;
}) {
  return (
    <FlowShell>
      <section className="ui-auth-card">
        <header className="ui-auth-card-header">
          <p className="ui-eyebrow text-danger">Needs attention</p>
          <h1 className="ui-section-title mt-2">{title}</h1>
        </header>
        <div className="ui-auth-card-body">
          <p className="text-[13px] leading-relaxed text-ink-secondary">{body}</p>
          <button className="ui-btn-primary mt-6 gap-2" onClick={onRetry}>
            <RefreshCw size={15} />
            {actionLabel}
          </button>
        </div>
      </section>
    </FlowShell>
  );
}
