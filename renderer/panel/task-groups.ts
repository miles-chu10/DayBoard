import { relativeDue } from "../lib/dates";
import { compareByDue, type Todo } from "../lib/todos";

export interface TaskRow {
  todo: Todo;
  /** Due date (and time) relative to now, or null for an undated to-do. */
  due: string | null;
  overdue: boolean;
}

export interface TaskGroup {
  /** The quick add's destination key for this list ("task:<id>" or "reminder:<id>"). */
  key: string;
  source: Todo["source"];
  title: string;
  rows: TaskRow[];
}

function listKey(todo: Todo): string {
  const listId = todo.task?.listId ?? todo.reminder?.listId ?? todo.listTitle;
  return `${todo.source === "tasks" ? "task" : "reminder"}:${listId}`;
}

/**
 * The menu bar's "All" view: every open to-do, grouped by its list. Google Tasks lists come
 * first, then Reminders lists, each in the order their source returned them; within a list,
 * the soonest due leads and undated items close it.
 */
export function taskGroups(todos: Todo[], now: Date): TaskGroup[] {
  const groups = new Map<string, TaskGroup>();
  for (const todo of todos) {
    if (todo.completed) continue;
    const key = listKey(todo);
    let group = groups.get(key);
    if (!group) {
      group = { key, source: todo.source, title: todo.listTitle, rows: [] };
      groups.set(key, group);
    }
    const due = todo.dueDate ? relativeDue(todo.dueDate, todo.dueTime, now) : null;
    group.rows.push({ todo, due: due?.label ?? null, overdue: due?.tone === "overdue" });
  }
  const ordered = [...groups.values()];
  for (const group of ordered) group.rows.sort((a, b) => compareByDue(a.todo, b.todo));
  return [
    ...ordered.filter((group) => group.source === "tasks"),
    ...ordered.filter((group) => group.source === "reminders"),
  ];
}
