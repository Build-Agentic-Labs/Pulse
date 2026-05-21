"use client";

import { Moon, RefreshCw, Sun } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { NothingLoadingBlock, NothingSpinner, NothingStatus } from "@/components/nothing-ui";
import { useTheme } from "@/components/theme-provider";

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
  if (/account created|confirm the email/i.test(message)) {
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
  body = "Reading the latest planner data.",
}: {
  title?: string;
  body?: string;
}) {
  return (
    <FlowShell>
      <section className="ui-auth-card">
        <div className="ui-auth-card-body">
          <NothingLoadingBlock title={title} body={body} />
        </div>
      </section>
    </FlowShell>
  );
}

export function AuthFormPanel({
  eyebrow = "Pulse",
  title,
  message,
  isSubmitting,
  onSignIn,
  onCreateAccount,
}: {
  eyebrow?: string;
  title: string;
  message: string;
  isSubmitting: boolean;
  onSignIn: (email: string, password: string) => void;
  onCreateAccount: (email: string, password: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const visibleMessage = normalizeAuthMessage(message);
  const messageTone = visibleMessage ? authMessageTone(visibleMessage) : null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSignIn(email, password);
  }

  return (
    <FlowShell>
      <section className="ui-auth-card">
        <header className="ui-auth-card-header">
          <div className="ui-auth-brand">{eyebrow}</div>
          <p className="ui-eyebrow mt-3">Workspace access</p>
          <h1 className="ui-section-title mt-2">{title}</h1>
          <p className="ui-section-subtitle mt-1">Sign in with your email or create a new account.</p>
        </header>

        <div className="ui-auth-card-body">
          <form className="ui-field-group" onSubmit={submit}>
            <label className="block">
              <span className="ui-field-label">Email</span>
              <input
                className="ui-field-standalone"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                placeholder="you@company.com"
                required
              />
            </label>

            <label className="block">
              <span className="ui-field-label">Password</span>
              <input
                className="ui-field-standalone"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                placeholder="Enter password"
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

            <div className="space-y-2.5 pt-1">
              <button className="ui-btn-primary h-11 w-full" type="submit" disabled={isSubmitting}>
                {isSubmitting ? (
                  <span className="flex items-center gap-3">
                    <NothingSpinner inline />
                    <NothingStatus>Signing in</NothingStatus>
                  </span>
                ) : (
                  "Sign in"
                )}
              </button>

              <div className="ui-auth-divider">
                <span className="ui-auth-divider-line" aria-hidden="true" />
                <span className="ui-auth-divider-label">Or</span>
                <span className="ui-auth-divider-line" aria-hidden="true" />
              </div>

              <button
                className="ui-btn-secondary h-11 w-full disabled:opacity-40"
                type="button"
                disabled={isSubmitting}
                onClick={() => onCreateAccount(email, password)}
              >
                Create account
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
