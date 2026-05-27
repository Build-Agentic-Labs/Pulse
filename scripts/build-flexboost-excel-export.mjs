import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const backupDir =
  process.argv[2] || path.join(process.cwd(), "backups", "flexboost-2026-05-20T20-33-26-921Z");
const outputPath =
  process.argv[3] || path.join(process.cwd(), "outputs", "flexboost-excel-export", "FlexBoost Editable Export.xlsx");

const source = JSON.parse(await fs.readFile(path.join(backupDir, "structured-flexboost.json"), "utf8"));
const workbook = Workbook.create();

const editableFill = "#FFF7D6";
const lockedFill = "#E8EEF5";
const headerFill = "#17324D";
const headerFont = "#FFFFFF";

function flattenRows() {
  const tasks = [];
  const steps = [];
  const tools = [];
  const photos = [];
  const parts = [];
  const events = [];

  for (const product of source.products ?? []) {
    for (const scenario of product.scenarios ?? []) {
      for (const task of scenario.tasks ?? []) {
        tasks.push({
          project_id: source.project?.id ?? "",
          product_id: product.id,
          product_name: product.name,
          scenario_id: scenario.id,
          scenario_name: scenario.name,
          task_id: task.id,
          wbs: task.wbs,
          manufacturing_code: task.manufacturing_code ?? "",
          component_id: task.component_id ?? "",
          task_number: task.task_number ?? "",
          code_locked: task.code_locked ?? false,
          name: task.name,
          description: task.description ?? "",
          station_id: task.station_id ?? "",
          station_name: task.station?.name ?? "",
          zone_id: task.zone_id ?? "",
          zone_name: task.zone?.name ?? "",
          row_type: task.row_type,
          status: task.status,
          planned_start: task.planned_start,
          planned_finish: task.planned_finish,
          planned_duration_minutes: task.planned_duration_minutes,
          actual_start: task.actual_start ?? "",
          actual_finish: task.actual_finish ?? "",
          actual_duration_minutes: task.actual_duration_minutes ?? "",
          planned_operators: task.planned_operators,
          actual_operators: task.actual_operators ?? "",
          planned_man_hours: task.planned_man_hours,
          actual_man_hours: task.actual_man_hours ?? "",
          role: task.role ?? "",
          owner_name: task.owner_name ?? "",
          tools_required: (task.tools_required ?? []).join(", "),
          equipment_required: (task.equipment_required ?? []).join(", "),
          safety_notes: task.safety_notes ?? "",
          qc_checklist: task.qc_checklist ?? "",
          notes: task.notes ?? "",
          version: task.version ?? "",
        });

        for (const part of task.part_references ?? []) {
          parts.push({
            task_id: task.id,
            wbs: task.wbs,
            manufacturing_code: task.manufacturing_code ?? "",
            task_name: task.name,
            part_id: part.id,
            part_number: part.part_number,
            description: part.description ?? "",
            quantity: part.quantity ?? "",
            disposition: part.disposition ?? "",
            created_at: part.created_at ?? "",
            updated_at: part.updated_at ?? "",
          });
        }

        for (const event of task.actual_events ?? []) {
          events.push({
            task_id: task.id,
            wbs: task.wbs,
            manufacturing_code: task.manufacturing_code ?? "",
            task_name: task.name,
            event_id: event.id,
            event_type: event.event_type,
            timestamp: event.timestamp,
            user_id: event.user_id ?? "",
            notes: event.notes ?? "",
            reason_code: event.reason_code ?? "",
            created_at: event.created_at ?? "",
          });
        }

        for (const step of task.manufacturing_steps ?? []) {
          steps.push({
            product_name: product.name,
            scenario_name: scenario.name,
            task_id: task.id,
            wbs: task.wbs,
            manufacturing_code: task.manufacturing_code ?? "",
            task_name: task.name,
            step_id: step.id,
            sequence: step.sequence,
            instruction: step.instruction ?? "",
            duration_minutes: step.duration_minutes ?? 0,
            quality_check: step.quality_check ?? "",
            dependency_ids: (step.dependency_ids ?? []).join(", "),
            version: step.version ?? "",
            photo_count: (step.photos ?? []).length,
            tool_count: (step.tools ?? []).length,
            created_at: step.created_at ?? "",
            updated_at: step.updated_at ?? "",
          });

          for (const tool of step.tools ?? []) {
            tools.push({
              task_id: task.id,
              wbs: task.wbs,
              manufacturing_code: task.manufacturing_code ?? "",
              task_name: task.name,
              step_id: step.id,
              step_sequence: step.sequence,
              step_tool_id: tool.id,
              sequence: tool.sequence,
              tool_name: tool.tool_name,
              created_at: tool.created_at ?? "",
              updated_at: tool.updated_at ?? "",
            });
          }

          for (const photo of step.photos ?? []) {
            photos.push({
              task_id: task.id,
              wbs: task.wbs,
              manufacturing_code: task.manufacturing_code ?? "",
              task_name: task.name,
              step_id: step.id,
              step_sequence: step.sequence,
              photo_id: photo.id,
              file_name: photo.file_name,
              caption: photo.caption ?? "",
              local_asset: photo.local_asset ?? "",
              storage_path: photo.storage_path,
              public_url: photo.public_url,
              mime_type: photo.mime_type ?? "",
              size_bytes: photo.size_bytes ?? "",
              width: photo.width ?? "",
              height: photo.height ?? "",
              captured_at: photo.captured_at ?? "",
              deleted_at: photo.deleted_at ?? "",
              download_error: photo.download_error ?? "",
            });
          }
        }
      }
    }
  }

  return { tasks, steps, tools, photos, parts, events };
}

