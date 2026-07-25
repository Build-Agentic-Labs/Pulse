"use client";

import { useEffect, useState } from "react";
import {
  formatResponsiblePersons,
  parseResponsiblePersons,
} from "@/domain/sop/responsible-persons";
import { AutoTextarea } from "./auto-textarea";

/**
 * The responsible-persons roster, edited one entry per line.
 *
 * It owns a local text buffer rather than deriving the textarea's value straight from the array,
 * and that is the whole reason it exists as its own component. The array cannot represent a line
 * the author is part-way through typing: parsing drops blank lines, so feeding
 * `format(parse(text))` back into a controlled textarea erased the newline the instant Enter was
 * pressed and snapped the caret back to the previous line — Enter looked broken.
 *
 * So the buffer holds exactly what was typed, and the array holds only real entries. They are
 * reconciled in one direction: whenever the stored roster stops matching what the buffer parses
 * to, the roster wins and the buffer is replaced.
 */
export function ResponsiblePersonsField({
  entries,
  disabled = false,
  onChange,
}: {
  entries: readonly string[];
  disabled?: boolean;
  onChange: (entries: string[]) => void;
}) {
  const stored = formatResponsiblePersons(entries);
  const [draft, setDraft] = useState(stored);

  useEffect(() => {
    // Compare parsed forms, not raw text: a trailing newline the author just typed parses to the
    // same roster, so their caret is left alone. A roster genuinely replaced from elsewhere
    // (server reload, revert, conflict reload, sample data) does not, and replaces the buffer.
    setDraft((current) => (formatResponsiblePersons(parseResponsiblePersons(current)) === stored ? current : stored));
  }, [stored]);

  return (
    <AutoTextarea
      className="ui-field-standalone min-h-16 py-2"
      aria-label="Responsible persons or roles, one per line"
      placeholder={"e.g. Quality Manager\nProcess Owner"}
      value={draft}
      disabled={disabled}
      onChange={(event) => {
        const next = event.target.value;
        setDraft(next);
        onChange(parseResponsiblePersons(next));
      }}
    />
  );
}
