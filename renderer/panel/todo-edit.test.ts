import assert from "node:assert/strict";
import test from "node:test";

import type { Todo } from "../lib/todos";
import {
  canEditTodo,
  draftChanged,
  moveChoices,
  movedDraft,
  todoDelete,
  todoDraft,
  todoUpdate,
} from "./todo-edit";

const task: Todo = {
  key: "task:list-1:t1",
  source: "tasks",
  title: "Send invoice",
  notes: "Net 30",
  dueDate: "2026-10-18",
  dueTime: null,
  listTitle: "Work",
  completed: false,
  completedAt: null,
  task: {
    id: "t1",
    listId: "list-1",
    listTitle: "Work",
    title: "Send invoice",
    notes: "Net 30",
    due: "2026-10-18",
    completed: false,
    completedAt: null,
  },
};

function reminder(overrides: Partial<NonNullable<Todo["reminder"]>> = {}): Todo {
  const item = {
    identity: "cal/r1",
    ref: "ref-1",
    listTitle: "Home",
    title: "Water plants",
    notes: null,
    dueDate: "2026-10-18",
    dueTime: "09:00",
    priority: 5,
    completed: false,
    completedAt: null,
    recurring: false,
    ...overrides,
  };
  return {
    key: "reminder:cal/r1",
    source: "reminders",
    title: item.title,
    notes: item.notes,
    dueDate: item.dueDate,
    dueTime: item.dueTime,
    listTitle: item.listTitle,
    completed: false,
    completedAt: null,
    reminder: item,
  };
}

test("a task update carries its list, the trimmed title and a date or null", () => {
  assert.deepEqual(todoUpdate(task, { ...todoDraft(task), title: "  Send invoice 14 " }, "scope"), {
    channel: "tasks:update",
    payload: {
      listId: "list-1",
      taskId: "t1",
      title: "Send invoice 14",
      notes: "Net 30",
      due: "2026-10-18",
      expectedScope: "scope",
    },
  });
  assert.equal(todoUpdate(task, movedDraft(task, null), "scope")?.payload.due, null);
});

test("a reminder update sends its due date only when it changed, and keeps its priority", () => {
  const todo = reminder();
  assert.deepEqual(todoUpdate(todo, { ...todoDraft(todo), notes: "Balcony too" }, "scope"), {
    channel: "reminders:update",
    payload: {
      ref: "ref-1",
      title: "Water plants",
      notes: "Balcony too",
      dueChanged: false,
      priority: 5,
      expectedScope: "scope",
    },
  });
  assert.deepEqual(todoUpdate(todo, movedDraft(todo, "2026-10-21"), "scope")?.payload, {
    ref: "ref-1",
    title: "Water plants",
    notes: "",
    dueChanged: true,
    dueDate: "2026-10-21",
    dueTime: "09:00",
    priority: 5,
    expectedScope: "scope",
  });
});

test("clearing a reminder's date clears its time with it", () => {
  const payload = todoUpdate(reminder(), movedDraft(reminder(), null), "scope")?.payload;
  assert.equal(payload?.dueDate, null);
  assert.equal(payload?.dueTime, null);
});

test("an empty title and a recurring reminder can't be saved or deleted", () => {
  assert.equal(todoUpdate(task, { ...todoDraft(task), title: "   " }, "scope"), null);
  const series = reminder({ recurring: true });
  assert.equal(canEditTodo(series), false);
  assert.equal(todoUpdate(series, todoDraft(series), "scope"), null);
  assert.equal(todoDelete(series, "scope"), null);
});

test("delete names the item and the account scope", () => {
  assert.deepEqual(todoDelete(task, "scope"), {
    channel: "tasks:delete",
    payload: { listId: "list-1", taskId: "t1", expectedScope: "scope" },
  });
  assert.deepEqual(todoDelete(reminder(), "scope"), {
    channel: "reminders:delete",
    payload: { ref: "ref-1", expectedScope: "scope" },
  });
});

test("a draft counts as changed only when something saved would differ", () => {
  assert.equal(draftChanged(task, todoDraft(task)), false);
  assert.equal(draftChanged(task, { ...todoDraft(task), title: " Send invoice " }), false);
  assert.equal(draftChanged(task, { ...todoDraft(task), notes: "" }), true);
  const todo = reminder();
  assert.equal(draftChanged(todo, { ...todoDraft(todo), dueTime: "10:00" }), true);
  assert.equal(
    draftChanged(reminder({ dueDate: null, dueTime: null }), {
      ...todoDraft(reminder({ dueDate: null, dueTime: null })),
      dueTime: "10:00",
    }),
    false,
  );
});

test("move choices on a weekday: today, tomorrow, this weekend, next week, no date", () => {
  const tuesday = new Date(2026, 9, 20, 12, 0);
  assert.deepEqual(
    moveChoices(tuesday, "2026-10-12").map((choice) => [choice.label, choice.date, choice.key]),
    [
      ["Today", "2026-10-20", "1"],
      ["Tomorrow", "2026-10-21", "2"],
      ["This weekend", "2026-10-24", "3"],
      ["Next week", "2026-10-26", "4"],
      ["No date", null, "0"],
    ],
  );
});

test("move choices leave out the day an item is on and never repeat a date", () => {
  const tuesday = new Date(2026, 9, 20, 12, 0);
  assert.deepEqual(
    moveChoices(tuesday, "2026-10-21").map((choice) => choice.id),
    ["today", "weekend", "next-week", "none"],
  );
  assert.deepEqual(
    moveChoices(tuesday, null).map((choice) => choice.id),
    ["today", "tomorrow", "weekend", "next-week"],
  );
  const sunday = new Date(2026, 9, 25, 12, 0);
  assert.deepEqual(
    moveChoices(sunday, "2026-10-12").map((choice) => [choice.label, choice.date]),
    [
      ["Today", "2026-10-25"],
      ["Tomorrow", "2026-10-26"],
      ["Next weekend", "2026-10-31"],
      ["No date", null],
    ],
  );
  const saturday = new Date(2026, 9, 24, 12, 0);
  assert.deepEqual(
    moveChoices(saturday, "2026-10-12").map((choice) => [choice.label, choice.date]),
    [
      ["Today", "2026-10-24"],
      ["Tomorrow", "2026-10-25"],
      ["Next weekend", "2026-10-31"],
      ["Next week", "2026-10-26"],
      ["No date", null],
    ],
  );
});
