/**
 * Who may download the general work instruction template.
 *
 * Restricted to its author while Quality (QC) reviews it. When QC approves,
 * open it to every member by making this return true for any signed-in user
 * (and drop the allowlist) — the API route and the Manage link both read it.
 *
 * Plain module on purpose: it is read by a server route and a client
 * component (see CLAUDE.md, "values shared across the server/client boundary").
 */
export const WI_TEMPLATE_PREVIEW_EMAILS: readonly string[] = ["rlopez@anacorp.com"];

export function canDownloadWorkInstructionTemplate(email: string | null | undefined): boolean {
  const normalized = email?.trim().toLowerCase();
  return Boolean(normalized) && WI_TEMPLATE_PREVIEW_EMAILS.includes(normalized as string);
}
