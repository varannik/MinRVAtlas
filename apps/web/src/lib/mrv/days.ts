import type { DateRange, DayKey } from "./types";

const DAY_MS = 86_400_000;

export function dayMs(day: DayKey): number {
  return Date.parse(`${day}T00:00:00Z`);
}

export function dayFromMs(ms: number): DayKey {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(day: DayKey, count: number): DayKey {
  return dayFromMs(dayMs(day) + count * DAY_MS);
}

/** Whole days from `a` to `b` (b − a). */
export function diffDays(a: DayKey, b: DayKey): number {
  return Math.round((dayMs(b) - dayMs(a)) / DAY_MS);
}

/** Inclusive day count of a range. */
export function rangeDays(range: DateRange): number {
  return diffDays(range.start, range.end) + 1;
}

export function isDayKey(value: unknown): value is DayKey {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function todayUtc(now = Date.now()): DayKey {
  return dayFromMs(now);
}

export function overlaps(a: DateRange, b: DateRange): boolean {
  return a.start <= b.end && b.start <= a.end;
}

export function contains(range: DateRange, day: DayKey): boolean {
  return day >= range.start && day <= range.end;
}

/** Days of `a` that fall inside `b`. */
export function overlapDays(a: DateRange, b: DateRange): number {
  const start = a.start > b.start ? a.start : b.start;
  const end = a.end < b.end ? a.end : b.end;
  return start > end ? 0 : diffDays(start, end) + 1;
}

export function orderRange(a: DayKey, b: DayKey): DateRange {
  return a <= b ? { start: a, end: b } : { start: b, end: a };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "3 Mar 2026". Manual so server and client markup match. */
export function formatDay(day: DayKey): string {
  const [y, m, d] = day.split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

/** "Jan – Mar 2026", "Dec 2025 – Feb 2026", or "3 – 19 Mar 2026". */
export function formatRange(range: DateRange): string {
  if (range.start === range.end) return formatDay(range.start);
  const [sy, sm, sd] = range.start.split("-");
  const [ey, em, ed] = range.end.split("-");
  const wholeMonths = sd === "01" && addDays(range.end, 1).endsWith("-01");
  if (wholeMonths) {
    if (sy === ey && sm === em) return `${MONTHS[Number(sm) - 1]} ${sy}`;
    if (sy === ey) return `${MONTHS[Number(sm) - 1]} – ${MONTHS[Number(em) - 1]} ${ey}`;
    return `${MONTHS[Number(sm) - 1]} ${sy} – ${MONTHS[Number(em) - 1]} ${ey}`;
  }
  if (sy === ey && sm === em) return `${Number(sd)} – ${Number(ed)} ${MONTHS[Number(em) - 1]} ${ey}`;
  return `${formatDay(range.start)} – ${formatDay(range.end)}`;
}

export function monthLabel(day: DayKey): string {
  return MONTHS[Number(day.slice(5, 7)) - 1];
}
