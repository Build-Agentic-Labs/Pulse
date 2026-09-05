"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { kindLabel } from "@/domain/notifications/channels";
import { createPlannerSupabaseClient, loadWorkspaceProjectGroups } from "@/domain/supabase-planner";
import type { WorkspaceProjectGroup } from "@/domain/types";
import type { AdminOverview, LedgerName, LedgerRowView } from "@/lib/notifications/admin-overview";
import { saveTeamsIntegration } from "@/lib/notifications/integrations-store";
import { resolveSupabaseSession } from "@/lib/supabase-auth";
import "./notification-admin-settings.css";

const API = "/api/notifications/admin";

function Block({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="ui-settings-section">
      <h3 className="ui-settings-section-title">{title}</h3>
      {description ? <p className="ui-settings-section-desc">{description}</p> : null}
      <div className="ui-settings-group">{children}</div>
    </section>
  );
}

function when(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}

function isManager(group: WorkspaceProjectGroup): boolean {
  return Boolean(group.isSuperAdmin) || group.role === "owner" || group.role === "admin";
}

async function callAdmin<T>(token: string | null, init: RequestInit & { query?: string }): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const response = await fetch(`${API}${init.query ?? ""}`, { ...init, headers, credentials: "same-origin" });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
  return body;
}

/**
 * Settings → Organization → Notifications: the operator's view. Owners/admins
 * only (the API enforces it; the component simply hides itself otherwise).
 */
