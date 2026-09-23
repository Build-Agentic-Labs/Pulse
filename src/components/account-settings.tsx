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
import "./account-settings.css";

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

  const nameHintClass = shouldShowNameValidation
    ? "acct-row-hint acct-row-hint-error"
    : nameMessage
      ? "acct-row-hint acct-row-hint-ok"
      : "acct-row-hint";

  return (
    <div className="acct-stack">
      {!embedded ? <h3 className="ui-settings-section-title">Account</h3> : null}
      <section className="acct-card" aria-labelledby="account-profile-title">
        <header className="acct-card-head">
          <div>
            <h3 id="account-profile-title" className="acct-card-title">Profile</h3>
            <p className="acct-card-desc">How teammates see you across Pulse.</p>
          </div>
        </header>
        <div className="acct-row">
          <div className="acct-row-label">Email</div>
          <div>
            <div className="acct-row-value">{email || "—"}</div>
          </div>
        </div>
        <div className="acct-row acct-row-top">
          <label className="acct-row-label" htmlFor="account-first-name">Name</label>
          <div>
            <div className="acct-fields">
              <input
                id="account-first-name"
                className={`ui-field-standalone acct-field ${shouldShowNameValidation ? "!border-danger" : ""}`}
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
              <input
                className={`ui-field-standalone acct-field ${shouldShowNameValidation ? "!border-danger" : ""}`}
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
            </div>
            <div id="account-display-name-message" className={nameHintClass}>
              {visibleNameMessage || "First and last name."}
            </div>
          </div>
        </div>
        <footer className="acct-actions">
          <button
            type="button"
            className="acct-btn acct-btn-primary"
            onClick={() => void saveName()}
            disabled={isSaving || !nameDirty}
          >
            Save name
          </button>
        </footer>
      </section>

      <section className="acct-card" aria-labelledby="account-password-title">
        <header className="acct-card-head">
          <div>
            <h3 id="account-password-title" className="acct-card-title">Password</h3>
            <p className="acct-card-desc">
              {isPasswordAccount
                ? "Used when you sign in with your email."
                : "You sign in with Microsoft — credentials are managed by your identity provider."}
            </p>
          </div>
        </header>
        {isPasswordAccount ? (
          <>
            <div className="acct-row acct-row-top">
              <label className="acct-row-label" htmlFor="account-new-password">New password</label>
              <div>
                <div className="acct-fields">
                  <input
                    id="account-new-password"
                    className="ui-field-standalone acct-field"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="New password"
                    autoComplete="new-password"
                    aria-describedby="account-password-message"
                    disabled={isSaving}
                  />
                  <input
                    className="ui-field-standalone acct-field"
                    type="password"
                    value={passwordConfirm}
                    onChange={(event) => setPasswordConfirm(event.target.value)}
                    placeholder="Confirm"
                    aria-label="Confirm new password"
                    autoComplete="new-password"
                    aria-describedby="account-password-message"
                    disabled={isSaving}
                  />
                </div>
                <div id="account-password-message" className="acct-row-hint">
                  {passwordMessage || "At least 8 characters."}
                </div>
              </div>
            </div>
            <footer className="acct-actions">
              <button
                type="button"
                className="acct-btn acct-btn-primary"
                onClick={() => void savePassword()}
                disabled={isSaving || !password}
              >
                Update password
              </button>
            </footer>
          </>
        ) : null}
      </section>
    </div>
  );
}
