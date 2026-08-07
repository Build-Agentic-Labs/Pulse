"use client";

import { useEffect, useMemo, useState } from "react";
import { createPlannerSupabaseClient, updateOwnProfileNameInSupabase } from "@/domain/supabase-planner";
import {
  announceProfileNameUpdated,
  displayNamePartsValidationMessage,
  hasCompletedDisplayName,
  joinDisplayNameParts,
  normalizeDisplayName,
  PROFILE_NAME_UPDATED_EVENT,
  splitDisplayName,
} from "@/lib/profile-name";
import { resolveSupabaseSession } from "@/lib/supabase-auth";

/**
 * Self-serve account management (Settings → General): display name for everyone,
 * password change for email/password accounts. Email changes stay out of scope — the
 * signup-domain trigger re-validates them, but the flow needs its own confirmation UX.
 */
export function AccountSettings({ embedded = false }: { embedded?: boolean }) {
  const supabase = useMemo(() => createPlannerSupabaseClient(), []);
  const [email, setEmail] = useState("");
  const [isPasswordAccount, setIsPasswordAccount] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [savedFullName, setSavedFullName] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [nameMessage, setNameMessage] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let mounted = true;

    void (async () => {
      const { session } = await resolveSupabaseSession(supabase);
      if (!mounted || !session) {
        return;
      }
      setEmail(session.user.email ?? "");
      // Password change only applies to accounts that actually have a password
      // (Microsoft sign-ins manage credentials at the IdP).
      const providers = (session.user.app_metadata?.providers as string[] | undefined) ?? [
        session.user.app_metadata?.provider ?? "email",
      ];
      setIsPasswordAccount(providers.includes("email"));

      const { data } = await supabase.from("profiles").select("full_name").eq("id", session.user.id).maybeSingle();
      if (mounted) {
        const name = typeof data?.full_name === "string" ? data.full_name : "";
        const parts = hasCompletedDisplayName(name) ? splitDisplayName(name) : { firstName: "", lastName: "" };
        setFirstName(parts.firstName);
        setLastName(parts.lastName);
        setSavedFullName(name);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [supabase]);

  useEffect(() => {
    function syncDisplayName(event: Event) {
      const name = (event as CustomEvent<string>).detail;
      if (!name) return;
      const parts = splitDisplayName(name);
      setFirstName(parts.firstName);
      setLastName(parts.lastName);
      setSavedFullName(name);
      setNameMessage("Display name updated.");
      setNameTouched(false);
    }

    window.addEventListener(PROFILE_NAME_UPDATED_EVENT, syncDisplayName);
    return () => window.removeEventListener(PROFILE_NAME_UPDATED_EVENT, syncDisplayName);
  }, []);

  async function saveName() {
    const validationError = displayNamePartsValidationMessage(firstName, lastName);
    if (validationError) {
      setNameMessage(validationError);
      setNameTouched(true);
      return;
    }

    setIsSaving(true);
    setNameMessage("");
    try {
      const name = joinDisplayNameParts(firstName, lastName);
      await updateOwnProfileNameInSupabase(name);
      const parts = splitDisplayName(name);
      setFirstName(parts.firstName);
      setLastName(parts.lastName);
      setSavedFullName(name);
      setNameMessage("Display name updated.");
      setNameTouched(false);
      announceProfileNameUpdated(name);
    } catch (error) {
      setNameMessage(error instanceof Error ? error.message : "Unable to update the display name.");
    } finally {
      setIsSaving(false);
    }
  }

  async function savePassword() {
    if (password.length < 8) {
      setPasswordMessage("Use at least 8 characters.");
      return;
    }
    if (password !== passwordConfirm) {
      setPasswordMessage("Passwords do not match.");
      return;
    }

    setIsSaving(true);
    setPasswordMessage("");
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        throw error;
      }
      setPassword("");
      setPasswordConfirm("");
      setPasswordMessage("Password updated.");
    } catch (error) {
      setPasswordMessage(error instanceof Error ? error.message : "Unable to update the password.");
    } finally {
      setIsSaving(false);
    }
  }

  const name = joinDisplayNameParts(firstName, lastName);
  const nameValidationMessage = displayNamePartsValidationMessage(firstName, lastName);
  const shouldShowNameValidation =
    Boolean(nameValidationMessage) && (nameTouched || (Boolean(savedFullName) && !hasCompletedDisplayName(savedFullName)));
  const visibleNameMessage = shouldShowNameValidation ? nameValidationMessage : nameMessage;
  const nameDirty =
    name !== normalizeDisplayName(savedFullName) && !nameValidationMessage;

  return (
    <section className={embedded ? "ui-settings-section ui-settings-section-embedded" : "ui-settings-section"}>
      {!embedded ? (
        <>
          <h3 className="ui-settings-section-title">Account</h3>
          <p className="ui-settings-section-desc">Your profile as teammates see it, and your sign-in credentials.</p>
        </>
      ) : null}
      <div className="ui-settings-group">
        <div className="ui-settings-group-row">
          <div className="ui-settings-group-row-copy">
            <div className="ui-settings-group-row-label">Email</div>
            <div className="ui-settings-group-row-desc">Managed by your organization.</div>
          </div>
          <div className="ui-settings-group-row-control">
            <span className="ui-settings-group-row-value">{email || "—"}</span>
          </div>
        </div>

        <div className="ui-settings-group-row">
          <div className="ui-settings-group-row-copy">
            <div className="ui-settings-group-row-label">Display name</div>
            <div
              id="account-display-name-message"
              className={`ui-settings-group-row-desc ${shouldShowNameValidation ? "text-danger" : ""}`}
            >
              {visibleNameMessage || "Use your first and last name."}
            </div>
          </div>
          <div className="ui-settings-group-row-control flex items-end gap-1.5">
            <div className="grid min-w-0 flex-1 grid-cols-2 gap-1.5 text-left">
              <label className="min-w-0 text-[10px] text-ink-secondary">
                <span className="mb-1 block">First name</span>
                <input
                  className={`ui-field-standalone h-9 w-full px-3 ${shouldShowNameValidation ? "!border-danger" : ""}`}
                  type="text"
                  value={firstName}
                  onChange={(event) => {
                    setFirstName(event.target.value);
                    setNameMessage("");
                    setNameTouched(true);
                  }}
                  placeholder="First name"
                  aria-label="First name"
                  aria-invalid={shouldShowNameValidation || undefined}
                  aria-describedby="account-display-name-message"
                  autoComplete="given-name"
                  disabled={isSaving}
                />
              </label>
              <label className="min-w-0 text-[10px] text-ink-secondary">
                <span className="mb-1 block">Last name</span>
                <input
                  className={`ui-field-standalone h-9 w-full px-3 ${shouldShowNameValidation ? "!border-danger" : ""}`}
                  type="text"
                  value={lastName}
                  onChange={(event) => {
                    setLastName(event.target.value);
                    setNameMessage("");
                    setNameTouched(true);
                  }}
                  placeholder="Last name"
                  aria-label="Last name"
                  aria-invalid={shouldShowNameValidation || undefined}
                  aria-describedby="account-display-name-message"
                  autoComplete="family-name"
                  disabled={isSaving}
                />
              </label>
            </div>
            <button
              type="button"
              className="ui-btn-ghost h-9 px-3 disabled:opacity-50"
              onClick={() => void saveName()}
              disabled={isSaving || !nameDirty}
            >
              Save
            </button>
          </div>
        </div>

        {isPasswordAccount ? (
          <div className="ui-settings-group-row">
            <div className="ui-settings-group-row-copy">
              <div className="ui-settings-group-row-label">Change password</div>
              <div className="ui-settings-group-row-desc">
                {passwordMessage || "At least 8 characters."}
              </div>
            </div>
            <div className="ui-settings-group-row-control flex flex-wrap items-center justify-end gap-1.5">
              <input
                className="ui-field-standalone h-9 px-3"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="New password"
                autoComplete="new-password"
                disabled={isSaving}
              />
              <input
                className="ui-field-standalone h-9 px-3"
                type="password"
                value={passwordConfirm}
                onChange={(event) => setPasswordConfirm(event.target.value)}
                placeholder="Confirm"
                autoComplete="new-password"
                disabled={isSaving}
              />
              <button
                type="button"
                className="ui-btn-ghost h-9 px-3 disabled:opacity-50"
                onClick={() => void savePassword()}
                disabled={isSaving || !password}
              >
                Update
              </button>
            </div>
          </div>
        ) : (
          <div className="ui-settings-group-row">
            <div className="ui-settings-group-row-copy">
              <div className="ui-settings-group-row-label">Password</div>
              <div className="ui-settings-group-row-desc">
                You sign in with Microsoft — credentials are managed by your identity provider.
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
