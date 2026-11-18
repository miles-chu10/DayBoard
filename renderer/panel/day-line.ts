import type { CalendarEventItem } from "@main/shared-types";

import type { Agenda, AgendaDay } from "../lib/agenda";
import { calendarEventKey } from "../lib/calendar-identity";
import { formatClock, formatTimeOfDay, parseISODate, relativeDue, toISODate } from "../lib/dates";
import type { Todo } from "../lib/todos";

export type DayRow =
  | {
      kind: "event";
      key: string;
      event: CalendarEventItem;
      /** "All day", or the start time. */
      time: string;
      /** A timed event's end time. */
      end: string | null;
      /** Ended before now. */
      past: boolean;
      /** Started and not yet ended. */
      live: boolean;
    }
  | {
      kind: "todo";
      key: string;
      todo: Todo;
      /** The due time; null for an anytime to-do. */
      time: string | null;
      /** Due earlier today than now. */
      late: boolean;
    };

export interface DayLine {
  date: string;
  /** All-day events, then timed events and to-dos in order, then anytime to-dos. */
  rows: DayRow[];
  /** Where the "now" marker sits: before `rows[nowIndex]`. Null off today or with nothing timed. */
  nowIndex: number | null;
  /** To-dos due this day that are already checked off. */
  done: Todo[];
}

function minutesOf(hhmm: string): number {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return hours * 60 + minutes;
}

/** One day as a single line of time. Nothing is capped: the panel scrolls instead. */
export function dayLine(day: AgendaDay | undefined, now: Date, completed: Todo[] = []): DayLine {
  if (!day) return { date: toISODate(now), rows: [], nowIndex: null, done: [] };
  const isToday = day.date === toISODate(now);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const rows: DayRow[] = day.allDay.map((event) => ({
    kind: "event",
    key: calendarEventKey(event),
    event,
    time: "All day",
    end: null,
    past: false,
    live: false,
  }));
  let before = rows.length;
  let timed = 0;
  for (const entry of day.timed) {
    if (entry.kind === "event") {
      const start = new Date(entry.event.start).getTime();
      const end = new Date(entry.event.end).getTime();
      const started = start <= now.getTime();
      rows.push({
        kind: "event",
        key: entry.key,
        event: entry.event,
        time: formatTimeOfDay(entry.event.start),
        end: end > start ? formatTimeOfDay(entry.event.end) : null,
        past: end <= now.getTime(),
        live: started && end > now.getTime(),
      });
      if (isToday && started) before += 1;
      timed += 1;
    } else if (!entry.todo.completed) {
      const late = isToday && minutesOf(entry.todo.dueTime!) <= nowMinutes;
      rows.push({
        kind: "todo",
        key: entry.todo.key,
        todo: entry.todo,
        time: formatClock(entry.todo.dueTime!),
        late,
      });
      if (late) before += 1;
      timed += 1;
    }
  }
  for (const todo of day.anytime) {
    if (!todo.completed) rows.push({ kind: "todo", key: todo.key, todo, time: null, late: false });
  }
  return {
    date: day.date,
    rows,
    nowIndex: isToday && timed ? before : null,
    done: completed.filter((todo) => todo.completed && todo.dueDate === day.date),
  };
}

/** Every open overdue to-do, oldest first, and how old the oldest is. */
export function overdueLine(agenda: Agenda, now: Date): { todos: Todo[]; oldest: string | null } {
  const todos = agenda.overdue.filter((todo) => !todo.completed);
  const first = todos[0];
  return {
    todos,
    oldest: first?.dueDate ? relativeDue(first.dueDate, first.dueTime, now).label : null,
  };
}

/** Whether a day holds events, and whether it holds open to-dos. */
export function marksFor(day: AgendaDay): { events: boolean; todos: boolean } {
  return {
    events: day.allDay.length > 0 || day.timed.some((entry) => entry.kind === "event"),
    todos:
      day.anytime.some((todo) => !todo.completed) ||
      day.timed.some((entry) => entry.kind === "todo" && !entry.todo.completed),
  };
}

export interface StripDay {
  date: string;
  /** "Wed" */
  weekday: string;
  /** Day of the month. */
  day: number;
  today: boolean;
  events: boolean;
  todos: boolean;
}

/** The days the agenda covers, with a mark for each kind of thing waiting on that day. */
export function weekStrip(agenda: Agenda, now: Date): StripDay[] {
  const today = toISODate(now);
  return agenda.days.map((day) => {
    const date = parseISODate(day.date);
    return {
      date: day.date,
      weekday: date.toLocaleDateString([], { weekday: "short" }),
      day: date.getDate(),
      today: day.date === today,
      ...marksFor(day),
    };
  });
}

export interface MatchGroup {
  /** "overdue", "undated", or the day (YYYY-MM-DD). */
  id: string;
  rows: DayRow[];
}

/**
 * A searched agenda as groups for the panel: overdue first, then each day with a match, then
 * undated to-dos. An event spanning several days is listed once, on its first day.
 */
export function matchGroups(agenda: Agenda, now: Date): MatchGroup[] {
  const todoRow = (todo: Todo): DayRow => ({
    kind: "todo",
    key: todo.key,
    todo,
    time: todo.dueTime ? formatClock(todo.dueTime) : null,
    late: false,
  });
  const groups: MatchGroup[] = [];
  const overdue = agenda.overdue.filter((todo) => !todo.completed);
  if (overdue.length) groups.push({ id: "overdue", rows: overdue.map(todoRow) });
  const seen = new Set<string>();
  for (const day of agenda.days) {
    const rows = dayLine(day, now).rows.filter((row) => {
      if (row.kind !== "event") return true;
      if (seen.has(row.key)) return false;
      seen.add(row.key);
      return true;
    });
    if (rows.length) groups.push({ id: day.date, rows });
  }
  const undated = agenda.undated.filter((todo) => !todo.completed);
  if (undated.length) groups.push({ id: "undated", rows: undated.map(todoRow) });
  return groups;
}
