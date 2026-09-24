"use client";

import { type ReactNode, type RefObject, useCallback, useLayoutEffect, useRef, useState } from "react";

export interface MarginNote {
  key: string;
  /** Review category whose section the note sits beside (`data-review-category`). */
  category: string;
  node: ReactNode;
}

const GAP_PX = 10;

/**
 * Comments in the margin: each note is pinned level with the first element of its section in the
 * rendered pages, pushed down only as far as needed to clear the note above it. Positions follow
 * the document (re-pagination, zoom) and the notes themselves (a card expanding into an editor).
 */
export function MarginNotesColumn({
  notes,
  pagesRef,
}: {
  notes: MarginNote[];
  pagesRef: RefObject<HTMLElement | null>;
}) {
  const columnRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  const [tops, setTops] = useState<Record<string, number>>({});

  const layout = useCallback(() => {
    const column = columnRef.current;
    const pages = pagesRef.current;
    if (!column || !pages) return;
    const origin = column.getBoundingClientRect().top;
    const desired = notes.map((note) => {
      const anchor = pages.querySelector<HTMLElement>(`[data-review-category="${note.category}"]`);
      return { key: note.key, top: anchor ? anchor.getBoundingClientRect().top - origin : 0 };
    });
    desired.sort((left, right) => left.top - right.top);
    const next: Record<string, number> = {};
    let floor = 0;
    for (const entry of desired) {
      const top = Math.max(entry.top, floor);
      next[entry.key] = Math.round(top);
      floor = top + (cardRefs.current.get(entry.key)?.offsetHeight ?? 0) + GAP_PX;
    }
    setTops((current) => {
      const same =
        Object.keys(next).length === Object.keys(current).length &&
        Object.entries(next).every(([key, value]) => current[key] === value);
      return same ? current : next;
    });
  }, [notes, pagesRef]);

  useLayoutEffect(() => {
    layout();
    const observer = new ResizeObserver(() => layout());
    if (pagesRef.current) observer.observe(pagesRef.current);
    for (const card of cardRefs.current.values()) observer.observe(card);
    return () => observer.disconnect();
  }, [layout, pagesRef]);

  const height = Math.max(
    0,
    ...notes.map((note) => (tops[note.key] ?? 0) + (cardRefs.current.get(note.key)?.offsetHeight ?? 0)),
  );

  return (
    <div ref={columnRef} className="sop-margin-notes" style={{ minHeight: height }}>
      {notes.map((note) => (
        <div
          key={note.key}
          ref={(element) => {
            if (element) cardRefs.current.set(note.key, element);
            else cardRefs.current.delete(note.key);
          }}
          className="sop-margin-note"
          style={{ top: tops[note.key] ?? 0 }}
        >
          {note.node}
        </div>
      ))}
    </div>
  );
}
