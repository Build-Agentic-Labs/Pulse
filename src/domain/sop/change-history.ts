import {
  SOP_STATUS_LABELS,
  type Sop,
  type SopChangeEntry,
  type SopStatus,
} from "./schema";

export type SopChangeActor = {
  name: string;
  position: string;
};

function todayIso(): string {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function initialDraftChangeEntry(
  version: string,
  actor: SopChangeActor,
  date = todayIso(),
): SopChangeEntry {
  return {
    version,
    changes: "Initial draft created.",
    createdByName: actor.name,
    createdByPosition: actor.position,
    createdByDate: date,
  };
}

export function lifecycleChangeEntry(
  sop: Sop,
  from: SopStatus,
  actor: SopChangeActor,
  date = todayIso(),
): SopChangeEntry {
  return {
    version: sop.meta.version,
    changes: `Status changed from ${SOP_STATUS_LABELS[from]} to ${SOP_STATUS_LABELS[sop.status]}.`,
    createdByName: actor.name,
    createdByPosition: actor.position,
    createdByDate: date,
  };
}

export function sameChangeEntry(left: SopChangeEntry, right: SopChangeEntry): boolean {
  return (
    left.version === right.version &&
    left.changes === right.changes &&
    left.createdByName === right.createdByName &&
    left.createdByPosition === right.createdByPosition &&
    left.createdByDate === right.createdByDate
  );
}
