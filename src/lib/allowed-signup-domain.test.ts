import { describe, expect, it } from "vitest";
import { isAllowedSignupEmail } from "./allowed-signup-domain";

describe("isAllowedSignupEmail", () => {
  it("accepts anacorp.com work emails", () => {
    expect(isAllowedSignupEmail("jli@anacorp.com")).toBe(true);
    expect(isAllowedSignupEmail("JLI@ANACORP.COM")).toBe(true);
    expect(isAllowedSignupEmail("  jli@anacorp.com  ")).toBe(true);
  });

  it("rejects other domains", () => {
    expect(isAllowedSignupEmail("jli@gmail.com")).toBe(false);
    expect(isAllowedSignupEmail("jli@anacorp.com.evil.io")).toBe(false);
    expect(isAllowedSignupEmail("jli@notanacorp.com")).toBe(false);
  });

  it("rejects malformed input", () => {
    expect(isAllowedSignupEmail("")).toBe(false);
    expect(isAllowedSignupEmail("anacorp.com")).toBe(false);
    expect(isAllowedSignupEmail("@")).toBe(false);
  });
});
