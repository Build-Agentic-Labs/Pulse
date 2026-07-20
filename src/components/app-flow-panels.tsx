"use client";

// Route-scoped styles: the split sign-in screen (~8 kB of .ui-auth-* rules)
// previously shipped to every route via globals.css. Loading them with this
// component keeps them off pages that never render the auth panels.
import "./app-flow-panels.css";

import { Moon, RefreshCw, Sun } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { NothingLoadingBlock, NothingSpinner, NothingStatus } from "@/components/nothing-ui";
import { useTheme } from "@/components/theme-provider";
import { SIGNUP_DOMAIN_MESSAGE } from "@/lib/allowed-signup-domain";

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// ── Brand dot field: a full-bleed field of dim dots with an idle glow beam
// drifting across it, plus a soft "zoom lens" of bright dots that follows the
// pointer. The lens position is driven by CSS custom properties set on the
// panel element, throttled through requestAnimationFrame. ────────────────────
function BrandPanel() {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) {
      return;
    }
    let raf = 0;
    let px = 0;
    let py = 0;

    function handleMove(event: PointerEvent) {
      if (!el) {
        return;
      }
      const rect = el.getBoundingClientRect();
      px = event.clientX - rect.left;
      py = event.clientY - rect.top;
      el.classList.add("is-hover");
      if (!raf) {
        raf = requestAnimationFrame(() => {
          raf = 0;
          el.style.setProperty("--ui-auth-mx", `${px}px`);
          el.style.setProperty("--ui-auth-my", `${py}px`);
        });
      }
    }

    function handleLeave() {
      el?.classList.remove("is-hover");
    }

    el.addEventListener("pointermove", handleMove);
    el.addEventListener("pointerleave", handleLeave);
    return () => {
      el.removeEventListener("pointermove", handleMove);
      el.removeEventListener("pointerleave", handleLeave);
      if (raf) {
        cancelAnimationFrame(raf);
      }
    };
  }, []);

  return (
    <aside className="ui-auth-brand" ref={ref}>
      <div className="ui-auth-dotfield" aria-hidden="true" />
      <div className="ui-auth-dotglow" aria-hidden="true" />
      <div className="ui-auth-dotlens" aria-hidden="true" />
      <div className="ui-auth-brand-top">
        <span className="ui-auth-wordmark">Pulse</span>
        <p className="ui-auth-brand-desc">
          Real-time production analytics for the shop floor — track takt time, throughput, and downtime as they happen.
        </p>
      </div>
      <div className="ui-auth-brand-mid">
        <GlossaryCarousel />
        <div className="ui-auth-foot ui-eyebrow">
          <span className="ui-auth-foot-dot" /> Anacorp Manufacturing
        </div>
      </div>
    </aside>
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
      <div className="ui-auth-gloss-stack">
        {GLOSSARY.map(([term, definition], n) => (
          <article key={term} className={`ui-auth-term ${n === index ? "is-active" : ""}`}>
            <h2>{term}</h2>
            <p>{definition}</p>
          </article>
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

      <BrandPanel />

      <main className="ui-auth-form-side">
        <div className="ui-auth-form-wrap">
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
              <button className="ui-btn-primary h-9 w-full" type="submit" disabled={isSubmitting}>
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
