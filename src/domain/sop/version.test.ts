import { describe, it, expect } from "vitest";
import {
  formatVersion,
  formatVersionLabel,
  initialVersion,
  firstEffectiveVersion,
  nextVersion,
  nextVersionLabel,
  versionLabel,
} from "./version";

describe("SOP versioning", () => {
  it("keeps the initial V1 version through first effectiveness", () => {
    expect(formatVersion(initialVersion())).toBe("1.0");
    expect(formatVersion(firstEffectiveVersion())).toBe("1.0");
  });

  it("bumps minor for editorial changes", () => {
    expect(nextVersion({ major: 1, minor: 0 }, "MINOR")).toEqual({ major: 1, minor: 1 });
    expect(formatVersion(nextVersion({ major: 2, minor: 3 }, "MINOR"))).toBe("2.4");
  });

  it("bumps major and resets minor for substantive changes", () => {
    expect(nextVersion({ major: 1, minor: 4 }, "MAJOR")).toEqual({ major: 2, minor: 0 });
    expect(formatVersion(nextVersion({ major: 1, minor: 0 }, "MAJOR"))).toBe("2.0");
  });

  it("renders controlled labels without a redundant zero", () => {
    expect(formatVersionLabel({ major: 1, minor: 0 })).toBe("V1");
    expect(versionLabel("1.1")).toBe("V1.1");
    expect(versionLabel("V2.0")).toBe("V2");
    expect(nextVersionLabel("1.0", "MINOR")).toBe("V1.1");
    expect(nextVersionLabel("1.3", "MAJOR")).toBe("V2");
  });
});
