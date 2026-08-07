export const PROFILE_NAME_UPDATED_EVENT = "pulse:profile-name-updated";

export function normalizeDisplayName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function splitDisplayName(value: string) {
  const [firstName = "", ...lastNameParts] = normalizeDisplayName(value).split(" ");
  return {
    firstName,
    lastName: lastNameParts.join(" "),
  };
}

export function joinDisplayNameParts(firstName: string, lastName: string) {
  return normalizeDisplayName(`${firstName} ${lastName}`);
}

export function displayNamePartsValidationMessage(firstNameValue: string, lastNameValue: string) {
  const firstName = normalizeDisplayName(firstNameValue);
  const lastName = normalizeDisplayName(lastNameValue);
  if (!firstName) {
    return "Enter your first name.";
  }
  if (firstName.includes("@")) {
    return "Enter a first name, not an email address.";
  }
  if (!lastName) {
    return "Enter your last name.";
  }
  if (lastName.includes("@")) {
    return "Enter a last name, not an email address.";
  }
  if (joinDisplayNameParts(firstName, lastName).length > 100) {
    return "Use 100 characters or fewer.";
  }
  return null;
}

export function displayNameValidationMessage(value: string) {
  const { firstName, lastName } = splitDisplayName(value);
  return displayNamePartsValidationMessage(firstName, lastName);
}

export function hasCompletedDisplayName(fullName?: string | null) {
  return displayNameValidationMessage(fullName ?? "") === null;
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
