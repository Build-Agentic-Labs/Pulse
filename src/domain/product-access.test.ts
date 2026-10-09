import { describe, expect, it } from "vitest";
import { effectiveProductAccess, productAuthorRole } from "./product-access";

describe("Product module permission", () => {
  it("does not give a generic editor Product access", () => {
    expect(effectiveProductAccess({ role: "editor" })).toBe("none");
    expect(productAuthorRole({ role: "editor" })).toBeUndefined();
  });
  it("uses the module level instead of the organization member role", () => {
    expect(productAuthorRole({ role: "editor", productAccess: "view" })).toBe("viewer");
    expect(productAuthorRole({ role: "viewer", productAccess: "edit" })).toBe("editor");
  });
  it("inherits managers and keeps unknown context denied", () => {
    expect(effectiveProductAccess({ role: "admin", productAccess: "none" })).toBe("edit");
    expect(effectiveProductAccess()).toBe("none");
  });
});
