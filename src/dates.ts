import type { Recurrence, Weekday } from './types';

/** JS Date.getDay() 순서 */
export const WEEKDAY_CODES: Weekday[] = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export const addDays = (d: Date, n: number) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());

export const addMinutes = (d: Date, n: number) => new Date(d.getTime() + n * 60_000);

/** 그 날 0시 + minutes (1440 이상이면 다음 날로 넘어감) */
export const atMinutes = (day: Date, minutes: number) =>
  new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minutes);

/** 월요일 시작 주의 월요일 */
export const mondayOf = (d: Date) => addDays(startOfDay(d), -((d.getDay() + 6) % 7));

/** from 당일을 포함해 가장 가까운 해당 요일 */
export const nextWeekday = (from: Date, weekday: number) => {
  const base = startOfDay(from);
  return addDays(base, (weekday - base.getDay() + 7) % 7);
};

export const lastDayOfMonth = (year: number, month0: number) => new Date(year, month0 + 1, 0);

/** n번째 요일 (n = -1이면 마지막). 그 달에 없으면 null */
export function nthWeekdayOfMonth(year: number, month0: number, weekday: number, n: number): Date | null {
  if (n < 0) {
    const last = lastDayOfMonth(year, month0);
    return new Date(year, month0, last.getDate() - ((last.getDay() - weekday + 7) % 7));
  }
  const first = new Date(year, month0, 1);
  const d = new Date(year, month0, 1 + ((weekday - first.getDay() + 7) % 7) + (n - 1) * 7);
  return d.getMonth() === month0 ? d : null;
}

function occursOn(r: Recurrence, d: Date, anchor: Date): boolean {
  switch (r.freq) {
    case 'DAILY':
      return true;
    case 'WEEKLY':
      return r.byDay ? r.byDay.includes(WEEKDAY_CODES[d.getDay()]) : d.getDay() === anchor.getDay();
    case 'MONTHLY':
      if (r.byDay && r.bySetPos) {
        const nth = nthWeekdayOfMonth(d.getFullYear(), d.getMonth(), WEEKDAY_CODES.indexOf(r.byDay[0]), r.bySetPos);
        return nth?.getDate() === d.getDate();
      }
      if (r.byMonthDay) {
        const last = lastDayOfMonth(d.getFullYear(), d.getMonth()).getDate();
        return r.byMonthDay.some((n) => d.getDate() === (n === -1 ? last : n));
      }
      return d.getDate() === anchor.getDate();
    case 'YEARLY':
      return (
        d.getMonth() + 1 === (r.byMonth?.[0] ?? anchor.getMonth() + 1) &&
        d.getDate() === (r.byMonthDay?.[0] ?? anchor.getDate())
      );
  }
}

/** now 이후 첫 반복 날짜. minutes가 있으면 오늘 그 시각이 지났을 때 오늘은 건너뛴다 */
export function firstOccurrence(r: Recurrence, now: Date, minutes?: number): Date {
  const today = startOfDay(now);
  for (let i = 0; i < 800; i++) {
    const d = addDays(today, i);
    if (!occursOn(r, d, today)) continue;
    if (i === 0 && minutes !== undefined && atMinutes(d, minutes) < now) continue;
    return d;
  }
  return today;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Recurrence → RRULE 문자열 (FullCalendar rrule 플러그인, rrule.js 등에 그대로 전달 가능) */
export function toRRule(r: Recurrence): string {
  const parts = [`FREQ=${r.freq}`];
  if (r.interval > 1) parts.push(`INTERVAL=${r.interval}`);
  if (r.byMonth) parts.push(`BYMONTH=${r.byMonth.join(',')}`);
  if (r.byDay) parts.push(`BYDAY=${r.byDay.map((d) => `${r.bySetPos ?? ''}${d}`).join(',')}`);
  if (r.byMonthDay) parts.push(`BYMONTHDAY=${r.byMonthDay.join(',')}`);
  if (r.count) parts.push(`COUNT=${r.count}`);
  if (r.until) parts.push(`UNTIL=${r.until.getFullYear()}${pad(r.until.getMonth() + 1)}${pad(r.until.getDate())}`);
  return parts.join(';');
}
