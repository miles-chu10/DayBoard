import { addDays, toISODate } from "../lib/dates";
import type { Todo } from "../lib/todos";

export interface TodoDraft {
  title: string;
  notes: string;
  /** YYYY-MM-DD, or "" for no date. */
  dueDate: string;
  /** HH:mm, or "" for no time. Reminders only. */
  dueTime: string;
}

export const RECURRING_NOTE = "Edit or delete recurring reminders in Apple Reminders.";

/** Recurring reminders are a series in Apple Reminders; the panel only checks them off. */
export function canEditTodo(todo: Todo): boolean {
  return todo.source === "tasks" ? Boolean(todo.task) : Boolean(todo.reminder?.recurring === false);
}

export function todoDraft(todo: Todo): TodoDraft {
  return {
    title: todo.title,
    notes: todo.notes ?? "",
    dueDate: todo.dueDate ?? "",
    dueTime: todo.source === "reminders" ? (todo.dueTime ?? "") : "",
  };
}

export function draftChanged(todo: Todo, draft: TodoDraft): boolean {
  const original = todoDraft(todo);
  return (
    draft.title.trim() !== original.title ||
    draft.notes !== original.notes ||
    draft.dueDate !== original.dueDate ||
    (draft.dueDate ? draft.dueTime : "") !== original.dueTime
  );
}

export type TodoWrite =
  | { channel: "tasks:update"; payload: Record<string, unknown> }
  | { channel: "reminders:update"; payload: Record<string, unknown> };

/** The validated update for a draft, or null when it can't be saved (no title, not editable). */
export function todoUpdate(todo: Todo, draft: TodoDraft, scope: string): TodoWrite | null {
  const title = draft.title.trim();
  if (!title || !canEditTodo(todo)) return null;
  if (todo.task) {
    return {
      channel: "tasks:update",
      payload: {
        listId: todo.task.listId,
        taskId: todo.task.id,
        title,
        notes: draft.notes,
        due: draft.dueDate || null,
        expectedScope: scope,
      },
    };
  }
  const reminder = todo.reminder!;
  const dueDate = draft.dueDate || null;
  const dueTime = dueDate && draft.dueTime ? draft.dueTime : null;
  const dueChanged = reminder.dueDate !== dueDate || reminder.dueTime !== dueTime;
  return {
    channel: "reminders:update",
    payload: {
      ref: reminder.ref,
      title,
      notes: draft.notes,
      dueChanged,
      ...(dueChanged ? { dueDate, dueTime } : {}),
      priority: reminder.priority,
      expectedScope: scope,
    },
  };
}

export type TodoDelete =
  | { channel: "tasks:delete"; payload: Record<string, unknown> }
  | { channel: "reminders:delete"; payload: Record<string, unknown> };

export function todoDelete(todo: Todo, scope: string): TodoDelete | null {
  if (!canEditTodo(todo)) return null;
  return todo.task
    ? {
        channel: "tasks:delete",
        payload: { listId: todo.task.listId, taskId: todo.task.id, expectedScope: scope },
      }
    : { channel: "reminders:delete", payload: { ref: todo.reminder!.ref, expectedScope: scope } };
}

export interface MoveChoice {
  id: "today" | "tomorrow" | "weekend" | "next-week" | "none";
  label: string;
  /** YYYY-MM-DD, or null to clear the date. */
  date: string | null;
  /** Catch up's key for this choice. */
  key: string;
}

/**
 * Where a to-do can move in one tap: today, tomorrow, the coming Saturday, next Monday, or no
 * date. The choice it already sits on is left out, and so is a repeat of an earlier date (on a
 * Sunday, next Monday is also tomorrow).
 */
export function moveChoices(now: Date, current: string | null): MoveChoice[] {
  const today = toISODate(now);
  const day = now.getDay(); // 0 Sunday … 6 Saturday
  const toSaturday = (6 - day + 7) % 7 || 7;
  const toMonday = (1 - day + 7) % 7 || 7;
  const choices: MoveChoice[] = [
    { id: "today", label: "Today", date: today, key: "1" },
    { id: "tomorrow", label: "Tomorrow", date: addDays(today, 1), key: "2" },
    {
      id: "weekend",
      label: day === 0 || day === 6 ? "Next weekend" : "This weekend",
      date: addDays(today, day === 0 ? 6 : toSaturday),
      key: "3",
    },
    { id: "next-week", label: "Next week", date: addDays(today, toMonday), key: "4" },
    { id: "none", label: "No date", date: null, key: "0" },
  ];
  return choices.filter(
    (choice, index) =>
      choice.date !== current && choices.findIndex((other) => other.date === choice.date) === index,
  );
}

/** The draft that moves a to-do to `date`, keeping a reminder's time when it keeps a date. */
export function movedDraft(todo: Todo, date: string | null): TodoDraft {
  return { ...todoDraft(todo), dueDate: date ?? "" };
}
