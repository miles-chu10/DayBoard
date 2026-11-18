import type { QueryClient } from "@tanstack/react-query";
import type { CalendarEventItem, ReminderItem, SourceResult, TaskItem } from "@main/shared-types";

import { queryKeys } from "./queries";
import type { Todo } from "./todos";

type EditableItem = Todo | CalendarEventItem;
type ItemKind = "task" | "reminder" | "event";

export function sourceKey(kind: ItemKind) {
  return kind === "task"
    ? queryKeys.tasks
    : kind === "reminder"
      ? queryKeys.reminders
      : queryKeys.calendar;
}

/** Swaps the provider's confirmed copy of an edited item into the cached source list. */
export function replaceSourceItem(
  queryClient: QueryClient,
  kind: ItemKind,
  original: EditableItem,
  updated: TaskItem | ReminderItem | CalendarEventItem,
) {
  if (kind === "task") {
    const task = updated as TaskItem;
    queryClient.setQueryData<SourceResult<TaskItem>>(queryKeys.tasks, (previous) =>
      previous?.state === "ok"
        ? {
            ...previous,
            items: previous.items.map((item) =>
              item.id === (original as Todo).task?.id && item.listId === task.listId ? task : item,
            ),
          }
        : previous,
    );
  } else if (kind === "reminder") {
    const reminder = updated as ReminderItem;
    queryClient.setQueryData<SourceResult<ReminderItem>>(queryKeys.reminders, (previous) =>
      previous?.state === "ok"
        ? {
            ...previous,
            items: previous.items.map((item) =>
              item.ref === (original as Todo).reminder?.ref ? reminder : item,
            ),
          }
        : previous,
    );
  } else {
    const event = updated as CalendarEventItem;
    queryClient.setQueryData<SourceResult<CalendarEventItem>>(queryKeys.calendar, (previous) =>
      previous?.state === "ok"
        ? {
            ...previous,
            items: previous.items.map((item) =>
              item.id === (original as CalendarEventItem).id && item.calendarId === event.calendarId
                ? event
                : item,
            ),
          }
        : previous,
    );
  }
}

/** Drops a deleted item from the cached source list. */
export function removeSourceItem(queryClient: QueryClient, kind: ItemKind, item: EditableItem) {
  if (kind === "task") {
    const task = (item as Todo).task!;
    queryClient.setQueryData<SourceResult<TaskItem>>(queryKeys.tasks, (previous) =>
      previous?.state === "ok"
        ? {
            ...previous,
            items: previous.items.filter(
              (candidate) => candidate.id !== task.id || candidate.listId !== task.listId,
            ),
          }
        : previous,
    );
  } else if (kind === "reminder") {
    const reminder = (item as Todo).reminder!;
    queryClient.setQueryData<SourceResult<ReminderItem>>(queryKeys.reminders, (previous) =>
      previous?.state === "ok"
        ? {
            ...previous,
            items: previous.items.filter((candidate) => candidate.ref !== reminder.ref),
          }
        : previous,
    );
  } else {
    const event = item as CalendarEventItem;
    queryClient.setQueryData<SourceResult<CalendarEventItem>>(queryKeys.calendar, (previous) =>
      previous?.state === "ok"
        ? {
            ...previous,
            items: previous.items.filter(
              (candidate) => candidate.id !== event.id || candidate.calendarId !== event.calendarId,
            ),
          }
        : previous,
    );
  }
}
