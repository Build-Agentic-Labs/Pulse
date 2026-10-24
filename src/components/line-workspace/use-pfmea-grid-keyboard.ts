'use client';

import { useRef, type FocusEvent, type KeyboardEvent, type MouseEvent } from 'react';

type Editor = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
function editor(target: EventTarget | null): Editor | undefined {
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) return;
  if (target.disabled || ('readOnly' in target && target.readOnly)) return;
  return target.closest('tbody tr[data-pfmea-row]') ? target : undefined;
}

/** Event delegation keeps keyboard focus out of memoized row render state. */
export function usePfmeaGridKeyboard(callbacks: { begin: (row: string) => void; cancel: (row: string) => void; leave: () => void; commit?: () => void }) {
  const active = useRef<Editor | undefined>(undefined);
  const editing = useRef(false);
  function setEditing(value: boolean) {
    editing.current = value;
    if (active.current) active.current.dataset.pfmeaEditing = String(value);
  }
  function focus(event: FocusEvent<HTMLDivElement>) {
    const cell = editor(event.target);
    if (!cell) return;
    if (active.current && active.current !== cell) delete active.current.dataset.pfmeaActive;
    active.current = cell;
    cell.dataset.pfmeaActive = 'true';
    setEditing(false);
    callbacks.begin(cell.closest<HTMLElement>('tr')!.dataset.pfmeaRow!);
    if (cell instanceof HTMLTextAreaElement || (cell instanceof HTMLInputElement && cell.type === 'number')) cell.select();
  }
  function blur(event: FocusEvent<HTMLDivElement>) {
    if (editor(event.target)) callbacks.commit?.();
    if (event.currentTarget.contains(event.relatedTarget as Node | null) && editor(event.relatedTarget)) return;
    if (active.current) { delete active.current.dataset.pfmeaActive; delete active.current.dataset.pfmeaEditing; }
    active.current = undefined;
    setEditing(false);
    callbacks.leave();
  }
  function mouseDown(event: MouseEvent<HTMLDivElement>) {
    const cell = editor(event.target);
    if (!cell || cell instanceof HTMLSelectElement || (cell instanceof HTMLInputElement && (cell.type === 'date' || cell.dataset.pfmeaField === 'targetDate')) || editing.current) return;
    if (event.detail > 1) { setEditing(true); return; }
    event.preventDefault();
    cell.focus();
    cell.select();
  }
  function click(event: MouseEvent<HTMLDivElement>) {
    const cell = editor(event.target);
    if (cell instanceof HTMLSelectElement || (cell instanceof HTMLInputElement && (cell.type === 'date' || cell.dataset.pfmeaField === 'targetDate'))) setEditing(true);
  }
  function doubleClick(event: MouseEvent<HTMLDivElement>) { if (editor(event.target)) setEditing(true); }
  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    const cell = editor(event.target);
    if (!cell || event.nativeEvent.isComposing || event.key === 'Process') return;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation();
      callbacks.cancel(cell.closest<HTMLElement>('tr')!.dataset.pfmeaRow!);
      setEditing(false);
      if (cell instanceof HTMLTextAreaElement || (cell instanceof HTMLInputElement && cell.type === 'number')) cell.select();
      return;
    }
    if (event.key === 'F2') { event.preventDefault(); setEditing(true); if (cell instanceof HTMLTextAreaElement) cell.setSelectionRange(cell.value.length,cell.value.length); return; }
    if (event.altKey && event.key === 'Enter' && cell instanceof HTMLTextAreaElement) { setEditing(true); return; }
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (!editing.current && event.key === 'Enter' && (cell instanceof HTMLSelectElement || (cell instanceof HTMLInputElement && (cell.type === 'date' || cell.dataset.pfmeaField === 'targetDate')))) { event.preventDefault(); setEditing(true); return; }
    const horizontal = event.key === 'Tab' || (!editing.current && ['ArrowLeft','ArrowRight'].includes(event.key));
    const vertical = event.key === 'Enter' || (!editing.current && ['ArrowUp','ArrowDown'].includes(event.key));
    if (!horizontal && !vertical) { if (event.key.length === 1 || ['Backspace','Delete'].includes(event.key)) setEditing(true); return; }
    const table = cell.closest('table')!;
    const view = table.dataset.columnView;
    const cells = Array.from(table.querySelectorAll<Editor>('tbody textarea,tbody input,tbody select')).filter(candidate => {
      if (!editor(candidate)) return false;
      const column = candidate.closest('td')?.dataset.pfmeaColumn;
      return !(view === 'risk' && column === 'action') && !(view === 'actions' && column === 'risk-detail');
    });
    let next: Editor | undefined;
    const backwards = event.shiftKey || event.key === 'ArrowLeft' || event.key === 'ArrowUp';
    if (horizontal) next = cells[cells.indexOf(cell) + (backwards ? -1 : 1)];
    else {
      const row = cell.closest('tr')!;
      // Fields have stable semantic IDs; grouped rowSpan cells never affect coordinates.
      const field = cell.dataset.pfmeaField;
      const rows = Array.from(table.querySelectorAll('tbody tr[data-pfmea-row]'));
      for (let index = rows.indexOf(row)+(backwards?-1:1); index >= 0 && index < rows.length; index += backwards?-1:1) {
        next = cells.find(candidate => candidate.closest('tr') === rows[index] && candidate.dataset.pfmeaField === field);
        if (next) break;
      }
    }
    // At either Tab edge, allow normal keyboard exit from the grid.
    if (!next && event.key === 'Tab') return;
    event.preventDefault();
    setEditing(false);
    if (!next) { callbacks.begin(cell.closest<HTMLElement>('tr')!.dataset.pfmeaRow!); return; }
    next.focus({preventScroll:true});
    next.scrollIntoView?.({block:'nearest',inline:'nearest'});
  }
  return { onFocusCapture: focus, onBlurCapture: blur, onMouseDown: mouseDown, onClick: click, onDoubleClick: doubleClick, onKeyDown: keyDown };
}