function addSheet(name, columns, rows, options = {}) {
  const sheet = workbook.worksheets.add(name);
  sheet.showGridLines = false;

  const matrix = [
    columns.map((column) => column.header),
    ...rows.map((row) => columns.map((column) => row[column.key] ?? "")),
  ];

  sheet.getRangeByIndexes(0, 0, matrix.length, columns.length).values = matrix;
  const used = sheet.getRangeByIndexes(0, 0, Math.max(1, matrix.length), columns.length);
  used.format = {
    font: { name: "Aptos", size: 10, color: "#172033" },
    wrapText: true,
    verticalAlignment: "Top",
  };
  const header = sheet.getRangeByIndexes(0, 0, 1, columns.length);
  header.format = {
    fill: headerFill,
    font: { bold: true, color: headerFont, name: "Aptos", size: 10 },
    horizontalAlignment: "Center",
    verticalAlignment: "Middle",
    wrapText: true,
  };
  header.format.rowHeightPx = 34;

  for (let i = 0; i < columns.length; i += 1) {
    const colRange = sheet.getRangeByIndexes(0, i, Math.max(1, matrix.length), 1);
    colRange.format.columnWidthPx = columns[i].width ?? 130;
    if (columns[i].format) {
      sheet.getRangeByIndexes(1, i, Math.max(1, matrix.length - 1), 1).format.numberFormat = columns[i].format;
    }
    if (columns[i].locked) {
      sheet.getRangeByIndexes(0, i, Math.max(1, matrix.length), 1).format.fill = lockedFill;
    }
    if (columns[i].editable) {
      sheet.getRangeByIndexes(1, i, Math.max(1, matrix.length - 1), 1).format.fill = editableFill;
    }
  }

  if (rows.length) {
    const table = sheet.tables.add(sheet.getRangeByIndexes(0, 0, matrix.length, columns.length), true, options.tableName);
    table.style = "TableStyleMedium2";
    table.showFilterButton = true;
  }
  sheet.freezePanes.freezeRows(1);
  return sheet;
}

const { tasks, steps, tools, photos, parts, events } = flattenRows();

const guide = workbook.worksheets.add("Guide");
guide.showGridLines = false;
guide.getRange("A1:D1").values = [["FlexBoost Editable Export", "", "", ""]];
guide.getRange("A1:D1").merge();
guide.getRange("A1:D1").format = {
  fill: "#17324D",
  font: { bold: true, color: "#FFFFFF", size: 16 },
  verticalAlignment: "Middle",
};
guide.getRange("A1:D1").format.rowHeightPx = 42;
guide.getRange("A3:D12").values = [
  ["Purpose", "Edit process/manufacturing data in Excel, while preserving IDs for import back into Pulse.", "", ""],
  ["Editable columns", "Yellow cells are intended for edits. Blue/gray ID/context columns should stay unchanged.", "", ""],
  ["Import rule", "Do not change *_id columns unless you are intentionally creating importer logic for new records.", "", ""],
  ["Photos", "Photo files are not embedded. Use local_asset for the downloaded backup file and public_url/storage_path for Supabase references.", "", ""],
  ["Generated from", source.metadata?.backupRoot ?? backupDir, "", ""],
  ["Exported at", new Date().toISOString(), "", ""],
  ["Tasks", tasks.length, "", ""],
  ["Manufacturing steps", steps.length, "", ""],
  ["Step tools", tools.length, "", ""],
  ["Step photos", photos.length, "", ""],
];
guide.getRange("A3:A12").format = { font: { bold: true }, fill: "#E8EEF5" };
guide.getRange("B3:D12").format = { wrapText: true };
guide.getRange("A:A").format.columnWidthPx = 160;
guide.getRange("B:D").format.columnWidthPx = 260;

