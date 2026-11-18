import type { Agenda } from "../lib/agenda";
import { addDays, parseISODate, toISODate } from "../lib/dates";
import { marksFor } from "./day-line";

export interface MonthCell {
  date: string;
  day: number;
  inMonth: boolean;
}

export const MONTH_GRID_DAYS = 42;

/** "YYYY-MM" for a date. */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function shiftMonth(month: string, delta: number): string {
  const [year, index] = month.split("-").map(Number);
  return toISODate(new Date(year, index - 1 + delta, 1)).slice(0, 7);
}

export function monthTitle(month: string): string {
  return parseISODate(`${month}-01`).toLocaleDateString([], { month: "long", year: "numeric" });
}

/** Six Sunday-first weeks covering `month`: always 42 days, the most one calendar read allows. */
export function monthGrid(month: string): { start: string; weeks: MonthCell[][] } {
  const first = parseISODate(`${month}-01`);
  const start = addDays(`${month}-01`, -first.getDay());
  const weeks = Array.from({ length: 6 }, (_, week) =>
    Array.from({ length: 7 }, (_, weekday) => {
      const date = addDays(start, week * 7 + weekday);
      return { date, day: Number(date.slice(8)), inMonth: monthOf(date) === month };
    }),
  );
  return { start, weeks };
}

export interface DayMarks {
  events: boolean;
  todos: boolean;
}

/** Which days of an agenda have events or open to-dos, for the grid's dots. */
export function dayMarks(agenda: Agenda): Map<string, DayMarks> {
  return new Map(agenda.days.map((day) => [day.date, marksFor(day)]));
}
