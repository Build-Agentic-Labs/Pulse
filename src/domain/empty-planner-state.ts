import { applyCalculatedFields } from "./calculations";
import type { PlannerState } from "./types";

// A valid but completely empty planner state. Used as the initial React state for the planner (and the
// no-project fallback) so the UI never shows placeholder/demo data before real project data loads.
// All capacity inputs are zero; applyCalculatedFields guards every division, so the derived metrics
// resolve to 0 rather than NaN, and with no stations/tasks the dashboard renders empty.
const EMPTY_PRODUCT_ID = "product-empty";
const EMPTY_SCENARIO_ID = "scenario-empty";
const EPOCH = "1970-01-01T00:00:00.000Z";

const { product } = applyCalculatedFields(
  {
    id: EMPTY_PRODUCT_ID,
    name: "",
    revision: "",
    ownerName: "",
    status: "draft",
    targetManHours: 0,
    demandQuantity: 1,
    demandPeriod: "day",
    grossAvailableMinutes: 0,
    breakMinutes: 0,
    lunchMinutes: 0,
    meetingMinutes: 0,
    plannedDowntimeMinutes: 0,
    workDaysPerWeek: 5,
    workWeeksPerMonth: 4.33,
    availableWorkDaysPerMonth: 0,
    netAvailableMinutes: 0,
    weeklyAvailableMinutes: 0,
    monthlyAvailableMinutes: 0,
    calculatedTaktMinutes: 0,
    activeTaktMinutes: 0,
    createdAt: EPOCH,
    updatedAt: EPOCH,
  },
  [],
  [],
);

export const emptyPlannerState: PlannerState = {
  project: undefined,
  product,
  scenario: {
    id: EMPTY_SCENARIO_ID,
    productId: EMPTY_PRODUCT_ID,
    name: "Current State",
    type: "current_state",
    status: "draft",
    targetOutput: 1,
    targetOutputPeriod: "day",
    createdAt: EPOCH,
    updatedAt: EPOCH,
  },
  stations: [],
  zones: [],
  components: [],
  documentTypes: [],
  tasks: [],
  dependencies: [],
  actualEvents: [],
  customColumns: [],
};
