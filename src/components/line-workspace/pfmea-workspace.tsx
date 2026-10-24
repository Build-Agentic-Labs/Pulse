"use client";

import { pastePfmeaGrid, type PfmeaPasteTarget } from "@/domain/pfmea-grid-paste";
import { createPfmeaEditHistory } from "@/domain/pfmea-edit-history";
import { usePfmeaGridKeyboard } from "./use-pfmea-grid-keyboard";
import { DatePicker } from "@/components/ui/date-picker";
import { ThemedSelect } from "@/components/themed-select";
import { ModalSurface } from "@/components/ui/modal-surface";

import Image from "next/image";
import {
  Archive,
  RotateCcw,
  AlertCircle,
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Download,
  ExternalLink,
  FileUp,
  FileText,
  Link2,
  Maximize2,
  Minimize2,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Settings2,
  Trash2,
  Undo2,
  Redo2,
  X,
} from "lucide-react";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  formatPfmeaRevision,
  pfmeaAssessmentState,
  calculateResidualRpn,
  calculateRowRpn,
  createPfmeaControlProposal,
  createPfmeaRowForProcedureLink,
  createPfmeaDocumentFromProcedure,
  serializePfmeaDocument,
  duplicatePfmeaRow,
  getPfmeaRowIssues,
  getProductPfmeaDocument,
  isHighPriorityPfmeaRow,
  isPfmeaRowStarted,
  normalizePfmeaScore,
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
import { loadWorkspaceMembersFromSupabase } from "@/domain/supabase-planner";
import { closePfmeaAction, pfmeaClosureIssues, isPfmeaActionOverdue, pfmeaActionStatus, patchPfmeaRow, pfmeaLinkIssue, previewPfmeaSync, relinkPfmeaRow } from "@/domain/pfmea-workflow";
import type { Product, Scenario, Task, Zone, WorkspaceMemberProfile } from "@/domain/types";

type PfmeaWorkspaceProps = {
  product: Product;
  workspaceId?: string;
  scenario: Scenario;
  tasks: Task[];
  zones: Zone[];
  readOnly?: boolean;
  backupError?: string;
  saveResult?: { document: unknown; state: "saving" | "saved" | "error"; error?: string };
  onDocumentChange: (document: PfmeaDocument) => void;
  onRetrySave?: () => void;
  onOpenTask?: (taskId: string) => void;
};

type PfmeaFilter = "all" | "started" | "high" | "incomplete" | "not_assessed" | "complete" | "links" | "archived" | "overdue" | "awaiting_verification";
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

function localToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

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

const PfmeaRenderedRow = memo(function PfmeaRenderedRow({ render }: {
  row: PfmeaRow; context: readonly unknown[]; render: () => ReactNode;
}) { return render(); }, (before, after) => before.row === after.row && before.context.length === after.context.length && before.context.every((value, index) => Object.is(value, after.context[index])));

function PfmeaTextCell({
  label,
  field,
  value,
  placeholder,
  readOnly,
  invalid = false,
  autoFocus = false,
  onChange,
}: {
  label: string;
  field: string;
  value: string;
  placeholder: string;
  readOnly: boolean;
  invalid?: boolean;
  autoFocus?: boolean;
  onChange: (value: string) => void;
}) {
  const textRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    if (field !== "verificationNotes" || !textRef.current) return;
    const textarea = textRef.current;
    if (!value) { textarea.style.height = ""; return; }
    textarea.style.height = "auto";
    textarea.style.height = `${Math.max(56, textarea.scrollHeight)}px`;
  }, [field, value]);
  return (
    <textarea
      ref={textRef}
      aria-label={label}
      data-pfmea-field={field}
      value={value}
      placeholder={placeholder}
      rows={2}
      readOnly={readOnly}
      aria-invalid={invalid || undefined}
      autoFocus={autoFocus}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={event => {
        if (!event.altKey || event.key !== "Enter") return;
        event.preventDefault();
        const cell = event.currentTarget;
        const start = cell.selectionStart;
        const end = cell.selectionEnd;
        onChange(cell.value.slice(0, start) + "\n" + cell.value.slice(end));
        requestAnimationFrame(() => { if (cell.isConnected) cell.setSelectionRange(start + 1, start + 1); });
      }}
      className={`ui-pfmea-cell-text ${invalid ? "ui-pfmea-field-invalid" : ""}`}
    />
  );
}

const PFMEA_SCORE_OPTIONS = Array.from({ length: 10 }, (_, index) => ({ value: String(index + 1), label: String(index + 1) }));

function PfmeaScoreCell({
  label,
  field,
  value,
  readOnly,
  invalid = false,
  onChange,
}: {
  label: string;
  field: string;
  value?: number;
  readOnly: boolean;
  invalid?: boolean;
  onChange: (value: number | undefined) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
    <input
      ref={inputRef}
      aria-label={label}
      data-pfmea-field={field}
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
    {!readOnly ? <ThemedSelect
      className="ui-pfmea-score-picker"
      triggerClassName="ui-pfmea-score-picker-trigger"
      ariaLabel={`Choose ${label.toLowerCase()}`}
      value={value == null ? "" : String(value)}
      selectedLabel=""
      options={PFMEA_SCORE_OPTIONS}
      menuMinWidth={96}
      menuMaxHeight={360}
      onChange={next => {
        onChange(normalizePfmeaScore(next));
        requestAnimationFrame(() => inputRef.current?.focus());
      }}
    /> : null}
    </>
  );
}

function PfmeaRpnCell({ value, threshold, label }: { value?: number; threshold?: number | null; label: string }) {
  const state = value == null || threshold == null ? "neutral" : value >= threshold ? "high" : "low";
  return (
    <output aria-label={label} className={`ui-pfmea-rpn ui-pfmea-rpn-${state}`}>
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
    <ModalSurface label={title} onCancel={onClose}><div
      className="ui-pfmea-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="ui-pfmea-modal"

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
    </div></ModalSurface>
  );
}

