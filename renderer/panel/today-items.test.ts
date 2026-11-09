import assert from "node:assert/strict";
import test from "node:test";

import type { Agenda } from "../lib/agenda";
import { todayItems } from "./today-items";

const now = new Date(2026, 9, 20, 12, 0);
const at = (hour: number, minute = 0) => new Date(2026, 9, 20, hour, minute).toISOString();

function event(id: string, start: string, end: string) {
  return {
    id,
    title: `Event ${id}`,
    start,
    end,
    allDay: false,
    location: null,
    description: null,
    htmlLink: null,
    meetLink: null,
    calendarId: "primary",
    calendarName: "Calendar",
    calendarColor: null,
    attendees: [],
  };
}

function todo(
  key: string,
  overrides: Partial<{ dueDate: string; dueTime: string | null; completed: boolean }> = {},
) {
  return {
    key,
    source: "reminders" as const,
    title: `Todo ${key}`,
    notes: null,
    dueDate: "2026-10-20",
    dueTime: null,
    listTitle: "Reminders",
    completed: false,
    completedAt: null,
    ...overrides,
  };
}

function agenda(
  parts: Partial<Agenda> & {
    timed?: Agenda["days"][number]["timed"];
    anytime?: Agenda["days"][number]["anytime"];
  },
): Agenda {
  return {
    days: [
      { date: "2026-10-20", allDay: [], timed: parts.timed ?? [], anytime: parts.anytime ?? [] },
    ],
    overdue: parts.overdue ?? [],
    undated: [],
  };
}

test("lists today's remaining events then due to-dos", () => {
  const result = todayItems(
    agenda({
      timed: [
        { kind: "event", key: "e1", event: event("1", at(9), at(10)) },
        { kind: "event", key: "e2", event: event("2", at(11, 30), at(12, 30)) },
        { kind: "todo", key: "t1", todo: todo("t1", { dueTime: "15:00" }) },
        { kind: "event", key: "e3", event: event("3", at(16), at(17)) },
      ],
      anytime: [todo("t2"), todo("t3", { completed: true })],
    }),
    now,
  );
  assert.deepEqual(
    result.items.map((item) => [item.key, item.kind, item.source]),
    [
      ["e2", "event", "calendar"],
      ["t1", "todo", "reminders"],
      ["e3", "event", "calendar"],
      ["t2", "todo", "reminders"],
    ],
  );
  assert.equal(result.items[1].time, "3:00 PM");
  assert.equal(result.items[3].time, null);
});

test("counts and lists open overdue to-dos with how late they are", () => {
  const result = todayItems(
    agenda({
      overdue: [
        todo("o1", { dueDate: "2026-10-15" }),
        todo("o2", { dueDate: "2026-10-19" }),
        todo("o3", { dueDate: "2026-10-19", completed: true }),
      ],
    }),
    now,
  );
  assert.equal(result.overdueCount, 2);
  assert.deepEqual(
    result.overdue.map((item) => [item.key, item.kind, item.time]),
    [
      ["o1", "todo", "5 days ago"],
      ["o2", "todo", "Yesterday"],
    ],
  );
});

test("caps the overdue list at eight but counts every overdue to-do", () => {
  const overdue = Array.from({ length: 12 }, (_, index) =>
    todo(`o${index}`, { dueDate: "2026-10-18" }),
  );
  const result = todayItems(agenda({ overdue }), now);
  assert.equal(result.overdueCount, 12);
  assert.equal(result.overdue.length, 8);
});

test("caps the list at eight", () => {
  const anytime = Array.from({ length: 12 }, (_, index) => todo(`t${index}`));
  assert.equal(todayItems(agenda({ anytime }), now).items.length, 8);
});
