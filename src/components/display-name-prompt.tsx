"use client";

import { ChevronLeft, CircleUserRound } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FocusEvent, type FormEvent } from "react";
import { createPlannerSupabaseClient, updateOwnProfileNameInSupabase } from "@/domain/supabase-planner";
import { ACCOUNT_MENU_VISIBILITY_EVENT } from "@/lib/app-chrome-events";
import {
  announceProfileNameUpdated,
  displayNamePartsValidationMessage,
  hasCompletedDisplayName,
  joinDisplayNameParts,
  PROFILE_NAME_UPDATED_EVENT,
} from "@/lib/profile-name";
import { resolveSupabaseSession } from "@/lib/supabase-auth";

type PromptState =
  | { status: "hidden" }
  | { status: "required" };

const PEEK_AGAIN_DELAY_MS = 5000;

export function DisplayNamePrompt() {
  const supabase = useMemo(() => createPlannerSupabaseClient(), []);
  const [prompt, setPrompt] = useState<PromptState>({ status: "hidden" });
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [message, setMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isPeeked, setIsPeeked] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [hasFocusWithin, setHasFocusWithin] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const peekTimerRef = useRef<number | null>(null);
  const hasStartedTypingRef = useRef(false);

  const hasStartedTyping = Boolean(firstName.trim() || lastName.trim());
  hasStartedTypingRef.current = hasStartedTyping;

  function clearPeekTimer() {
    if (peekTimerRef.current !== null) {
      window.clearTimeout(peekTimerRef.current);
      peekTimerRef.current = null;
    }
  }

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

      setFirstName("");
      setLastName("");
      setMessage("");
      setIsExpanded(false);
      setIsPeeked(false);
      setIsHovered(false);
      setHasFocusWithin(false);
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

  useEffect(() => {
    function syncAccountMenu(event: Event) {
      const isOpen = Boolean((event as CustomEvent<boolean>).detail);
      clearPeekTimer();
      if (!isOpen || hasStartedTypingRef.current) {
        return;
      }
      setIsExpanded(false);
      setIsPeeked(true);
    }

    window.addEventListener(ACCOUNT_MENU_VISIBILITY_EVENT, syncAccountMenu);
    return () => {
      window.removeEventListener(ACCOUNT_MENU_VISIBILITY_EVENT, syncAccountMenu);
      clearPeekTimer();
    };
  }, []);

  useEffect(() => {
    clearPeekTimer();
    if (
      prompt.status !== "required" ||
      isPeeked ||
      isHovered ||
      hasFocusWithin ||
      hasStartedTyping
    ) {
      return;
    }

    peekTimerRef.current = window.setTimeout(() => {
      setIsExpanded(false);
      setIsPeeked(true);
      peekTimerRef.current = null;
    }, PEEK_AGAIN_DELAY_MS);

    return clearPeekTimer;
  }, [hasFocusWithin, hasStartedTyping, isHovered, isPeeked, prompt.status]);

  useEffect(() => {
    function syncDisplayName(event: Event) {
      const name = (event as CustomEvent<string>).detail;
      if (!hasCompletedDisplayName(name)) {
        return;
      }
      setFirstName("");
      setLastName("");
      setMessage("");
      setIsExpanded(false);
      setIsPeeked(false);
      setPrompt({ status: "hidden" });
    }

    window.addEventListener(PROFILE_NAME_UPDATED_EVENT, syncDisplayName);
    return () => window.removeEventListener(PROFILE_NAME_UPDATED_EVENT, syncDisplayName);
  }, []);

  useEffect(() => {
    if (prompt.status === "required" && isExpanded) {
      inputRef.current?.focus();
    }
  }, [isExpanded, prompt.status]);

  if (prompt.status !== "required") {
    return null;
  }

  async function saveName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationError = displayNamePartsValidationMessage(firstName, lastName);
    if (validationError) {
      setMessage(validationError);
      inputRef.current?.focus();
      return;
    }

    setIsSaving(true);
    setMessage("");
    try {
      const name = joinDisplayNameParts(firstName, lastName);
      await updateOwnProfileNameInSupabase(name);
      announceProfileNameUpdated(name);
      setPrompt({ status: "hidden" });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save your display name.");
    } finally {
      setIsSaving(false);
    }
  }

  function revealFromEdge() {
    clearPeekTimer();
    setIsHovered(true);
    setIsPeeked(false);
  }

  function leaveReminder() {
    setIsHovered(false);
    if (!hasStartedTypingRef.current) {
      clearPeekTimer();
      setHasFocusWithin(false);
      setIsExpanded(false);
      setIsPeeked(true);
    }
  }

  function focusReminder() {
    clearPeekTimer();
    setHasFocusWithin(true);
    setIsPeeked(false);
  }

  function blurReminder(event: FocusEvent<HTMLDivElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }
    setHasFocusWithin(false);
  }

  function markNameEditing() {
    clearPeekTimer();
    setIsPeeked(false);
  }

  return (
    <div
      data-testid="display-name-prompt-shell"
      data-peeked={isPeeked || undefined}
      className="ui-display-name-prompt-boundary pointer-events-none fixed right-0 top-16 z-[150] w-[min(396px,100vw)]"
      onMouseEnter={revealFromEdge}
      onMouseLeave={leaveReminder}
      onFocusCapture={focusReminder}
      onBlurCapture={blurReminder}
    >
      <span
        data-testid="display-name-prompt-edge-bridge"
        className="pointer-events-auto absolute right-0 top-0 h-full w-4"
        aria-hidden="true"
      />
      <div className="ui-display-name-prompt-track pointer-events-none relative ml-auto mr-4 w-[min(380px,calc(100vw-2rem))]">
        <button
          type="button"
          className={`ui-display-name-prompt-tab pointer-events-auto absolute -left-6 top-4 z-10 grid h-9 w-6 place-items-center rounded-l-full border border-r-0 border-accent/35 bg-surface text-ink-secondary transition-[opacity,transform] duration-200 motion-reduce:transition-none ${
            isPeeked
              ? "translate-x-0 opacity-100"
              : "pointer-events-none translate-x-1 opacity-0"
          }`}
          aria-label="Open name reminder"
          aria-hidden={!isPeeked}
          tabIndex={isPeeked ? 0 : -1}
          onClick={revealFromEdge}
        >
          <ChevronLeft size={14} strokeWidth={2} aria-hidden="true" />
        </button>
        <section
          className="ui-feedback-toast pointer-events-auto overflow-hidden rounded-lg border border-accent/35 bg-surface shadow-modal"
          role="region"
          aria-labelledby="display-name-prompt-title"
          aria-describedby="display-name-prompt-description"
        >
        <div className="flex items-start gap-3 p-3.5" inert={isPeeked}>
          <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent-muted text-accent" aria-hidden="true">
            <CircleUserRound size={17} strokeWidth={1.8} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="display-name-prompt-title" className="text-sm font-semibold text-ink">
              Add your name
            </h2>
            <p id="display-name-prompt-description" className="mt-1 text-xs leading-5 text-ink-secondary">
              Replace your email with your first and last name.
            </p>

            <div
              data-testid="display-name-form-reveal"
              className={`grid transition-[grid-template-rows,opacity,transform] duration-300 ease-out motion-reduce:transition-none ${
                isExpanded
                  ? "grid-rows-[1fr] translate-y-0 opacity-100"
                  : "pointer-events-none grid-rows-[0fr] -translate-y-1 opacity-0"
              }`}
              aria-hidden={!isExpanded}
              inert={!isExpanded}
            >
              <div className="min-h-0 overflow-hidden">
                <form className="mt-3 space-y-2.5" onSubmit={(event) => void saveName(event)}>
                  <div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label htmlFor="required-first-name" className="mb-1 block text-xs font-medium text-ink-secondary">
                          First name
                        </label>
                        <input
                          ref={inputRef}
                          id="required-first-name"
                          className={`ui-field-standalone h-9 w-full px-3 ${message ? "!border-danger" : ""}`}
                          value={firstName}
                          onChange={(event) => {
                            setFirstName(event.target.value);
                            markNameEditing();
                            if (message) setMessage("");
                          }}
                          placeholder="First name"
                          autoComplete="given-name"
                          disabled={isSaving}
                          aria-invalid={Boolean(message) || undefined}
                          aria-describedby={message ? "display-name-prompt-message" : "display-name-prompt-format"}
                        />
                      </div>
                      <div>
                        <label htmlFor="required-last-name" className="mb-1 block text-xs font-medium text-ink-secondary">
                          Last name
                        </label>
                        <input
                          id="required-last-name"
                          className={`ui-field-standalone h-9 w-full px-3 ${message ? "!border-danger" : ""}`}
                          value={lastName}
                          onChange={(event) => {
                            setLastName(event.target.value);
                            markNameEditing();
                            if (message) setMessage("");
                          }}
                          placeholder="Last name"
                          autoComplete="family-name"
                          disabled={isSaving}
                          aria-invalid={Boolean(message) || undefined}
                          aria-describedby={message ? "display-name-prompt-message" : "display-name-prompt-format"}
                        />
                      </div>
                    </div>
                    {message ? (
                      <p id="display-name-prompt-message" className="mt-1.5 text-xs text-danger" role="alert">
                        {message}
                      </p>
                    ) : (
                      <p id="display-name-prompt-format" className="mt-1.5 text-[11px] text-ink-tertiary">
                        This becomes your display name throughout Pulse.
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="submit"
                      className="ui-btn-primary h-8 justify-center px-3 disabled:opacity-50"
                      disabled={isSaving}
                    >
                      {isSaving ? "Saving…" : "Save name"}
                    </button>
                    <button
                      type="button"
                      className="ui-btn-ghost h-8 px-3"
                      onClick={() => {
                        setIsExpanded(false);
                        setMessage("");
                      }}
                      disabled={isSaving}
                    >
                      Not now
                    </button>
                  </div>
                </form>
              </div>
            </div>

            <div
              className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${
                isExpanded ? "pointer-events-none grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100"
              }`}
              aria-hidden={isExpanded}
              inert={isExpanded}
            >
              <div className="min-h-0 overflow-hidden">
                <button
                  type="button"
                  className="ui-btn-primary mt-3 h-8 px-3"
                  onClick={() => setIsExpanded(true)}
                >
                  Update name
                </button>
              </div>
            </div>
          </div>
        </div>
        </section>
      </div>
    </div>
  );
}
