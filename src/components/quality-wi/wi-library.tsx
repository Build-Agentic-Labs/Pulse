"use client";
import Link from "next/link";
import { useEffect, useState, useRef } from "react";
import { Plus } from "lucide-react";
import type { Department } from "@/domain/departments";
import type { QualityWi } from "@/domain/quality-wi/schema";
import { formatDate } from "@/domain/formatting";
import { listDepartments, listMyDepartments } from "@/lib/departments/store";
import { listQualityWis } from "@/lib/quality-wi/read-store";
import { createQualityWi } from "@/lib/quality-wi/write-store";
import { SopShell } from "@/components/sop/sop-shell";
import { SopTabNav } from "@/components/sop/sop-tab-nav";
import { useSopWorkspace } from "@/components/sop/sop-workspace-provider";
import { ThemedSelect } from "@/components/themed-select";
import { useRouter } from "next/navigation";
import { useWiIdentity } from "./use-wi-identity";
export function WiLibrary({
  initialWorkspaceId,
  initialUserId,
  initialRows,
}: {
  initialWorkspaceId?: string;
  initialUserId?: string;
  initialRows?: QualityWi[];
}) {
  const { workspaceId, role, canEditSops } = useSopWorkspace();
  const userId = useWiIdentity(initialUserId);
  const router = useRouter();
  const [rows, setRows] = useState(initialRows ?? []);
  const [rowScope, setRowScope] = useState(
    initialWorkspaceId && initialUserId
      ? `${initialUserId}:${initialWorkspaceId}`
      : null,
  );
  const [departments, setDepartments] = useState<Department[]>([]);
  const [department, setDepartment] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(!initialRows);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const createIntent = useRef<{ id: string; scope: string } | null>(null);
  useEffect(
    () => () => {
      createIntent.current = null;
    },
    [userId, workspaceId],
  );
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!workspaceId || !userId) return;
    let active = true;
    setError("");
    if (initialWorkspaceId !== workspaceId || !initialRows) setLoading(true);
    Promise.all([
      listQualityWis(workspaceId),
      role === "owner" || role === "admin"
        ? listDepartments(workspaceId)
        : listMyDepartments(workspaceId),
    ])
      .then(([next, eligible]) => {
        if (!active) return;
        setRows(next);
        setRowScope(`${userId}:${workspaceId}`);
        setDepartments(eligible);
        setDepartment((current) =>
          eligible.some((d) => d.id === current)
            ? current
            : (eligible[0]?.id ?? ""),
        );
        setLoading(false);
      })
      .catch((caught) => {
        if (active) {
          setRowScope(null);
          setRows([]);
          setDepartments([]);
          setError(
            caught instanceof Error
              ? caught.message
              : "Could not load work instructions.",
          );
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [workspaceId, userId, role, initialWorkspaceId, initialRows, retry]);
  const visible = (rowScope === `${userId}:${workspaceId}` ? rows : []).filter(
    (row) =>
      `${row.title} ${row.documentNumber ?? ""} ${row.departmentName}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  const groups = [
    ...new Map(
      visible.map((row) => [row.departmentId, row.departmentName]),
    ).entries(),
  ].sort((a, b) => a[1].localeCompare(b[1]));
  async function create() {
    if (!workspaceId || !department || !userId || creating) return;
    setCreating(true);
    setError("");
    const scope = `${userId}:${workspaceId}:${department}`;
    if (createIntent.current?.scope !== scope)
      createIntent.current = { id: crypto.randomUUID(), scope };
    const intent = createIntent.current;
    const id = intent.id;
    const assertCurrent = () => {
      if (createIntent.current !== intent)
        throw new Error("The authoring context changed.");
    };
    try {
      await createQualityWi(
        id,
        workspaceId,
        department,
        undefined,
        assertCurrent,
        userId,
      );
      assertCurrent();
      router.push(`/sops/work-instructions/${id}`);
    } catch (caught) {
      if (createIntent.current !== intent) return;
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not create the draft.",
      );
      setCreating(false);
    }
  }
  return (
    <SopShell
      sidebar={
        <SopTabNav
          active="work-instructions"
          manage={role === "owner" || role === "admin"}
        />
      }
      crumb="Quality / Work instructions"
    >
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">Work instructions</h1>
            <p className="ui-section-subtitle mt-1">
              General procedures, organized by department.
            </p>
          </div>
          {canEditSops ? (
            <div className="flex items-center gap-2">
              <ThemedSelect
                ariaLabel="Department for new work instruction"
                value={department}
                options={departments.map((d) => ({
                  value: d.id,
                  label: `${d.code} · ${d.name}`,
                }))}
                onChange={setDepartment}
              />
              <button
                className="ui-btn-primary inline-flex h-9 items-center gap-2 px-3"
                disabled={!department || creating || !userId}
                onClick={() => void create()}
              >
                <Plus size={14} />
                {creating ? "Creating…" : "New WI"}
              </button>
            </div>
          ) : null}
        </div>
        {error ? (
          <div className="ui-notice ui-notice-warn p-3" role="alert">
            {error}
            <button
              className="ui-btn-ghost ml-2"
              onClick={() => setRetry((value) => value + 1)}
            >
              Retry
            </button>
          </div>
        ) : null}
        {canEditSops && !loading && !departments.length ? (
          <p className="ui-section-subtitle">
            Join a department before creating a work instruction.
          </p>
        ) : null}
        <input
          type="search"
          aria-label="Search work instructions"
          className="ui-input w-full max-w-sm"
          placeholder="Search by number or title"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {loading ? (
          <p className="ui-section-subtitle" role="status">
            Loading work instructions…
          </p>
        ) : !visible.length ? (
          <div className="rounded border border-line p-8 text-center text-sm text-ink-secondary">
            {search
              ? "No work instructions match your search."
              : "No work instructions yet."}
          </div>
        ) : (
          <div className="overflow-x-auto rounded border border-line">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs text-ink-secondary">
                  <th className="px-4 py-3 font-normal">Number</th>
                  <th className="px-4 py-3 font-normal">Title</th>
                  <th className="px-4 py-3 font-normal">Status</th>
                  <th className="px-4 py-3 font-normal">Updated</th>
                </tr>
              </thead>
              <tbody>
                {groups.map(([id, name]) => (
                  <DepartmentRows
                    key={id}
                    name={name}
                    rows={visible.filter((row) => row.departmentId === id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </SopShell>
  );
}
function DepartmentRows({ name, rows }: { name: string; rows: QualityWi[] }) {
  return (
    <>
      <tr className="border-b border-line">
        <th colSpan={4} className="px-4 py-3 font-medium">
          {name}
          <span className="float-right text-xs font-normal text-ink-tertiary">
            {rows.length} WIs
          </span>
        </th>
      </tr>
      {rows.map((row) => (
        <tr
          key={row.id}
          className="border-b border-line last:border-b-0 hover:bg-surface-muted"
        >
          <td className="px-4 py-3 text-xs">
            <Link
              href={`/sops/work-instructions/${row.id}`}
              className="hover:underline"
            >
              {row.documentNumber ?? `WI-${row.departmentCode}-###`}
            </Link>
          </td>
          <td className="px-4 py-3 font-medium">
            <Link
              href={`/sops/work-instructions/${row.id}`}
              className="hover:underline"
            >
              {row.title || "Untitled work instruction"}
            </Link>
          </td>
          <td className="px-4 py-3 text-xs text-ink-secondary">
            {row.publishedRevisionId
              ? row.hasChanges
                ? "Published · draft changes"
                : "Published"
              : "Draft"}
          </td>
          <td className="px-4 py-3 text-xs text-ink-tertiary">
            {formatDate(row.updatedAt)}
          </td>
        </tr>
      ))}
    </>
  );
}
