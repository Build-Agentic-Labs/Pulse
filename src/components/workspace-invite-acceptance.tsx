"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AppLoadingShell,
  ErrorRecoveryPanel,
  PasswordUpdatePanel,
} from "@/components/app-flow-panels";
import {
  parseWorkspaceInviteAcceptanceHash,
  type WorkspaceInviteAcceptance,
} from "@/domain/workspace/invite";
import {
  beginInvitePasswordSetup,
  completeInvitePasswordSetup,
} from "@/lib/invite-password-setup";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

function inviteErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/expired|invalid|already.*used|otp/i.test(message)) {
    return "This invitation link has expired or was already used. Ask an organization administrator to resend it.";
  }
  return message || "Unable to finish setting up your account. Try again.";
}

export function WorkspaceInviteAcceptancePanel() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const verifiedRef = useRef(false);
  const [acceptance, setAcceptance] = useState<WorkspaceInviteAcceptance | null>();
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const parsed = parseWorkspaceInviteAcceptanceHash(window.location.hash);
    if (parsed) {
      beginInvitePasswordSetup();
    }
    setAcceptance(parsed);
  }, []);

  async function finishSetup(password: string) {
    if (!acceptance) return;

    setIsSubmitting(true);
    setMessage("");
    try {
      if (!verifiedRef.current) {
        const { error } = await supabase.auth.verifyOtp({
          token_hash: acceptance.tokenHash,
          type: acceptance.type,
        });
        if (error) throw error;
        verifiedRef.current = true;
      }

      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;

      completeInvitePasswordSetup();
      router.replace("/");
      router.refresh();
    } catch (error) {
      setMessage(inviteErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (acceptance === undefined) {
    return <AppLoadingShell title="Preparing your invitation" />;
  }

  if (acceptance === null) {
    return (
      <ErrorRecoveryPanel
        title="Invitation link unavailable"
        body="This invitation link is incomplete. Ask an organization administrator to resend it."
        actionLabel="Go to sign in"
        onRetry={() => router.replace("/")}
      />
    );
  }

  return (
    <PasswordUpdatePanel
      mode="invite"
      email={acceptance.email}
      message={message}
      isSubmitting={isSubmitting}
      onUpdatePassword={(password) => void finishSetup(password)}
    />
  );
}
