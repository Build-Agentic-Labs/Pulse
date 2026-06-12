/**
 * Client-side mirror of the approved sign-up domains enforced in the database
 * (workspace_auto_join_domains + the enforce_signup_domain trigger on auth.users).
 * Validating here gives users a friendly message before the request is sent;
 * the trigger remains the actual enforcement.
 */
export const ALLOWED_SIGNUP_DOMAINS = ["anacorp.com"] as const;

export const SIGNUP_DOMAIN_MESSAGE =
  "Use your @anacorp.com work email to create an account.";

export function isAllowedSignupEmail(email: string): boolean {
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  return ALLOWED_SIGNUP_DOMAINS.some((allowed) => domain === allowed);
}