export function PfmeaWorkspace({
  product,
  workspaceId,
  scenario,
  tasks,
  zones,
  readOnly = false,
  saveResult,
  backupError,
  onDocumentChange,
  onRetrySave,
  onOpenTask,
}: PfmeaWorkspaceProps) {
  const storedDocument = useMemo(() => getProductPfmeaDocument(product.customFields), [product.customFields]);
  const productIdRef = useRef(product.id);
  const [pendingDocument, setPendingDocument] = useState<string>();
  const [saveNotice, setSaveNotice] = useState<"saving" | "saved" | "error">();
  const [pfmeaError, setPfmeaError] = useState<string>();
  const [pasteError, setPasteError] = useState<string>();
  const [showSettings, setShowSettings] = useState(false);
  const [showDocumentDetails, setShowDocumentDetails] = useState(false);
  const [fullScreen, setFullScreen] = useState(false);
  const fullScreenRoot = useRef<HTMLElement>(null);
  const [thresholdDraft, setThresholdDraft] = useState("");

  useEffect(() => {
    if (!fullScreen) return;
    // Keep keyboard focus out of the covered app shell; new popup portals remain usable.
    const covered: HTMLElement[] = [];
    let branch: HTMLElement | null = fullScreenRoot.current;
    while (branch?.parentElement) {
      const parent = branch.parentElement;
      for (const sibling of Array.from(parent.children)) {
        if (sibling !== branch && sibling instanceof HTMLElement && !sibling.hasAttribute("inert")) {
          sibling.setAttribute("inert", "");
          covered.push(sibling);
        }
      }
      if (parent === window.document.body) break;
      branch = parent;
    }
    fullScreenRoot.current?.querySelector<HTMLButtonElement>("[data-pfmea-exit-fullscreen]")?.focus();
    function exitOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // Close an open popup first; otherwise Escape exits without reverting edits.
      if (window.document.querySelector('dialog[open], [role="listbox"], .ui-pfmea-file-menu[open]')) return;
      event.preventDefault();
      event.stopPropagation();
      setFullScreen(false);
    }
    window.document.addEventListener("keydown", exitOnEscape, true);
    return () => {
      window.document.removeEventListener("keydown", exitOnEscape, true);
      for (const sibling of covered) sibling.removeAttribute("inert");
    };
  }, [fullScreen]);

  useEffect(() => {
    if (!saveResult || (pendingDocument ? JSON.stringify(saveResult.document) !== pendingDocument : saveResult.state !== "error")) return;
    setSaveNotice(saveResult.state);
    setPfmeaError(saveResult.error);
    if (saveResult.state !== "saved") return;
    setPendingDocument(undefined);
  }, [pendingDocument, saveResult]);

  useEffect(() => {
    if (saveNotice !== "saved") return;
    const timer = window.setTimeout(() => setSaveNotice(undefined), 2500);
    return () => window.clearTimeout(timer);
  }, [saveNotice]);
  const [document, setDocument] = useState<PfmeaDocument>(() =>
    storedDocument ?? createPfmeaDocumentFromProcedure(product, scenario, tasks, zones),
  );
  const history = useRef(createPfmeaEditHistory());
  const editGroup = useRef<string | undefined>(undefined);
  const editSequence = useRef(0);
  const [historyStatus, setHistoryStatus] = useState({undo:false,redo:false});
  function refreshHistory() { const next = history.current.status(); setHistoryStatus(current => current.undo === next.undo && current.redo === next.redo ? current : next); }
  const [activeGridRow, setActiveGridRow] = useState<string>();
  const editBaseline = useRef<PfmeaRow | undefined>(undefined);
  const [members, setMembers] = useState<WorkspaceMemberProfile[]>([]);
  const [directoryReady, setDirectoryReady] = useState(false);
  const [taskFilter, setTaskFilter] = useState("");
  const [areaFilter, setAreaFilter] = useState("");
  const gridScrollRef = useRef<HTMLDivElement>(null);
  const [collapsedTasks, setCollapsedTasks] = useState<Set<string>>(new Set());
  useEffect(() => { if (gridScrollRef.current) gridScrollRef.current.scrollLeft = 0; }, [collapsedTasks]);
  const [syncPreview, setSyncPreview] = useState<ReturnType<typeof previewPfmeaSync>>();
  const [relinkId, setRelinkId] = useState<string>();
  const [relinkTask, setRelinkTask] = useState("");
  const [relinkStep, setRelinkStep] = useState("");
  const [archiveId, setArchiveId] = useState<string>();
  const [filter, setFilter] = useState<PfmeaFilter>("all");
  const [columnView, setColumnView] = useState<PfmeaColumnView>("all");
  const [query, setQuery] = useState("");
  const [showAddFailure, setShowAddFailure] = useState(false);
  const [showScoringGuide, setShowScoringGuide] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [selectedStepId, setSelectedStepId] = useState("");
  const [focusRowId, setFocusRowId] = useState<string>();
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
    setPendingDocument(undefined);
    setSaveNotice(undefined);
    setPfmeaError(undefined);
    setDocument(storedDocument ?? createPfmeaDocumentFromProcedure(product, scenario, tasks, zones));
    history.current.clear();
    editGroup.current = undefined;
    setHistoryStatus({undo:false,redo:false});
    setActiveGridRow(undefined);
    editBaseline.current = undefined;
    setTaskFilter("");
    setAreaFilter("");
    setCollapsedTasks(new Set());
    setSyncPreview(undefined);
    setRelinkId(undefined);
    setArchiveId(undefined);
    setFilter("all");
    setColumnView("risk");
    setQuery("");
    setShowAddFailure(false);
    setShowScoringGuide(false);
    setImportPreview(undefined);
    setImportError(undefined);
    setExportError(undefined);
    setMappingRowId(undefined);
  }, [product, scenario, storedDocument, tasks, zones]);

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
  const activeRows = useMemo(() => document.rows.filter(row => !row.archivedAt), [document.rows]);
  const startedRows = useMemo(() => activeRows.filter(isPfmeaRowStarted), [activeRows]);
  const highPriorityRows = useMemo(() => startedRows.filter(row => isHighPriorityPfmeaRow(row, document.settings)), [startedRows, document.settings]);
  const incompleteRows = useMemo(() => startedRows.filter((row) => getPfmeaRowIssues(row, document.settings).length > 0), [startedRows, document.settings]);
  const staleLinkCount = useMemo(
    () => activeRows.filter((row) => pfmeaLinkIssue(row, tasks)).length,
    [activeRows, tasks],
  );

  const keyboard = usePfmeaGridKeyboard({
    begin: id => { history.current.seal(); editGroup.current = `cell-${++editSequence.current}`; editBaseline.current = document.rows.find(row => row.id === id); setActiveGridRow(id); },
    cancel: id => {
      const baseline = editBaseline.current;
      const previous = history.current.cancel(editGroup.current);
      if (baseline?.id === id && previous) applyDocument(previous, false);
      editGroup.current = `cell-${++editSequence.current}`;
      refreshHistory();
    },
    leave: () => { history.current.seal(); editGroup.current = undefined; editBaseline.current = undefined; setActiveGridRow(undefined); },
  });
  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return document.rows.filter((row) => {
      if (row.id === activeGridRow) return true;
      if (filter === "archived" ? !row.archivedAt : row.archivedAt) return false;
      if (taskFilter && pfmeaTaskGroupKey(row) !== taskFilter) return false;
      if (areaFilter && (row.zoneNameSnapshot || "Unassigned") !== areaFilter) return false;
      if (filter === "overdue" && !isPfmeaActionOverdue(row, localToday())) return false;
      if (filter === "awaiting_verification" && pfmeaActionStatus(row) !== "awaiting_verification") return false;
      if (filter === "links" && !pfmeaLinkIssue(row, tasks)) return false;
      if (filter === "not_assessed" && pfmeaAssessmentState(row, document.settings) !== "not_assessed") return false;
      if (filter === "complete" && pfmeaAssessmentState(row, document.settings) !== "complete") return false;
      if (filter === "started" && !isPfmeaRowStarted(row)) return false;
      if (filter === "high" && !isHighPriorityPfmeaRow(row, document.settings)) return false;
      if (
        filter === "incomplete" &&
        (!isPfmeaRowStarted(row) || getPfmeaRowIssues(row, document.settings).length === 0)
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
  }, [document.rows, document.settings, filter, query, tasks, taskFilter, areaFilter, activeGridRow]);
  const visibleRows = useMemo(() => {
    const groups = new Map<string, PfmeaRow[]>();
    filteredRows.forEach(row => { const key = pfmeaTaskGroupKey(row); groups.set(key, [...(groups.get(key) ?? []), row]); });
    return [...groups.values()].flat();
  }, [filteredRows]);
  const taskFilters = [...new Map(document.rows.map(row => [pfmeaTaskGroupKey(row), row.taskNameSnapshot || "Unmapped"])).entries()];
  const areas = [...new Set(document.rows.map(row => row.zoneNameSnapshot || "Unassigned"))].sort();
  useEffect(() => {
    if (!workspaceId || columnView === "risk") return;
    let active = true;
    setDirectoryReady(false);
    void loadWorkspaceMembersFromSupabase(workspaceId).then(rows => {
      if (active) { setMembers(rows.filter(member => member.fullName || member.email)); setDirectoryReady(true); }
    }).catch(() => { if (active) setDirectoryReady(false); });
    return () => { active = false; };
  }, [workspaceId, columnView]);

  // Memoized rows invoke current handlers, never callbacks holding an older document.
  const rowActions = useRef({ updateRow, addFailureMode, openControlMapping, onOpenTask, closeRow });
  rowActions.current = { updateRow, addFailureMode, openControlMapping, onOpenTask, closeRow };
  function closeRow(rowId: string) {
    const row = document.rows.find(item => item.id === rowId);
    if (!row) return;
    const closed = closePfmeaAction(row, true, new Date(), document.settings);
    applyDocument({ ...document, rows: document.rows.map(item => item.id === rowId ? closed : item) });
  }

  function toggleTask(key: string) { setCollapsedTasks(current => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; }); }


  function applyDocument(nextDocument: PfmeaDocument, record = true) {
    if (record) { history.current.record(document, nextDocument, editGroup.current); refreshHistory(); }
    const next = { ...nextDocument, updatedAt: new Date().toISOString() };
    setDocument(next);
    setPendingDocument(JSON.stringify(serializePfmeaDocument(next)));
    setSaveNotice("saving");
    setPfmeaError(undefined);
    onDocumentChange(next);
  }

  function replayHistory(direction: "undo" | "redo") {
    if (readOnly) return;
    const next = history.current[direction]();
    if (!next) return;
    editGroup.current = `cell-${++editSequence.current}`;
    editBaseline.current = next.rows.find(row => row.id === activeGridRow);
    applyDocument(next, false);
    refreshHistory();
  }
  function updateMetadata(patch: Partial<PfmeaDocument>) {
    applyDocument({ ...document, ...patch });
  }

  function updateRow(rowId: string, patch: Partial<PfmeaRow>) {
    applyDocument({
      ...document,
      rows: document.rows.map((row) => (row.id === rowId ? patchPfmeaRow(row, patch) : row)),
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
    setSyncPreview(previewPfmeaSync(document, scenario, tasks, zones));
  }

  const workspaceReadOnly = readOnly;
  const duplicateImport = importPreview
    ? document.imports.some((record) => record.sourceKey === importPreview.record.sourceKey)
    : false;

  return (
    <section ref={fullScreenRoot} className={`ui-pfmea-page space-y-4${fullScreen ? " ui-pfmea-fullscreen" : ""}`} aria-labelledby="planner-pfmea-title" onKeyDownCapture={event => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.nativeEvent.isComposing || event.key.toLowerCase() !== "z" && event.key.toLowerCase() !== "y") return;
      const target = event.target as HTMLElement;
      if (!target.closest('.ui-pfmea-grid-wrap') && !target.closest('[data-pfmea-history]')) return;
      event.preventDefault(); event.stopPropagation();
      replayHistory(event.shiftKey || event.key.toLowerCase() === "y" ? "redo" : "undo");
    }}>
      <section className="ui-pfmea-document" aria-label="PFMEA document actions" hidden={fullScreen}>
        <div className="ui-pfmea-document-tools">
          <div className="ui-pfmea-head-actions">
            {saveNotice ? (
              <span role="status" aria-label="PFMEA save status" className="text-xs text-ink-secondary" title={pfmeaError}>
                {saveNotice === "saved" ? <Check className="mr-1 inline" size={13} aria-hidden="true" /> : null}
                {saveNotice === "saving" ? "Saving…" : saveNotice === "saved" ? "Saved" : "Save failed"}
                {saveNotice === "error" && onRetrySave ? <button type="button" onClick={onRetrySave} className="ml-2 underline">Retry</button> : null}
              </span>
            ) : null}
            <input
              ref={importInputRef}
              className="sr-only"
              type="file"
              accept=".csv,.xlsx,.xls"
              aria-label="Choose PFMEA import file"
              onChange={(event) => void selectImportFile(event.target.files?.[0])}
            />
            <button type="button" className="ui-btn-ghost h-9 gap-2" data-pfmea-fullscreen-toggle aria-pressed={fullScreen} onClick={() => setFullScreen(current => !current)}>{fullScreen ? <Minimize2 size={14} aria-hidden="true" /> : <Maximize2 size={14} aria-hidden="true" />}{fullScreen ? "Exit full screen" : "Full screen"}</button>
            <button type="button" className="ui-btn-ghost h-9 gap-2" onClick={() => setShowDocumentDetails(true)}><FileText size={14} aria-hidden="true" />Document details</button>
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
      </section>

      {showDocumentDetails ? <PfmeaModal title="Document details" onClose={() => setShowDocumentDetails(false)} actions={<button type="button" className="ui-btn-primary h-9" onClick={() => setShowDocumentDetails(false)}>Done</button>}>
          <div className="ui-pfmea-details-grid">
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
      </PfmeaModal> : null}
      {showSettings ? <PfmeaModal title="PFMEA settings" onClose={() => setShowSettings(false)} actions={<><button type="button" className="ui-btn-secondary h-9" onClick={() => setShowSettings(false)}>Cancel</button><button type="button" className="ui-btn-primary h-9" disabled={readOnly || Boolean(thresholdDraft && (!/^\d+$/.test(thresholdDraft) || Number(thresholdDraft) < 1 || Number(thresholdDraft) > 1000))} onClick={() => { history.current.seal(); editGroup.current = undefined; updateMetadata({ settings: { ...document.settings, highRpnThreshold: thresholdDraft ? Number(thresholdDraft) : null } }); setShowSettings(false); }}>Save settings</button></>}>
        <label className="block text-sm">RPN mitigation threshold<input className="ui-input mt-2 w-full" aria-label="RPN mitigation threshold" type="number" min={1} max={1000} step={1} placeholder="Not set" value={thresholdDraft} readOnly={readOnly} onChange={event => setThresholdDraft(event.target.value)} /></label>
        <p className="mt-3 text-xs text-ink-secondary">RPN at or above this number requires mitigation. Final RPN must be below it. Applies to this PFMEA.</p>
      </PfmeaModal> : null}
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
            <option value="overdue">Overdue actions</option>
            <option value="awaiting_verification">Awaiting verification</option>
            <option value="links">Links need review ({staleLinkCount})</option>
            <option value="archived">Archived ({document.rows.length - activeRows.length})</option>
            <option value="not_assessed">Not assessed ({activeRows.length - startedRows.length})</option>
            <option value="complete">Complete ({startedRows.length - incompleteRows.length})</option>
            <option value="high">High priority ({highPriorityRows.length})</option>
            <option value="incomplete">In progress ({incompleteRows.length})</option>
          </select>
          <select aria-label="Filter PFMEA task" value={taskFilter} onChange={event => setTaskFilter(event.target.value)}><option value="">All tasks</option>{taskFilters.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
          <select aria-label="Filter PFMEA area" value={areaFilter} onChange={event => setAreaFilter(event.target.value)}><option value="">All areas</option>{areas.map(area => <option key={area} value={area}>{area}</option>)}</select>
          <select aria-label="PFMEA column view" value={columnView} onChange={(event) => setColumnView(event.target.value as PfmeaColumnView)}>
            <option value="risk">Core risk fields</option>
            <option value="actions">Action tracking</option>
            <option value="all">All fields</option>
          </select>
          <span>{visibleRows.length} of {document.rows.length} rows</span>
          <button type="button" className="ui-pfmea-toolbar-action" title="Scoring and keyboard guide" onClick={() => setShowScoringGuide(true)}>
            <CircleHelp size={14} aria-hidden="true" />
            <span className="sr-only">Scoring guide</span>
          </button>
          <button type="button" className="ui-pfmea-toolbar-action" aria-label="PFMEA settings" title={document.settings.highRpnThreshold == null ? "RPN threshold not set" : `Mitigate RPN ≥ ${document.settings.highRpnThreshold}`} onClick={() => { setThresholdDraft(document.settings.highRpnThreshold?.toString() ?? ""); setShowSettings(true); }}><Settings2 size={14} aria-hidden="true" /></button>
          <button type="button" data-pfmea-history className="ui-pfmea-toolbar-action disabled:opacity-35" aria-label="Undo PFMEA edit" title="Undo (Ctrl/Cmd+Z)" disabled={readOnly || !historyStatus.undo} onClick={() => replayHistory("undo")}><Undo2 size={14} aria-hidden="true" /></button>
          <button type="button" data-pfmea-history className="ui-pfmea-toolbar-action disabled:opacity-35" aria-label="Redo PFMEA edit" title="Redo (Ctrl+Y or Ctrl/Cmd+Shift+Z)" disabled={readOnly || !historyStatus.redo} onClick={() => replayHistory("redo")}><Redo2 size={14} aria-hidden="true" /></button>
        </div>

        <p id="pfmea-keyboard-help" className="sr-only">Tab across · Enter down · F2 or double-click to edit · Alt+Enter for a new line · Esc to revert the active edit</p>
        <div className="ui-pfmea-progress" aria-label="Assessment progress">
          {staleLinkCount > 0 ? <button type="button" onClick={() => setFilter("links")} className="underline">{staleLinkCount} links need review</button> : null}
          <span>Not assessed <strong>{activeRows.length - startedRows.length}</strong></span>
          <span>In progress <strong>{incompleteRows.length}</strong></span>
          <span>Complete <strong>{startedRows.length - incompleteRows.length}</strong></span>
          <button type="button" className="ml-auto" onClick={() => setCollapsedTasks(new Set(visibleRows.map(pfmeaTaskGroupKey)))}>Collapse tasks</button>
          <button type="button" onClick={() => setCollapsedTasks(new Set())}>Expand tasks</button>
        </div>
        {backupError ? <div role="alert" className="ui-notice">{backupError}</div> : null}
        {pasteError ? <div role="alert" className="ui-notice">{pasteError}</div> : null}
        <div className="ui-pfmea-form">
        <div className="ui-pfmea-document-head">
          <div className="ui-pfmea-brand">
            <div className="ui-pfmea-logo-cell"><Image src="/sop/ana-logo.png" alt="ANA" width={116} height={32} priority /></div>
            <div>
              <div className="ui-pfmea-title-line">
                <h2 id="planner-pfmea-title" className="ui-pfmea-document-title">{product.name} PFMEA</h2>
                <span className="ui-pfmea-status">{document.status.replace("_", " ")}</span>
                {fullScreen ? <button type="button" data-pfmea-exit-fullscreen className="ui-btn-ghost ml-auto h-8 w-8" aria-label="Exit full screen" title="Exit full screen (Esc)" onClick={() => setFullScreen(false)}><Minimize2 size={16} aria-hidden="true" /></button> : null}
              </div>
              <p className="ui-pfmea-document-subtitle">Process Failure Mode and Effects Analysis</p>

            </div>
          </div>
          <dl className="ui-pfmea-document-control" aria-label="Document control">
            <div><dt>Document no.</dt><dd>{document.documentNumber || "—"}</dd></div>
            <div><dt>Revision</dt><dd>{formatPfmeaRevision(document.revision)}</dd></div>
            <div><dt>Original date</dt><dd>{displayDate(document.originalDate)}</dd></div>
            <div><dt>Owner</dt><dd>{document.owner || "—"}</dd></div>
          </dl>
        </div>
        <div onPointerDownCapture={event => {
          const target = event.target as HTMLElement;
          const cell = target.closest("td.ui-pfmea-score-cell");
          const input = cell?.querySelector<HTMLInputElement>("input.ui-pfmea-score-input");
          if (!input || input.readOnly || input.disabled || target.closest("button")) return;
          event.preventDefault();
          input.focus();
          input.select();
        }} onClickCapture={event => {
          const target = event.target as HTMLElement;
          const cell = target.closest("td.ui-pfmea-score-cell");
          if (!cell || target.closest("button, input")) return;
          cell.querySelector<HTMLButtonElement>(".ui-pfmea-score-picker-trigger:not(:disabled)")?.click();
        }} onPaste={event => {
          const text = event.clipboardData.getData("text/plain");
          if (!text.includes("\t") && !/[\r\n]/.test(text)) return;
          const cell = event.target as HTMLElement;
          if (!cell.dataset.pfmeaField || !cell.closest("tbody")) return;
          // Editing mode retains normal multiline text paste in a single cell.
          if (cell.dataset.pfmeaEditing === "true" && !text.includes("\t")) return;
          event.preventDefault();
          if (readOnly) return;
          const table = cell.closest("table")!;
          const rows = Array.from(table.querySelectorAll<HTMLTableRowElement>("tbody tr[data-pfmea-row]"));
          const editors = (row: HTMLTableRowElement) => Array.from(row.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("[data-pfmea-field]")).filter(item => {
            const column = item.closest("td")?.dataset.pfmeaColumn;
            return !(columnView === "risk" && column === "action") && !(columnView === "actions" && column === "risk-detail");
          });
          const startRow = rows.indexOf(cell.closest("tr")!);
          const startColumn = editors(rows[startRow]).findIndex(item => item === cell);
          const targets: PfmeaPasteTarget[][] = rows.slice(startRow).map(row => editors(row).slice(startColumn).map(item => ({ rowId: row.dataset.pfmeaRow!, field: item.disabled || ("readOnly" in item && item.readOnly) ? "" : item.dataset.pfmeaField!, options: item instanceof HTMLSelectElement ? Array.from(item.options).map(option => ({ value: option.value, label: option.text })) : undefined })));
          try {
            const next = pastePfmeaGrid(document, text, targets);
            history.current.seal(); editGroup.current = undefined;
            applyDocument(next);
            history.current.seal(); editGroup.current = `cell-${++editSequence.current}`;
            setPasteError(undefined);
          } catch (error) { setPasteError(error instanceof Error ? error.message : "The block could not be pasted."); }
        }} className="ui-pfmea-grid-wrap" ref={gridScrollRef} aria-describedby="pfmea-keyboard-help" {...keyboard}>
          <table className="ui-pfmea-grid" data-column-view={columnView}>
            <colgroup>
              <col data-pfmea-column="shared" style={{ width: 140 }} />
              <col data-pfmea-column="shared" style={{ width: 170 }} />
              <col data-pfmea-column="shared" style={{ width: 205 }} />
              <col data-pfmea-column="risk-detail" style={{ width: 220 }} />
              <col data-pfmea-column="risk-detail" style={{ width: 60 }} />
              <col data-pfmea-column="risk-detail" style={{ width: 230 }} />
              <col data-pfmea-column="risk-detail" style={{ width: 60 }} />
              <col data-pfmea-column="risk-detail" style={{ width: 205 }} />
              <col data-pfmea-column="risk-detail" style={{ width: 60 }} />
              <col data-pfmea-column="risk-detail" style={{ width: 205 }} />
              <col data-pfmea-column="shared" style={{ width: 64 }} />
              <col data-pfmea-column="action" style={{ width: 205 }} />
              <col data-pfmea-column="action" style={{ width: 220 }} />
              <col data-pfmea-column="action" style={{ width: 205 }} />
              <col data-pfmea-column="action" style={{ width: 64 }} />
              <col data-pfmea-column="action" style={{ width: 64 }} />
              <col data-pfmea-column="action" style={{ width: 64 }} />
              <col data-pfmea-column="action" style={{ width: 64 }} />
              <col data-pfmea-column="action" style={{ width: 170 }} />
              <col data-pfmea-column="action" style={{ width: 220 }} />
              <col data-pfmea-column="shared" style={{ width: 64 }} />
            </colgroup>
            <thead>
              <tr>
                <th scope="col" rowSpan={2} data-pfmea-column="shared">Procedure task</th>
                <th scope="col" rowSpan={2} data-pfmea-column="shared">Process step</th>
                <th scope="col" rowSpan={2} data-pfmea-column="shared">Potential Failure Mode<small>What failed</small></th>
                <th scope="col" rowSpan={2} data-pfmea-column="risk-detail">Potential Effect(s) of Failure<small>What happens due to the failure</small></th>
                <th scope="col" rowSpan={2} data-pfmea-column="risk-detail" className="ui-pfmea-score-heading" aria-label="Severity (1–10)" title="Severity (1–10)">Sev<small>(1–10)</small></th>
                <th scope="col" rowSpan={2} data-pfmea-column="risk-detail">Potential Cause(s) / Mechanism(s) of Failure<small>What caused the failure</small></th>
                <th scope="col" rowSpan={2} data-pfmea-column="risk-detail" className="ui-pfmea-score-heading" aria-label="Occurrence (1–10)" title="Occurrence (1–10)">Occ<small>(1–10)</small></th>
                <th scope="col" rowSpan={2} data-pfmea-column="risk-detail">Current Process Controls</th>
                <th scope="col" rowSpan={2} data-pfmea-column="risk-detail" className="ui-pfmea-score-heading" aria-label="Detection (1–10)" title="Detection (1–10)">Det<small>(1–10)</small></th>
                <th scope="col" rowSpan={2} data-pfmea-column="risk-detail">Detection Activity</th>
                <th scope="col" rowSpan={2} data-pfmea-column="shared">RPN</th>
                <th scope="col" rowSpan={2} data-pfmea-column="action">Recommended Action(s)</th>
                <th scope="col" rowSpan={2} data-pfmea-column="action">Responsibility and Target Completion Date</th>
                <th scope="colgroup" colSpan={5} data-pfmea-column="action" className="ui-pfmea-results-heading">Action Results</th>
                <th scope="col" rowSpan={2} data-pfmea-column="action">Action Status</th>
                <th scope="col" rowSpan={2} data-pfmea-column="action">Effectiveness Verification</th>
                <th scope="col" rowSpan={2} data-pfmea-column="shared" aria-label="Row actions" />
              </tr>
              {columnView !== "risk" ? <tr className="ui-pfmea-results-subhead">
                <th scope="col">Actions Taken</th><th scope="col">Sev</th><th scope="col">Occ</th><th scope="col">Det</th><th scope="col">RPN</th>
              </tr> : null}
            </thead>
            <tbody>
              {visibleRows.map((row, index) => {
                const readOnly = workspaceReadOnly || Boolean(row.archivedAt);
                const rowRpn = calculateRowRpn(row);
                const residualRpn = calculateResidualRpn(row);
                const highPriority = isHighPriorityPfmeaRow(row, document.settings);
                const verified = row.actionStatus === "closed" && Boolean(row.verifiedAt) && pfmeaClosureIssues(row, document.settings).length === 0;
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
                const rowIssues = getPfmeaRowIssues(row, document.settings);
                const issueFields = new Set(rowIssues.map((issue) => issue.field));
                const rowLabel = row.processStepSnapshot || row.taskNameSnapshot || `row ${index + 1}`;
                if (collapsedTasks.has(taskGroupKey)) {
                  if (!startsTask) return null;
                  return <tr key={row.id} className="ui-pfmea-task-start ui-pfmea-collapsed"><td colSpan={columnView === "all" ? 21 : columnView === "actions" ? 14 : 12}><button type="button" className="ui-pfmea-group-toggle" aria-expanded={false} onClick={() => toggleTask(taskGroupKey)}><ChevronRight size={14} />{row.taskCodeSnapshot} · {row.taskNameSnapshot} · {normalizedTaskRowSpan} rows</button></td></tr>;
                }
                return (<PfmeaRenderedRow key={row.id} row={row} context={[task, readOnly, workspaceReadOnly, startsTask, startsStep, normalizedTaskRowSpan, normalizedStepRowSpan, highPriority, document.settings, focusRowId === row.id, members, directoryReady]} render={() => (
                  <tr
                    key={row.id}
                    data-pfmea-row={row.id}
                    className={`${startsTask ? "ui-pfmea-task-start" : ""} ${verified ? "ui-pfmea-row-verified" : ""}`}
                  >
                    {startsTask ? (
                      <td
                        className="ui-pfmea-task-cell"
                        data-pfmea-column="shared"
                        rowSpan={normalizedTaskRowSpan}
                        title={row.zoneNameSnapshot || undefined}
                      >
                        <button type="button" className="ui-pfmea-group-toggle" aria-label={`Collapse ${row.taskNameSnapshot || "task"}`} aria-expanded={true} onClick={() => toggleTask(taskGroupKey)}><ChevronDown size={14} />Collapse</button>
                        <button
                          type="button"
                          disabled={!task || !onOpenTask}
                          onClick={() => row.taskId && rowActions.current.onOpenTask?.(row.taskId)}
                          title={task ? "Open linked Procedure task" : "Procedure link needs review"}
                        >
                          <strong>{row.taskCodeSnapshot || "Unmapped"}</strong>
                          <span>{row.taskNameSnapshot || "Choose a Procedure task"}</span>
                          {task && onOpenTask ? <ExternalLink size={11} aria-hidden="true" /> : null}
                        </button>

                      </td>
                    ) : null}
                    {startsStep ? (
                      <td className="ui-pfmea-step-cell" data-pfmea-column="shared" rowSpan={normalizedStepRowSpan}>
                        <span>{row.stepSequenceSnapshot ? `Step ${row.stepSequenceSnapshot}` : "Task level"}</span>
                        <strong>{row.processStepSnapshot || "Unmapped process step"}</strong>

                        <button type="button" className="ui-pfmea-add-failure" disabled={readOnly || Boolean(row.archivedAt)} onClick={() => rowActions.current.addFailureMode(row)}>
                          <Plus size={11} aria-hidden="true" />
                          Failure mode
                        </button>
                      </td>
                    ) : null}
                    <td data-pfmea-column="shared"><PfmeaTextCell field="failureMode" label={`Failure mode for ${rowLabel}`} value={row.failureMode} placeholder="What could fail?" readOnly={readOnly} invalid={issueFields.has("failureMode")} autoFocus={focusRowId === row.id} onChange={(value) => rowActions.current.updateRow(row.id, { failureMode: value })} />                        {pfmeaLinkIssue(row, tasks) ? <button type="button" className="ui-pfmea-link-review" disabled={readOnly} onClick={() => { setRelinkId(row.id); setRelinkTask(task?.id ?? ""); setRelinkStep(""); }}><AlertTriangle size={12} aria-hidden="true" />{pfmeaLinkIssue(row, tasks)} · Review</button> : null}</td>
                    <td data-pfmea-column="risk-detail"><PfmeaTextCell field="effect" label={`Failure effect for ${rowLabel}`} value={row.effect} placeholder="What happens?" readOnly={readOnly} invalid={issueFields.has("effect")} onChange={(value) => rowActions.current.updateRow(row.id, { effect: value })} /></td>
                    <td className="ui-pfmea-score-cell" data-pfmea-column="risk-detail"><PfmeaScoreCell field="severity" label={`Severity for ${rowLabel}`} value={row.severity} readOnly={readOnly} invalid={issueFields.has("severity")} onChange={(value) => rowActions.current.updateRow(row.id, { severity: value })} /></td>
                    <td data-pfmea-column="risk-detail"><PfmeaTextCell field="cause" label={`Failure cause for ${rowLabel}`} value={row.cause} placeholder="What causes it?" readOnly={readOnly} invalid={issueFields.has("cause")} onChange={(value) => rowActions.current.updateRow(row.id, { cause: value })} /></td>
                    <td className="ui-pfmea-score-cell" data-pfmea-column="risk-detail"><PfmeaScoreCell field="occurrence" label={`Occurrence for ${rowLabel}`} value={row.occurrence} readOnly={readOnly} invalid={issueFields.has("occurrence")} onChange={(value) => rowActions.current.updateRow(row.id, { occurrence: value })} /></td>
                    <td data-pfmea-column="risk-detail"><PfmeaTextCell field="currentControls" label={`Current controls for ${rowLabel}`} value={row.currentControls} placeholder="Existing prevention controls" readOnly={readOnly} invalid={issueFields.has("currentControls")} onChange={(value) => rowActions.current.updateRow(row.id, { currentControls: value })} /></td>
                    <td className="ui-pfmea-score-cell" data-pfmea-column="risk-detail"><PfmeaScoreCell field="detection" label={`Detection for ${rowLabel}`} value={row.detection} readOnly={readOnly} invalid={issueFields.has("detection")} onChange={(value) => rowActions.current.updateRow(row.id, { detection: value })} /></td>
                    <td data-pfmea-column="risk-detail"><PfmeaTextCell field="detectionActivity" label={`Detection activity for ${rowLabel}`} value={row.detectionActivity} placeholder="How is it detected?" readOnly={readOnly} invalid={issueFields.has("detectionActivity")} onChange={(value) => rowActions.current.updateRow(row.id, { detectionActivity: value })} /></td>
                    <td data-pfmea-column="shared"><PfmeaRpnCell label={`Current RPN for ${rowLabel}`} value={rowRpn} threshold={document.settings.highRpnThreshold} /></td>
                    <td data-pfmea-column="action">
                      <div className="ui-pfmea-action-cell">
                        <PfmeaTextCell field="recommendedActions" label={`Recommended actions for ${rowLabel}`} value={row.recommendedActions} placeholder="Required controls or improvements" readOnly={readOnly} onChange={(value) => rowActions.current.updateRow(row.id, { recommendedActions: value })} />
                        <button type="button" disabled title="Control mapping is deferred; checklist generation is planned.">
                          <Link2 size={11} aria-hidden="true" />
                          {row.controlProposals.length > 0 ? `${row.controlProposals.length} mapping${row.controlProposals.length === 1 ? "" : "s"}` : "Map control"}
                        </button>
                      </div>
                    </td>
                    <td data-pfmea-column="action" className="ui-pfmea-responsibility-cell">
                      <select data-pfmea-field="actionOwnerId" className="ui-pfmea-inline-select" aria-label={`Action owner for ${rowLabel}`} disabled={readOnly || !directoryReady} value={row.actionOwnerId ?? (row.actionOwner ? "legacy" : "")} onChange={event => {
                        const member = members.find(item => item.userId === event.target.value);
                        rowActions.current.updateRow(row.id, { actionOwnerId: member?.userId, actionOwner: member?.fullName || member?.email || "" });
                      }}>
                        <option value="">{directoryReady ? "Choose owner" : "Directory unavailable"}</option>
                        {row.actionOwner && !members.some(member => member.userId === row.actionOwnerId) ? <option value={row.actionOwnerId ?? "legacy"}>{row.actionOwner} (existing)</option> : null}
                        {members.map(member => <option key={member.userId} value={member.userId}>{member.fullName || member.email}</option>)}
                      </select>
                      <DatePicker label={`Target date for ${rowLabel}`} value={row.targetDate} readOnly={readOnly} inputClassName="ui-pfmea-date-input" inputProps={{"data-pfmea-field":"targetDate"}} onChange={value => rowActions.current.updateRow(row.id, { targetDate: value })} />
                    </td>
                    <td data-pfmea-column="action"><PfmeaTextCell field="actionsTaken" label={`Actions taken for ${rowLabel}`} value={row.actionsTaken} placeholder="Implementation evidence" readOnly={readOnly} onChange={(value) => rowActions.current.updateRow(row.id, { actionsTaken: value })} /></td>
                    <td data-pfmea-column="action"><span className="ui-pfmea-result-severity" aria-label={`Result severity for ${rowLabel}`} title="Original severity (read-only)">{row.severity ?? "—"}</span></td>
                    <td className="ui-pfmea-score-cell" data-pfmea-column="action"><PfmeaScoreCell field="resultOccurrence" label={`Result occurrence for ${rowLabel}`} value={row.resultOccurrence} readOnly={readOnly} invalid={issueFields.has("resultOccurrence")} onChange={(value) => rowActions.current.updateRow(row.id, { resultOccurrence: value })} /></td>
                    <td className="ui-pfmea-score-cell" data-pfmea-column="action"><PfmeaScoreCell field="resultDetection" label={`Result detection for ${rowLabel}`} value={row.resultDetection} readOnly={readOnly} invalid={issueFields.has("resultDetection")} onChange={(value) => rowActions.current.updateRow(row.id, { resultDetection: value })} /></td>
                    <td data-pfmea-column="action">
                      <PfmeaRpnCell label={`Residual RPN for ${rowLabel}`} value={residualRpn} threshold={document.settings.highRpnThreshold} />
                    </td>
                    <td data-pfmea-column="action">
                      <select data-pfmea-field="actionStatus" className="ui-pfmea-inline-select" aria-label={`Action status for ${rowLabel}`} disabled={readOnly} value={pfmeaActionStatus(row) ?? ""} onChange={event => rowActions.current.updateRow(row.id, { actionStatus: event.target.value as "open" | "in_progress" | "awaiting_verification", verifiedAt: undefined })}>
                        <option value="" disabled>No action</option><option value="open">Open</option><option value="in_progress">In progress</option><option value="awaiting_verification">Awaiting verification</option>
                        {row.actionStatus === "closed" ? <option value="closed">Closed</option> : null}
                      </select>
                      {isPfmeaActionOverdue(row, localToday()) ? <span className="ui-pfmea-action-status">Overdue</span> : null}
                    </td>
                    <td data-pfmea-column="action">
                      <div className="ui-pfmea-verification-cell">
                      <PfmeaTextCell field="verificationNotes" label={`Effectiveness verification for ${rowLabel}`} value={row.verificationNotes ?? ""} placeholder="How was effectiveness verified?" readOnly={readOnly} onChange={value => rowActions.current.updateRow(row.id, { verificationNotes: value })} />
                      </div>
                    </td>
                    <td className="ui-pfmea-row-actions" data-pfmea-column="shared">
                      <input type="checkbox" checked={row.actionStatus === "closed"} aria-label={`Confirm effective & close for ${rowLabel}`} className="ui-pfmea-close-action" disabled={row.actionStatus === "closed" || readOnly || pfmeaClosureIssues(row, document.settings).length > 0} title={pfmeaClosureIssues(row, document.settings).join("\n") || "Confirm the recorded evidence demonstrates effectiveness"} onChange={() => {
                        rowActions.current.closeRow(row.id);
                      }} />
                      {rowIssues.length > 0 ? (
                        <span className="ui-pfmea-issue-count" title={rowIssues.map((issue) => issue.message).join("\n")} aria-label={`${rowIssues.length} validation issue(s)`}>
                          <AlertCircle size={13} aria-hidden="true" />
                          {rowIssues.length}
                        </span>
                      ) : null}
                      <button type="button" disabled={workspaceReadOnly} aria-label={row.archivedAt ? "Restore" : "Archive"} title={row.archivedAt ? "Restore row" : "Archive row"} onClick={() => row.archivedAt ? rowActions.current.updateRow(row.id, { archivedAt: undefined }) : setArchiveId(row.id)}>{row.archivedAt ? <RotateCcw size={13} /> : <Archive size={13} />}</button>
                    </td>
                  </tr>
                )} />);
              })}
              {visibleRows.length === 0 ? (
                <tr><td colSpan={21} className="ui-pfmea-empty">No PFMEA rows match this filter.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
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


      {syncPreview ? <PfmeaModal title="Review Procedure changes" description="Refresh source labels and add new steps. Existing risk analysis is preserved; missing sources remain for review." onClose={() => setSyncPreview(undefined)} actions={<><button className="ui-btn-secondary h-9" onClick={() => setSyncPreview(undefined)}>Cancel</button><button className="ui-btn-primary h-9" disabled={readOnly} onClick={() => { applyDocument(syncPreview.next); setSyncPreview(undefined); }}>Apply sync</button></>}>
        {([['Added', syncPreview.added], ['Changed', syncPreview.changed], ['Source missing', syncPreview.missing]] as const).map(([label, rows]) => <section key={label} className="ui-pfmea-sync-section"><h4>{label} ({rows.length})</h4><ul>{rows.map(row => <li key={row.id}>{row.taskCodeSnapshot} · {row.processStepSnapshot || row.taskNameSnapshot}</li>)}</ul></section>)}
      </PfmeaModal> : null}
      {relinkId ? <PfmeaModal title="Review source link" description="Relink this risk to an existing task or step, or archive it. Its analysis will be retained." onClose={() => setRelinkId(undefined)} actions={<><button className="ui-btn-secondary h-9" disabled={readOnly} onClick={() => { setArchiveId(relinkId); setRelinkId(undefined); }}>Archive row</button><button className="ui-btn-primary h-9" disabled={readOnly || !relinkTask} onClick={() => { const row = document.rows.find(row => row.id === relinkId); const task = taskById.get(relinkTask); if (row && task) updateRow(row.id, relinkPfmeaRow(row, task, relinkStep || undefined, zones)); setRelinkId(undefined); }}>Relink</button></>}>
        <div className="ui-pfmea-form-grid"><label><span>Procedure task</span><select aria-label="Relink task" value={relinkTask} onChange={event => { setRelinkTask(event.target.value); setRelinkStep(""); }}><option value="">Choose a task</option>{procedureTaskOptions.map(task => <option key={task.id} value={task.id}>{task.manufacturingCode || task.wbs} · {task.name}</option>)}</select></label>
        <label><span>Process step</span><select aria-label="Relink step" value={relinkStep} onChange={event => setRelinkStep(event.target.value)}><option value="">Task-level risk</option>{taskById.get(relinkTask)?.manufacturingSteps?.map(step => <option key={step.id} value={step.id}>{step.sequence} · {step.name}</option>)}</select></label></div>
      </PfmeaModal> : null}
      {archiveId ? <PfmeaModal title="Archive risk row?" description="Keep the analysis in Archived and remove it from the active register. You can restore it later." onClose={() => setArchiveId(undefined)} actions={<><button className="ui-btn-secondary h-9" onClick={() => setArchiveId(undefined)}>Cancel</button><button className="ui-btn-primary h-9" disabled={readOnly} onClick={() => { updateRow(archiveId, { archivedAt: new Date().toISOString() }); setArchiveId(undefined); }}>Archive</button></>}><p>{document.rows.find(row => row.id === archiveId)?.processStepSnapshot}</p></PfmeaModal> : null}

      {showScoringGuide ? (
        <PfmeaModal
          title="PFMEA scoring guide"
          description="Use consistent judgment across risks. RPN is calculated automatically from Severity × Occurrence × Detection."
          onClose={() => setShowScoringGuide(false)}
          actions={<button type="button" className="ui-btn-primary h-9" onClick={() => setShowScoringGuide(false)}>Done</button>}
        >
          <p className="mb-4 text-xs text-ink-secondary">Tab across · Enter down · F2 or double-click to edit · Alt+Enter for a new line · Esc to revert. Block paste fills editable cells, skipping calculated columns.</p>
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

    </section>
  );
}
