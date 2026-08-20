import type { Task } from "./types";

export const STEP_PART_MENTIONS_FIELD = "stepPartMentions";

export interface StepPartMention {
  id: string;
  partReferenceId: string;
  text: string;
  start: number;
  end: number;
}

export type StepPartMentionMap = Record<string, StepPartMention[]>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value : "";
}

function cleanIndex(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function parseMention(value: unknown): StepPartMention | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const id = cleanText(value.id).trim();
  const partReferenceId = cleanText(value.partReferenceId).trim();
  const text = cleanText(value.text);
  const start = cleanIndex(value.start);
  const end = cleanIndex(value.end);

  if (!id || !partReferenceId || !text || start === undefined || end === undefined || end <= start) {
    return undefined;
  }

  return { id, partReferenceId, text, start, end };
}

function normalizeMentions(values: unknown): StepPartMention[] {
  if (!Array.isArray(values)) {
    return [];
  }

  const seenIds = new Set<string>();
  return values
    .map(parseMention)
    .filter((mention): mention is StepPartMention => Boolean(mention))
    .filter((mention) => {
      if (seenIds.has(mention.id)) {
        return false;
      }
      seenIds.add(mention.id);
      return true;
    })
    .sort((left, right) => left.start - right.start || left.end - right.end || left.id.localeCompare(right.id));
}

export function getTaskStepPartMentionMap(task: Pick<Task, "customFields">): StepPartMentionMap {
  const rawMap = task.customFields?.[STEP_PART_MENTIONS_FIELD];
  if (!isRecord(rawMap)) {
    return {};
  }

  return Object.entries(rawMap).reduce<StepPartMentionMap>((map, [stepId, values]) => {
    const mentions = normalizeMentions(values);
    if (mentions.length > 0) {
      map[stepId] = mentions;
    }
    return map;
  }, {});
}

export function getStepPartMentions(task: Pick<Task, "customFields">, stepId: string) {
  return getTaskStepPartMentionMap(task)[stepId] ?? [];
}

export function setStepPartMentions(task: Task, stepId: string, mentions: StepPartMention[]): Task {
  const mentionMap = getTaskStepPartMentionMap(task);
  const nextMap = { ...mentionMap };
  const normalized = normalizeMentions(mentions);

  if (normalized.length > 0) {
    nextMap[stepId] = normalized;
  } else {
    delete nextMap[stepId];
  }

  const customFields = { ...task.customFields };
  if (Object.keys(nextMap).length > 0) {
    customFields[STEP_PART_MENTIONS_FIELD] = nextMap;
  } else {
    delete customFields[STEP_PART_MENTIONS_FIELD];
  }

  return { ...task, customFields };
}

export function addStepPartMention(
  task: Task,
  stepId: string,
  instruction: string,
  mention: Omit<StepPartMention, "text">,
): Task | null {
  const selectedText = instruction.slice(mention.start, mention.end);
  if (
    !selectedText.trim() ||
    mention.end <= mention.start ||
    !(task.partReferences ?? []).some((part) => part.id === mention.partReferenceId)
  ) {
    return null;
  }

  const nextMention: StepPartMention = { ...mention, text: selectedText };
  const existing = getStepPartMentions(task, stepId).filter(
    (candidate) => candidate.end <= nextMention.start || candidate.start >= nextMention.end,
  );
  return setStepPartMentions(task, stepId, [...existing, nextMention]);
}

export function removeStepPartMention(task: Task, stepId: string, mentionId: string) {
  return setStepPartMentions(
    task,
    stepId,
    getStepPartMentions(task, stepId).filter((mention) => mention.id !== mentionId),
  );
}

export function removePartReferenceMentions(task: Task, partReferenceId: string) {
  const mentionMap = getTaskStepPartMentionMap(task);
  return Object.entries(mentionMap).reduce(
    (nextTask, [stepId, mentions]) =>
      setStepPartMentions(
        nextTask,
        stepId,
        mentions.filter((mention) => mention.partReferenceId !== partReferenceId),
      ),
    task,
  );
}

export function removeStepPartReferenceMentions(task: Task, stepId: string, partReferenceId: string) {
  return setStepPartMentions(
    task,
    stepId,
    getStepPartMentions(task, stepId).filter((mention) => mention.partReferenceId !== partReferenceId),
  );
}

