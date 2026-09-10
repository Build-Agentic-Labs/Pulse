/**
 * Author-nominated reviewers — the pure half. Request/outcome parsing for the route, the fixed
 * entitlement package (for the invitation email's access summary), pending-state derivation for
 * the roster, and outcome copy. No React, no Supabase, no clocks (callers pass `now`).
 * Spec: docs/superpowers/specs/2026-09-10-author-reviewer-invites-design.md
 */

import { normalizeJobTitle } from "@/domain/departments";
import type { WorkspaceInviteEntitlements } from "@/domain/workspace/invite-access";

export type NominationMode = "added" | "lifted" | "already_eligible" | "invite";

const NOMINATION_MODES: readonly NominationMode[] = ["added", "lifted", "already_eligible", "invite"];

export interface NominationRequest {
  sopId: string;
  departmentId: string;
  email: string;
  positionTitle: string;
}

export interface NominationResponse {
  mode: NominationMode;
  userId: string | null;
  emailSent: boolean;
  /** The nominee is selectable in the roster right now (membership or provisional row exists). */
  seated: boolean;
  error?: string;
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseNominationBody(raw: unknown): NominationRequest | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const sopId = typeof record.sopId === "string" ? record.sopId.trim() : "";
  const departmentId = typeof record.departmentId === "string" ? record.departmentId.trim() : "";
  const email = typeof record.email === "string" ? record.email.trim().toLowerCase() : "";
  const positionTitle = typeof record.positionTitle === "string" ? normalizeJobTitle(record.positionTitle) : null;
  if (!sopId || !departmentId || !EMAIL_SHAPE.test(email) || !positionTitle) return null;
  return { sopId, departmentId, email, positionTitle };
}

export function parseNominationOutcome(raw: unknown): { mode: NominationMode; userId: string | null } | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const mode = NOMINATION_MODES.find((candidate) => candidate === record.mode);
  if (!mode) return null;
  const userId = typeof record.user_id === "string" && record.user_id ? record.user_id : null;
  return { mode, userId };
}

/** The fixed package a nomination grants — mirrors the database function; used only for the email's access summary. */
export function nominatedReviewerEntitlements(departmentId: string, positionTitle: string): WorkspaceInviteEntitlements {
  return {
    organizationRole: "member",
    accessPackage: "custom",
    qualityAccess: "edit",
    planningAccess: false,
    projectAccess: [],
    departmentAccess: [{ departmentId, role: "reviewer", positionTitle }],
  };
}

export const PENDING_INVITE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export type PendingInviteState = "none" | "pending" | "expired";

export function pendingInviteState(pendingInviteAt: string | null | undefined, now: Date): PendingInviteState {
  if (!pendingInviteAt) return "none";
  const startedAt = new Date(pendingInviteAt).getTime();
  if (Number.isNaN(startedAt)) return "none";
  return now.getTime() - startedAt > PENDING_INVITE_DAYS * DAY_MS ? "expired" : "pending";
}

export function pendingInviteLabel(state: PendingInviteState): string {
  if (state === "pending") return "Invited · not yet joined";
  if (state === "expired") return "Invite expired · resend";
  return "";
}

export function nominationOutcomeMessage(response: NominationResponse, email: string): string {
  switch (response.mode) {
    case "added":
      return `${email} can now be selected as the approver.`;
    case "lifted":
      return `${email} now has Review access and can be selected as the approver.`;
    case "already_eligible":
      return `${email} can already be selected as the approver.`;
    case "invite":
      if (!response.emailSent) {
        return `Added, but the invitation email didn't send — use Resend.${response.error ? ` (${response.error})` : ""}`;
      }
      if (!response.seated) {
        return `Invitation sent to ${email}, but they can't be seated yet — try Resend in a moment.`;
      }
      return `Invitation sent to ${email}. You can seat them now; the review will be waiting when they join.`;
  }
}
