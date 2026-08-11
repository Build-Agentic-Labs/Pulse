"use client";

import { Check, ChevronLeft, ChevronRight, MailPlus, PackageCheck, Send, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { ThemedSelect } from "@/components/themed-select";
import type { AccessLevel, Project } from "@/domain/types";
import type { Department, DeptRole } from "@/domain/departments";
import { DEPT_ROLE_ACCESS, standardPositionTitlesForDepartment } from "@/domain/departments";
import {
  describeInviteEntitlements,
  entitlementsForPackage,
  INVITE_PACKAGE_OPTIONS,
  ORGANIZATION_ROLE_OPTIONS,
  type InviteAccessPackage,
  type OrganizationInviteRole,
  type WorkspaceInviteEntitlements,
} from "@/domain/workspace/invite-access";
import { isAllowedSignupEmail } from "@/lib/allowed-signup-domain";

const STEPS = ["Person", "Org role", "Access package", "Resources & scope", "Review & send"] as const;
const ACCESS_OPTIONS = [
  { value: "none", label: "No access" },
  { value: "view", label: "View", description: "Can open and read" },
  { value: "edit", label: "Edit", description: "Can create and change content" },
] as const;
const DEPARTMENT_ROLE_OPTIONS = [
  { value: "none", label: "No duty" },
  ...(["author", "reviewer", "approver"] as const).map((role) => ({
    value: role,
    label: DEPT_ROLE_ACCESS[role].label,
    description: DEPT_ROLE_ACCESS[role].description,
  })),
];

function StepChoice({
  active,
  description,
  label,
  onClick,
}: {
  active: boolean;
  description: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`rounded-lg border p-3 text-left transition-colors ${
        active ? "border-ink bg-surface-raised" : "border-line bg-surface hover:border-border-strong"
      }`}
      aria-pressed={active}
      onClick={onClick}
    >
      <span className="flex items-center gap-2 text-[13px] font-medium text-ink">
        <span
          className={`grid h-4 w-4 place-items-center rounded-full border ${active ? "border-ink bg-ink text-white" : "border-border-strong"}`}
          aria-hidden="true"
        >
          {active ? <Check size={10} /> : null}
        </span>
        {label}
      </span>
      <span className="mt-1.5 block pl-6 text-[12px] leading-5 text-ink-secondary">{description}</span>
    </button>
  );
}

