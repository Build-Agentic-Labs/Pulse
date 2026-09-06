"use client";

import { CredentialLinkPanel } from "@/components/credential-link-panel";

/** The /invite page: create a password from the fragment-token link. */
export function WorkspaceInviteAcceptancePanel() {
  return <CredentialLinkPanel mode="invite" />;
}
