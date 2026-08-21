"use client";

import Image from "next/image";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CircleHelp,
  Download,
  ExternalLink,
  FileUp,
  Link2,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  calculateResidualRpn,
  calculateRowRpn,
  createPfmeaControlProposal,
  createPfmeaRowForProcedureLink,
  createPfmeaDocumentFromProcedure,
  duplicatePfmeaRow,
  getPfmeaRowIssues,
  getProductPfmeaDocument,
  isHighPriorityPfmeaRow,
  isPfmeaRowStarted,
  normalizePfmeaScore,
  syncPfmeaDocumentWithProcedure,
  type PfmeaDocument,
  type PfmeaControlTarget,
  type PfmeaRow,
} from "@/domain/pfmea";
import { buildPfmeaPrintHtml, buildPfmeaXlsx } from "@/domain/pfmea-export";
import {
  buildPfmeaImportPreview,
  mergePfmeaImport,
  parsePfmeaDelimitedText,
  type PfmeaImportPreview,
  type PfmeaTabularValue,
} from "@/domain/pfmea-import";
import type { SaveState } from "@/domain/supabase-planner";
import type { Product, Scenario, Task, Zone } from "@/domain/types";

type PfmeaWorkspaceProps = {
  product: Product;
  scenario: Scenario;
  tasks: Task[];
  zones: Zone[];
  readOnly?: boolean;
  saveState?: SaveState;
  saveError?: string;
  onDocumentChange: (document: PfmeaDocument) => void;
  onOpenTask?: (taskId: string) => void;
};

type PfmeaFilter = "all" | "started" | "high" | "incomplete";
type PfmeaColumnView = "risk" | "actions" | "all";

const PFMEA_SCORE_GUIDE = [
  {
    title: "Severity",
    description: "How serious the effect is if the failure occurs.",
    bands: [
      ["1", "No noticeable effect"],
      ["2–3", "Minor inconvenience; no functional loss"],
      ["4–6", "Moderate degradation or rework"],
      ["7–8", "Major loss of function or production disruption"],
      ["9–10", "Safety, regulatory, or complete functional failure"],
    ],
  },
  {
    title: "Occurrence",
    description: "How likely the cause is to occur with current prevention controls.",
    bands: [
      ["1", "Remote; failure is unlikely"],
      ["2–3", "Low frequency"],
      ["4–6", "Occasional or moderate frequency"],
      ["7–8", "Repeated or high frequency"],
      ["9–10", "Very high or nearly inevitable"],
    ],
  },
  {
    title: "Detection",
    description: "How likely current controls are to detect the failure before escape.",
    bands: [
      ["1", "Almost certain detection"],
      ["2–3", "High likelihood of detection"],
      ["4–6", "Moderate likelihood of detection"],
      ["7–8", "Low likelihood of detection"],
      ["9–10", "Unlikely to detect or no control exists"],
    ],
  },
] as const;

function displayDate(value?: string) {
  if (!value) {
    return "—";
  }
  const [year, month, day] = value.split("-");
  return year && month && day ? `${month}/${day}/${year}` : value;
}

function pfmeaTabularValue(value: unknown): PfmeaTabularValue {
  if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value instanceof Date) {
    return value as PfmeaTabularValue;
  }
  return String(value);
}

function saveLabel(saveState: SaveState | undefined, hasPersistedDocument: boolean) {
  if (saveState === "saving" || saveState === "retrying") return "Saving";
  if (saveState === "error" || saveState === "conflict") return "Save failed";
  if (saveState === "loading") return "Loading";
  if (saveState === "idle" || saveState === "draft") return "Unsaved changes";
  return hasPersistedDocument ? "Saved" : "Not saved";
}

