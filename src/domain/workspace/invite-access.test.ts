import { describe, expect, it } from "vitest";
import type { Department } from "@/domain/departments";
import {
  compactInviteEntitlementSummary,
  describeInviteEntitlements,
  entitlementsForPackage,
  normalizedInviteEntitlements,
  organizationRoleLabel,
  workspaceRoleForOrganizationRole,
} from "./invite-access";

const departments: Department[] = [
  {
    id: "pro-1",
    workspaceId: "workspace-1",
    code: "PRO",
    name: "Process Engineering",
    isQualityGate: false,
    sopTarget: 12,
  },
  {
    id: "qas-1",
    workspaceId: "workspace-1",
    code: "QAS",
    name: "Quality",
    isQualityGate: true,
    sopTarget: 16,
  },
];

describe("workspace invitation access", () => {
  it("maps the simplified Member role to the compatible database role", () => {
    expect(workspaceRoleForOrganizationRole("member")).toBe("editor");
    expect(organizationRoleLabel("viewer")).toBe("Member");
    expect(organizationRoleLabel("editor")).toBe("Member");
  });

  it("builds an editable Industrial Engineer starting point", () => {
    expect(entitlementsForPackage("industrial_engineer", departments)).toEqual({
      organizationRole: "member",
      accessPackage: "industrial_engineer",
      qualityAccess: "edit",
      planningAccess: true,
      projectAccess: [],
      departmentAccess: [
        { departmentId: "pro-1", role: "author", positionTitle: "Industrial Engineer" },
      ],
    });
  });

  it("keeps final Quality approval separate from the reviewer package", () => {
    expect(entitlementsForPackage("quality_reviewer", departments).departmentAccess).toEqual([
      { departmentId: "qas-1", role: "reviewer", positionTitle: "Quality Engineer" },
    ]);
  });

  it("summarizes only the explicit Member grants", () => {
    expect(
      compactInviteEntitlementSummary({
        organizationRole: "member",
        accessPackage: "custom",
        qualityAccess: "view",
        planningAccess: true,
        projectAccess: [{ projectId: "project-1", level: "view" }],
        departmentAccess: [
          { departmentId: "pro-1", role: "author", positionTitle: "Industrial Engineer" },
        ],
      }),
    ).toBe("Member · Quality View · Planning · 1 project · 1 workflow duty");
  });

  it("summarizes Admin as full access without contradictory module rows", () => {
    expect(
      describeInviteEntitlements({
        organizationRole: "admin",
        accessPackage: "custom",
        qualityAccess: "none",
        planningAccess: false,
        projectAccess: [],
        departmentAccess: [],
      }),
    ).toEqual(["Organization: Admin", "Modules and projects: Full access"]);
  });

  it("does not persist hidden project grants beneath the Admin role", () => {
    expect(
      normalizedInviteEntitlements({
        organizationRole: "admin",
        accessPackage: "custom",
        qualityAccess: "view",
        planningAccess: false,
        projectAccess: [{ projectId: "project-1", level: "edit" }],
        departmentAccess: [],
      }),
    ).toMatchObject({ qualityAccess: "edit", planningAccess: true, projectAccess: [] });
  });
});