addSheet(
  "Tasks",
  [
    { key: "task_id", header: "task_id", width: 245, locked: true },
    { key: "wbs", header: "wbs", width: 80, locked: true },
    { key: "manufacturing_code", header: "manufacturing_code", width: 140, editable: true },
    { key: "component_id", header: "component_id", width: 190, editable: true },
    { key: "task_number", header: "task_number", width: 105, editable: true, format: "0" },
    { key: "code_locked", header: "code_locked", width: 95, editable: true },
    { key: "name", header: "name", width: 220, editable: true },
    { key: "description", header: "description", width: 300, editable: true },
    { key: "status", header: "status", width: 130, editable: true },
    { key: "station_name", header: "station_name", width: 160, locked: true },
    { key: "zone_name", header: "zone_name", width: 130, locked: true },
    { key: "planned_duration_minutes", header: "planned_duration_minutes", width: 145, editable: true, format: "0.00" },
    { key: "actual_duration_minutes", header: "actual_duration_minutes", width: 145, editable: true, format: "0.00" },
    { key: "planned_start", header: "planned_start", width: 180, editable: true },
    { key: "planned_finish", header: "planned_finish", width: 180, editable: true },
    { key: "actual_start", header: "actual_start", width: 180, editable: true },
    { key: "actual_finish", header: "actual_finish", width: 180, editable: true },
    { key: "planned_operators", header: "planned_operators", width: 135, editable: true, format: "0.00" },
    { key: "actual_operators", header: "actual_operators", width: 135, editable: true, format: "0.00" },
    { key: "role", header: "role", width: 140, editable: true },
    { key: "owner_name", header: "owner_name", width: 160, editable: true },
    { key: "tools_required", header: "tools_required", width: 240, editable: true },
    { key: "equipment_required", header: "equipment_required", width: 240, editable: true },
    { key: "safety_notes", header: "safety_notes", width: 260, editable: true },
    { key: "qc_checklist", header: "qc_checklist", width: 260, editable: true },
    { key: "notes", header: "notes", width: 260, editable: true },
    { key: "scenario_id", header: "scenario_id", width: 210, locked: true },
    { key: "station_id", header: "station_id", width: 210, locked: true },
    { key: "zone_id", header: "zone_id", width: 210, locked: true },
    { key: "version", header: "version", width: 80, locked: true },
  ],
  tasks,
  { tableName: "TasksTable" },
);

addSheet(
  "Manufacturing Steps",
  [
    { key: "step_id", header: "step_id", width: 245, locked: true },
    { key: "task_id", header: "task_id", width: 245, locked: true },
    { key: "wbs", header: "wbs", width: 80, locked: true },
    { key: "manufacturing_code", header: "manufacturing_code", width: 140, locked: true },
    { key: "task_name", header: "task_name", width: 220, locked: true },
    { key: "sequence", header: "sequence", width: 95, editable: true, format: "0" },
    { key: "instruction", header: "instruction", width: 430, editable: true },
    { key: "duration_minutes", header: "duration_minutes", width: 130, editable: true, format: "0.00" },
    { key: "quality_check", header: "quality_check", width: 300, editable: true },
    { key: "dependency_ids", header: "dependency_ids", width: 250, editable: true },
    { key: "photo_count", header: "photo_count", width: 95, locked: true, format: "0" },
    { key: "tool_count", header: "tool_count", width: 95, locked: true, format: "0" },
    { key: "version", header: "version", width: 80, locked: true },
    { key: "created_at", header: "created_at", width: 175, locked: true },
    { key: "updated_at", header: "updated_at", width: 175, locked: true },
  ],
  steps,
  { tableName: "ManufacturingStepsTable" },
);

