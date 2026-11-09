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
}

const MAX_ITEMS = 8;

function clockTime(hhmm: string): string {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return formatTimeOfDay(new Date(2000, 0, 1, hours, minutes).toISOString());
}

/**
 * What's left today, for the menu-bar panel: timed items not yet over, then anytime to-dos. Open
 * overdue to-dos come separately, oldest first, for the panel's collapsible overdue row.
 */
export function todayItems(
  agenda: Agenda,
  now: Date,
): { overdueCount: number; overdue: TodayItem[]; items: TodayItem[] } {
  const today = agenda.days[0];
  const items: TodayItem[] = [];
  for (const entry of today?.timed ?? []) {
    if (entry.kind === "event") {
      if (new Date(entry.event.end).getTime() <= now.getTime()) continue;
      items.push({
        key: entry.key,
        kind: "event",
        title: entry.event.title,
        time: formatTimeOfDay(entry.event.start),
        source: "calendar",
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
    items: items.slice(0, MAX_ITEMS),
  };
}
