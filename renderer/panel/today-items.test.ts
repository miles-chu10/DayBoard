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

test("keeps today's ended events, marked past, in order with the rest", () => {
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
      ["e1", "event", "calendar"],
      ["e2", "event", "calendar"],
      ["t1", "todo", "reminders"],
      ["e3", "event", "calendar"],
      ["t2", "todo", "reminders"],
    ],
  );
  assert.deepEqual(
    result.items.map((item) => item.past ?? false),
    [true, false, false, false, false],
  );
  assert.equal(result.items[2].time, "3:00 PM");
  assert.equal(result.items[4].time, null);
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

test("an event ending exactly now counts as past; a running one does not", () => {
  const result = todayItems(
    agenda({
      timed: [
        { kind: "event", key: "ended", event: event("1", at(11), at(12)) },
        { kind: "event", key: "running", event: event("2", at(11, 30), at(12, 30)) },
      ],
    }),
    now,
  );
  assert.deepEqual(
    result.items.map((item) => [item.key, item.past ?? false]),
    [
      ["ended", true],
      ["running", false],
    ],
  );
});

test("lists every event today, past or not, and caps only the to-dos", () => {
  const timed = Array.from({ length: 6 }, (_, index) => ({
    kind: "event" as const,
    key: `e${index}`,
    event: event(`e${index}`, at(index * 2 + 8), at(index * 2 + 8, 30)),
  }));
  const anytime = Array.from({ length: 10 }, (_, index) => todo(`t${index}`));
  const items = todayItems(agenda({ timed, anytime }), now).items;
  assert.deepEqual(
    items.filter((item) => item.kind === "event").map((item) => [item.key, item.past ?? false]),
    [
      ["e0", true],
      ["e1", true],
      ["e2", false],
      ["e3", false],
      ["e4", false],
      ["e5", false],
    ],
  );
  assert.equal(items.filter((item) => item.kind === "todo").length, 8);
});
