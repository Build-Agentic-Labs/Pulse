import { buildStepToolLibrary } from "@/domain/step-tools";
import type { ToolLibraryItem } from "@/domain/supabase-planner";
import { canonicalToolKey } from "@/domain/tool-name-format";
import type { Task } from "@/domain/types";

export type ProjectToolDefinition = {
  id: string;
  name: string;
  color: string;
  colorLabel: string;
  libraryId?: string;
};

const TOOL_COLOR_PALETTE = [
  { hex: "#4A7FC1", label: "Blue" },
  { hex: "#4A9E5C", label: "Green" },
  { hex: "#D4A843", label: "Amber" },
  { hex: "#C45B7A", label: "Rose" },
  { hex: "#7B6BC4", label: "Violet" },
  { hex: "#4AA8A8", label: "Teal" },
  { hex: "#D17B45", label: "Copper" },
  { hex: "#6B7280", label: "Slate" },
] as const;

function formatToolId(sequence: number) {
  return `T${String(sequence).padStart(2, "0")}`;
}

export function buildProjectToolRegistry(
  tasks: Task[],
  libraryItems: ToolLibraryItem[] = [],
): Map<string, ProjectToolDefinition> {
  const libraryByName = new Map(
    libraryItems.map((item) => [canonicalToolKey(item.toolName), item] as const),
  );
  const toolNames = buildStepToolLibrary(tasks);

  return new Map(
    toolNames.map((name, index) => {
      const palette = TOOL_COLOR_PALETTE[index % TOOL_COLOR_PALETTE.length];
      const libraryItem = libraryByName.get(canonicalToolKey(name));

      return [
        canonicalToolKey(name),
        {
          id: formatToolId(index + 1),
          name,
          color: palette.hex,
          colorLabel: palette.label,
          libraryId: libraryItem?.id,
        } satisfies ProjectToolDefinition,
      ] as const;
    }),
  );
}

export function listProjectToolDefinitions(registry: Map<string, ProjectToolDefinition>) {
  return [...registry.values()].sort((left, right) => left.id.localeCompare(right.id));
}

export function resolveProjectTool(toolName: string, registry: Map<string, ProjectToolDefinition>): ProjectToolDefinition {
  const known = registry.get(canonicalToolKey(toolName));
  if (known) {
    return known;
  }

  return {
    id: "—",
    name: toolName.trim(),
    color: "#777777",
    colorLabel: "Unassigned",
  };
}
