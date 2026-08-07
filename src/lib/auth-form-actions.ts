"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { isAllowedSignupEmail, SIGNUP_DOMAIN_MESSAGE } from "@/lib/allowed-signup-domain";

/**
 * Shared sign-in / sign-up / recovery actions for the two auth surfaces (the planner's
 * AuthProjectGate and the SOP workspace provider), so flows like password reset and
 * confirmation resend exist in exactly one place.
 */
export function useAuthFormActions(supabase: SupabaseClient) {
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Surface OAuth/callback failures passed back in the URL (post-hydration: the
  // consume rewrites the address bar, which must not happen during render).
  useEffect(() => {
    const redirectError = consumeAuthRedirectError();
    if (redirectError) {
      setMessage(redirectError);
    }
  }, []);

  async function run(action: () => Promise<string | void>, fallbackError: string) {
    setIsSubmitting(true);
    setMessage("");
    try {
      const successMessage = await action();
      if (successMessage) {
        setMessage(successMessage);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : fallbackError);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSignIn(email: string, password: string) {
    await run(async () => {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
    }, "Unable to sign in.");
  }

  async function handleCreateAccount(email: string, password: string, fullName?: string) {
    if (!isAllowedSignupEmail(email)) {
      setMessage(SIGNUP_DOMAIN_MESSAGE);
      return;
    }

    await run(async () => {
      const { error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: fullName?.trim() ? { data: { full_name: fullName.trim() } } : undefined,
      });
      if (error) throw error;
      return "Account created. Check your inbox and confirm the email before signing in.";
    }, "Unable to create account.");
  }

  async function handleMicrosoftSignIn() {
    setIsSubmitting(true);
    setMessage("");
    try {
      // Azure (Entra) provider is configured in the Supabase dashboard. The browser
      // redirects to Microsoft, back to Supabase's /auth/v1/callback, then to redirectTo,
      // where the global Supabase client picks up the session (detectSessionInUrl) and
      // onAuthStateChange fires SIGNED_IN. redirectTo must be allowlisted in Supabase
      // (Authentication -> URL Configuration).
      const redirectTo = typeof window !== "undefined" ? window.location.origin : undefined;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "azure",
        options: { scopes: "openid email profile", redirectTo },
      });
      if (error) throw error;
      // Success navigates away to Microsoft; leave isSubmitting set so the button stays busy.
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to start Microsoft sign-in.");
      setIsSubmitting(false);
    }
  }

  async function handleResetPassword(email: string) {
    if (!email.trim()) {
      setMessage("Enter your email first, then request a recovery code.");
      return false;
    }

    let requested = false;
    await run(async () => {
      const response = await fetch("/api/auth/password-reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Unable to send the recovery code.");
      }
      requested = true;
      return payload.message || "If an account exists, a recovery code has been sent.";
    }, "Unable to send the recovery code.");
    return requested;
  }

  async function handleVerifyRecoveryCode(email: string, code: string) {
    const normalizedEmail = email.trim();
    const normalizedCode = code.replace(/\s/g, "");
    if (!normalizedEmail || !/^\d{6,8}$/.test(normalizedCode)) {
      setMessage("Enter the recovery code from your email.");
      return false;
    }

    let verified = false;
    await run(async () => {
      const { error } = await supabase.auth.verifyOtp({
        email: normalizedEmail,
        token: normalizedCode,
        type: "recovery",
      });
      if (error) throw error;
      verified = true;
      return "Recovery code verified. Choose a new password.";
    }, "Unable to verify the recovery code.");
    return verified;
  }

  async function handleResendConfirmation(email: string) {
    if (!email.trim()) {
      setMessage("Enter your email first, then resend the confirmation.");
      return;
    }

    await run(async () => {
      const { error } = await supabase.auth.resend({ type: "signup", email: email.trim() });
      if (error) throw error;
      return "Confirmation email sent. Check your inbox.";
    }, "Unable to resend the confirmation email.");
  }

  async function handleUpdatePassword(password: string) {
    let updated = false;
    await run(async () => {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      updated = true;
      return "Password updated. You're signed in.";
    }, "Unable to update the password.");
    return updated;
  }

  return {
    message,
    setMessage,
    isSubmitting,
    handleSignIn,
    handleCreateAccount,
    handleMicrosoftSignIn,
    handleResetPassword,
    handleVerifyRecoveryCode,
    handleResendConfirmation,
    handleUpdatePassword,
  };
}

/**
 * Supabase returns OAuth/callback failures as error_description in the redirect URL.
 * The DB-level domain trigger surfaces as an opaque "Database error saving new user",
 * so translate it (and the trigger's own text) into the friendly domain message.
 * Consuming clears the params from the address bar so refreshes don't re-show it.
 */
export function consumeAuthRedirectError(): string {
  if (typeof window === "undefined") {
    return "";
  }

  const fromHash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const fromSearch = new URLSearchParams(window.location.search);
  const description = fromHash.get("error_description") ?? fromSearch.get("error_description") ?? "";

  if (!description) {
    return "";
  }

  try {
    const url = new URL(window.location.href);
    url.hash = "";
    url.searchParams.delete("error");
    url.searchParams.delete("error_code");
    url.searchParams.delete("error_description");
    window.history.replaceState(null, "", url.toString());
  } catch {
    // Leave the URL as-is if it can't be rewritten.
  }

  if (/database error saving new user|restricted to approved work email domains/i.test(description)) {
    return SIGNUP_DOMAIN_MESSAGE;
  }

  return description;
}