addSheet(
  "Step Tools",
  [
    { key: "step_tool_id", header: "step_tool_id", width: 260, locked: true },
    { key: "step_id", header: "step_id", width: 245, locked: true },
    { key: "task_id", header: "task_id", width: 245, locked: true },
    { key: "wbs", header: "wbs", width: 80, locked: true },
    { key: "manufacturing_code", header: "manufacturing_code", width: 140, locked: true },
    { key: "task_name", header: "task_name", width: 220, locked: true },
    { key: "step_sequence", header: "step_sequence", width: 100, locked: true, format: "0" },
    { key: "sequence", header: "sequence", width: 95, editable: true, format: "0" },
    { key: "tool_name", header: "tool_name", width: 220, editable: true },
    { key: "created_at", header: "created_at", width: 175, locked: true },
    { key: "updated_at", header: "updated_at", width: 175, locked: true },
  ],
  tools,
  { tableName: "StepToolsTable" },
);

addSheet(
  "Step Photos",
  [
    { key: "photo_id", header: "photo_id", width: 245, locked: true },
    { key: "step_id", header: "step_id", width: 245, locked: true },
    { key: "task_id", header: "task_id", width: 245, locked: true },
    { key: "wbs", header: "wbs", width: 80, locked: true },
    { key: "manufacturing_code", header: "manufacturing_code", width: 140, locked: true },
    { key: "task_name", header: "task_name", width: 220, locked: true },
    { key: "step_sequence", header: "step_sequence", width: 100, locked: true, format: "0" },
    { key: "file_name", header: "file_name", width: 220, editable: true },
    { key: "caption", header: "caption", width: 300, editable: true },
    { key: "local_asset", header: "local_asset", width: 420, locked: true },
    { key: "storage_path", header: "storage_path", width: 480, locked: true },
    { key: "public_url", header: "public_url", width: 480, locked: true },
    { key: "mime_type", header: "mime_type", width: 120, locked: true },
    { key: "size_bytes", header: "size_bytes", width: 105, locked: true, format: "0" },
    { key: "width", header: "width", width: 80, locked: true, format: "0" },
    { key: "height", header: "height", width: 80, locked: true, format: "0" },
    { key: "captured_at", header: "captured_at", width: 175, locked: true },
  ],
  photos,
  { tableName: "StepPhotosTable" },
);

addSheet(
  "Parts",
  [
    { key: "part_id", header: "part_id", width: 245, locked: true },
    { key: "task_id", header: "task_id", width: 245, locked: true },
    { key: "wbs", header: "wbs", width: 80, locked: true },
    { key: "manufacturing_code", header: "manufacturing_code", width: 140, locked: true },
    { key: "task_name", header: "task_name", width: 220, locked: true },
    { key: "part_number", header: "part_number", width: 180, editable: true },
    { key: "description", header: "description", width: 280, editable: true },
    { key: "quantity", header: "quantity", width: 100, editable: true, format: "0.000" },
    { key: "disposition", header: "disposition", width: 180, editable: true },
  ],
  parts,
  { tableName: "PartsTable" },
);

addSheet(
  "Actual Events",
  [
    { key: "event_id", header: "event_id", width: 245, locked: true },
    { key: "task_id", header: "task_id", width: 245, locked: true },
    { key: "wbs", header: "wbs", width: 80, locked: true },
    { key: "manufacturing_code", header: "manufacturing_code", width: 140, locked: true },
    { key: "task_name", header: "task_name", width: 220, locked: true },
    { key: "event_type", header: "event_type", width: 130, editable: true },
    { key: "timestamp", header: "timestamp", width: 175, editable: true },
    { key: "notes", header: "notes", width: 300, editable: true },
    { key: "reason_code", header: "reason_code", width: 160, editable: true },
  ],
  events,
  { tableName: "ActualEventsTable" },
);

addSheet(
  "Tool Library",
  [
    { key: "id", header: "tool_library_id", width: 270, locked: true },
    { key: "project_id", header: "project_id", width: 180, locked: true },
    { key: "tool_name", header: "tool_name", width: 220, editable: true },
    { key: "category", header: "category", width: 160, editable: true },
    { key: "local_asset", header: "local_asset", width: 420, locked: true },
    { key: "storage_path", header: "storage_path", width: 420, locked: true },
    { key: "image_url", header: "image_url", width: 420, locked: true },
  ],
  source.tool_library ?? [],
  { tableName: "ToolLibraryTable" },
);

const preview = await workbook.render({
  sheetName: "Guide",
  autoCrop: "all",
  scale: 1,
  format: "png",
});
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(
  path.join(path.dirname(outputPath), "flexboost-editable-export-guide-preview.png"),
  new Uint8Array(await preview.arrayBuffer()),
);

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 300 },
  summary: "formula error scan",
});
console.log(errors.ndjson);

const file = await SpreadsheetFile.exportXlsx(workbook);
await file.save(outputPath);
console.log(outputPath);
