export const TOOL_TYPE_OPTIONS = [
  { value: "wrench", label: "Wrench" },
  { value: "socket", label: "Socket" },
  { value: "impact", label: "Impact gun" },
  { value: "torque", label: "Torque wrench" },
  { value: "ratchet", label: "Ratchet" },
  { value: "loctite", label: "Loctite / adhesive" },
  { value: "driver", label: "Driver" },
  { value: "plier", label: "Plier" },
  { value: "general", label: "General" },
] as const;

export type ToolTypeValue = (typeof TOOL_TYPE_OPTIONS)[number]["value"];

const TOOL_TYPE_LABEL_BY_VALUE = new Map<string, string>(
  TOOL_TYPE_OPTIONS.map((option) => [option.value, option.label]),
);

export function inferToolType(toolName: string): ToolTypeValue {
  const lowerToolName = toolName.trim().toLocaleLowerCase();

  if (lowerToolName.includes("socket")) {
    return "socket";
  }
  if (lowerToolName.includes("impact")) {
    return "impact";
  }
  if (lowerToolName.includes("torque")) {
    return "torque";
  }
  if (lowerToolName.includes("loctite")) {
    return "loctite";
  }
  if (lowerToolName.includes("ratchet")) {
    return "ratchet";
  }
  if (lowerToolName.includes("driver")) {
    return "driver";
  }
  if (lowerToolName.includes("plier")) {
    return "plier";
  }
  if (lowerToolName.includes("wrench")) {
    return "wrench";
  }

  return "general";
}

export function resolveToolType(toolName: string, category?: string): ToolTypeValue {
  const normalizedCategory = category?.trim().toLocaleLowerCase();
  if (normalizedCategory && TOOL_TYPE_LABEL_BY_VALUE.has(normalizedCategory)) {
    return normalizedCategory as ToolTypeValue;
  }

  return inferToolType(toolName);
}

export function toolTypeLabel(value: string) {
  return TOOL_TYPE_LABEL_BY_VALUE.get(value) ?? value;
}