export function WorkspaceInviteComposer({
  callerIsOwner,
  departments,
  isSubmitting,
  onSubmit,
  projects,
}: {
  callerIsOwner: boolean;
  departments: readonly Department[];
  isSubmitting: boolean;
  onSubmit: (email: string, entitlements: WorkspaceInviteEntitlements) => Promise<boolean>;
  projects: readonly Project[];
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [email, setEmail] = useState("");
  const [personError, setPersonError] = useState("");
  const [entitlements, setEntitlements] = useState<WorkspaceInviteEntitlements>(() =>
    entitlementsForPackage("custom", departments),
  );

  const projectNames = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects]);
  const departmentNames = useMemo(
    () => new Map(departments.map((department) => [department.id, department.name])),
    [departments],
  );
  const summary = describeInviteEntitlements(entitlements, projectNames, departmentNames);

  function reset() {
    setOpen(false);
    setStep(0);
    setEmail("");
    setPersonError("");
    setEntitlements(entitlementsForPackage("custom", departments));
  }

  function goNext() {
    if (step === 0) {
      const normalized = email.trim().toLowerCase();
      if (!normalized || !isAllowedSignupEmail(normalized)) {
        setPersonError("Enter an Anacorp work email.");
        return;
      }
      setEmail(normalized);
      setPersonError("");
    }
    setStep((current) => Math.min(STEPS.length - 1, current + 1));
  }

  function selectPackage(accessPackage: InviteAccessPackage) {
    const preset = entitlementsForPackage(accessPackage, departments);
    setEntitlements({ ...preset, organizationRole: entitlements.organizationRole });
  }

  function setProjectLevel(projectId: string, level: AccessLevel) {
    setEntitlements((current) => ({
      ...current,
      projectAccess:
        level === "none"
          ? current.projectAccess.filter((grant) => grant.projectId !== projectId)
          : [
              ...current.projectAccess.filter((grant) => grant.projectId !== projectId),
              { projectId, level },
            ],
    }));
  }

  function setDepartmentRole(departmentId: string, role: DeptRole | "none") {
    setEntitlements((current) => ({
      ...current,
      departmentAccess:
        role === "none"
          ? current.departmentAccess.filter((grant) => grant.departmentId !== departmentId)
          : [
              ...current.departmentAccess.filter((grant) => grant.departmentId !== departmentId),
              {
                departmentId,
                role,
                positionTitle:
                  current.departmentAccess.find((grant) => grant.departmentId === departmentId)?.positionTitle ??
                  standardPositionTitlesForDepartment(
                    departments.find((department) => department.id === departmentId)?.code ?? "",
                  )[0] ??
                  "Team Member",
              },
            ],
    }));
  }

  function setDepartmentPosition(departmentId: string, positionTitle: string) {
    setEntitlements((current) => ({
      ...current,
      departmentAccess: current.departmentAccess.map((grant) =>
        grant.departmentId === departmentId ? { ...grant, positionTitle } : grant,
      ),
    }));
  }

  async function submit() {
    if (await onSubmit(email, entitlements)) reset();
  }

  if (!open) {
    return (
      <div className="flex flex-col gap-3 p-3.5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[13px] font-medium text-ink">Invite with the right access on day one</p>
          <p className="mt-1 text-[12px] leading-5 text-ink-secondary">
            Choose an organization role, then grant only the modules, projects, and SOP duties they need.
          </p>
        </div>
        <button type="button" className="ui-btn-primary h-9 shrink-0 gap-1.5 px-3" onClick={() => setOpen(true)}>
          <MailPlus size={13} />
          Start invitation
        </button>
      </div>
    );
  }

  return (
    <div className="p-3.5">
      <div className="overflow-x-auto pb-1" aria-label="Invitation progress">
        <ol className="flex min-w-[620px] items-center gap-1">
          {STEPS.map((label, index) => (
            <li key={label} className="flex min-w-0 flex-1 items-center gap-1">
              <button
                type="button"
                className={`flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] transition-colors ${
                  index === step ? "bg-ink text-white" : index < step ? "text-ink" : "text-ink-tertiary"
                }`}
                onClick={() => index <= step && setStep(index)}
                disabled={index > step}
                aria-current={index === step ? "step" : undefined}
              >
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-current">
                  {index < step ? <Check size={11} /> : index + 1}
                </span>
                <span className="truncate">{label}</span>
              </button>
              {index < STEPS.length - 1 ? <span className="h-px flex-1 bg-line" aria-hidden="true" /> : null}
            </li>
          ))}
        </ol>
      </div>

      <div className="mt-4 min-h-[250px] rounded-xl border border-line bg-surface-muted p-4">
        {step === 0 ? (
          <div className="mx-auto max-w-xl">
            <div className="flex items-center gap-2">
              <MailPlus size={16} className="text-ink-secondary" />
              <h4 className="text-[14px] font-semibold text-ink">Who are you inviting?</h4>
            </div>
            <p className="mt-1 text-[12px] text-ink-secondary">They will use this email to create their password.</p>
            <label className="mt-5 block text-[11px] font-medium text-ink-secondary" htmlFor="workspace-invite-email">
              Work email
            </label>
            <input
              id="workspace-invite-email"
              className={`ui-field-standalone mt-1 h-10 w-full px-3 ${personError ? "border-danger" : ""}`}
              type="email"
              autoComplete="email"
              placeholder="name@anacorp.com"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                if (personError) setPersonError("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") goNext();
              }}
              aria-describedby={personError ? "workspace-invite-email-error" : undefined}
              aria-invalid={Boolean(personError)}
            />
            {personError ? (
              <p id="workspace-invite-email-error" className="mt-1.5 text-[11px] text-danger">
                {personError}
              </p>
            ) : null}
          </div>
        ) : null}

        {step === 1 ? (
          <div>
            <h4 className="text-[14px] font-semibold text-ink">Choose the organization role</h4>
            <p className="mt-1 text-[12px] text-ink-secondary">
              A Member receives explicit access. An Admin manages the organization and has full access.
            </p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {ORGANIZATION_ROLE_OPTIONS.filter((option) => option.value !== "admin" || callerIsOwner).map((option) => (
                <StepChoice
                  key={option.value}
                  active={entitlements.organizationRole === option.value}
                  label={option.label}
                  description={option.description}
                  onClick={() =>
                    setEntitlements((current) => ({
                      ...current,
                      organizationRole: option.value as OrganizationInviteRole,
                    }))
                  }
                />
              ))}
            </div>
            {!callerIsOwner ? (
              <p className="mt-3 text-[11px] text-ink-tertiary">Only an owner can invite another Admin.</p>
            ) : null}
          </div>
        ) : null}

        {step === 2 ? (
          <div>
            <div className="flex items-center gap-2">
              <PackageCheck size={16} className="text-ink-secondary" />
              <h4 className="text-[14px] font-semibold text-ink">Start from an access package</h4>
            </div>
            <p className="mt-1 text-[12px] text-ink-secondary">
              Packages are editable starting points, not a second permission layer.
            </p>
            <div className="mt-4 grid gap-2 md:grid-cols-2">
              {INVITE_PACKAGE_OPTIONS.map((option) => (
                <StepChoice
                  key={option.value}
                  active={entitlements.accessPackage === option.value}
                  label={option.label}
                  description={option.description}
                  onClick={() => selectPackage(option.value)}
                />
              ))}
            </div>
          </div>
        ) : null}

        {step === 3 ? (
          <div>
            <h4 className="text-[14px] font-semibold text-ink">Set resources and scope</h4>
            <p className="mt-1 text-[12px] text-ink-secondary">
              Resource access and SOP workflow duties stay separate so one person can Create, Review, or Approve by department.
            </p>

            {entitlements.organizationRole === "admin" ? (
              <div className="mt-4 flex items-start gap-2 rounded-lg border border-line bg-surface p-3 text-[12px] text-ink-secondary">
                <ShieldCheck size={15} className="mt-0.5 shrink-0" />
                Admins already receive full module and project access. Department duties below remain explicit because final Quality approval is a separate workflow responsibility.
              </div>
            ) : (
              <div className="mt-4 overflow-hidden rounded-lg border border-line bg-surface">
                <div className="grid items-center gap-3 border-b border-line p-3 sm:grid-cols-[minmax(0,1fr)_220px]">
                  <div>
                    <p className="text-[13px] font-medium text-ink">Quality Module</p>
                    <p className="text-[11px] text-ink-secondary">SOPs, reviews, and controlled documents</p>
                  </div>
                  <ThemedSelect
                    ariaLabel="Quality Module access"
                    value={entitlements.qualityAccess}
                    options={ACCESS_OPTIONS}
                    onChange={(value) =>
                      setEntitlements((current) => ({ ...current, qualityAccess: value as AccessLevel }))
                    }
                    triggerClassName="h-9 px-3"
                  />
                </div>
                <div className="grid items-center gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_220px]">
                  <div>
                    <p className="text-[13px] font-medium text-ink">Planning</p>
                    <p className="text-[11px] text-ink-secondary">Work orders, schedules, and production capacity</p>
                  </div>
                  <ThemedSelect
                    ariaLabel="Planning access"
                    value={entitlements.planningAccess ? "access" : "none"}
                    options={[
                      { value: "none", label: "No access" },
                      { value: "access", label: "Access" },
                    ]}
                    onChange={(value) =>
                      setEntitlements((current) => ({ ...current, planningAccess: value === "access" }))
                    }
                    triggerClassName="h-9 px-3"
                  />
                </div>
              </div>
            )}

            {entitlements.organizationRole !== "admin" && projects.length ? (
              <div className="mt-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-tertiary">Projects</p>
                <div className="mt-2 overflow-hidden rounded-lg border border-line bg-surface">
                  {projects.map((project, index) => (
                    <div
                      key={project.id}
                      className={`grid items-center gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_220px] ${index ? "border-t border-line" : ""}`}
                    >
                      <p className="truncate text-[13px] font-medium text-ink">{project.name}</p>
                      <ThemedSelect
                        ariaLabel={`${project.name} access`}
                        value={entitlements.projectAccess.find((grant) => grant.projectId === project.id)?.level ?? "none"}
                        options={ACCESS_OPTIONS}
                        onChange={(value) => setProjectLevel(project.id, value as AccessLevel)}
                        triggerClassName="h-9 px-3"
                      />
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {departments.length ? (
              <div className="mt-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-tertiary">SOP workflow duties</p>
                <p className="mt-1 text-[11px] text-ink-secondary">
                  These duties are cumulative: Approve includes Review and Create. Quality-gate approval remains the final release approval.
                </p>
                <div className="mt-2 overflow-hidden rounded-lg border border-line bg-surface">
                  {departments.map((department, index) => (
                    <div
                      key={department.id}
                      className={`grid items-center gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_160px_260px] ${index ? "border-t border-line" : ""}`}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-medium text-ink">
                          {department.name}
                          {department.isQualityGate ? <span className="ml-2 text-[10px] text-danger">Final Quality gate</span> : null}
                        </p>
                        <p className="text-[11px] text-ink-tertiary">{department.code}</p>
                      </div>
                      <ThemedSelect
                        ariaLabel={`${department.name} SOP duty`}
                        value={
                          entitlements.departmentAccess.find((grant) => grant.departmentId === department.id)?.role ?? "none"
                        }
                        options={DEPARTMENT_ROLE_OPTIONS}
                        onChange={(value) => setDepartmentRole(department.id, value as DeptRole | "none")}
                        triggerClassName="h-9 px-3"
                      />
                      {entitlements.departmentAccess.find((grant) => grant.departmentId === department.id) ? (
                        <ThemedSelect
                          ariaLabel={`${department.name} job title`}
                          value={
                            entitlements.departmentAccess.find((grant) => grant.departmentId === department.id)
                              ?.positionTitle ?? ""
                          }
                          options={standardPositionTitlesForDepartment(department.code).map((title) => ({
                            value: title,
                            label: title,
                          }))}
                          allowCustomValue
                          placeholder="Select or add job title"
                          onChange={(value) => setDepartmentPosition(department.id, value)}
                          triggerClassName="h-9 px-3"
                        />
                      ) : (
                        <span className="text-[11px] text-ink-tertiary sm:text-right">Job title after duty</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {step === 4 ? (
          <div className="mx-auto max-w-2xl">
            <div className="flex items-center gap-2">
              <Send size={16} className="text-ink-secondary" />
              <h4 className="text-[14px] font-semibold text-ink">Review and send</h4>
            </div>
            <p className="mt-1 text-[12px] text-ink-secondary">
              {email} will receive one secure link to create a password. These grants activate together after sign-in.
            </p>
            <div className="mt-4 overflow-hidden rounded-lg border border-line bg-surface">
              <div className="border-b border-line px-3 py-2.5 text-[12px] font-medium text-ink">Access summary</div>
              <ul className="divide-y divide-line">
                {summary.map((item) => (
                  <li key={item} className="flex items-center gap-2 px-3 py-2.5 text-[12px] text-ink-secondary">
                    <Check size={12} className="shrink-0 text-ink" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <button type="button" className="ui-btn-ghost h-9 px-3" onClick={step === 0 ? reset : () => setStep(step - 1)}>
            {step === 0 ? null : <ChevronLeft size={13} />}
            {step === 0 ? "Cancel" : "Back"}
          </button>
        </div>
        {step < STEPS.length - 1 ? (
          <button type="button" className="ui-btn-primary h-9 gap-1.5 px-3" onClick={goNext}>
            Continue
            <ChevronRight size={13} />
          </button>
        ) : (
          <button
            type="button"
            className="ui-btn-primary h-9 gap-1.5 px-3 disabled:opacity-50"
            onClick={() => void submit()}
            disabled={isSubmitting}
          >
            <Send size={13} />
            {isSubmitting ? "Sending…" : "Send invitation"}
          </button>
        )}
      </div>
    </div>
  );
}
