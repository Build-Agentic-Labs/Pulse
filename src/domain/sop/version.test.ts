import { describe, it, expect } from "vitest";
import { formatVersion, initialVersion, firstEffectiveVersion, nextVersion } from "./version";

describe("SOP versioning", () => {
  it("starts drafts at 0.1 and first-effective at 1.0", () => {
    expect(formatVersion(initialVersion())).toBe("0.1");
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
});
