"use client";

import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState, type InputHTMLAttributes } from "react";
import { calendarMonthDays, parseCalendarDate, shiftCalendarMonth } from "@/domain/calendar-date";
import { formatDate } from "@/domain/formatting";
import { ModalSurface } from "./modal-surface";
import "./date-picker.css";

type DatePickerProps = {
  value?: string;
  onChange: (value: string | undefined) => void;
  label: string;
  readOnly?: boolean;
  inputClassName?: string;
  inputProps?: InputHTMLAttributes<HTMLInputElement> & { [key: `data-${string}`]: string | undefined };
};
function todayDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Uses the app's modal layer so the anchored calendar also works in fullscreen. */
export function DatePicker({ value, onChange, label, readOnly, inputClassName, inputProps }: DatePickerProps) {
  const [draft, setDraft] = useState(() => formatDate(value));
  const [invalid, setInvalid] = useState(false);
  const [popup, setPopup] = useState<{left: number; top: number} | null>(null);
  const [month, setMonth] = useState(() => (value || todayDate()).slice(0, 7));
  const input = useRef<HTMLInputElement>(null);
  const today = todayDate();
  useEffect(() => { setDraft(formatDate(value)); setInvalid(false); }, [value]);
  function choose(date?: string) {
    onChange(date); setDraft(formatDate(date)); setInvalid(false); setPopup(null);
  }
  function open() {
    const bounds = input.current?.getBoundingClientRect();
    if (!bounds) return;
    setMonth((value || today).slice(0, 7));
    setPopup({ left: Math.max(8, Math.min(bounds.left, window.innerWidth - 288)), top: bounds.bottom + 332 < window.innerHeight ? bounds.bottom + 6 : Math.max(8, bounds.top - 332) });
  }
  return <>
    <div className="ui-date-picker-field">
      <input {...inputProps} ref={input} aria-label={label} className={inputClassName} type="text" inputMode="numeric" placeholder="MM/DD/YYYY" title={invalid ? "Enter a valid date as MM/DD/YYYY or YYYY-MM-DD." : "MM/DD/YYYY or YYYY-MM-DD"} value={draft} readOnly={readOnly} aria-invalid={invalid || undefined}
        onChange={event => {
          const text = event.target.value;
          setDraft(text); setInvalid(false);
          if (!text.trim()) { onChange(undefined); return; }
          const date = parseCalendarDate(text);
          if (date) onChange(date);
        }}
        onBlur={() => setInvalid(Boolean(draft.trim() && !parseCalendarDate(draft)))} />
      {!readOnly ? <button type="button" className="ui-date-picker-trigger" aria-label={`Choose ${label.toLowerCase()}`} title="Choose date" aria-haspopup="dialog" aria-expanded={Boolean(popup)} onClick={open}><CalendarDays size={13} aria-hidden="true" /></button> : null}
    </div>
    {popup ? <ModalSurface label={`Choose ${label.toLowerCase()}`} onCancel={() => setPopup(null)}>
      <div className="ui-date-picker-backdrop" onClick={event => { if (event.target === event.currentTarget) setPopup(null); }}>
        <section className="ui-date-picker-calendar" style={popup} aria-label="Calendar">
          <header>
            <button type="button" className="ui-btn-ghost" aria-label="Previous month" onClick={() => setMonth(current => shiftCalendarMonth(current, -1))}><ChevronLeft size={15} aria-hidden="true" /></button>
            <strong aria-live="polite">{new Date(`${month}-01T12:00:00`).toLocaleDateString(undefined, {month:'long',year:'numeric'})}</strong>
            <button type="button" className="ui-btn-ghost" aria-label="Next month" onClick={() => setMonth(current => shiftCalendarMonth(current, 1))}><ChevronRight size={15} aria-hidden="true" /></button>
          </header>
          <div className="ui-date-picker-days" onKeyDown={event => {
            const target = event.target as HTMLElement;
            const date = target.dataset.date;
            const delta = {ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7}[event.key];
            if (!date || delta == null) return;
            event.preventDefault();
            const days = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-date]'));
            const next = days[days.indexOf(target as HTMLButtonElement) + delta];
            next?.focus();
          }}>
            {['Su','Mo','Tu','We','Th','Fr','Sa'].map(day => <span key={day} aria-hidden="true">{day}</span>)}
            {calendarMonthDays(month).map(day => <button type="button" key={day.date} data-date={day.date} data-outside={!day.inMonth || undefined} data-selected={day.date === value || undefined} data-modal-initial-focus={day.date === (value || today) || undefined} aria-label={`Choose ${formatDate(day.date)}`} aria-pressed={day.date === value} onClick={() => choose(day.date)}>{day.day}</button>)}
          </div>
          <footer><button type="button" className="ui-btn-ghost" onClick={() => choose(today)}>Today</button><button type="button" className="ui-btn-ghost" onClick={() => choose(undefined)}>Clear</button></footer>
        </section>
      </div>
    </ModalSurface> : null}
  </>;
}
