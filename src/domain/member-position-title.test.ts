import { describe, expect, it } from "vitest";
import { memberPositionTitle, type DepartmentMember } from "./departments";
const member = (departmentId: string, positionTitle: string): DepartmentMember => ({ departmentId, positionTitle, userId: "michael", deptRole: "reviewer" });
describe("member position titles across SOP departments", () => {
  it("uses the saved job title for a cross-department approval", () => {
    expect(memberPositionTitle([member("production", "EVP of Operations")], "michael", "planning")).toBe("EVP of Operations");
  });
  it("prefers an explicit title for the assigned department", () => {
    expect(memberPositionTitle([member("production", "Director"), member("planning", "EVP of Operations")], "michael", "planning")).toBe("EVP of Operations");
  });
  it("does not guess when other departments contain conflicting titles", () => {
    expect(memberPositionTitle([member("production", "Director"), member("sales", "VP Sales")], "michael", "planning")).toBe("");
  });
  it("ignores provisional memberships and other users", () => {
    expect(memberPositionTitle([{ ...member("production", "Director"), pendingInviteAt: "pending" }, { ...member("planning", "VP"), userId: "other" }], "michael", "planning")).toBe("");
  });
});
