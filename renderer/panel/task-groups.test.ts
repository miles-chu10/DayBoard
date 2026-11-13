import assert from "node:assert/strict";
import test from "node:test";

import type { Todo } from "../lib/todos";
import { taskGroups } from "./task-groups";

const now = new Date(2026, 10, 13, 12, 0);

function task(
  id: string,
  listId: string,
  listTitle: string,
  due: string | null,
  completed = false,
): Todo {
  return {
    key: `task:${listId}:${id}`,
    source: "tasks",
    title: `Task ${id}`,
    notes: null,
    dueDate: due,
    dueTime: null,
    listTitle,
    completed,
    completedAt: null,
    task: {
      id,
      listId,
      listTitle,
      title: `Task ${id}`,
      notes: null,
      due,
      completed,
      completedAt: null,
    } as Todo["task"],
  };
}

function reminder(
  ref: string,
  listId: string | undefined,
  listTitle: string,
  due: string | null,
): Todo {
  return {
    key: `reminder:${ref}`,
    source: "reminders",
    title: `Reminder ${ref}`,
    notes: null,
    dueDate: due,
    dueTime: null,
    listTitle,
    completed: false,
    completedAt: null,
    reminder: { ref, listId, listTitle } as Todo["reminder"],
  };
}

test("groups open to-dos by list, Google Tasks first, keyed like the quick add's destinations", () => {
  const groups = taskGroups(
    [
      reminder("r1", "errands", "Errands", null),
      task("a", "work", "Work", "2026-11-14"),
      task("b", "personal", "Personal", null),
      task("c", "work", "Work", "2026-11-12"),
      task("done", "work", "Work", "2026-11-10", true),
    ],
    now,
  );
  assert.deepEqual(
    groups.map((group) => [group.key, group.title, group.rows.map((row) => row.todo.title)]),
    [
      ["task:work", "Work", ["Task c", "Task a"]],
      ["task:personal", "Personal", ["Task b"]],
      ["reminder:errands", "Errands", ["Reminder r1"]],
    ],
  );
});

test("labels due dates relative to now and flags overdue ones", () => {
  const [work] = taskGroups(
    [
      task("late", "work", "Work", "2026-11-12"),
      task("today", "work", "Work", "2026-11-13"),
      task("tomorrow", "work", "Work", "2026-11-14"),
      task("someday", "work", "Work", null),
    ],
    now,
  );
  assert.deepEqual(
    work.rows.map((row) => [row.due, row.overdue]),
    [
      ["Yesterday", true],
      ["Today", false],
      ["Tomorrow", false],
      [null, false],
    ],
  );
});

test("a reminder without a list id still groups by its list title", () => {
  const groups = taskGroups(
    [reminder("r1", undefined, "Inbox", null), reminder("r2", undefined, "Inbox", null)],
    now,
  );
  assert.equal(groups.length, 1);
  assert.equal(groups[0].key, "reminder:Inbox");
});