export function NotificationAdminSettings() {
  const supabase = useMemo(() => createPlannerSupabaseClient(), []);
  const [workspace, setWorkspace] = useState<{ id: string; name: string } | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [message, setMessage] = useState("");
  const [rowNotes, setRowNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [teamsEnabled, setTeamsEnabled] = useState(false);

  const refresh = useCallback(
    async (workspaceId: string, accessToken: string | null) => {
      const data = await callAdmin<AdminOverview>(accessToken, { method: "GET", query: `?workspaceId=${encodeURIComponent(workspaceId)}` });
      setOverview(data);
      setWebhookUrl(data.integration?.webhookUrl ?? "");
      setTeamsEnabled(data.integration?.enabled ?? false);
    },
    [],
  );

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const { session } = await resolveSupabaseSession(supabase);
        if (!mounted || !session) return;
        setUserId(session.user.id);
        const accessToken = session.access_token ?? null;
        setToken(accessToken);
        const groups = await loadWorkspaceProjectGroups();
        const group = groups.find(isManager);
        if (!mounted || !group) return;
        setWorkspace({ id: group.workspace.id, name: group.workspace.name });
        await refresh(group.workspace.id, accessToken);
      } catch (error: unknown) {
        if (mounted) setMessage(error instanceof Error ? error.message : "Could not load notifications.");
      }
    })();
    return () => {
      mounted = false;
    };
  }, [refresh, supabase]);

  if (!workspace) return null;

  const rowKey = (row: LedgerRowView) => `${row.ledger}:${row.id}`;

  async function resend(row: LedgerRowView) {
    if (!workspace) return;
    const key = rowKey(row);
    setBusy(key);
    try {
      const result = await callAdmin<{ ok: boolean; revived: boolean; reason?: string }>(token, {
        method: "POST",
        body: JSON.stringify({ workspaceId: workspace.id, action: "resend", ledger: row.ledger as LedgerName, id: row.id }),
      });
      setRowNotes((notes) => ({
        ...notes,
        [key]: result.revived ? "Queued for the next drain and drained now — refresh to see the outcome." : (result.reason ?? "Not revived."),
      }));
    } catch (error: unknown) {
      setRowNotes((notes) => ({ ...notes, [key]: error instanceof Error ? error.message : "Resend failed." }));
    } finally {
      setBusy(null);
    }
  }

  async function unsuppress(email: string) {
    if (!workspace) return;
    setBusy(`unsuppress:${email}`);
    try {
      await callAdmin(token, { method: "POST", body: JSON.stringify({ workspaceId: workspace.id, action: "unsuppress", email }) });
      await refresh(workspace.id, token);
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "Could not remove the suppression.");
    } finally {
      setBusy(null);
    }
  }

  async function saveTeams() {
    if (!workspace || !userId) return;
    setBusy("teams:save");
    setMessage("");
    try {
      await saveTeamsIntegration(supabase, workspace.id, { webhookUrl, enabled: teamsEnabled }, userId);
      await refresh(workspace.id, token);
      setMessage("Teams settings saved.");
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "Could not save the Teams webhook.");
    } finally {
      setBusy(null);
    }
  }

  async function testTeams() {
    if (!workspace) return;
    setBusy("teams:test");
    setMessage("");
    try {
      const result = await callAdmin<{ ok: boolean; reason?: string }>(token, {
        method: "POST",
        body: JSON.stringify({ workspaceId: workspace.id, action: "teams_test" }),
      });
      setMessage(result.ok ? "Test card posted to Teams." : (result.reason ?? "Teams refused the card."));
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "Teams test failed.");
    } finally {
      setBusy(null);
    }
  }

  const health = overview?.health;

  return (
    <>
      <Block title="Notifications · Health" description="Whether the daily run is happening and whether the last one was clean.">
        {health ? (
          <div className="notif-admin-health" data-healthy={health.healthy ? "true" : "false"}>
            <strong>{health.healthy ? "Healthy" : "Needs attention"}</strong>
            <span>Last cron run: {when(health.lastCronAt)}</span>
            {health.problems.length > 0 ? (
              <ul>
                {health.problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          <p className="notif-admin-note">{message || "Loading…"}</p>
        )}
        {overview && overview.runs.length > 0 ? (
          <div className="notif-admin-scroll">
            <table className="notif-admin-table">
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Caller</th>
                  <th>Result</th>
                  <th>Problems</th>
                </tr>
              </thead>
              <tbody>
                {overview.runs.map((run) => (
                  <tr key={run.id}>
                    <td>{when(run.startedAt)}</td>
                    <td>{run.caller}</td>
                    <td>
                      <span className="notif-state" data-state={run.healthy ? "sent" : "dead"}>
                        {run.healthy ? "clean" : "unhealthy"}
                      </span>
                    </td>
                    <td className="notif-admin-error">{run.problems.join("; ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Block>

      <Block title="Notifications · Ledger" description="Every decision the drain made for this workspace, newest first. Resend revives a row that never went out.">
        {overview ? (
          overview.ledger.length === 0 ? (
            <p className="notif-admin-note">No notifications recorded yet.</p>
          ) : (
            <div className="notif-admin-scroll">
              <table className="notif-admin-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Kind</th>
                    <th>Recipient</th>
                    <th>State</th>
                    <th>Delivery</th>
                    <th>Detail</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {overview.ledger.map((row) => {
                    const key = rowKey(row);
                    const revivable = row.state === "dead" || row.state === "blocked" || row.state === "skipped";
                    return (
                      <tr key={key}>
                        <td>{when(row.createdAt)}</td>
                        <td>
                          {kindLabel(row.kind)}
                          <div className="notif-admin-error">{row.subject}</div>
                        </td>
                        <td>{row.recipientName}</td>
                        <td>
                          <span className="notif-state" data-state={row.state}>
                            {row.state}
                          </span>
                        </td>
                        <td>{row.deliveryStatus?.replace("email.", "") ?? (row.sentAt ? "accepted" : "—")}</td>
                        <td className="notif-admin-error">{rowNotes[key] ?? row.lastError ?? row.skippedReason ?? "—"}</td>
                        <td>
                          {revivable ? (
                            <button type="button" className="ui-btn-ghost h-7 px-2 text-[12px]" disabled={busy === key} onClick={() => void resend(row)}>
                              Resend
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : null}
      </Block>

      {overview && overview.transactional.length > 0 ? (
        <Block title="Notifications · Invitations and recovery" description="Emails sent outside the drain: invitations, access updates, and password recovery.">
          <div className="notif-admin-scroll">
            <table className="notif-admin-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Kind</th>
                  <th>Recipient</th>
                  <th>Status</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {overview.transactional.map((row) => (
                  <tr key={row.id}>
                    <td>{when(row.createdAt)}</td>
                    <td>{row.kind.replaceAll("_", " ")}</td>
                    <td>{row.recipientEmail}</td>
                    <td>
                      <span className="notif-state" data-state={row.status === "sent" ? "sent" : "dead"}>
                        {row.status}
                      </span>
                    </td>
                    <td className="notif-admin-error">{row.error ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Block>
      ) : null}

      <Block title="Notifications · Suppressed addresses" description="Addresses that hard-bounced or complained. The drain never mails them until they are removed here.">
        {overview && overview.suppressions.length > 0 ? (
          <div className="notif-admin-scroll">
            <table className="notif-admin-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Reason</th>
                  <th>Since</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {overview.suppressions.map((row) => (
                  <tr key={row.email}>
                    <td>{row.email}</td>
                    <td>{row.reason.replaceAll("_", " ")}</td>
                    <td>{when(row.createdAt)}</td>
                    <td>
                      <button
                        type="button"
                        className="ui-btn-ghost h-7 px-2 text-[12px]"
                        disabled={busy === `unsuppress:${row.email}`}
                        onClick={() => void unsuppress(row.email)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="notif-admin-note">No suppressed addresses.</p>
        )}
      </Block>

      <Block title="Notifications · Microsoft Teams" description="Post one card per notification to a Teams channel via an incoming webhook.">
        <div className="notif-admin-form">
          <input
            type="url"
            value={webhookUrl}
            placeholder="https://….webhook.office.com/webhookb2/…"
            aria-label="Teams webhook URL"
            onChange={(event) => setWebhookUrl(event.target.value)}
          />
          <label className="flex items-center gap-2 text-[12px]">
            <input type="checkbox" checked={teamsEnabled} onChange={(event) => setTeamsEnabled(event.target.checked)} />
            Enabled
          </label>
          <button type="button" className="ui-btn-ghost h-8 px-3 text-[12px]" disabled={busy === "teams:save"} onClick={() => void saveTeams()}>
            Save
          </button>
          <button
            type="button"
            className="ui-btn-ghost h-8 px-3 text-[12px]"
            disabled={busy === "teams:test" || !overview?.integration?.webhookUrl}
            onClick={() => void testTeams()}
          >
            Send test card
          </button>
        </div>
        {message ? <p className="notif-admin-note">{message}</p> : null}
      </Block>
    </>
  );
}
