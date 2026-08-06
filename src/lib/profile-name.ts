export const PROFILE_NAME_UPDATED_EVENT = "pulse:profile-name-updated";

export function normalizeDisplayName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function displayNameValidationMessage(value: string) {
  const name = normalizeDisplayName(value);
  if (!name) {
    return "Enter your name.";
  }
  if (name.length > 100) {
    return "Use 100 characters or fewer.";
  }
  return null;
}

export function hasCompletedDisplayName(fullName?: string | null) {
  return normalizeDisplayName(fullName ?? "").length > 0;
}

export function announceProfileNameUpdated(fullName: string) {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(
    new CustomEvent<string>(PROFILE_NAME_UPDATED_EVENT, {
      detail: normalizeDisplayName(fullName),
    }),
  );
}