function safeExportName(value: string) {
  return value.trim().replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "PFMEA";
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function PfmeaTextCell({
  label,
  value,
  placeholder,
  readOnly,
  invalid = false,
  autoFocus = false,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  readOnly: boolean;
  invalid?: boolean;
  autoFocus?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <textarea
      aria-label={label}
      value={value}
      placeholder={placeholder}
      rows={2}
      readOnly={readOnly}
      aria-invalid={invalid || undefined}
      autoFocus={autoFocus}
      onChange={(event) => onChange(event.target.value)}
      className={`ui-pfmea-cell-text ${invalid ? "ui-pfmea-field-invalid" : ""}`}
    />
  );
}

function PfmeaScoreCell({
  label,
  value,
  readOnly,
  invalid = false,
  onChange,
}: {
  label: string;
  value?: number;
  readOnly: boolean;
  invalid?: boolean;
  onChange: (value: number | undefined) => void;
}) {
  return (
    <input
      aria-label={label}
      type="number"
      min={1}
      max={10}
      step={1}
      inputMode="numeric"
      value={value ?? ""}
      readOnly={readOnly}
      aria-invalid={invalid || undefined}
      onChange={(event) => onChange(normalizePfmeaScore(event.target.value))}
      className={`ui-pfmea-score-input ${invalid ? "ui-pfmea-field-invalid" : ""}`}
    />
  );
}

function PfmeaRpnCell({ value, high, label }: { value?: number; high?: boolean; label: string }) {
  return (
    <output aria-label={label} className={`ui-pfmea-rpn ${high ? "ui-pfmea-rpn-high" : ""}`}>
      {value ?? "—"}
    </output>
  );
}

function pfmeaTaskGroupKey(row: PfmeaRow) {
  return row.taskId ?? [row.zoneNameSnapshot, row.taskCodeSnapshot, row.taskNameSnapshot].join("|");
}

function pfmeaStepGroupKey(row: PfmeaRow) {
  return `${pfmeaTaskGroupKey(row)}|${row.stepId ?? "task"}|${row.processStepSnapshot ?? ""}`;
}

function PfmeaModal({
  title,
  description,
  children,
  actions,
  onClose,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  actions?: ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="ui-pfmea-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="ui-pfmea-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
      >
        <header>
          <div>
            <h3>{title}</h3>
            {description ? <p>{description}</p> : null}
          </div>
          <button type="button" onClick={onClose} aria-label={`Close ${title}`}><X size={15} /></button>
        </header>
        <div className="ui-pfmea-modal-body">{children}</div>
        {actions ? <footer>{actions}</footer> : null}
      </section>
    </div>
  );
}

export function PfmeaWorkspace({
  product,
  scenario,
  tasks,
  zones,
  readOnly = false,
  saveState,
  saveError,
  onDocumentChange,
  onOpenTask,
}: PfmeaWorkspaceProps) {
  const storedDocument = useMemo(() => getProductPfmeaDocument(product.customFields), [product.customFields]);
  const productIdRef = useRef(product.id);
  const [document, setDocument] = useState<PfmeaDocument>(() =>
    storedDocument ?? createPfmeaDocumentFromProcedure(product, scenario, tasks, zones),
  );
  const [filter, setFilter] = useState<PfmeaFilter>("all");
  const [columnView, setColumnView] = useState<PfmeaColumnView>("risk");
  const [query, setQuery] = useState("");
  const [showAddFailure, setShowAddFailure] = useState(false);
  const [showScoringGuide, setShowScoringGuide] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [selectedStepId, setSelectedStepId] = useState("");
  const [focusRowId, setFocusRowId] = useState<string>();
  const [pendingDeleteRow, setPendingDeleteRow] = useState<PfmeaRow>();
  const [undoDelete, setUndoDelete] = useState<{ row: PfmeaRow; index: number }>();
  const [importPreview, setImportPreview] = useState<PfmeaImportPreview>();
  const [importError, setImportError] = useState<string>();
  const [importLoading, setImportLoading] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const fileMenuRef = useRef<HTMLDetailsElement>(null);
  const [exportLoading, setExportLoading] = useState(false);
  const [exportError, setExportError] = useState<string>();
  const [mappingRowId, setMappingRowId] = useState<string>();
  const [proposalTarget, setProposalTarget] = useState<PfmeaControlTarget>("checklist");
  const [proposalTitle, setProposalTitle] = useState("");
  const [proposalNotes, setProposalNotes] = useState("");
  const [proposalReady, setProposalReady] = useState(false);

  useEffect(() => {
    if (productIdRef.current === product.id) {
      return;
    }
    productIdRef.current = product.id;
    setDocument(storedDocument ?? createPfmeaDocumentFromProcedure(product, scenario, tasks, zones));
    setFilter("all");
    setColumnView("risk");
    setQuery("");
    setShowAddFailure(false);
    setShowScoringGuide(false);
    setPendingDeleteRow(undefined);
    setUndoDelete(undefined);
    setImportPreview(undefined);
    setImportError(undefined);
    setExportError(undefined);
    setMappingRowId(undefined);
  }, [product, scenario, storedDocument, tasks, zones]);

  useEffect(() => {
    if (!undoDelete) return;
    const timeout = window.setTimeout(() => setUndoDelete(undefined), 8000);
    return () => window.clearTimeout(timeout);
  }, [undoDelete]);

  useEffect(() => {
    function closeFileMenuFromPage(event: PointerEvent | KeyboardEvent) {
      if (!fileMenuRef.current?.open) return;
      if (event.type === "keydown") {
        if ((event as KeyboardEvent).key === "Escape") closeFileMenu();
        return;
      }
      if (!fileMenuRef.current.contains(event.target as Node)) closeFileMenu();
    }
    window.document.addEventListener("pointerdown", closeFileMenuFromPage);
    window.document.addEventListener("keydown", closeFileMenuFromPage);
    return () => {
      window.document.removeEventListener("pointerdown", closeFileMenuFromPage);
      window.document.removeEventListener("keydown", closeFileMenuFromPage);
    };
  }, []);

  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const zoneById = useMemo(() => new Map(zones.map((zone) => [zone.id, zone])), [zones]);
  const procedureTaskOptions = useMemo(() => {
    const order = new Map<string, number>();
    document.rows.forEach((row, index) => {
      if (row.taskId && !order.has(row.taskId)) order.set(row.taskId, index);
    });
    return tasks
      .filter((task) => task.rowType === "task" && !task.parentTaskId)
      .sort((left, right) => (order.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.id) ?? Number.MAX_SAFE_INTEGER));
  }, [document.rows, tasks]);
  const selectedTask = selectedTaskId ? taskById.get(selectedTaskId) : undefined;
  const selectedTaskSteps = useMemo(
    () => [...(selectedTask?.manufacturingSteps ?? [])].sort((left, right) => left.sequence - right.sequence),
    [selectedTask],
  );
  const mappingRow = mappingRowId ? document.rows.find((row) => row.id === mappingRowId) : undefined;
  const startedRows = useMemo(() => document.rows.filter(isPfmeaRowStarted), [document.rows]);
  const highPriorityRows = useMemo(() => startedRows.filter(isHighPriorityPfmeaRow), [startedRows]);
  const incompleteRows = useMemo(() => startedRows.filter((row) => getPfmeaRowIssues(row).length > 0), [startedRows]);
  const staleLinkCount = useMemo(
    () => document.rows.filter((row) => row.linkStatus !== "linked").length,
    [document.rows],
  );

  const visibleRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return document.rows.filter((row) => {
      if (filter === "started" && !isPfmeaRowStarted(row)) return false;
      if (filter === "high" && !isHighPriorityPfmeaRow(row)) return false;
      if (
        filter === "incomplete" &&
        (!isPfmeaRowStarted(row) || getPfmeaRowIssues(row).length === 0)
      ) return false;
      if (!normalizedQuery) return true;
      return [
        row.taskCodeSnapshot,
        row.taskNameSnapshot,
        row.zoneNameSnapshot,
        row.processStepSnapshot,
        row.failureMode,
        row.effect,
        row.cause,
        row.currentControls,
        row.recommendedActions,
      ].some((value) => value?.toLowerCase().includes(normalizedQuery));
    });
  }, [document.rows, filter, query]);

  function applyDocument(nextDocument: PfmeaDocument) {
    const next = { ...nextDocument, updatedAt: new Date().toISOString() };
    setDocument(next);
    onDocumentChange(next);
  }

  function updateMetadata(patch: Partial<PfmeaDocument>) {
    applyDocument({ ...document, ...patch });
  }

  function updateRow(rowId: string, patch: Partial<PfmeaRow>) {
    const timestamp = new Date().toISOString();
    applyDocument({
      ...document,
      rows: document.rows.map((row) => (row.id === rowId ? { ...row, ...patch, updatedAt: timestamp } : row)),
    });
  }

  function addFailureMode(row: PfmeaRow) {
    const nextRow = duplicatePfmeaRow(row);
    const linkKey = pfmeaStepGroupKey(row);
    const rowIndex = document.rows.findLastIndex((candidate) => pfmeaStepGroupKey(candidate) === linkKey);
    const rows = [...document.rows];
    rows.splice(rowIndex + 1, 0, nextRow);
    applyDocument({ ...document, rows });
    setFocusRowId(nextRow.id);
  }

  function openAddFailureDialog() {
    const nextTaskId = selectedTaskId || visibleRows[0]?.taskId || procedureTaskOptions[0]?.id || "";
    setSelectedTaskId(nextTaskId);
    setSelectedStepId("");
    setShowAddFailure(true);
  }

  function addSelectedFailureMode() {
    const task = selectedTaskId ? taskById.get(selectedTaskId) : undefined;
    if (!task) return;
    const step = selectedStepId
      ? (task.manufacturingSteps ?? []).find((candidate) => candidate.id === selectedStepId)
      : undefined;
    const existingContextRow = document.rows.find((row) => row.taskId === task.id && row.stepId === step?.id);
    const nextRow = existingContextRow
      ? duplicatePfmeaRow(existingContextRow)
      : createPfmeaRowForProcedureLink(task, step, task.zoneId ? zoneById.get(task.zoneId) : undefined);
    const contextKey = pfmeaStepGroupKey(nextRow);
    const lastContextIndex = document.rows.findLastIndex((row) => pfmeaStepGroupKey(row) === contextKey);
    const lastTaskIndex = document.rows.findLastIndex((row) => row.taskId === task.id);
    const insertIndex = (lastContextIndex >= 0 ? lastContextIndex : lastTaskIndex) + 1;
    const rows = [...document.rows];
    rows.splice(Math.max(0, insertIndex), 0, nextRow);
    applyDocument({ ...document, rows });
    setFocusRowId(nextRow.id);
    setShowAddFailure(false);
  }

  function confirmDeleteRow() {
    if (!pendingDeleteRow) return;
    const index = document.rows.findIndex((row) => row.id === pendingDeleteRow.id);
    applyDocument({ ...document, rows: document.rows.filter((row) => row.id !== pendingDeleteRow.id) });
    setUndoDelete({ row: pendingDeleteRow, index });
    setPendingDeleteRow(undefined);
  }

  function restoreDeletedRow() {
    if (!undoDelete) return;
    const rows = [...document.rows];
    rows.splice(Math.min(Math.max(undoDelete.index, 0), rows.length), 0, undoDelete.row);
    applyDocument({ ...document, rows });
    setUndoDelete(undefined);
  }

  async function selectImportFile(file: File | undefined) {
    if (!file) return;
    setImportLoading(true);
    setImportError(undefined);
    try {
      const extension = file.name.toLowerCase().split(".").pop();
      const sourceKey = `${file.name}:${file.size}:${file.lastModified}`;
      let table: PfmeaTabularValue[][];
      let fileType: "csv" | "xlsx";
      if (extension === "xlsx" || extension === "xls") {
        const { default: readWorkbook } = await import("read-excel-file/browser");
        const sheets = await readWorkbook(file);
        const selectedSheet = sheets.find((sheet) => /pfmea\s*current/i.test(sheet.sheet)) ?? sheets[0];
        if (!selectedSheet) throw new Error("The workbook does not contain any worksheets.");
        table = selectedSheet.data.map((row) => row.map(pfmeaTabularValue));
        fileType = "xlsx";
      } else if (extension === "csv") {
        const buffer = await file.arrayBuffer();
        let decoded: string;
        try {
          decoded = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
        } catch {
          decoded = new TextDecoder("windows-1252").decode(buffer);
        }
        table = parsePfmeaDelimitedText(decoded.replace(/^\uFEFF/, ""));
        fileType = "csv";
      } else {
        throw new Error("Choose a CSV or XLSX PFMEA file.");
      }
      setImportPreview(buildPfmeaImportPreview(table, {
        fileName: file.name,
        fileType,
        sourceKey,
        tasks,
        zones,
      }));
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "The PFMEA file could not be read.");
    } finally {
      setImportLoading(false);
      if (importInputRef.current) importInputRef.current.value = "";
    }
  }

  function confirmImport() {
    if (!importPreview) return;
    applyDocument(mergePfmeaImport(document, importPreview));
    setImportPreview(undefined);
  }

  function closeFileMenu() {
    fileMenuRef.current?.removeAttribute("open");
  }

  async function exportExcel() {
    setExportLoading(true);
    setExportError(undefined);
    closeFileMenu();
    try {
      let logoBytes: ArrayBuffer | undefined;
      try {
        const response = await fetch("/sop/ana-logo.png");
        if (response.ok) logoBytes = await response.arrayBuffer();
      } catch {
        // The workbook remains usable and displays an ANA text mark if the logo cannot be loaded.
      }
      const workbook = await buildPfmeaXlsx(document, product.name, logoBytes);
      downloadBlob(workbook, `${safeExportName(document.documentNumber || `${product.name}-PFMEA`)}.xlsx`);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "The Excel workbook could not be created.");
    } finally {
      setExportLoading(false);
    }
  }

  function printPfmea() {
    closeFileMenu();
    setExportError(undefined);
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      setExportError("Allow pop-ups for this site to open the PFMEA print view.");
      return;
    }
    const logoUrl = new URL("/sop/ana-logo.png", window.location.origin).toString();
    printWindow.addEventListener("load", () => {
      printWindow.focus();
      printWindow.print();
    }, { once: true });
    printWindow.document.write(buildPfmeaPrintHtml(document, product.name, logoUrl));
    printWindow.document.close();
  }

  function openControlMapping(row: PfmeaRow) {
    setMappingRowId(row.id);
    setProposalTarget("checklist");
    setProposalTitle(row.recommendedActions.trim() || row.failureMode.trim());
    setProposalNotes("");
    setProposalReady(false);
  }

  function addControlProposal() {
    if (!mappingRow || !proposalTitle.trim()) return;
    const proposal = createPfmeaControlProposal(mappingRow, {
      target: proposalTarget,
      title: proposalTitle,
      notes: proposalNotes,
      status: proposalReady ? "ready" : "draft",
    });
    updateRow(mappingRow.id, { controlProposals: [...mappingRow.controlProposals, proposal] });
    setProposalTitle("");
    setProposalNotes("");
    setProposalReady(false);
  }

  function removeControlProposal(proposalId: string) {
    if (!mappingRow) return;
    updateRow(mappingRow.id, { controlProposals: mappingRow.controlProposals.filter((proposal) => proposal.id !== proposalId) });
  }

  function syncProcedure() {
    applyDocument(syncPfmeaDocumentWithProcedure(document, scenario, tasks, zones));
  }

  const currentSaveLabel = saveLabel(saveState, Boolean(storedDocument));
  const saveTone = saveState === "error" || saveState === "conflict"
    ? "text-danger"
    : saveState === "saving" || saveState === "retrying"
      ? "text-warning"
      : "text-ink-secondary";
  const duplicateImport = importPreview
    ? document.imports.some((record) => record.sourceKey === importPreview.record.sourceKey)
    : false;

  return (
    <section className="ui-pfmea-page space-y-4" aria-labelledby="planner-pfmea-title">
      <section className="ui-pfmea-document" aria-label="ANA PFMEA controlled document">
        <div className="ui-pfmea-document-head">
          <div className="ui-pfmea-brand">
            <Image src="/sop/ana-logo.png" alt="ANA" width={116} height={32} priority />
            <div>
              <div className="ui-pfmea-title-line">
                <h2 id="planner-pfmea-title" className="ui-pfmea-document-title">{product.name} PFMEA</h2>
                <span className="ui-pfmea-status">{document.status.replace("_", " ")}</span>
              </div>
              <p className="ui-pfmea-document-subtitle">Process Failure Mode and Effects Analysis</p>
              <p className="ui-pfmea-document-reference">
                <span>{document.documentNumber}</span>
                <span>Rev {document.revision}</span>
                <span>{displayDate(document.originalDate)}</span>
              </p>
            </div>
          </div>
          <div className="ui-pfmea-head-actions">
            <span className={`text-xs ${saveTone}`} title={saveError}>
              {saveState === "saved" && storedDocument ? <Check className="mr-1 inline" size={13} aria-hidden="true" /> : null}
              {currentSaveLabel}
            </span>
            <input
              ref={importInputRef}
              className="sr-only"
              type="file"
              accept=".csv,.xlsx,.xls"
              aria-label="Choose PFMEA import file"
              onChange={(event) => void selectImportFile(event.target.files?.[0])}
            />
            <details ref={fileMenuRef} className="ui-pfmea-file-menu">
              <summary className="ui-btn-ghost h-9 gap-2" aria-label="PFMEA file options">
                <FileUp size={14} aria-hidden="true" />
                File
              </summary>
              <div>
                <button type="button" disabled={readOnly || importLoading} onClick={() => { closeFileMenu(); importInputRef.current?.click(); }}>
                  <FileUp size={14} aria-hidden="true" />
                  <span><strong>{importLoading ? "Reading…" : "Import PFMEA"}</strong><small>Stage a CSV or Excel file</small></span>
                </button>
                <button type="button" disabled={exportLoading} onClick={() => void exportExcel()}>
                  <Download size={14} aria-hidden="true" />
                  <span><strong>{exportLoading ? "Building…" : "Export Excel"}</strong><small>Workbook with live RPN formulas</small></span>
                </button>
                <button type="button" onClick={printPfmea}>
                  <Printer size={14} aria-hidden="true" />
                  <span><strong>Print / Save PDF</strong><small>ANA-branded A3 landscape view</small></span>
                </button>
              </div>
            </details>
            <button
              type="button"
              className="ui-btn-ghost h-9 gap-2"
              onClick={syncProcedure}
              disabled={readOnly}
              title={staleLinkCount ? `${staleLinkCount} Procedure link(s) need review` : "Refresh links from Procedure"}
            >
              <RefreshCw size={14} aria-hidden="true" />
              Sync Procedure
            </button>
            <button type="button" className="ui-btn-primary h-9 gap-2" onClick={openAddFailureDialog} disabled={readOnly}>
              <Plus size={14} aria-hidden="true" />
              Add failure mode
            </button>
          </div>
        </div>

        <details className="ui-pfmea-details">
          <summary>Document details</summary>
          <div className="ui-pfmea-details-grid">
            <label>
              <span>Document no.</span>
              <input
                aria-label="PFMEA document number"
                value={document.documentNumber}
                readOnly={readOnly}
                onChange={(event) => updateMetadata({ documentNumber: event.target.value })}
              />
            </label>
            <label>
              <span>Revision</span>
              <input
                aria-label="PFMEA revision"
                value={document.revision}
                readOnly={readOnly}
                onChange={(event) => updateMetadata({ revision: event.target.value })}
              />
            </label>
            <label>
              <span>Item / product</span>
              <input aria-label="PFMEA item" value={document.item} readOnly={readOnly} onChange={(event) => updateMetadata({ item: event.target.value })} />
            </label>
            <label>
              <span>Model</span>
              <input aria-label="PFMEA model" value={document.model} readOnly={readOnly} onChange={(event) => updateMetadata({ model: event.target.value })} />
            </label>
            <label>
              <span>Responsibility</span>
              <input aria-label="PFMEA owner" value={document.owner} readOnly={readOnly} onChange={(event) => updateMetadata({ owner: event.target.value })} />
            </label>
            <label>
              <span>Core team</span>
              <input aria-label="PFMEA core team" value={document.coreTeam} readOnly={readOnly} placeholder="Add team members" onChange={(event) => updateMetadata({ coreTeam: event.target.value })} />
            </label>
            <div>
              <span>Procedure scenario</span>
              <strong>{document.sourceScenarioName || scenario.name}</strong>
            </div>
            <div>
              <span>Original date</span>
              <strong>{displayDate(document.originalDate)}</strong>
            </div>
          </div>
        </details>
      </section>

      <section className="ui-pfmea-register" aria-label="PFMEA register">
        <div className="ui-pfmea-toolbar">
          <div className="ui-pfmea-search">
            <Search size={14} aria-hidden="true" />
            <input
              aria-label="Search PFMEA"
              value={query}
              placeholder="Search task, step, failure mode, or control..."
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <select aria-label="Filter PFMEA rows" value={filter} onChange={(event) => setFilter(event.target.value as PfmeaFilter)}>
            <option value="all">All process rows</option>
            <option value="started">Risks started ({startedRows.length})</option>
            <option value="high">High priority ({highPriorityRows.length})</option>
            <option value="incomplete">Incomplete ({incompleteRows.length})</option>
          </select>
          <select aria-label="PFMEA column view" value={columnView} onChange={(event) => setColumnView(event.target.value as PfmeaColumnView)}>
            <option value="risk">Core risk fields</option>
            <option value="actions">Action tracking</option>
            <option value="all">All fields</option>
          </select>
          <span>{visibleRows.length} of {document.rows.length} rows</span>
          <button type="button" className="ui-pfmea-toolbar-action" onClick={() => setShowScoringGuide(true)}>
            <CircleHelp size={13} aria-hidden="true" />
            Scoring guide
          </button>
          <span className="ml-auto">RPN = Severity × Occurrence × Detection</span>
        </div>

        <div className="ui-pfmea-grid-wrap">
          <table className="ui-pfmea-grid" data-column-view={columnView}>
            <thead>
              <tr>
                <th data-pfmea-column="shared">Procedure task</th>
                <th data-pfmea-column="shared">Process step</th>
                <th data-pfmea-column="shared">Potential failure mode</th>
                <th data-pfmea-column="risk-detail">Potential effect</th>
                <th data-pfmea-column="risk-detail" title="Severity">S</th>
                <th data-pfmea-column="risk-detail">Potential cause</th>
                <th data-pfmea-column="risk-detail" title="Occurrence">O</th>
                <th data-pfmea-column="risk-detail">Current process controls</th>
                <th data-pfmea-column="risk-detail" title="Detection">D</th>
                <th data-pfmea-column="risk-detail">Detection activity</th>
                <th data-pfmea-column="shared">RPN</th>
                <th data-pfmea-column="action">Recommended actions</th>
                <th data-pfmea-column="action">Owner</th>
                <th data-pfmea-column="action">Target</th>
                <th data-pfmea-column="action">Actions taken</th>
                <th data-pfmea-column="action" title="Result occurrence">Result O</th>
                <th data-pfmea-column="action" title="Result detection">Result D</th>
                <th data-pfmea-column="action">Residual RPN</th>
                <th data-pfmea-column="shared" aria-label="Row actions" />
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row, index) => {
                const rowRpn = calculateRowRpn(row);
                const residualRpn = calculateResidualRpn(row);
                const highPriority = isHighPriorityPfmeaRow(row);
                const task = row.taskId ? taskById.get(row.taskId) : undefined;
                const prior = visibleRows[index - 1];
                const taskGroupKey = pfmeaTaskGroupKey(row);
                const startsTask = !prior || pfmeaTaskGroupKey(prior) !== taskGroupKey;
                const taskRowSpan = startsTask
                  ? visibleRows.slice(index).findIndex((candidate) => pfmeaTaskGroupKey(candidate) !== taskGroupKey)
                  : 0;
                const normalizedTaskRowSpan = taskRowSpan === -1 ? visibleRows.length - index : taskRowSpan;
                const stepGroupKey = pfmeaStepGroupKey(row);
                const startsStep = !prior || pfmeaStepGroupKey(prior) !== stepGroupKey;
                const stepRowSpan = startsStep
                  ? visibleRows.slice(index).findIndex((candidate) => pfmeaStepGroupKey(candidate) !== stepGroupKey)
                  : 0;
                const normalizedStepRowSpan = stepRowSpan === -1 ? visibleRows.length - index : stepRowSpan;
                const rowIssues = getPfmeaRowIssues(row);
                const issueFields = new Set(rowIssues.map((issue) => issue.field));
                const rowLabel = row.processStepSnapshot || row.taskNameSnapshot || `row ${index + 1}`;
                return (
                  <tr
                    key={row.id}
                    className={`${startsTask ? "ui-pfmea-task-start" : ""} ${highPriority ? "ui-pfmea-row-high" : ""}`}
                  >
                    {startsTask ? (
                      <td
                        className="ui-pfmea-task-cell"
                        data-pfmea-column="shared"
                        rowSpan={normalizedTaskRowSpan}
                        title={row.zoneNameSnapshot || undefined}
                      >
                        <button
                          type="button"
                          disabled={!task || !onOpenTask}
                          onClick={() => row.taskId && onOpenTask?.(row.taskId)}
                          title={task ? "Open linked Procedure task" : "Procedure link needs review"}
                        >
                          <strong>{row.taskCodeSnapshot || "Unmapped"}</strong>
                          <span>{row.taskNameSnapshot || "Choose a Procedure task"}</span>
                          {task && onOpenTask ? <ExternalLink size={11} aria-hidden="true" /> : null}
                        </button>
                        {row.linkStatus !== "linked" ? (
                          <em><AlertTriangle size={11} aria-hidden="true" /> {row.linkStatus}</em>
                        ) : null}
                      </td>
                    ) : null}
                    {startsStep ? (
                      <td className="ui-pfmea-step-cell" data-pfmea-column="shared" rowSpan={normalizedStepRowSpan}>
                        <span>{row.stepSequenceSnapshot ? `Step ${row.stepSequenceSnapshot}` : "Task level"}</span>
                        <strong>{row.processStepSnapshot || "Unmapped process step"}</strong>
                        <button type="button" className="ui-pfmea-add-failure" disabled={readOnly} onClick={() => addFailureMode(row)}>
                          <Plus size={11} aria-hidden="true" />
                          Failure mode
                        </button>
                      </td>
                    ) : null}
                    <td data-pfmea-column="shared"><PfmeaTextCell label={`Failure mode for ${rowLabel}`} value={row.failureMode} placeholder="What could fail?" readOnly={readOnly} invalid={issueFields.has("failureMode")} autoFocus={focusRowId === row.id} onChange={(value) => updateRow(row.id, { failureMode: value })} /></td>
                    <td data-pfmea-column="risk-detail"><PfmeaTextCell label={`Failure effect for ${rowLabel}`} value={row.effect} placeholder="What happens?" readOnly={readOnly} invalid={issueFields.has("effect")} onChange={(value) => updateRow(row.id, { effect: value })} /></td>
                    <td data-pfmea-column="risk-detail"><PfmeaScoreCell label={`Severity for ${rowLabel}`} value={row.severity} readOnly={readOnly} invalid={issueFields.has("severity")} onChange={(value) => updateRow(row.id, { severity: value })} /></td>
                    <td data-pfmea-column="risk-detail"><PfmeaTextCell label={`Failure cause for ${rowLabel}`} value={row.cause} placeholder="What causes it?" readOnly={readOnly} invalid={issueFields.has("cause")} onChange={(value) => updateRow(row.id, { cause: value })} /></td>
                    <td data-pfmea-column="risk-detail"><PfmeaScoreCell label={`Occurrence for ${rowLabel}`} value={row.occurrence} readOnly={readOnly} invalid={issueFields.has("occurrence")} onChange={(value) => updateRow(row.id, { occurrence: value })} /></td>
                    <td data-pfmea-column="risk-detail"><PfmeaTextCell label={`Current controls for ${rowLabel}`} value={row.currentControls} placeholder="Existing prevention controls" readOnly={readOnly} invalid={issueFields.has("currentControls")} onChange={(value) => updateRow(row.id, { currentControls: value })} /></td>
                    <td data-pfmea-column="risk-detail"><PfmeaScoreCell label={`Detection for ${rowLabel}`} value={row.detection} readOnly={readOnly} invalid={issueFields.has("detection")} onChange={(value) => updateRow(row.id, { detection: value })} /></td>
                    <td data-pfmea-column="risk-detail"><PfmeaTextCell label={`Detection activity for ${rowLabel}`} value={row.detectionActivity} placeholder="How is it detected?" readOnly={readOnly} onChange={(value) => updateRow(row.id, { detectionActivity: value })} /></td>
                    <td data-pfmea-column="shared"><PfmeaRpnCell label={`Current RPN for ${rowLabel}`} value={rowRpn} high={highPriority} /></td>
                    <td data-pfmea-column="action">
                      <div className="ui-pfmea-action-cell">
                        <PfmeaTextCell label={`Recommended actions for ${rowLabel}`} value={row.recommendedActions} placeholder="Required controls or improvements" readOnly={readOnly} onChange={(value) => updateRow(row.id, { recommendedActions: value })} />
                        <button type="button" disabled={readOnly} onClick={() => openControlMapping(row)}>
                          <Link2 size={11} aria-hidden="true" />
                          {row.controlProposals.length > 0 ? `${row.controlProposals.length} mapping${row.controlProposals.length === 1 ? "" : "s"}` : "Map control"}
                        </button>
                      </div>
                    </td>
                    <td data-pfmea-column="action"><PfmeaTextCell label={`Action owner for ${rowLabel}`} value={row.actionOwner} placeholder="Owner" readOnly={readOnly} invalid={issueFields.has("actionOwner")} onChange={(value) => updateRow(row.id, { actionOwner: value })} /></td>
                    <td data-pfmea-column="action">
                      <input
                        aria-label={`Target date for ${rowLabel}`}
                        type="date"
                        value={row.targetDate ?? ""}
                        readOnly={readOnly}
                        onChange={(event) => updateRow(row.id, { targetDate: event.target.value || undefined })}
                        className="ui-pfmea-date-input"
                      />
                    </td>
                    <td data-pfmea-column="action"><PfmeaTextCell label={`Actions taken for ${rowLabel}`} value={row.actionsTaken} placeholder="Implementation evidence" readOnly={readOnly} onChange={(value) => updateRow(row.id, { actionsTaken: value })} /></td>
                    <td data-pfmea-column="action"><PfmeaScoreCell label={`Result occurrence for ${rowLabel}`} value={row.resultOccurrence} readOnly={readOnly} invalid={issueFields.has("resultOccurrence")} onChange={(value) => updateRow(row.id, { resultOccurrence: value })} /></td>
                    <td data-pfmea-column="action"><PfmeaScoreCell label={`Result detection for ${rowLabel}`} value={row.resultDetection} readOnly={readOnly} invalid={issueFields.has("resultDetection")} onChange={(value) => updateRow(row.id, { resultDetection: value })} /></td>
                    <td data-pfmea-column="action">
                      <PfmeaRpnCell label={`Residual RPN for ${rowLabel}`} value={residualRpn} high={residualRpn != null && residualRpn >= 100} />
                      <span className="ui-pfmea-severity-lock">S remains {row.severity ?? "—"}</span>
                    </td>
                    <td className="ui-pfmea-row-actions" data-pfmea-column="shared">
                      {rowIssues.length > 0 ? (
                        <span className="ui-pfmea-issue-count" title={rowIssues.map((issue) => issue.message).join("\n")} aria-label={`${rowIssues.length} validation issue(s)`}>
                          <AlertCircle size={13} aria-hidden="true" />
                          {rowIssues.length}
                        </span>
                      ) : null}
                      <button type="button" title="Delete this failure mode" aria-label={`Delete PFMEA row for ${rowLabel}`} disabled={readOnly} onClick={() => setPendingDeleteRow(row)}><Trash2 size={13} /></button>
                    </td>
                  </tr>
                );
              })}
              {visibleRows.length === 0 ? (
                <tr><td colSpan={19} className="ui-pfmea-empty">No PFMEA rows match this filter.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {importPreview ? (
        <PfmeaModal
          title="Review PFMEA import"
          description={`${importPreview.record.fileName} is staged only. Confirming will add the reviewed rows to this PFMEA and will not change Procedure data.`}
          onClose={() => setImportPreview(undefined)}
          actions={(
            <>
              <button type="button" className="ui-btn-ghost h-9" onClick={() => setImportPreview(undefined)}>Cancel</button>
              <button type="button" className="ui-btn-primary h-9" disabled={duplicateImport || importPreview.rows.length === 0} onClick={confirmImport}>
                Import {importPreview.rows.length} row{importPreview.rows.length === 1 ? "" : "s"}
              </button>
            </>
          )}
        >
          <div className="ui-pfmea-import-summary">
            <div><strong>{importPreview.record.rowCount}</strong><span>Risk rows</span></div>
            <div><strong>{importPreview.record.matchedTaskCount}</strong><span>Task matches</span></div>
            <div><strong>{importPreview.record.matchedStepCount}</strong><span>Step matches</span></div>
            <div><strong>{importPreview.record.unmappedCount}</strong><span>Unmapped</span></div>
          </div>
          {duplicateImport ? <p className="ui-pfmea-import-warning">This exact file has already been imported.</p> : null}
          {importPreview.warnings.length > 0 ? (
            <ul className="ui-pfmea-import-warnings">
              {importPreview.warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          ) : null}
          <div className="ui-pfmea-import-preview">
            <table>
              <thead><tr><th>Source row</th><th>Procedure task</th><th>Process step</th><th>Failure mode</th><th>S</th><th>O</th><th>D</th><th>Match</th></tr></thead>
              <tbody>
                {importPreview.rows.slice(0, 10).map((row) => (
                  <tr key={row.id}>
                    <td>{row.sourceRow}</td>
                    <td>{row.taskCodeSnapshot || row.taskNameSnapshot || "—"}</td>
                    <td>{row.processStepSnapshot || "Task level"}</td>
                    <td>{row.failureMode || "—"}</td>
                    <td>{row.severity ?? "—"}</td>
                    <td>{row.occurrence ?? "—"}</td>
                    <td>{row.detection ?? "—"}</td>
                    <td>{row.linkStatus}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {importPreview.rows.length > 10 ? <p>Showing the first 10 of {importPreview.rows.length} rows.</p> : null}
          </div>
        </PfmeaModal>
      ) : null}

      {importError ? (
        <PfmeaModal
          title="Import could not be completed"
          onClose={() => setImportError(undefined)}
          actions={<button type="button" className="ui-btn-primary h-9" onClick={() => setImportError(undefined)}>Close</button>}
        >
          <p className="ui-pfmea-import-warning">{importError}</p>
        </PfmeaModal>
      ) : null}

      {exportError ? (
        <PfmeaModal
          title="Export could not be completed"
          onClose={() => setExportError(undefined)}
          actions={<button type="button" className="ui-btn-primary h-9" onClick={() => setExportError(undefined)}>Close</button>}
        >
          <p className="ui-pfmea-import-warning">{exportError}</p>
        </PfmeaModal>
      ) : null}

      {showAddFailure ? (
        <PfmeaModal
          title="Add failure mode"
          description="Choose the Procedure task and, when useful, the specific step this risk belongs to. Procedure data remains unchanged."
          onClose={() => setShowAddFailure(false)}
          actions={(
            <>
              <button type="button" className="ui-btn-ghost h-9" onClick={() => setShowAddFailure(false)}>Cancel</button>
              <button type="button" className="ui-btn-primary h-9" disabled={!selectedTaskId} onClick={addSelectedFailureMode}>Add failure mode</button>
            </>
          )}
        >
          <div className="ui-pfmea-form-grid">
            <label>
              <span>Procedure task</span>
              <select
                aria-label="Procedure task for new failure mode"
                value={selectedTaskId}
                onChange={(event) => {
                  setSelectedTaskId(event.target.value);
                  setSelectedStepId("");
                }}
              >
                <option value="">Choose a task</option>
                {procedureTaskOptions.map((task) => (
                  <option key={task.id} value={task.id}>{task.manufacturingCode || task.wbs} · {task.name}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Process step (optional)</span>
              <select aria-label="Process step for new failure mode" value={selectedStepId} disabled={!selectedTask} onChange={(event) => setSelectedStepId(event.target.value)}>
                <option value="">Task-level risk</option>
                {selectedTaskSteps.map((step) => (
                  <option key={step.id} value={step.id}>Step {step.sequence} · {step.name || step.instruction.split("\n")[0]}</option>
                ))}
              </select>
            </label>
          </div>
        </PfmeaModal>
      ) : null}

      {showScoringGuide ? (
        <PfmeaModal
          title="PFMEA scoring guide"
          description="Use consistent judgment across risks. RPN is calculated automatically from Severity × Occurrence × Detection."
          onClose={() => setShowScoringGuide(false)}
          actions={<button type="button" className="ui-btn-primary h-9" onClick={() => setShowScoringGuide(false)}>Done</button>}
        >
          <div className="ui-pfmea-score-guide">
            {PFMEA_SCORE_GUIDE.map((guide) => (
              <section key={guide.title}>
                <h4>{guide.title}</h4>
                <p>{guide.description}</p>
                <dl>
                  {guide.bands.map(([score, meaning]) => (
                    <div key={score}><dt>{score}</dt><dd>{meaning}</dd></div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        </PfmeaModal>
      ) : null}

      {mappingRow ? (
        <PfmeaModal
          title="Control mapping proposals"
          description="These mappings stay inside PFMEA. They do not create or edit Procedure steps, Checklist items, travelers, or other downstream records."
          onClose={() => setMappingRowId(undefined)}
          actions={<button type="button" className="ui-btn-primary h-9" onClick={() => setMappingRowId(undefined)}>Done</button>}
        >
          <div className="ui-pfmea-mapping-context">
            <span>{mappingRow.taskCodeSnapshot || "Unmapped task"}</span>
            <strong>{mappingRow.processStepSnapshot || mappingRow.taskNameSnapshot || "Task-level risk"}</strong>
            <p>{mappingRow.failureMode || "No failure mode entered yet."}</p>
          </div>

          {mappingRow.controlProposals.length > 0 ? (
            <div className="ui-pfmea-proposal-list">
              {mappingRow.controlProposals.map((proposal) => (
                <article key={proposal.id}>
                  <div>
                    <span>{proposal.target} · {proposal.status}</span>
                    <strong>{proposal.title}</strong>
                    {proposal.notes ? <p>{proposal.notes}</p> : null}
                  </div>
                  <button type="button" aria-label={`Remove ${proposal.title} mapping`} onClick={() => removeControlProposal(proposal.id)}><Trash2 size={13} /></button>
                </article>
              ))}
            </div>
          ) : null}

          <div className="ui-pfmea-mapping-form">
            <label>
              <span>Intended destination</span>
              <select aria-label="Control proposal destination" value={proposalTarget} onChange={(event) => setProposalTarget(event.target.value as PfmeaControlTarget)}>
                <option value="checklist">Checklist control</option>
                <option value="procedure">Procedure control</option>
                <option value="traveler">Traveler / operator signoff</option>
                <option value="inspection">Inspection activity</option>
                <option value="training">Training action</option>
                <option value="documentation">Documentation action</option>
              </select>
            </label>
            <label>
              <span>Proposed control</span>
              <input aria-label="Proposed control title" value={proposalTitle} placeholder="Describe the intended control" onChange={(event) => setProposalTitle(event.target.value)} />
            </label>
            <label className="ui-pfmea-mapping-notes">
              <span>Notes</span>
              <textarea aria-label="Control proposal notes" rows={3} value={proposalNotes} placeholder="Acceptance criteria, evidence, or implementation detail" onChange={(event) => setProposalNotes(event.target.value)} />
            </label>
            <label className="ui-pfmea-ready-check">
              <input type="checkbox" checked={proposalReady} onChange={(event) => setProposalReady(event.target.checked)} />
              Ready for downstream review
            </label>
            <button type="button" className="ui-btn-ghost h-9" disabled={!proposalTitle.trim()} onClick={addControlProposal}>
              <Plus size={13} aria-hidden="true" /> Add proposal
            </button>
          </div>
        </PfmeaModal>
      ) : null}

      {pendingDeleteRow ? (
        <PfmeaModal
          title="Delete failure mode?"
          description="This removes only the selected PFMEA risk row. Its Procedure task and step are not changed."
          onClose={() => setPendingDeleteRow(undefined)}
          actions={(
            <>
              <button type="button" className="ui-btn-ghost h-9" onClick={() => setPendingDeleteRow(undefined)}>Cancel</button>
              <button type="button" className="ui-btn-primary ui-pfmea-delete-button h-9" onClick={confirmDeleteRow}>Delete</button>
            </>
          )}
        >
          <p className="ui-pfmea-delete-summary">
            <strong>{pendingDeleteRow.failureMode || "Blank failure mode"}</strong>
            <span>{pendingDeleteRow.taskCodeSnapshot} · {pendingDeleteRow.processStepSnapshot}</span>
          </p>
        </PfmeaModal>
      ) : null}

      {undoDelete ? (
        <div className="ui-pfmea-undo" role="status">
          <span>Failure mode deleted.</span>
          <button type="button" onClick={restoreDeletedRow}><Undo2 size={13} aria-hidden="true" /> Undo</button>
        </div>
      ) : null}
    </section>
  );
}