function occurrenceStarts(text: string, needle: string) {
  const starts: number[] = [];
  let fromIndex = 0;
  while (fromIndex <= text.length - needle.length) {
    const index = text.indexOf(needle, fromIndex);
    if (index < 0) {
      break;
    }
    starts.push(index);
    fromIndex = index + Math.max(needle.length, 1);
  }
  return starts;
}

function relocationScore(
  candidateStart: number,
  mention: StepPartMention,
  previousInstruction: string,
  nextInstruction: string,
) {
  const contextLength = 24;
  const previousPrefix = previousInstruction.slice(Math.max(0, mention.start - contextLength), mention.start);
  const previousSuffix = previousInstruction.slice(mention.end, mention.end + contextLength);
  const candidatePrefix = nextInstruction.slice(Math.max(0, candidateStart - contextLength), candidateStart);
  const candidateEnd = candidateStart + mention.text.length;
  const candidateSuffix = nextInstruction.slice(candidateEnd, candidateEnd + contextLength);
  const prefixBonus = previousPrefix && candidatePrefix.endsWith(previousPrefix) ? 10_000 : 0;
  const suffixBonus = previousSuffix && candidateSuffix.startsWith(previousSuffix) ? 10_000 : 0;
  return prefixBonus + suffixBonus - Math.abs(candidateStart - mention.start);
}

function changedRange(previousInstruction: string, nextInstruction: string) {
  let start = 0;
  while (
    start < previousInstruction.length &&
    start < nextInstruction.length &&
    previousInstruction[start] === nextInstruction[start]
  ) {
    start += 1;
  }

  let previousEnd = previousInstruction.length;
  let nextEnd = nextInstruction.length;
  while (
    previousEnd > start &&
    nextEnd > start &&
    previousInstruction[previousEnd - 1] === nextInstruction[nextEnd - 1]
  ) {
    previousEnd -= 1;
    nextEnd -= 1;
  }

  return { start, previousEnd };
}

/**
 * Rebase text links when surrounding instruction text changes. If the linked
 * phrase itself no longer exists, drop its mapping while leaving the step part
 * allocation intact.
 */
export function reconcileStepPartMentionsAfterInstructionChange(
  task: Task,
  stepId: string,
  previousInstruction: string,
  nextInstruction: string,
) {
  const mentions = getStepPartMentions(task, stepId);
  if (mentions.length === 0 || previousInstruction === nextInstruction) {
    return task;
  }

  const change = changedRange(previousInstruction, nextInstruction);
  const relocated = mentions.flatMap((mention) => {
    const insertionInsideMention =
      change.start === change.previousEnd && change.start > mention.start && change.start < mention.end;
    const replacementTouchesMention = change.start < mention.end && change.previousEnd > mention.start;
    if (insertionInsideMention || replacementTouchesMention) {
      return [];
    }

    if (nextInstruction.slice(mention.start, mention.end) === mention.text) {
      return [mention];
    }

    const starts = occurrenceStarts(nextInstruction, mention.text);
    if (starts.length === 0) {
      return [];
    }

    const start = starts.reduce((best, candidate) =>
      relocationScore(candidate, mention, previousInstruction, nextInstruction) >
      relocationScore(best, mention, previousInstruction, nextInstruction)
        ? candidate
        : best,
    );
    return [{ ...mention, start, end: start + mention.text.length }];
  });

  return setStepPartMentions(task, stepId, relocated);
}

export function numberedStepPartMentions(task: Pick<Task, "customFields">, stepId: string) {
  return getStepPartMentions(task, stepId).map((mention, index) => ({ ...mention, marker: index + 1 }));
}

export function instructionWithPartMentionMarkers(task: Pick<Task, "customFields">, stepId: string, instruction: string) {
  const mentions = numberedStepPartMentions(task, stepId).filter(
    (mention) => instruction.slice(mention.start, mention.end) === mention.text,
  );

  return [...mentions]
    .sort((left, right) => right.start - left.start)
    .reduce(
      (markedInstruction, mention) =>
        `${markedInstruction.slice(0, mention.end)}[${mention.marker}]${markedInstruction.slice(mention.end)}`,
      instruction,
    );
}
