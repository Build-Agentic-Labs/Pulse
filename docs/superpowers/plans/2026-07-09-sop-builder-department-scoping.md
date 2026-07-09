# SOP Builder — Department-Scoped Authoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user assign a SOP to an owning department from the builder — scoped to the departments they belong to — with the number auto-minted from that department, and block users who belong to no department.

**Architecture:** The DB already enforces department scoping (RLS on `sops` + `next_sop_number` authorization). This work is app-layer only: pure decision helpers (unit-tested), a membership-scoped store query, a mint-on-first-save path in the editor, a no-department block on the create screen, and removal of the now-redundant control-page assign widget. No database migration.

**Tech Stack:** Next.js 15 (App Router) + React 19, TypeScript, Supabase JS, Vitest.

## Global Constraints

- **Testing convention:** the repo has **no** React Testing Library or Supabase-mock harness. Tests are pure-function Vitest unit tests only (see `src/domain/**/*.test.ts`). Put logic in pure functions and test those; verify store/React wiring with `npm run typecheck` + `npm run build`. Do **not** introduce a component/DB test harness.
- **Immutability:** never mutate `Sop`/state objects — spread to new objects (repo + user rules).
- **Default doc type:** `"SOP"` (v1 exposes only this; `WI`/`FRM`/`POL` are out of scope).
- **No DB migration:** schema, RLS, and RPCs already exist; do not add one.
- **Verification gate (must pass before final commit):** `npm run typecheck`, `npm run test`, `npm run lint`, `npm run build`.
- **Branch:** `feat/sop-builder-department-scoping` (already created and checked out).

---

### Task 1: Pure authoring + membership-filter helpers (TDD)

**Files:**
- Modify: `src/domain/departments.ts` (add `pickMemberDepartments`)
- Test: `src/domain/departments.test.ts` (append cases)
- Create: `src/domain/sop/authoring.ts`
- Test: `src/domain/sop/authoring.test.ts`

**Interfaces:**
- Produces:
  - `pickMemberDepartments(all: Department[], memberIds: ReadonlySet<string>): Department[]`
  - `DEFAULT_DOC_TYPE: "SOP"`
  - `type AuthoringMode = { kind: "blocked" } | { kind: "single"; department: Department } | { kind: "choose"; departments: Department[] }`
  - `authoringMode(myDepartments: Department[]): AuthoringMode`
  - `previewSopNumber(departmentCode: string, docType: string): string`
  - `effectiveSopNumber(columnNumber: string | null | undefined, documentNumber: string): string`

- [ ] **Step 1: Write the failing test for `pickMemberDepartments`**

Append to `src/domain/departments.test.ts`:

```typescript
import { pickMemberDepartments, type Department } from "./departments";

function dept(id: string, code: string): Department {
  return { id, workspaceId: "ws", code, name: `${code} dept`, isQualityGate: false };
}

describe("pickMemberDepartments", () => {
  it("keeps only member departments, preserving input order", () => {
    const all = [dept("a", "QA"), dept("b", "OPS"), dept("c", "ENG")];
    const result = pickMemberDepartments(all, new Set(["c", "a"]));
    expect(result.map((d) => d.id)).toEqual(["a", "c"]);
  });

  it("returns empty when the user is a member of none", () => {
    expect(pickMemberDepartments([dept("a", "QA")], new Set())).toEqual([]);
  });
});
```

