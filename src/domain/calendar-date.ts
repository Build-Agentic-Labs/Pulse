/** Calendar-date entry without timezone shifts or permissive Date string parsing. */
export function parseCalendarDate(input: string): string | undefined {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.trim());
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(input.trim());
  if (!iso && !us) return;
  const [year, month, day] = iso ? iso.slice(1).map(Number) : [Number(us![3]), Number(us![1]), Number(us![2])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (year < 1000 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return;
  return date.toISOString().slice(0, 10);
}
export function shiftCalendarMonth(month: string, offset: number) {
  const [year, number] = month.split('-').map(Number);
  return new Date(Date.UTC(year, number - 1 + offset, 1)).toISOString().slice(0, 7);
}
export function calendarMonthDays(month: string) {
  const [year, number] = month.split('-').map(Number);
  const start = new Date(Date.UTC(year, number - 1, 1));
  const offset = start.getUTCDay();
  return Array.from({length: 42}, (_, index) => {
    const date = new Date(Date.UTC(year, number - 1, index - offset + 1));
    return {date: date.toISOString().slice(0, 10), day: date.getUTCDate(), inMonth: date.getUTCMonth() === number - 1};
  });
}
