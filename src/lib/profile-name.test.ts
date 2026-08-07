import { describe, expect, it } from "vitest";
import {
  displayNameValidationMessage,
  displayNamePartsValidationMessage,
  hasCompletedDisplayName,
  joinDisplayNameParts,
  normalizeDisplayName,
  splitDisplayName,
} from "./profile-name";

describe("profile display names", () => {
  it("normalizes edge and repeated whitespace", () => {
    expect(normalizeDisplayName("  Rosendo   Lopez  ")).toBe("Rosendo Lopez");
    expect(joinDisplayNameParts(" Rosendo ", " Lopez ")).toBe("Rosendo Lopez");
    expect(splitDisplayName("Rosendo De La Cruz")).toEqual({
      firstName: "Rosendo",
      lastName: "De La Cruz",
    });
  });

  it("requires a human first-and-last display name", () => {
    expect(hasCompletedDisplayName(null)).toBe(false);
    expect(hasCompletedDisplayName("   ")).toBe(false);
    expect(hasCompletedDisplayName("rlopez@anacorp.com")).toBe(false);
    expect(hasCompletedDisplayName("rlopez")).toBe(false);
    expect(hasCompletedDisplayName("Rosendo Lopez")).toBe(true);
    expect(hasCompletedDisplayName("Jean-Luc O'Neill")).toBe(true);
  });

  it("explains missing and email-like values", () => {
    expect(displayNameValidationMessage("")).toBe("Enter your first name.");
    expect(displayNameValidationMessage("person")).toBe("Enter your last name.");
    expect(displayNameValidationMessage("person@example.com")).toBe("Enter a first name, not an email address.");
    expect(displayNameValidationMessage("Rosendo Lopez")).toBeNull();
  });

  it("validates the first and last fields independently", () => {
    expect(displayNamePartsValidationMessage("", "Lopez")).toBe("Enter your first name.");
    expect(displayNamePartsValidationMessage("Rosendo", "")).toBe("Enter your last name.");
    expect(displayNamePartsValidationMessage("Rosendo", "person@example.com")).toBe(
      "Enter a last name, not an email address.",
    );
    expect(displayNamePartsValidationMessage("Rosendo", "Lopez")).toBeNull();
  });
});