> Note: `departments.test.ts` already has `import { describe, it, expect } from "vitest";` at the top — do not duplicate it. Add the two imports above (`pickMemberDepartments`, `type Department`) to the existing import from `./departments` or as shown.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/domain/departments.test.ts`
Expected: FAIL — `pickMemberDepartments is not a function` (or an export/type error).

- [ ] **Step 3: Implement `pickMemberDepartments`**

Append to `src/domain/departments.ts`:

```typescript
/** Departments in `all` that the user is a member of, preserving `all`'s order. */
export function pickMemberDepartments(all: Department[], memberIds: ReadonlySet<string>): Department[] {
  return all.filter((department) => memberIds.has(department.id));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/domain/departments.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing test for the authoring module**

Create `src/domain/sop/authoring.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import type { Department } from "@/domain/departments";
import { authoringMode, previewSopNumber, effectiveSopNumber, DEFAULT_DOC_TYPE } from "./authoring";

function dept(id: string, code: string): Department {
  return { id, workspaceId: "ws", code, name: `${code} dept`, isQualityGate: false };
}

describe("authoringMode", () => {
  it("blocks a user in no department", () => {
    expect(authoringMode([])).toEqual({ kind: "blocked" });
  });

  it("returns a fixed single department", () => {
    const d = dept("a", "QA");
    expect(authoringMode([d])).toEqual({ kind: "single", department: d });
  });

  it("offers a choice for several departments", () => {
    const list = [dept("a", "QA"), dept("b", "OPS")];
    expect(authoringMode(list)).toEqual({ kind: "choose", departments: list });
  });
});

describe("previewSopNumber", () => {
  it("formats CODE-TYPE-### uppercased", () => {
    expect(previewSopNumber("qa", DEFAULT_DOC_TYPE)).toBe("QA-SOP-###");
  });
});

describe("effectiveSopNumber", () => {
  it("prefers the column number when present", () => {
    expect(effectiveSopNumber("QA-SOP-007", "STALE")).toBe("QA-SOP-007");
  });

  it("falls back to the document number when the column is blank or null", () => {
    expect(effectiveSopNumber(null, "DOC-1")).toBe("DOC-1");
    expect(effectiveSopNumber("   ", "DOC-1")).toBe("DOC-1");
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm run test -- src/domain/sop/authoring.test.ts`
Expected: FAIL — cannot find module `./authoring`.

- [ ] **Step 7: Implement the authoring module**

Create `src/domain/sop/authoring.ts`:

```typescript
/**
 * Pure decision logic for department-scoped SOP authoring in the builder. No Supabase — the store
 * layer supplies the data; these functions decide how the create form behaves and how the SOP
 * number is presented. Unit-tested in authoring.test.ts.
 */

import type { Department } from "@/domain/departments";

/** Document type minted for hand-authored SOPs (v1 exposes only SOP). */
export const DEFAULT_DOC_TYPE = "SOP";

/**
 * How the builder presents department selection, derived from the departments the current user may
 * author in:
 *  - `blocked`: member of none -> cannot create a SOP.
 *  - `single`: exactly one -> show it as a fixed label (nothing to pick).
 *  - `choose`: several -> inline dropdown, defaulting to the first.
 */
export type AuthoringMode =
  | { kind: "blocked" }
  | { kind: "single"; department: Department }
  | { kind: "choose"; departments: Department[] };

/** Decide how the builder should present department selection for these member departments. */
export function authoringMode(myDepartments: Department[]): AuthoringMode {
  const [first] = myDepartments;
  if (!first) return { kind: "blocked" };
  if (myDepartments.length === 1) return { kind: "single", department: first };
  return { kind: "choose", departments: myDepartments };
}

/** Human preview of the number to be minted, e.g. previewSopNumber("QA","SOP") -> "QA-SOP-###". */
export function previewSopNumber(departmentCode: string, docType: string): string {
  return `${departmentCode.toUpperCase()}-${docType.toUpperCase()}-###`;
}

/**
 * The authoritative SOP number: the promoted `sop_number` column when set, else the jsonb copy.
 * Keeps the list (reads the column) and the editor (read the jsonb) from disagreeing.
 */
