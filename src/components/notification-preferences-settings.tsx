"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  NOTIFICATION_KINDS,
  resolveEmailEnabled,
  type NotificationKindMeta,
  type PreferenceRow,
} from "@/domain/notifications/channels";
import { createPlannerSupabaseClient } from "@/domain/supabase-planner";
import { loadPreferences, savePreference } from "@/lib/notifications/preferences-store";
import { currentPushEndpoint, isPushSupported, subscribeToPush, unsubscribeFromPush } from "@/lib/notifications/push-client";
import { deletePushSubscription, savePushSubscription } from "@/lib/notifications/push-store";
import { resolveSupabaseSession } from "@/lib/supabase-auth";
import "./notification-preferences-settings.css";
import "./account-settings.css";

const GROUPS: { key: NotificationKindMeta["group"]; title: string; description: string }[] = [
  { key: "sop", title: "SOP document control", description: "Reviews, signatures, releases, stalls" },
  { key: "workspace", title: "Workspace", description: "Membership and access" },
  { key: "digest", title: "Digests", description: "Periodic summaries" },
];

function Card({ id, title, description, children }: { id: string; title: string; description: string; children: ReactNode }) {
  return (
    <section className="acct-card" aria-labelledby={id}>
      <header className="acct-card-head">
        <div>
          <h3 id={id} className="acct-card-title">{title}</h3>
          <p className="acct-card-desc">{description}</p>
        </div>
      </header>
      {children}
    </section>
  );
}

function ToggleRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="acct-toggle-row">
      <span>{label}</span>
      {children}
    </div>
  );
}

/**
 * Per-kind email switches (Settings → Account → Notifications). Global scope
 * only for now: a workspace-scoped row, if one exists, still wins in the drain.
 * Saves immediately, optimistically; a rejected save reverts and says so.
 */
export function NotificationPreferencesSettings() {
  const supabase = useMemo(() => createPlannerSupabaseClient(), []);
  const [userId, setUserId] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<PreferenceRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [pushSupported, setPushSupported] = useState(false);
  const [pushEndpoint, setPushEndpoint] = useState<string | null>(null);
  const [pushBusy, setPushBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const { session } = await resolveSupabaseSession(supabase);
        const id = session?.user?.id ?? null;
        if (!mounted) return;
        setUserId(id);
        if (!id) {
          setLoaded(true);
          return;
        }
        const supported = isPushSupported();
        setPushSupported(supported);
        const [rows, endpoint] = await Promise.all([
          loadPreferences(id, supabase),
          supported ? currentPushEndpoint().catch(() => null) : Promise.resolve(null),
        ]);
        if (mounted) {
          setPreferences(rows);
          setPushEndpoint(endpoint);
        }
      } catch (error: unknown) {
        if (mounted) setMessage(error instanceof Error ? error.message : "Could not load notification settings.");
      } finally {
        if (mounted) setLoaded(true);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [supabase]);

  async function toggle(kind: string) {
    if (!userId) return;
    const enabled = resolveEmailEnabled(kind, null, preferences);
    const next: PreferenceRow = { workspaceId: "", kind, channel: "email", mode: enabled ? "off" : "immediate" };
    const previous = preferences;
    setPreferences((current) => [
      ...current.filter((row) => !(row.workspaceId === "" && row.kind === kind && row.channel === "email")),
      next,
    ]);
    setSaving(kind);
    setMessage("");
    try {
      await savePreference(userId, next, supabase);
    } catch (error: unknown) {
      setPreferences(previous);
      setMessage(error instanceof Error ? error.message : "Could not save that change.");
    } finally {
      setSaving(null);
    }
  }

  async function togglePush() {
    if (!userId || pushBusy) return;
    setPushBusy(true);
    setMessage("");
    try {
      if (pushEndpoint) {
        const endpoint = (await unsubscribeFromPush()) ?? pushEndpoint;
        await deletePushSubscription(supabase, endpoint);
        setPushEndpoint(null);
      } else {
        const subscription = await subscribeToPush();
        await savePushSubscription(supabase, userId, subscription, navigator.userAgent);
        setPushEndpoint(subscription.endpoint);
      }
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "Could not change push notifications.");
    } finally {
      setPushBusy(false);
    }
  }

  return (
    <div className="acct-stack">
      <Card
        id="notif-email-title"
        title="Email notifications"
        description="Choose what reaches your inbox. Everything still shows in the bell."
      >
        {GROUPS.map((group) => {
          const kinds = Object.entries(NOTIFICATION_KINDS).filter(([, meta]) => meta.group === group.key);
          return (
            <div key={group.key} className="acct-group" role="group" aria-label={group.title}>
              <div className="acct-subhead">
                <span className="acct-subhead-title">{group.title}</span>
                <span className="acct-subhead-desc">{group.description}</span>
              </div>
              {kinds.map(([kind, meta]) => {
                const enabled = resolveEmailEnabled(kind, null, preferences);
                return (
                  <ToggleRow key={kind} label={meta.label}>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={enabled}
                      aria-label={meta.label}
                      className="notif-switch"
                      disabled={!loaded || !userId || saving === kind}
                      onClick={() => void toggle(kind)}
                    />
                  </ToggleRow>
                );
              })}
            </div>
          );
        })}
      </Card>
      {pushSupported ? (
        <Card
          id="notif-device-title"
          title="This device"
          description="Show a system notification here for anything that lands in your inbox."
        >
          <ToggleRow label="Browser push">
            <button
              type="button"
              role="switch"
              aria-checked={pushEndpoint !== null}
              aria-label="Browser push on this device"
              className="notif-switch"
              disabled={!loaded || !userId || pushBusy}
              onClick={() => void togglePush()}
            />
          </ToggleRow>
        </Card>
      ) : null}
      {message ? <p className="notif-prefs-status">{message}</p> : null}
    </div>
  );
}
