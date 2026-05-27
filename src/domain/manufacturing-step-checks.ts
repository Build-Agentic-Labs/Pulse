export type ManufacturingStepCheckInputType = "checkbox" | "number";

export interface ManufacturingStepCheckDefinition {
  key: string;
  label: string;
  enabled: boolean;
  inputType: ManufacturingStepCheckInputType;
  defaultUnit?: string;
  unitOptions?: string[];
}

export interface ManufacturingStepCheckValue {
  value?: number;
  unit?: string;
}

export interface ManufacturingStepCheckState {
  selected: Set<string>;
  values: Record<string, ManufacturingStepCheckValue>;
}

export const PRODUCT_STEP_CHECK_CONFIG_FIELD = "procedureStepChecks";

export const defaultManufacturingStepCheckDefinitions: ManufacturingStepCheckDefinition[] = [
  { key: "work_instruction", label: "Work instruction", enabled: true, inputType: "checkbox" },
  { key: "self_qc", label: "Self QC", enabled: true, inputType: "checkbox" },
  { key: "qc", label: "QC", enabled: true, inputType: "checkbox" },
  { key: "critical", label: "Critical", enabled: true, inputType: "checkbox" },
  {
    key: "torque_required",
    label: "Torque required",
    enabled: true,
    inputType: "number",
    defaultUnit: "Nm",
    unitOptions: ["Nm", "ft-lb"],
  },
  { key: "loctite", label: "Loctite", enabled: true, inputType: "checkbox" },
];

export const manufacturingStepCheckOptions = defaultManufacturingStepCheckDefinitions;

export type ManufacturingStepCheckKey = string;

export function normalizeManufacturingStepCheck(value: string) {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeDefinition(definition: unknown, fallback?: ManufacturingStepCheckDefinition): ManufacturingStepCheckDefinition | undefined {
  if (!isRecord(definition)) {
    return fallback;
  }

  const key = typeof definition.key === "string" ? normalizeManufacturingStepCheck(definition.key) : fallback?.key;
  if (!key) {
    return undefined;
  }

  const inputType = definition.inputType === "number" || definition.inputType === "checkbox"
    ? definition.inputType
    : fallback?.inputType ?? "checkbox";
  const unitOptions = Array.isArray(definition.unitOptions)
    ? definition.unitOptions.filter((unit): unit is string => typeof unit === "string" && unit.trim().length > 0)
    : fallback?.unitOptions;
  const defaultUnit = typeof definition.defaultUnit === "string"
    ? definition.defaultUnit
    : fallback?.defaultUnit ?? unitOptions?.[0];

  return {
    key,
    label: typeof definition.label === "string" && definition.label.trim() ? definition.label.trim() : fallback?.label ?? key,
    enabled: typeof definition.enabled === "boolean" ? definition.enabled : fallback?.enabled ?? true,
    inputType,
    defaultUnit,
    unitOptions,
  };
}

export function getManufacturingStepCheckDefinitions(customFields?: Record<string, unknown>) {
  const rawDefinitions = customFields?.[PRODUCT_STEP_CHECK_CONFIG_FIELD];
  const configuredDefinitions = Array.isArray(rawDefinitions) ? rawDefinitions : [];
  const configuredByKey = new Map(
    configuredDefinitions
      .map((definition) => normalizeDefinition(definition))
      .filter((definition): definition is ManufacturingStepCheckDefinition => Boolean(definition))
      .map((definition) => [definition.key, definition]),
  );

  const mergedDefinitions = defaultManufacturingStepCheckDefinitions.map((defaultDefinition) =>
    normalizeDefinition(configuredByKey.get(defaultDefinition.key), defaultDefinition) ?? defaultDefinition,
  );
  const customDefinitions = [...configuredByKey.values()].filter(
    (definition) => !defaultManufacturingStepCheckDefinitions.some((defaultDefinition) => defaultDefinition.key === definition.key),
  );

  return [...mergedDefinitions, ...customDefinitions];
}

export function serializeManufacturingStepCheckDefinitions(definitions: ManufacturingStepCheckDefinition[]) {
  return definitions.map((definition) => ({
    key: normalizeManufacturingStepCheck(definition.key),
    label: definition.label.trim() || definition.key,
    enabled: definition.enabled,
    inputType: definition.inputType,
    defaultUnit: definition.defaultUnit,
    unitOptions: definition.unitOptions,
  }));
}

export function getManufacturingStepCheckState(
  value?: string,
  definitions: ManufacturingStepCheckDefinition[] = defaultManufacturingStepCheckDefinitions,
): ManufacturingStepCheckState {
  if (value?.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (isRecord(parsed)) {
        const selected = new Set(
          (Array.isArray(parsed.selected) ? parsed.selected : [])
            .filter((item): item is string => typeof item === "string")
            .map(normalizeManufacturingStepCheck),
        );
        const rawValues = isRecord(parsed.values) ? parsed.values : {};
        const values = Object.entries(rawValues).reduce<Record<string, ManufacturingStepCheckValue>>((accumulator, [key, rawValue]) => {
          if (!isRecord(rawValue)) {
            return accumulator;
          }

          const numericValue = typeof rawValue.value === "number"
            ? rawValue.value
            : typeof rawValue.value === "string" && rawValue.value.trim() !== ""
              ? Number(rawValue.value)
              : undefined;
          accumulator[normalizeManufacturingStepCheck(key)] = {
            value: Number.isFinite(numericValue) ? numericValue : undefined,
            unit: typeof rawValue.unit === "string" ? rawValue.unit : undefined,
          };
          return accumulator;
        }, {});

        return { selected, values };
      }
    } catch {
      // Fall back to legacy comma-separated parsing below.
    }
  }

  const normalizedValues = new Set(
    (value ?? "")
      .split(",")
      .map(normalizeManufacturingStepCheck)
      .filter(Boolean),
  );
  const selected = new Set<string>();

  definitions.forEach((option) => {
    if (normalizedValues.has(option.key) || normalizedValues.has(normalizeManufacturingStepCheck(option.label))) {
      selected.add(option.key);
    }
  });

  return { selected, values: {} };
}

export function getManufacturingStepCheckSet(
  value?: string,
  definitions: ManufacturingStepCheckDefinition[] = defaultManufacturingStepCheckDefinitions,
) {
  return getManufacturingStepCheckState(value, definitions).selected;
}

export function serializeManufacturingStepCheckState(
  state: ManufacturingStepCheckState,
  definitions: ManufacturingStepCheckDefinition[] = defaultManufacturingStepCheckDefinitions,
) {
  const enabledKeys = new Set(definitions.filter((definition) => definition.enabled).map((definition) => definition.key));
  const selected = definitions
    .filter((definition) => enabledKeys.has(definition.key) && state.selected.has(definition.key))
    .map((definition) => definition.key);
  const values = Object.entries(state.values).reduce<Record<string, ManufacturingStepCheckValue>>((accumulator, [key, value]) => {
    if (!enabledKeys.has(key) || !state.selected.has(key)) {
      return accumulator;
    }

    accumulator[key] = value;
    return accumulator;
  }, {});

  return JSON.stringify({ version: 1, selected, values });
}

export function serializeManufacturingStepCheckSet(
  selected: ReadonlySet<string>,
  definitions: ManufacturingStepCheckDefinition[] = defaultManufacturingStepCheckDefinitions,
) {
  return serializeManufacturingStepCheckState({ selected: new Set(selected), values: {} }, definitions);
}