export function effectiveSopNumber(columnNumber: string | null | undefined, documentNumber: string): string {
  const trimmed = (columnNumber ?? "").trim();
  return trimmed || documentNumber;
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm run test -- src/domain/sop/authoring.test.ts src/domain/departments.test.ts`
Expected: PASS (all)

- [ ] **Step 9: Commit**

```bash
git add src/domain/departments.ts src/domain/departments.test.ts src/domain/sop/authoring.ts src/domain/sop/authoring.test.ts
git commit -m "feat(sop): pure department-authoring helpers + membership filter"
```

---

### Task 2: Store layer — membership query, save options, number overlay

**Files:**
- Modify: `src/lib/departments/store.ts` (add `listMyDepartments`)
- Modify: `src/lib/sop/store.ts` (extend `SaveSopOptions`, write department on INSERT, overlay number in `mapSop`)

**Interfaces:**
- Consumes: `pickMemberDepartments` (Task 1), `effectiveSopNumber` (Task 1)
- Produces:
  - `listMyDepartments(workspaceId: string): Promise<Department[]>`
  - `SaveSopOptions` gains `departmentId?: string` and `docType?: string`
  - `saveSop` writes `department_id` + `doc_type` on the INSERT branch only
  - `mapSop` makes the `sop_number` column authoritative for `meta.sopNumber`

> **Testing note:** these hit Supabase and cannot be unit-tested with the repo's harness. Their pure inputs are already covered by Task 1 (`pickMemberDepartments`, `effectiveSopNumber`). Verify this task with `npm run typecheck`.

- [ ] **Step 1: Add `listMyDepartments` to `src/lib/departments/store.ts`**

Add the import at the top (extend the existing `@/domain/departments` import):

```typescript
import type { Department, DepartmentMember, DeptRole } from "@/domain/departments";
import { pickMemberDepartments } from "@/domain/departments";
```

Append this function at the end of the file:

```typescript
/**
 * The departments the current user is an explicit member of (author/reviewer/approver), for the
 * builder's owning-department picker. Managers are intentionally NOT folded in here (unlike the DB
 * `has_department_role`): authoring requires real membership, so a manager with no department is
 * blocked from creating SOPs until added to one.
 */
export async function listMyDepartments(workspaceId: string): Promise<Department[]> {
  const supabase = createPlannerSupabaseClient();
  const { data: userData } = await getUserFromSession(supabase);
  const userId = userData.user?.id;
  if (!userId) return [];
  const departments = await listDepartments(workspaceId);
  const rows = await throwIfError(
    supabase.from("department_members").select(MEMBER_COLUMNS).eq("user_id", userId),
  );
  const memberIds = new Set((rows ?? []).map((row: Record<string, unknown>) => mapMember(row).departmentId));
  return pickMemberDepartments(departments, memberIds);
}
```

- [ ] **Step 2: Extend `SaveSopOptions` in `src/lib/sop/store.ts`**

Replace the `SaveSopOptions` interface (currently only `expectedUpdatedAt`) with:

```typescript
export interface SaveSopOptions {
  /**
   * Optimistic-concurrency token for SOPs that already exist server-side: the `updatedAt`
   * loaded when the editor opened (or returned by the previous save). Present -> guarded
   * UPDATE that throws `SopConflictError` if the row moved; absent -> plain INSERT.
   */
  expectedUpdatedAt?: string;
  /**
   * Owning department + document type, written only on the initial INSERT (the DB trigger freezes
   * `department_id` once the SOP leaves draft, and it is never changed on later saves).
   */
  departmentId?: string;
  docType?: string;
}
```

- [ ] **Step 3: Write `department_id` + `doc_type` on the INSERT branch of `saveSop`**

In `src/lib/sop/store.ts`, replace the first-save INSERT call:

```typescript
  // First save: a plain INSERT so created_by is written exactly once and never rewritten.
  const inserted = await throwIfError(
    supabase
      .from("sops")
      .insert({ ...row, id: next.id, workspace_id: workspaceId, created_by: userId })
      .select(SOP_COLUMNS)
      .single(),
  );
  return mapSop(inserted as Record<string, unknown>);
```

with:

```typescript
  // First save: a plain INSERT so created_by is written exactly once and never rewritten. The
  // owning department + doc type ride along here (frozen afterwards) when the builder supplies them.
  const inserted = await throwIfError(
    supabase
      .from("sops")
      .insert({
        ...row,
        id: next.id,
        workspace_id: workspaceId,
        created_by: userId,
        ...(options.departmentId
          ? { department_id: options.departmentId, doc_type: options.docType ?? "SOP" }
          : {}),
      })
      .select(SOP_COLUMNS)
      .single(),
  );
  return mapSop(inserted as Record<string, unknown>);
```

- [ ] **Step 4: Make the `sop_number` column authoritative in `mapSop`**

Add the import near the top of `src/lib/sop/store.ts`:

```typescript
import { effectiveSopNumber } from "@/domain/sop/authoring";
```

Replace the `mapSop` function body:

```typescript
function mapSop(row: Record<string, unknown>): Sop {
  const document = (row.document ?? {}) as Sop;
  return {
    ...document,
    id: String(row.id),
    status: (row.status as SopStatus | null) ?? "draft",
    createdAt: String(row.created_at ?? document.createdAt ?? ""),
    updatedAt: String(row.updated_at ?? document.updatedAt ?? ""),
  };
}
```

with:

```typescript
function mapSop(row: Record<string, unknown>): Sop {
  const document = (row.document ?? {}) as Sop;
  return {
    ...document,
    id: String(row.id),
    status: (row.status as SopStatus | null) ?? "draft",
    // The promoted `sop_number` column is authoritative (the list reads it); overlay it onto the
    // jsonb copy so the editor and list never disagree.
    meta: {
      ...document.meta,
      sopNumber: effectiveSopNumber(row.sop_number as string | null | undefined, document.meta?.sopNumber ?? ""),
    },
    createdAt: String(row.created_at ?? document.createdAt ?? ""),
    updatedAt: String(row.updated_at ?? document.updatedAt ?? ""),
  };
}
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/departments/store.ts src/lib/sop/store.ts
git commit -m "feat(sop): store support for department-scoped create (listMyDepartments, save options, number overlay)"
```

---

### Task 3: Editor — owning-department UI, read-only number, mint on first save

**Files:**
- Modify: `src/components/sop/sop-editor.tsx`

**Interfaces:**
- Consumes: `authoringMode`, `previewSopNumber`, `DEFAULT_DOC_TYPE` (Task 1); `mintSopNumber` ([review.ts](../../../src/lib/sop/review.ts)); `SaveSopOptions` (Task 2)
- Produces: `SopEditor` accepts a new optional prop `authoringDepartments?: Department[]` (present only for new SOPs; length ≥ 1)

> **Testing note:** React wiring; verified by `npm run typecheck` + `npm run build`. The decision logic it uses is covered by Task 1.

- [ ] **Step 1: Add imports**

At the top of `src/components/sop/sop-editor.tsx`, add:

```typescript
import type { Department } from "@/domain/departments";
import { authoringMode, DEFAULT_DOC_TYPE, previewSopNumber } from "@/domain/sop/authoring";
import { mintSopNumber } from "@/lib/sop/review";
```

And change the existing store import to also bring in the options type:

```typescript
import { saveSop, SopConflictError, type SaveSopOptions } from "@/lib/sop/store";
```

- [ ] **Step 2: Add the `authoringDepartments` prop**

Replace the `SopEditor` props destructuring + type:

```typescript
export function SopEditor({
  initial,
  workspaceId,
  canEdit = true,
  isNew = false,
}: {
  initial: Sop;
  workspaceId?: string;
  canEdit?: boolean;
  /** True when the SOP has never been persisted (autosave stays off until the first save). */
  isNew?: boolean;
}) {
```

with:

```typescript
export function SopEditor({
  initial,
  workspaceId,
  canEdit = true,
  isNew = false,
  authoringDepartments,
}: {
  initial: Sop;
  workspaceId?: string;
  canEdit?: boolean;
  /** True when the SOP has never been persisted (autosave stays off until the first save). */
  isNew?: boolean;
  /** The departments the author may own this SOP with. Present only for new SOPs (length >= 1). */
  authoringDepartments?: Department[];
}) {
```

- [ ] **Step 3: Add department-selection state**

Immediately after the existing `const [sop, setSop] = useState<Sop>(initial);` line, add:

```typescript
  // Owning-department selection for a new SOP (undefined mode => not the create flow).
  const authMode = isNew && authoringDepartments ? authoringMode(authoringDepartments) : null;
  const [deptId, setDeptId] = useState<string>(() => {
    if (authMode?.kind === "single") return authMode.department.id;
    if (authMode?.kind === "choose") return authMode.departments[0]?.id ?? "";
    return "";
  });
  const selectedDept = authoringDepartments?.find((d) => d.id === deptId) ?? null;
```

- [ ] **Step 4: Rewrite `persist()` to mint the number on the first save**

Replace the entire `persist` function with:

```typescript
  // Persist the current SOP, returning whether it succeeded. Callers that navigate or export
  // gate on the boolean so a failed save never silently drops the user's work.
  async function persist(): Promise<boolean> {
    if (!canEdit || !workspaceId) {
      setSaveError(workspaceId ? "You do not have permission to save this SOP." : "Select an organization before saving.");
      setSaveStatus("error");
      return false;
    }

    // First save of a new SOP: the owning department mints the number (and is written on INSERT).
    const firstSave = isNew && !persistedUpdatedAt;
    if (firstSave && !deptId) {
      setSaveError("Choose an owning department before saving.");
      setSaveStatus("error");
      return false;
    }

    setSaveStatus("saving");
    setSaveError("");

    let working = sop;
    const saveOptions: SaveSopOptions = { expectedUpdatedAt: persistedUpdatedAt };
    if (firstSave) {
      try {
        const minted = await mintSopNumber(workspaceId, deptId, DEFAULT_DOC_TYPE);
        working = { ...sop, meta: { ...sop.meta, sopNumber: minted } };
        setSop(working);
        saveOptions.departmentId = deptId;
        saveOptions.docType = DEFAULT_DOC_TYPE;
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : "Could not assign a SOP number.");
        setSaveStatus("error");
        return false;
      }
    }

    const statusChanged = working.status !== lastSavedStatusRef.current;
    const historyEntry = statusChanged ? statusChangeEntry(working, lastSavedStatusRef.current) : undefined;
    const toSave: Sop = historyEntry ? { ...working, changeHistory: [...working.changeHistory, historyEntry] } : working;
    const editVersion = editVersionRef.current;
    try {
      const next = await saveSop(toSave, workspaceId, saveOptions);
      setPersistedUpdatedAt(next.updatedAt);
      lastSavedStatusRef.current = next.status;
      if (editVersionRef.current === editVersion) {
        // Nothing changed while the save was in flight -- adopt the server copy wholesale.
        setSop(next);
        setDirty(false);
        setSaveStatus("saved");
      } else {
        // Edits landed mid-save: keep them (still dirty, so autosave picks them up) and only
        // fold in the server timestamp plus the auto-appended history row.
        setSop((current) => ({
          ...current,
          updatedAt: next.updatedAt,
          changeHistory: historyEntry ? [...current.changeHistory, historyEntry] : current.changeHistory,
        }));
        setSaveStatus("idle");
      }
      return true;
    } catch (error) {
      if (error instanceof SopConflictError) {
        // Never retry into a conflict -- the user copies their changes and reloads.
        setConflicted(true);
      }
      setSaveError(error instanceof Error ? error.message : "Save failed.");
      setSaveStatus("error");
      return false;
    }
  }
```

- [ ] **Step 5: Replace the SOP-number field and add the owning-department field**

Find the "Document" section's SOP number field:

```typescript
                  <Field label="SOP number">
                    <input
                      className="ui-field-standalone"
                      value={sop.meta.sopNumber}
                      placeholder="SOP-QA-001"
                      disabled={!canEdit}
                      onChange={(event) => update({ meta: { ...sop.meta, sopNumber: event.target.value } })}
                    />
                  </Field>
```

Replace it with a read-only number display **plus** an owning-department field for new SOPs:

```typescript
                  {authMode && authMode.kind !== "blocked" ? (
                    <Field label="Owning department">
                      {authMode.kind === "single" ? (
                        <div className="flex h-9 items-center">
                          <span className="ui-chip">
                            {authMode.department.code} · {authMode.department.name}
                          </span>
                        </div>
                      ) : (
                        <select
                          className="ui-field-standalone"
                          value={deptId}
                          disabled={!canEdit}
                          onChange={(event) => setDeptId(event.target.value)}
                        >
                          {authMode.departments.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.code} · {d.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </Field>
                  ) : null}
                  <Field label="SOP number">
                    <div className="flex h-9 items-center">
                      <span className="font-mono text-sm text-ink">
                        {isNew && !persistedUpdatedAt
                          ? selectedDept
                            ? previewSopNumber(selectedDept.code, DEFAULT_DOC_TYPE)
                            : "Assigned on save"
                          : sop.meta.sopNumber || "—"}
                      </span>
                    </div>
                  </Field>
```

- [ ] **Step 6: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: no errors; build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/components/sop/sop-editor.tsx
git commit -m "feat(sop): owning-department picker + auto-minted read-only number in the builder"
```

---

### Task 4: Block no-department users on the create screen

**Files:**
- Modify: `src/components/sop/sop-new-client.tsx`

**Interfaces:**
- Consumes: `listMyDepartments` (Task 2); `SopEditor` `authoringDepartments` prop (Task 3)

> **Testing note:** React wiring; verified by `npm run typecheck` + `npm run build`.

- [ ] **Step 1: Replace the whole file**

Replace the contents of `src/components/sop/sop-new-client.tsx` with:

```typescript
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Department } from "@/domain/departments";
import { createEmptySop } from "@/domain/sop/schema";
import { listMyDepartments } from "@/lib/departments/store";
import { newSopId } from "@/lib/sop/store";
import { SopEditor } from "./sop-editor";
import { SopShell } from "./sop-shell";
import { canEdit, useSopWorkspace } from "./sop-workspace-provider";

/** Shell-wrapped centered message used for the empty / loading / blocked states. */
function NewSopNotice({ children }: { children: React.ReactNode }) {
  return (
    <SopShell sidebar={<div className="ui-nav-section">SOPs</div>} back={{ href: "/sops", label: "All SOPs" }}>
      <div className="flex h-full items-center justify-center p-4">
        <div className="max-w-md text-center">{children}</div>
      </div>
    </SopShell>
  );
}

export function SopNewClient() {
  const { workspaceId, role } = useSopWorkspace();
  // Build the blank SOP once, client-side (needs crypto + Date).
  const [initial] = useState(() => createEmptySop(newSopId(), new Date().toISOString()));
  // undefined = not loaded yet; [] = loaded, user is in no department.
  const [myDepartments, setMyDepartments] = useState<Department[] | undefined>(undefined);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    setMyDepartments(undefined);
    setLoadError("");
    listMyDepartments(workspaceId)
      .then((rows) => {
        if (active) setMyDepartments(rows);
      })
      .catch((caught) => {
        if (active) setLoadError(caught instanceof Error ? caught.message : "Could not load your departments.");
      });
    return () => {
      active = false;
    };
  }, [workspaceId]);

  if (!workspaceId) {
    return (
      <NewSopNotice>
        <p className="ui-section-subtitle text-ink-tertiary">Create or select an organization before adding a SOP.</p>
        <Link href="/sops" className="ui-btn-ghost mt-3 inline-flex h-9 px-3">
          Back to SOPs
        </Link>
      </NewSopNotice>
    );
  }

  if (loadError) {
    return (
      <NewSopNotice>
        <div className="ui-notice ui-notice-warn px-4 py-3 ui-section-subtitle">{loadError}</div>
      </NewSopNotice>
    );
  }

  if (myDepartments === undefined) {
    return (
      <NewSopNotice>
        <p className="ui-section-subtitle text-ink-tertiary">Loading your departments…</p>
      </NewSopNotice>
    );
  }

  if (myDepartments.length === 0) {
    return (
      <NewSopNotice>
        <p className="text-sm font-medium text-ink">You’re not in a department yet</p>
        <p className="ui-section-subtitle mt-1 text-ink-secondary">
          SOPs are owned by a department. Ask an organization admin to add you to one, then you can create SOPs.
        </p>
        <Link href="/sops" className="ui-btn-ghost mt-3 inline-flex h-9 px-3">
          Back to SOPs
        </Link>
      </NewSopNotice>
    );
  }

  return (
    <SopEditor
      initial={initial}
      workspaceId={workspaceId}
      canEdit={canEdit(role)}
      isNew
      authoringDepartments={myDepartments}
    />
  );
}
```

- [ ] **Step 2: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: no errors; build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/sop/sop-new-client.tsx
git commit -m "feat(sop): block SOP creation for users in no department"
```

---

### Task 5: Remove the control-page department-assign widget

**Files:**
- Modify: `src/components/sop/sop-approval-panel.tsx`
- Delete: `src/components/sop/sop-department-assign.tsx`

**Interfaces:**
- None produced. Removes the now-redundant in-control assignment (department is set in the builder).

> **Testing note:** verified by `npm run typecheck` + `npm run build` (proves no dangling references).

- [ ] **Step 1: Remove the import in `sop-approval-panel.tsx`**

Delete this line:

```typescript
import { SopDepartmentAssign } from "./sop-department-assign";
```

- [ ] **Step 2: Remove the assign block**

Delete this block (the draft-only department assignment; keep the `rejectedReason` block that follows it):

```typescript
          {control.status === "draft" ? (
            <div className="border-t border-line pt-3">
              <SopDepartmentAssign control={control} canEdit={canEdit(role)} onChanged={() => void reload()} />
            </div>
          ) : null}
```

- [ ] **Step 3: Delete the component file**

Run: `git rm src/components/sop/sop-department-assign.tsx`

- [ ] **Step 4: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: no errors — confirms nothing else imports the deleted component.

- [ ] **Step 5: Commit**

```bash
git add src/components/sop/sop-approval-panel.tsx
git commit -m "refactor(sop): remove control-page department-assign (now set in the builder)"
```

---

### Task 6: Full verification gate

**Files:** none (verification only).

- [ ] **Step 1: Run the full gate**

Run each and confirm all pass:

```bash
npm run typecheck
npm run test
npm run lint
npm run build
```

Expected:
- `typecheck`: no errors
- `test`: all suites pass (including the new `authoring.test.ts` and `departments.test.ts` cases)
- `lint`: no errors
- `build`: succeeds

- [ ] **Step 2: If anything fails, fix inline and re-run the gate.** Do not proceed with a red gate.

- [ ] **Step 3: Final sanity commit (if fixes were needed)**

```bash
git add -A
git commit -m "chore(sop): verification-gate fixes for department-scoped authoring"
```

---

## Self-Review

**Spec coverage** (against `2026-07-09-sop-builder-department-scoping-design.md`):
- §4.1 blocked / single / choose rendering → Task 3 (editor) + Task 4 (blocked screen), logic in Task 1 (`authoringMode`).
- §4.1 read-only number + preview → Task 3 Step 5.
- §4.2 mint on first save + write department on INSERT → Task 3 Step 4 + Task 2 Steps 2–3.
- §4.3 existing SOPs unchanged in editor → Task 3 gates all department UI behind `isNew && authoringDepartments`.
- §5 `listMyDepartments` → Task 2 Step 1; `mapSop` overlay → Task 2 Step 4; `SaveSopOptions` → Task 2 Step 2.
- §3.4 remove control-page widget → Task 5.
- §7 testing (pure logic) → Task 1; regression gate → Task 6.
- §8 no migration / no doc-type exposure / no reassignment → honored (no migration task; `DEFAULT_DOC_TYPE` only; widget removed).

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** `authoringMode`/`AuthoringMode`, `previewSopNumber`, `effectiveSopNumber`, `DEFAULT_DOC_TYPE`, `pickMemberDepartments`, `listMyDepartments`, and `SaveSopOptions.{departmentId,docType}` are named identically across Tasks 1–4. `authoringDepartments` prop name matches between Task 3 (definition) and Task 4 (usage).
