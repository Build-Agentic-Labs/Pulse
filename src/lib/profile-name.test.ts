import { describe, expect, it } from "vitest";
import {
  displayNameValidationMessage,
  hasCompletedDisplayName,
  normalizeDisplayName,
} from "./profile-name";

describe("profile display names", () => {
  it("normalizes edge and repeated whitespace", () => {
    expect(normalizeDisplayName("  Rosendo   Lopez  ")).toBe("Rosendo Lopez");
  });

  it("prompts only when the saved name is blank", () => {
    expect(hasCompletedDisplayName(null)).toBe(false);
    expect(hasCompletedDisplayName("   ")).toBe(false);
    expect(hasCompletedDisplayName("rlopez@anacorp.com")).toBe(true);
    expect(hasCompletedDisplayName("rlopez")).toBe(true);
    expect(hasCompletedDisplayName("Rosendo Lopez")).toBe(true);
  });

  it("requires only a non-empty name", () => {
    expect(displayNameValidationMessage("")).toBe("Enter your name.");
    expect(displayNameValidationMessage("person")).toBeNull();
    expect(displayNameValidationMessage("1234")).toBeNull();
  });
});
