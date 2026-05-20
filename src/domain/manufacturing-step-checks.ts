export const manufacturingStepCheckOptions = [
  { key: "work_instruction", label: "Work instruction" },
  { key: "self_qc", label: "Self QC" },
  { key: "qc", label: "QC" },
  { key: "critical", label: "Critical" },
  { key: "torque_required", label: "Torque required" },
  { key: "loctite", label: "Loctite" },
] as const;

export type ManufacturingStepCheckKey = (typeof manufacturingStepCheckOptions)[number]["key"];

export function normalizeManufacturingStepCheck(value: string) {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export function getManufacturingStepCheckSet(value?: string) {
  const normalizedValues = new Set(
    (value ?? "")
      .split(",")
      .map(normalizeManufacturingStepCheck)
      .filter(Boolean),
  );
  const selected = new Set<ManufacturingStepCheckKey>();

  manufacturingStepCheckOptions.forEach((option) => {
    if (normalizedValues.has(option.key) || normalizedValues.has(normalizeManufacturingStepCheck(option.label))) {
      selected.add(option.key);
    }
  });

  return selected;
}

export function serializeManufacturingStepCheckSet(selected: ReadonlySet<string>) {
  return manufacturingStepCheckOptions
    .filter((option) => selected.has(option.key))
    .map((option) => option.label)
    .join(", ");
}
