"use client";

import { useEffect, useMemo, useState } from "react";
import { createPlannerSupabaseClient, updateOwnProfileNameInSupabase } from "@/domain/supabase-planner";
import { resolveSupabaseSession } from "@/lib/supabase-auth";

/**
 * Self-serve account management (Settings → General): display name for everyone,
 * password change for email/password accounts. Email changes stay out of scope — the
 * signup-domain trigger re-validates them, but the flow needs its own confirmation UX.
 */
export function AccountSettings() {
  const supabase = useMemo(() => createPlannerSupabaseClient(), []);
  const [email, setEmail] = useState("");
  const [isPasswordAccount, setIsPasswordAccount] = useState(false);
  const [fullName, setFullName] = useState("");
  const [savedFullName, setSavedFullName] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [nameMessage, setNameMessage] = useState("");
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
        setFullName(name);
        setSavedFullName(name);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [supabase]);

  async function saveName() {
    setIsSaving(true);
    setNameMessage("");
    try {
      await updateOwnProfileNameInSupabase(fullName);
      setSavedFullName(fullName.trim());
      setNameMessage("Display name updated.");
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

  const nameDirty = fullName.trim() !== savedFullName && fullName.trim().length > 0;

  return (
    <section className="ui-settings-section">
      <h3 className="ui-settings-section-title">Account</h3>
      <p className="ui-settings-section-desc">Your profile as teammates see it, and your sign-in credentials.</p>
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
            {nameMessage ? <div className="ui-settings-group-row-desc">{nameMessage}</div> : null}
          </div>
          <div className="ui-settings-group-row-control flex items-center gap-1.5">
            <input
              className="ui-field-standalone h-9 px-3"
              type="text"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              placeholder="Your name"
              disabled={isSaving}
            />
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
