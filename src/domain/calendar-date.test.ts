import { describe, it, expect } from 'vitest';
import { parseCalendarDate, calendarMonthDays, shiftCalendarMonth } from './calendar-date';
describe('calendar dates', () => {
 it('accepts explicit date formats and rejects rolled-over dates', () => {
  expect(parseCalendarDate('10/30/2026')).toBe('2026-10-30');
  expect(parseCalendarDate('2026-10-30')).toBe('2026-10-30');
  expect(parseCalendarDate('02/29/2024')).toBe('2024-02-29');
  expect(parseCalendarDate('02/29/2026')).toBeUndefined();
  expect(parseCalendarDate('13/01/2026')).toBeUndefined();
  expect(parseCalendarDate('10/3')).toBeUndefined();
 });
 it('builds a six-week calendar across month and year boundaries',()=>{
  const days=calendarMonthDays('2026-01');
  expect(days).toHaveLength(42);expect(days[0].date).toBe('2025-12-28');
  expect(days.filter(d=>d.inMonth)).toHaveLength(31);
  expect(shiftCalendarMonth('2026-01',-1)).toBe('2025-12');
  expect(shiftCalendarMonth('2026-12',1)).toBe('2027-01');
 });
});
