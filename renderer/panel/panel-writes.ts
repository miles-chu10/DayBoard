import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "@renderer/ui";
import type { CalendarEventItem, ReminderItem, TaskItem } from "@main/shared-types";

import { isRendererDemoMode } from "../lib/demo";
import { errorMessage, invoke } from "../lib/ipc";
import { queryKeys, useAccountScope } from "../lib/queries";
import { removeSourceItem, replaceSourceItem, sourceKey } from "../lib/source-cache";
import type { Todo } from "../lib/todos";
import type { EventDraft } from "./event-edit";
import { movedDraft, todoDelete, todoDraft, todoUpdate, type TodoDraft } from "./todo-edit";

/** `busy` while a bulk move runs. */
export const ALL = "all";

const DEMO_NOTE = "Demo content is read-only. Exit demo mode to make changes.";

function kindOf(todo: Todo): "task" | "reminder" {
  return todo.source === "tasks" ? "task" : "reminder";
}

/** The same to-do as the provider now has it, so a follow-up write uses its current reference. */
function withUpdate(todo: Todo, updated: TaskItem | ReminderItem): Todo {
  return "ref" in updated
    ? {
        ...todo,
        title: updated.title,
        notes: updated.notes,
        dueDate: updated.dueDate,
        dueTime: updated.dueTime,
        reminder: updated,
      }
    : { ...todo, title: updated.title, notes: updated.notes, dueDate: updated.due, task: updated };
}

/**
 * Edits made inside the menu-bar panel. Each write names the account scope it started under, so
 * an account switch mid-write is refused by the backend rather than landing on the new account.
 */
export function usePanelWrites() {
  const queryClient = useQueryClient();
  const liveScope = useAccountScope();
  const [busy, setBusy] = useState<string | null>(null);

  function scopeFor(): string | null {
    if (isRendererDemoMode()) {
      toast.error(DEMO_NOTE);
      return null;
    }
    const scope = liveScope ?? queryClient.getQueryData<string>(queryKeys.agendaScope);
    if (!scope || scope === "unavailable") {
      toast.error("Your account is still loading. Try again shortly.");
      return null;
    }
    return scope;
  }
  const sameScope = (scope: string) =>
    queryClient.getQueryData<string>(queryKeys.agendaScope) === scope;

  /** One confirmed update, mirrored into the cached list. Throws what the provider refuses. */
  async function applyTodo(todo: Todo, draft: TodoDraft, scope: string): Promise<Todo | null> {
    const write = todoUpdate(todo, draft, scope);
    if (!write) return null;
    const updated = await invoke<TaskItem | ReminderItem>(write.channel, write.payload);
    if (sameScope(scope)) {
      replaceSourceItem(queryClient, kindOf(todo), todo, updated);
      if ("ref" in updated && updated.agendaSaveError) toast.error(updated.agendaSaveError);
      void queryClient.invalidateQueries({ queryKey: sourceKey(kindOf(todo)) });
    }
    return withUpdate(todo, updated);
  }

  async function writeTodo(todo: Todo, draft: TodoDraft): Promise<Todo | null> {
    const scope = scopeFor();
    if (!scope) return null;
    setBusy(todo.key);
    try {
      return await applyTodo(todo, draft, scope);
    } catch (error) {
      toast.error(`Couldn’t save “${todo.title}”: ${errorMessage(error)}`);
      return null;
    } finally {
      setBusy(null);
    }
  }

  /** Moves many to-dos to one day, one write at a time, and reports the count once. */
  async function moveAll(todos: Todo[], date: string, label: string): Promise<void> {
    const scope = scopeFor();
    if (!scope) return;
    setBusy(ALL);
    let moved = 0;
    let failed = 0;
    for (const todo of todos) {
      if (!sameScope(scope)) break;
      try {
        if (await applyTodo(todo, movedDraft(todo, date), scope)) moved += 1;
      } catch {
        failed += 1;
      }
    }
    setBusy(null);
    if (moved) toast.success(`Moved ${moved} to ${label.toLowerCase()}`);
    if (failed) toast.error(`${failed} couldn’t be moved. They are still where they were.`);
  }

  /** Saves title, notes and due date. Resolves true once the provider confirms. */
  async function saveTodo(todo: Todo, draft: TodoDraft): Promise<boolean> {
    const saved = await writeTodo(todo, draft);
    if (saved) toast.success(`Saved “${saved.title}”`);
    return Boolean(saved);
  }

  /** Moves a to-do to another day (or no day), with Undo back to where it was. */
  async function moveTodo(todo: Todo, date: string | null, label: string): Promise<boolean> {
    const before = todoDraft(todo);
    const moved = await writeTodo(todo, movedDraft(todo, date));
    if (!moved) return false;
    let undone = false;
    toast.success(`Moved “${moved.title}” to ${label.toLowerCase()}`, {
      action: {
        label: "Undo",
        onClick: () => {
          if (undone) return;
          undone = true;
          void writeTodo(moved, {
            ...todoDraft(moved),
            dueDate: before.dueDate,
            dueTime: before.dueTime,
          }).then((back) => {
            if (!back) undone = false;
          });
        },
      },
    });
    return true;
  }

  async function deleteTodo(todo: Todo): Promise<boolean> {
    const scope = scopeFor();
    const write = scope ? todoDelete(todo, scope) : null;
    if (!scope || !write) return false;
    setBusy(todo.key);
    try {
      await invoke(write.channel, write.payload);
      if (sameScope(scope)) {
        removeSourceItem(queryClient, kindOf(todo), todo);
        void queryClient.invalidateQueries({ queryKey: sourceKey(kindOf(todo)) });
      }
      toast.success(`Deleted “${todo.title}”`);
      return true;
    } catch (error) {
      toast.error(`Couldn’t delete “${todo.title}”: ${errorMessage(error)}`);
      return false;
    } finally {
      setBusy(null);
    }
  }

  /** Saves an event's title, place and time. Its description and guests are left untouched. */
  async function saveEvent(event: CalendarEventItem, draft: EventDraft): Promise<boolean> {
    const scope = scopeFor();
    const title = draft.title.trim();
    if (!scope || !title) return false;
    const key = `${event.calendarId}/${event.id}`;
    setBusy(key);
    try {
      const updated = await invoke<CalendarEventItem>("calendar:update", {
        calendarId: event.calendarId,
        eventId: event.id,
        title,
        location: draft.location,
        start: draft.start,
        end: draft.end,
        allDay: draft.allDay,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        timesChanged: draft.timesChanged,
        expectedScope: scope,
      });
      if (sameScope(scope)) {
        // Every calendar read, including each visible range, starts with this key.
        void queryClient.invalidateQueries({ queryKey: queryKeys.calendar });
        void queryClient.invalidateQueries({ queryKey: queryKeys.review });
      }
      toast.success(`Saved “${updated.title}”`);
      return true;
    } catch (error) {
      toast.error(`Couldn’t save “${event.title}”: ${errorMessage(error)}`);
      return false;
    } finally {
      setBusy(null);
    }
  }

  return { busy, saveTodo, moveTodo, moveAll, deleteTodo, saveEvent };
}

export type PanelWrites = ReturnType<typeof usePanelWrites>;
