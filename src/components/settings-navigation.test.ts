import { describe, expect, it } from "vitest";
import { embeddedSettingsSections, settingsSections } from "./settings-navigation";

describe("settings navigation", () => {
  it("offers the phone portal while keeping embedded settings limited to organization controls", () => {
    const sectionIds = settingsSections.map((section) => section.id);

    expect(sectionIds).toContain("phone-portal");
    expect(sectionIds).not.toContain("projects");
    expect(embeddedSettingsSections.map((section) => section.id)).toEqual([
      "account",
      "appearance",
      "organization",
    ]);
  });
});
