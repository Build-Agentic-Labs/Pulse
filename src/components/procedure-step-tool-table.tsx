"use client";

import { Trash2 } from "lucide-react";
import { resolveProjectTool, type ProjectToolDefinition } from "@/domain/tool-registry";

export function ProcedureStepToolTable({
  tools,
  registry,
  onRemove,
  removeAriaLabel,
}: {
  tools: string[];
  registry: Map<string, ProjectToolDefinition>;
  onRemove: (toolName: string) => void;
  removeAriaLabel?: (toolName: string) => string;
}) {
  if (tools.length === 0) {
    return null;
  }

  return (
    <div className="ui-procedure-tool-table-wrap">
      <table className="ui-procedure-tool-table">
        <thead>
          <tr>
            <th className="ui-procedure-tool-table-head w-[72px]">Tool ID</th>
            <th className="ui-procedure-tool-table-head">Tool name</th>
            <th className="ui-procedure-tool-table-head w-[132px]">Color</th>
            <th className="ui-procedure-tool-table-head w-8" aria-hidden="true" />
          </tr>
        </thead>
        <tbody>
          {tools.map((toolName) => {
            const tool = resolveProjectTool(toolName, registry);

            return (
              <tr key={toolName} className="ui-procedure-tool-table-row group">
                <td className="ui-procedure-tool-table-cell font-mono text-[11px] tabular-nums text-ink-secondary">
                  {tool.id}
                </td>
                <td className="ui-procedure-tool-table-cell text-[12px] text-ink">{tool.name}</td>
                <td className="ui-procedure-tool-table-cell">
                  <span className="inline-flex min-w-0 items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full border border-line/70"
                      style={{ backgroundColor: tool.color }}
                      aria-hidden="true"
                    />
                    <span className="truncate text-[11px] text-ink-secondary">{tool.colorLabel}</span>
                  </span>
                </td>
                <td className="ui-procedure-tool-table-cell text-right">
                  <button
                    type="button"
                    onClick={() => onRemove(toolName)}
                    className="ui-procedure-tool-table-remove"
                    aria-label={removeAriaLabel?.(toolName) ?? `Remove ${toolName}`}
                    title={removeAriaLabel?.(toolName) ?? `Remove ${toolName}`}
                  >
                    <Trash2 size={10} />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ProcedureToolRegistryTable({
  tools,
}: {
  tools: ProjectToolDefinition[];
}) {
  if (tools.length === 0) {
    return (
      <div className="ui-procedure-empty">
        Tools added to procedure steps will appear here with stable project IDs and colors.
      </div>
    );
  }

  return (
    <div className="ui-procedure-tool-table-wrap">
      <table className="ui-procedure-tool-table">
        <thead>
          <tr>
            <th className="ui-procedure-tool-table-head w-[72px]">Tool ID</th>
            <th className="ui-procedure-tool-table-head">Tool name</th>
            <th className="ui-procedure-tool-table-head w-[132px]">Color</th>
          </tr>
        </thead>
        <tbody>
          {tools.map((tool) => (
            <tr key={tool.id} className="ui-procedure-tool-table-row">
              <td className="ui-procedure-tool-table-cell font-mono text-[11px] tabular-nums text-ink-secondary">
                {tool.id}
              </td>
              <td className="ui-procedure-tool-table-cell text-[12px] text-ink">{tool.name}</td>
              <td className="ui-procedure-tool-table-cell">
                <span className="inline-flex min-w-0 items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full border border-line/70"
                    style={{ backgroundColor: tool.color }}
                    aria-hidden="true"
                  />
                  <span className="truncate text-[11px] text-ink-secondary">{tool.colorLabel}</span>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
