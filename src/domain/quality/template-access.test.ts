import { describe, expect, it } from "vitest";
import { canDownloadWorkInstructionTemplate } from "./template-access";

describe("canDownloadWorkInstructionTemplate", () => {
  it("allows the template owner while it awaits QC approval", () => {
    expect(canDownloadWorkInstructionTemplate("rlopez@anacorp.com")).toBe(true);
  });

  it("ignores case and surrounding whitespace", () => {
    expect(canDownloadWorkInstructionTemplate("  RLopez@AnaCorp.com ")).toBe(true);
  });

  it("refuses everyone else, including other company addresses", () => {
    expect(canDownloadWorkInstructionTemplate("qc@anacorp.com")).toBe(false);
    expect(canDownloadWorkInstructionTemplate("rlopez@anacorp.com.evil.test")).toBe(false);
  });

  it("refuses a missing identity", () => {
    expect(canDownloadWorkInstructionTemplate(null)).toBe(false);
    expect(canDownloadWorkInstructionTemplate(undefined)).toBe(false);
    expect(canDownloadWorkInstructionTemplate("")).toBe(false);
  });
});
