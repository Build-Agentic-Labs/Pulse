"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { createPlannerSupabaseClient, updateOwnProfileNameInSupabase } from "@/domain/supabase-planner";
import {
  announceProfileNameUpdated,
  displayNameValidationMessage,
  hasCompletedDisplayName,
  normalizeDisplayName,
} from "@/lib/profile-name";
import { resolveSupabaseSession } from "@/lib/supabase-auth";

type PromptState =
  | { status: "hidden" }
  | { status: "required" };

export function DisplayNamePrompt() {
  const supabase = useMemo(() => createPlannerSupabaseClient(), []);
  const [prompt, setPrompt] = useState<PromptState>({ status: "hidden" });
  const [fullName, setFullName] = useState("");
  const [message, setMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let mounted = true;
    let requestVersion = 0;

    async function checkProfile(userId: string) {
      const version = ++requestVersion;
      const { data, error } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", userId)
        .maybeSingle();

      if (!mounted || version !== requestVersion) {
        return;
      }

      // A transient profile-read failure should not trap a signed-in user behind a
      // prompt we cannot confidently resolve. The next auth event or app open retries.
      if (error) {
        setPrompt({ status: "hidden" });
        return;
      }

      const savedName = typeof data?.full_name === "string" ? data.full_name : "";
      if (hasCompletedDisplayName(savedName)) {
        setPrompt({ status: "hidden" });
        return;
      }

      setFullName("");
      setMessage("");
      setPrompt({ status: "required" });
    }

    async function hydrate() {
      const { session } = await resolveSupabaseSession(supabase);
      if (!mounted) {
        return;
      }
      if (!session) {
        requestVersion += 1;
        setPrompt({ status: "hidden" });
        return;
      }
      await checkProfile(session.user.id);
    }

    void hydrate();

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!session) {
        requestVersion += 1;
        setPrompt({ status: "hidden" });
        return;
      }
      // Password recovery must finish before profile completion can take over the
      // screen. Token refreshes do not represent a new app entry and should not
      // clear a name the user is actively typing.
      if (event === "PASSWORD_RECOVERY") {
        requestVersion += 1;
        setPrompt({ status: "hidden" });
        return;
      }
      if (event === "TOKEN_REFRESHED") {
        return;
      }
      void checkProfile(session.user.id);
    });

    return () => {
      mounted = false;
      requestVersion += 1;
      listener.subscription.unsubscribe();
    };
  }, [supabase]);

  if (prompt.status !== "required") {
    return null;
  }

  const validationMessage = displayNameValidationMessage(fullName);

  async function saveName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationError = displayNameValidationMessage(fullName);
    if (validationError) {
      setMessage(validationError);
      inputRef.current?.focus();
      return;
    }

    setIsSaving(true);
    setMessage("");
    try {
      const name = normalizeDisplayName(fullName);
      await updateOwnProfileNameInSupabase(name);
      announceProfileNameUpdated(name);
      setPrompt({ status: "hidden" });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save your display name.");
    } finally {
      setIsSaving(false);
    }
  }

  function keepFocusInside(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Tab") {
      return;
    }
    if (event.shiftKey && document.activeElement === inputRef.current) {
      event.preventDefault();
      submitRef.current?.focus();
    } else if (!event.shiftKey && document.activeElement === submitRef.current) {
      event.preventDefault();
      inputRef.current?.focus();
    }
  }

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]">
      <section
        className="ui-panel w-full max-w-md p-6 shadow-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="display-name-prompt-title"
        aria-describedby="display-name-prompt-description"
        onKeyDown={keepFocusInside}
      >
        <h2 id="display-name-prompt-title" className="text-lg font-semibold text-ink">
          Finish your profile
        </h2>
        <p id="display-name-prompt-description" className="mt-1.5 text-sm leading-5 text-ink-secondary">
          Enter your full name as it should appear on SOP authorship, reviews, and approvals.
        </p>

        <form className="mt-5 space-y-4" onSubmit={(event) => void saveName(event)}>
          <div>
            <label htmlFor="required-display-name" className="mb-1.5 block text-xs font-medium text-ink-secondary">
              Display name
            </label>
            <input
              ref={inputRef}
              id="required-display-name"
              className="ui-field-standalone h-10 w-full px-3"
              value={fullName}
              onChange={(event) => {
                setFullName(event.target.value);
                if (message) setMessage("");
              }}
              placeholder="First and last name"
              autoComplete="name"
              autoFocus
              disabled={isSaving}
              aria-invalid={Boolean(message) || undefined}
              aria-describedby={message ? "display-name-prompt-message" : undefined}
            />
            {message ? (
              <p id="display-name-prompt-message" className="mt-1.5 text-xs text-danger" role="alert">
                {message}
              </p>
            ) : null}
          </div>

          <button
            ref={submitRef}
            type="submit"
            className="ui-btn-primary h-9 w-full justify-center px-4 disabled:opacity-50"
            disabled={isSaving || Boolean(validationMessage)}
          >
            {isSaving ? "Saving…" : "Save and continue"}
          </button>
        </form>
      </section>
    </div>
  );
}
