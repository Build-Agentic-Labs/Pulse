const INVITE_QUERY_PARAM = "invite";
const INVITE_SETUP_STORAGE_KEY = "pulse:invite-password-setup";

export const INVITE_PASSWORD_SETUP_COMPLETED_EVENT = "pulse:invite-password-setup-completed";

export function isInvitePasswordSetupActive(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const url = new URL(window.location.href);
    return (
      url.searchParams.get(INVITE_QUERY_PARAM) === "1" ||
      window.sessionStorage.getItem(INVITE_SETUP_STORAGE_KEY) === "1"
    );
  } catch {
    return false;
  }
}

export function activateInvitePasswordSetup(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const url = new URL(window.location.href);
    const requested = url.searchParams.get(INVITE_QUERY_PARAM) === "1";
    if (requested) {
      window.sessionStorage.setItem(INVITE_SETUP_STORAGE_KEY, "1");
      url.searchParams.delete(INVITE_QUERY_PARAM);
      window.history.replaceState(null, "", url.toString());
    }
    return requested || window.sessionStorage.getItem(INVITE_SETUP_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function completeInvitePasswordSetup() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(INVITE_SETUP_STORAGE_KEY);
  } catch {
    // The password is still updated when storage is unavailable.
  }
  window.dispatchEvent(new Event(INVITE_PASSWORD_SETUP_COMPLETED_EVENT));
}
