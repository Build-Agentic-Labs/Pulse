"use client";
import Link from "next/link";
import { useEffect, useState, useRef } from "react";
import { FileDown, Plus, Search } from "lucide-react";
import type { QualityWi } from "@/domain/quality-wi/schema";
import { formatDate } from "@/domain/formatting";
import { loadWiLibraryDepartments, type WiLibraryDepartments } from "@/lib/quality-wi/library-departments";
import { listQualityWis } from "@/lib/quality-wi/read-store";
import { createQualityWi } from "@/lib/quality-wi/write-store";
import { QualitySkeleton } from "@/components/sop/quality-skeleton";
import { SopShell } from "@/components/sop/sop-shell";
import { SopTabNav } from "@/components/sop/sop-tab-nav";
import { useSopWorkspace } from "@/components/sop/sop-workspace-provider";
import { ThemedSelect } from "@/components/themed-select";
import { useRouter } from "next/navigation";
import { useWiIdentity } from "./use-wi-identity";
import { WORK_INSTRUCTION_TEMPLATE_HREF, useWorkInstructionTemplateAccess } from "@/components/sop/work-instruction-template-access";
import { WiPreview } from "./wi-preview";

export function WiLibrary({
  view = "drafts",
  initialWorkspaceId,
  initialUserId,
  initialRows,
  initialDepartments,
}: {
  view?: "drafts" | "published";
  initialWorkspaceId?: string;
  initialUserId?: string;
  initialRows?: QualityWi[];
  initialDepartments?: WiLibraryDepartments;
}) {
  const published = view === "published";
  const title = published ? "Published Work Instructions" : "Work Instruction Builder";
  const [preview, setPreview] = useState<QualityWi | null>(null);
  const { workspaceId, role, canEditSops } = useSopWorkspace();
  const userId = useWiIdentity(initialUserId);
  const templateAccess = useWorkInstructionTemplateAccess();
  const router = useRouter();
  const [rows, setRows] = useState(initialRows ?? []);
  const [rowScope, setRowScope] = useState(
    initialWorkspaceId && initialUserId
      ? `${initialUserId}:${initialWorkspaceId}`
      : null,
  );
  const scope = userId && workspaceId ? `${userId}:${workspaceId}` : null;
  const [departmentData, setDepartmentData] = useState(() => ({
    scope: initialWorkspaceId && initialUserId ? `${initialUserId}:${initialWorkspaceId}` : null,
    value: initialDepartments,
  }));
  const [departmentChoice, setDepartmentChoice] = useState<{ scope: string | null; id: string } | null>(null);
  const [departmentError, setDepartmentError] = useState("");
  const currentDepartments = departmentData.scope === scope ? departmentData.value : undefined;
  const departmentsLoading = !published && !currentDepartments && !departmentError;
  const departments = (currentDepartments?.departments ?? []).filter(d =>
    role === "owner" || role === "admin" || currentDepartments?.memberDepartmentIds.includes(d.id),
  );
  const department = departmentChoice?.scope === scope && departments.some(d => d.id === departmentChoice.id)
    ? departmentChoice.id
    : departments.find(d => currentDepartments?.memberDepartmentIds.includes(d.id))?.id ?? "";
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
    listQualityWis(workspaceId, undefined, view)
      .then((next) => {
        if (!active) return;
        setRows(next);
        setRowScope(`${userId}:${workspaceId}`);
        setLoading(false);
      })
      .catch((caught) => {
        if (active) {
          setRowScope(null);
          setRows([]);
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
  }, [workspaceId, userId, initialWorkspaceId, initialRows, retry, view]);
  useEffect(() => {
    if (published || !workspaceId || !userId) return;
    let active = true;
    setDepartmentError("");
    void loadWiLibraryDepartments(workspaceId, userId).then(value => {
      if (active) setDepartmentData({ scope: `${userId}:${workspaceId}`, value });
    }).catch(caught => {
      if (active) setDepartmentError(caught instanceof Error ? caught.message : "Could not load departments.");
    });
    return () => { active = false; };
  }, [workspaceId, userId, published, retry]);
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
          active={published ? "published-work-instructions" : "work-instructions"}
          manage={role === "owner" || role === "admin"}
        />
      }
      crumb={`Quality / ${title}`}
    >
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">{title}</h1>
            <p className="ui-section-subtitle mt-1">
              {published ? "Published procedures, organized by department." : "Draft work instructions, organized by department."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!published && templateAccess ? (
              <a href={WORK_INSTRUCTION_TEMPLATE_HREF} download
                className="ui-btn-secondary inline-flex h-9 items-center gap-2 px-3"
                title="Download the blank work instruction template (Word)">
                <FileDown size={14} />
                WI template
              </a>
            ) : null}
          {!published && canEditSops ? (
            <div className="flex items-center gap-2">
              {departmentsLoading ? (
                <div className="h-9 w-40 rounded bg-surface-muted" role="status" aria-label="Loading departments" />
              ) : <ThemedSelect
                ariaLabel="Department for new work instruction"
                value={department}
                options={departments.map((d) => ({
                  value: d.id,
                  label: `${d.code} · ${d.name}`,
                }))}
                placeholder="Choose department"
                onChange={id => setDepartmentChoice({ scope, id })}
              />}
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
        </div>
        {error || departmentError ? (
          <div className="ui-notice ui-notice-warn p-3" role="alert">
            {error || departmentError}
            <button
              className="ui-btn-ghost ml-2"
              onClick={() => setRetry((value) => value + 1)}
            >
              Retry
            </button>
          </div>
        ) : null}
        {!published && canEditSops && !loading && !departmentsLoading && !error && !departmentError && !departments.length ? (
          <p className="ui-section-subtitle">
            Join a department before creating a work instruction.
          </p>
        ) : null}
        <div className="relative max-w-sm">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-tertiary" strokeWidth={1.75} />
          <input
            type="search"
            aria-label="Search work instructions"
            className="ui-field-standalone h-9 w-full pl-9 pr-3 font-normal"
            placeholder="Search by WI number or title"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        {loading ? (
          <QualitySkeleton variant="list" label="Loading work instructions" />
        ) : !visible.length ? (
          <div className="rounded border border-line p-8 text-center text-sm text-ink-secondary">
            {search
              ? "No work instructions match your search."
              : published ? "No published work instructions yet." : "No draft work instructions."}
          </div>
        ) : (
          <div className="ui-data-table-frame ui-data-table-frame-canvas">
            <div className="ui-table-scroll">
            <table className="w-full min-w-[680px] border-collapse text-left">
              <thead>
                <tr className="border-b border-line">
                  <th className="w-36 px-5 py-3 text-[11px] font-medium text-ink-secondary">Number</th>
                  <th className="px-5 py-3 text-[11px] font-medium text-ink-secondary">Title</th>
                  <th className="w-32 px-5 py-3 text-[11px] font-medium text-ink-secondary">Status</th>
                  <th className="w-28 px-5 py-3 text-[11px] font-medium text-ink-secondary">Updated</th>
                </tr>
              </thead>
              <tbody>
                {groups.map(([id, name]) => (
                  <DepartmentRows
                    key={id}
                    name={name}
                    published={published}
                    onPreview={setPreview}
                    rows={visible.filter((row) => row.departmentId === id)}
                  />
                ))}
              </tbody>
            </table>
            </div>
          </div>
        )}
      </div>
      {preview ? <WiPreview key={preview.id} document={preview} publishedOnly onClose={() => setPreview(null)}
        onEdit={canEditSops ? () => router.push(`/sops/work-instructions/${preview.id}`) : undefined} /> : null}
    </SopShell>
  );
}
function DepartmentRows({ name, rows, published, onPreview }: {
  name: string;
  rows: QualityWi[];
  published: boolean;
  onPreview: (document: QualityWi) => void;
}) {
  return (
    <>
      <tr className="border-b border-line bg-canvas/70">
        <th colSpan={4} className="px-5 py-2.5 text-left">
          <div className="flex items-center justify-between gap-3">
            <span className="truncate text-sm font-semibold text-ink">{name}</span>
            <span className="shrink-0 text-xs font-normal tabular-nums text-ink-tertiary">
              {rows.length} {rows.length === 1 ? "WI" : "WIs"}
            </span>
          </div>
        </th>
      </tr>
      {rows.map((row) => {
        const number = row.documentNumber ?? `WI-${row.departmentCode}-###`;
        const title = row.title || "Untitled work instruction";
        return (
          <tr key={row.id} className="border-b border-line last:border-b-0 hover:bg-surface-muted">
            <td className="px-5 py-3.5 align-middle">
              {published ? (
                <button type="button" className="text-xs font-medium text-ink-secondary hover:text-ink" onClick={() => onPreview(row)}>{number}</button>
              ) : (
                <Link href={`/sops/work-instructions/${row.id}`} className="text-xs font-medium text-ink-secondary hover:text-ink">{number}</Link>
              )}
            </td>
            <td className="max-w-0 px-5 py-3.5 align-middle">
              {published ? (
                <button type="button" className="block w-full truncate text-left text-[13px] font-medium leading-snug text-ink" onClick={() => onPreview(row)}>{title}</button>
              ) : (
                <Link href={`/sops/work-instructions/${row.id}`} className="block truncate text-[13px] font-medium leading-snug text-ink">{title}</Link>
              )}
            </td>
            <td className="px-5 py-3.5 align-middle">
              <span className="inline-flex whitespace-nowrap rounded bg-surface-muted px-2 py-1 text-[11px] font-medium text-ink-secondary">
                {published ? "Published" : row.publishedRevisionId ? "Draft changes" : "Draft"}
              </span>
            </td>
            <td className="px-5 py-3.5 align-middle text-xs text-ink-tertiary">{formatDate(row.updatedAt)}</td>
          </tr>
        );
      })}
    </>
  );
}
