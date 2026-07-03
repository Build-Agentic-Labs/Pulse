"use client";

import { Moon, RefreshCw, Sun } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { NothingLoadingBlock, NothingSpinner, NothingStatus } from "@/components/nothing-ui";
import { useTheme } from "@/components/theme-provider";
import { SIGNUP_DOMAIN_MESSAGE } from "@/lib/allowed-signup-domain";

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
  title = "Loading workspace",
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

const AUTH_MODE_COPY: Record<AuthFormMode, { subtitle: string; submit: string; busy: string }> = {
  signin: { subtitle: "Sign in with your work email.", submit: "Sign in", busy: "Signing in" },
  signup: { subtitle: "Create your account with your work email.", submit: "Create account", busy: "Creating account" },
  reset: { subtitle: "We'll email you a link to set a new password.", submit: "Send reset link", busy: "Sending link" },
};

export function AuthFormPanel({
  eyebrow = "Pulse",
  title,
  message,
  isSubmitting,
  onSignIn,
  onCreateAccount,
  onMicrosoftSignIn,
  onResetPassword,
  onResendConfirmation,
}: {
  eyebrow?: string;
  title: string;
  message: string;
  isSubmitting: boolean;
  onSignIn: (email: string, password: string) => void;
  onCreateAccount: (email: string, password: string, fullName?: string) => void;
  onMicrosoftSignIn?: () => void;
  onResetPassword?: (email: string) => void;
  onResendConfirmation?: (email: string) => void;
}) {
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
    <FlowShell>
      <section className="ui-auth-card">
        <header className="ui-auth-card-header">
          <div className="ui-auth-brand font-display">{eyebrow}</div>
          <p className="ui-eyebrow mt-3">Organization access</p>
          <h1 className="ui-section-title mt-2">{title}</h1>
          <p className="ui-section-subtitle mt-1">{copy.subtitle}</p>
        </header>

        <div className="ui-auth-card-body">
          <form className="ui-field-group" onSubmit={submit}>
            {mode === "signup" ? (
              <label className="block">
                <span className="ui-field-label">Full name</span>
                <input
                  className="ui-field-standalone font-mono"
                  type="text"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  autoComplete="name"
                  placeholder="Your name"
                  required
                />
              </label>
            ) : null}

            <label className="block">
              <span className="ui-field-label">Email</span>
              <input
                className="ui-field-standalone font-mono"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                placeholder="you@company.com"
                required
              />
            </label>

            {mode !== "reset" ? (
              <label className="block">
                <span className="ui-field-label">Password</span>
                <input
                  className="ui-field-standalone font-mono"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  placeholder={mode === "signup" ? "Choose a password" : "Enter password"}
                  required
                />
              </label>
            ) : null}

            {mode === "signin" && onResetPassword ? (
              <div className="text-right">
                <button
                  type="button"
                  className="ui-auth-link text-[12px] text-ink-secondary underline-offset-2 hover:underline"
                  onClick={() => setMode("reset")}
                  disabled={isSubmitting}
                >
                  Forgot password?
                </button>
              </div>
            ) : null}

            {visibleMessage ? (
              <p
                className={`ui-auth-message ${messageTone === "info" ? "ui-auth-message-info" : "ui-auth-message-error"}`}
                role="alert"
              >
                {formatAuthMessage(visibleMessage)}
              </p>
            ) : null}

            {showResend ? (
              <button
                type="button"
                className="ui-btn-ghost font-mono h-9 w-full disabled:opacity-40"
                disabled={isSubmitting}
                onClick={() => onResendConfirmation?.(email)}
              >
                Resend confirmation email
              </button>
            ) : null}

            <div className="space-y-2.5 pt-1">
              <button className="ui-btn-primary font-mono h-11 w-full" type="submit" disabled={isSubmitting}>
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
                  <div className="ui-auth-divider">
                    <span className="ui-auth-divider-line" aria-hidden="true" />
                    <span className="ui-auth-divider-label">Or</span>
                    <span className="ui-auth-divider-line" aria-hidden="true" />
                  </div>

                  {onMicrosoftSignIn ? (
                    <button
                      className="ui-btn-ghost font-mono h-11 w-full gap-2.5 disabled:opacity-40"
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
                className="ui-btn-ghost font-mono h-11 w-full disabled:opacity-40"
                type="button"
                disabled={isSubmitting}
                onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
              >
                {mode === "signin" ? "Create account" : "Back to sign in"}
              </button>
            </div>
          </form>
        </div>
      </section>
    </FlowShell>
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
