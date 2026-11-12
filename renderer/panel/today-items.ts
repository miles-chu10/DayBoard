import { calendarEventKey } from "../lib/calendar-identity";
import type { Agenda } from "../lib/agenda";
import { formatTimeOfDay, relativeDue } from "../lib/dates";

export interface TodayItem {
  key: string;
  kind: "event" | "todo";
  title: string;
  /** Start or due time, formatted for display ("Yesterday" for an overdue to-do); null for an
   * anytime to-do. */
  time: string | null;
  source: "calendar" | "tasks" | "reminders";
  /** An event that has already ended today; it stays listed, styled as past. */
  past?: boolean;
}

const MAX_ITEMS = 8;

function clockTime(hhmm: string): string {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return formatTimeOfDay(new Date(2000, 0, 1, hours, minutes).toISOString());
}

function capItems(items: TodayItem[]): TodayItem[] {
  let todos = 0;
  return items.filter((item) => item.kind === "event" || ++todos <= MAX_ITEMS);
}

/**
 * Today in the menu-bar panel: timed items in order (events that already ended stay, marked past),
 * then anytime to-dos. Every event today is listed; to-dos stop at the cap.
 * Open overdue to-dos come separately, oldest first, for the panel's collapsible overdue row.
 */
export function todayItems(
  agenda: Agenda,
  now: Date,
): { overdueCount: number; overdue: TodayItem[]; items: TodayItem[]; hiddenCount: number } {
  const today = agenda.days[0];
  const items: TodayItem[] = (today?.allDay ?? []).map((event) => ({
    key: calendarEventKey(event),
    kind: "event",
    title: event.title,
    time: "All day",
    source: "calendar",
  }));
  for (const entry of today?.timed ?? []) {
    if (entry.kind === "event") {
      const past = new Date(entry.event.end).getTime() <= now.getTime();
      items.push({
        key: entry.key,
        kind: "event",
        title: entry.event.title,
        time: formatTimeOfDay(entry.event.start),
        source: "calendar",
        ...(past ? { past } : {}),
      });
    } else if (!entry.todo.completed) {
      items.push({
        key: entry.key,
        kind: "todo",
        title: entry.todo.title,
        time: entry.todo.dueTime ? clockTime(entry.todo.dueTime) : null,
        source: entry.todo.source,
      });
    }
  }
  for (const todo of today?.anytime ?? []) {
    if (todo.completed) continue;
    items.push({ key: todo.key, kind: "todo", title: todo.title, time: null, source: todo.source });
  }
  const overdue = agenda.overdue.filter((todo) => !todo.completed);
  return {
    overdueCount: overdue.length,
    overdue: overdue.slice(0, MAX_ITEMS).map((todo) => ({
      key: todo.key,
      kind: "todo",
      title: todo.title,
      time: todo.dueDate ? relativeDue(todo.dueDate, todo.dueTime, now).label : null,
      source: todo.source,
    })),
    items: capItems(items),
    hiddenCount: items.length - capItems(items).length,
  };
}

/** The next six days, omitting empty dates and keeping overdue work only in Today. */
export function upcomingItems(agenda: Agenda, now: Date) {
  return agenda.days
    .slice(1)
    .map((day) => ({
      date: day.date,
      ...todayItems({ days: [day], overdue: [], undated: [] }, now),
    }))
    .filter((day) => day.items.length > 0);
}
