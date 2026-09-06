"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppLoadingShell, ErrorRecoveryPanel, PasswordUpdatePanel } from "@/components/app-flow-panels";
import {
  parseWorkspaceInviteAcceptanceHash,
  type WorkspaceInviteAcceptance,
  type WorkspaceInviteVerificationType,
} from "@/domain/workspace/invite";
import { beginInvitePasswordSetup, completeInvitePasswordSetup } from "@/lib/invite-password-setup";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { getUserFromSession } from "@/domain/supabase-planner";

/**
 * One panel for both credential links. The email link carries Supabase's
 * token_hash in the URL fragment; nothing is verified until the person submits a
 * password, so a mail scanner that opens the link consumes nothing.
 */
export type CredentialLinkMode = "invite" | "reset";

interface ModeCopy {
  loading: string;
  unavailableTitle: string;
  unavailableBody: string;
  wrongTypeBody: string;
  expired: string;
  fallback: string;
  accepts: readonly WorkspaceInviteVerificationType[];
  panelMode: "invite" | "reset";
  /** Remember an unfinished setup so the app can resume it after a reload. */
  trackSetup: boolean;
}

const FORGOT_PASSWORD_HINT = "Request a new one from Forgot password on the sign-in page.";

const COPY: Record<CredentialLinkMode, ModeCopy> = {
  invite: {
    loading: "Preparing your invitation",
    unavailableTitle: "Invitation link unavailable",
    unavailableBody: "This invitation link is incomplete. Ask an organization administrator to resend it.",
    wrongTypeBody: "This invitation link is incomplete. Ask an organization administrator to resend it.",
    expired:
      "This invitation link has expired or was already used. " +
      "If you already set a password, sign in — or use Forgot password on the sign-in page. " +
      "Otherwise ask an organization administrator to resend the invite.",
    fallback: "Unable to finish setting up your account. Try again.",
    // Resent invitations mint a recovery-typed token for the existing user.
    accepts: ["invite", "recovery"],
    panelMode: "invite",
    trackSetup: true,
  },
  reset: {
    loading: "Preparing your password reset",
    unavailableTitle: "Reset link unavailable",
    unavailableBody: `This reset link is incomplete. ${FORGOT_PASSWORD_HINT}`,
    wrongTypeBody: `This is not a password reset link. ${FORGOT_PASSWORD_HINT}`,
    expired: `This reset link has expired or was already used. ${FORGOT_PASSWORD_HINT}`,
    fallback: "Unable to update your password. Try again.",
    accepts: ["recovery"],
    panelMode: "reset",
    trackSetup: false,
  },
};

function errorMessage(copy: ModeCopy, error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/expired|invalid|already.*used|otp/i.test(message)) return copy.expired;
  return message || copy.fallback;
}

type LinkState =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "wrong_type" }
  | { status: "ready"; acceptance: WorkspaceInviteAcceptance };

export function CredentialLinkPanel({ mode }: { mode: CredentialLinkMode }) {
  const copy = COPY[mode];
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const verifiedRef = useRef(false);
  const [link, setLink] = useState<LinkState>({ status: "loading" });
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const parsed = parseWorkspaceInviteAcceptanceHash(window.location.hash);
    if (!parsed) {
      setLink({ status: "missing" });
      return;
    }
    if (!copy.accepts.includes(parsed.type)) {
      setLink({ status: "wrong_type" });
      return;
    }
    if (copy.trackSetup) beginInvitePasswordSetup();
    setLink({ status: "ready", acceptance: parsed });
  }, [copy]);

  async function finish(password: string) {
    if (link.status !== "ready") return;
    const { acceptance } = link;

    setIsSubmitting(true);
    setMessage("");
    try {
      if (!verifiedRef.current) {
        // A reload after a verified-but-unfinished attempt leaves the one-time
        // token consumed while its session is still live — finish with the
        // session instead. Any other signed-in user (an admin opening the
        // link) must go through the token so their own password is never
        // replaced.
        const { data: sessionData } = await getUserFromSession(supabase);
        const sessionEmail = sessionData?.user?.email?.trim().toLowerCase() ?? "";
        if (sessionEmail === acceptance.email) {
          verifiedRef.current = true;
        } else {
          const { error } = await supabase.auth.verifyOtp({ token_hash: acceptance.tokenHash, type: acceptance.type });
          if (error) throw error;
          verifiedRef.current = true;
        }
      }

      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;

      if (copy.trackSetup) completeInvitePasswordSetup();
      router.replace("/");
      router.refresh();
    } catch (error) {
      setMessage(errorMessage(copy, error));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (link.status === "loading") {
    return <AppLoadingShell title={copy.loading} />;
  }

  if (link.status === "missing" || link.status === "wrong_type") {
    return (
      <ErrorRecoveryPanel
        title={copy.unavailableTitle}
        body={link.status === "missing" ? copy.unavailableBody : copy.wrongTypeBody}
        actionLabel="Go to sign in"
        onRetry={() => router.replace("/")}
      />
    );
  }

  return (
    <PasswordUpdatePanel
      mode={copy.panelMode}
      email={link.acceptance.email}
      message={message}
      isSubmitting={isSubmitting}
      onUpdatePassword={(password) => void finish(password)}
    />
  );
}

export function PasswordResetPanel() {
  return <CredentialLinkPanel mode="reset" />;
}
