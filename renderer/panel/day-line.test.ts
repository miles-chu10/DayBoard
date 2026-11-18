import assert from "node:assert/strict";
import test from "node:test";

import { buildAgenda } from "../lib/agenda";
import { formatTimeOfDay } from "../lib/dates";
import type { Todo } from "../lib/todos";
import { dayLine, matchGroups, overdueLine, weekStrip } from "./day-line";

const now = new Date(2026, 9, 20, 12, 0);
const at = (hour: number, minute = 0, day = 20) =>
  new Date(2026, 9, day, hour, minute).toISOString();

function event(id: string, start: string, end: string, allDay = false) {
  return {
    id,
    title: `Event ${id}`,
    start,
    end,
    allDay,
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

function todo(key: string, overrides: Partial<Todo> = {}): Todo {
  return {
    key,
    source: "reminders",
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

function agendaOf(events: ReturnType<typeof event>[], todos: Todo[], search?: string) {
  return buildAgenda({ events, todos, startDate: "2026-10-20", days: 7, now, search });
}

test("a day lists every item: all-day, then timed in order, then anytime", () => {
  const todos = Array.from({ length: 30 }, (_, index) => todo(`t${index}`));
  const agenda = agendaOf(
    [
      event("late", at(15), at(16)),
      event("early", at(9), at(10)),
      event("day", "2026-10-20", "2026-10-21", true),
    ],
    [...todos, todo("timed", { dueTime: "13:30" })],
  );
  const line = dayLine(agenda.days[0], now);
  assert.equal(line.rows.length, 34);
  assert.deepEqual(
    line.rows.slice(0, 4).map((row) => (row.kind === "event" ? row.event.id : row.todo.key)),
    ["day", "early", "timed", "late"],
  );
  assert.equal(line.rows[0].time, "All day");
  assert.equal(line.rows[1].time, formatTimeOfDay(at(9)));
  assert.equal(line.rows[2].time, "1:30 PM");
  assert.ok(line.rows.slice(4).every((row) => row.kind === "todo" && row.time === null));
});

test("the now marker sits after what has started and before what is ahead", () => {
  const agenda = agendaOf(
    [
      event("done", at(9), at(10)),
      event("live", at(11, 30), at(12, 30)),
      event("ahead", at(15), at(16)),
    ],
    [todo("late", { dueTime: "10:15" }), todo("soon", { dueTime: "14:00" }), todo("any")],
  );
  const line = dayLine(agenda.days[0], now);
  assert.equal(line.nowIndex, 3);
  const [done, late, live, soon, ahead] = line.rows;
  assert.ok(done.kind === "event" && done.past && !done.live);
  assert.ok(late.kind === "todo" && late.late);
  assert.ok(live.kind === "event" && live.live && !live.past);
  assert.ok(soon.kind === "todo" && !soon.late);
  assert.ok(ahead.kind === "event" && !ahead.past && !ahead.live);
});

test("the now marker closes a day whose timed items have all started", () => {
  const agenda = agendaOf([event("done", at(9), at(10))], [todo("any")]);
  assert.equal(dayLine(agenda.days[0], now).nowIndex, 1);
});

test("no now marker on another day or on a day with nothing timed", () => {
  const agenda = agendaOf([event("tomorrow", at(9, 0, 21), at(10, 0, 21))], [todo("any")]);
  assert.equal(dayLine(agenda.days[0], now).nowIndex, null);
  assert.equal(dayLine(agenda.days[1], now).nowIndex, null);
  assert.equal(dayLine(undefined, now).rows.length, 0);
});

test("completed to-dos leave the line and return only when asked for", () => {
  const done = todo("done", { completed: true });
  const agenda = agendaOf([], [todo("open"), done]);
  assert.deepEqual(
    dayLine(agenda.days[0], now).rows.map((row) => row.key),
    ["open"],
  );
  assert.deepEqual(dayLine(agenda.days[0], now).done, []);
  assert.deepEqual(
    dayLine(agenda.days[0], now, [done, todo("other", { completed: true, dueDate: "2026-10-21" })])
      .done,
    [done],
  );
});

test("overdue is the whole list, oldest first, with the oldest item's age", () => {
  const todos = Array.from({ length: 20 }, (_, index) =>
    todo(`o${index}`, { dueDate: `2026-10-${String(index % 2 ? 12 : 18).padStart(2, "0")}` }),
  );
  const overdue = overdueLine(agendaOf([], [...todos, todo("today")]), now);
  assert.equal(overdue.todos.length, 20);
  assert.equal(overdue.todos[0].dueDate, "2026-10-12");
  assert.equal(overdue.oldest, "A week ago");
  assert.deepEqual(overdueLine(agendaOf([], [todo("today")]), now), { todos: [], oldest: null });
});

test("the week strip marks each day's events and open to-dos", () => {
  const strip = weekStrip(
    agendaOf(
      [event("thursday", at(9, 0, 22), at(10, 0, 22))],
      [
        todo("wed", { dueDate: "2026-10-21" }),
        todo("gone", { dueDate: "2026-10-23", completed: true }),
      ],
    ),
    now,
  );
  assert.equal(strip.length, 7);
  assert.deepEqual(
    strip.map((day) => [day.day, day.today, day.events, day.todos]),
    [
      [20, true, false, false],
      [21, false, false, true],
      [22, false, true, false],
      [23, false, false, false],
      [24, false, false, false],
      [25, false, false, false],
      [26, false, false, false],
    ],
  );
});

test("search groups overdue, each matching day, then undated, listing a long event once", () => {
  const groups = matchGroups(
    agendaOf(
      [event("trip", "2026-10-21", "2026-10-24", true), event("other", at(9), at(10))].map(
        (item) => (item.id === "trip" ? { ...item, title: "Plan trip" } : item),
      ),
      [
        todo("old", { title: "Plan budget", dueDate: "2026-10-10" }),
        todo("wed", { title: "Plan dinner", dueDate: "2026-10-21", dueTime: "18:00" }),
        todo("none", { title: "Plan garden", dueDate: null }),
        todo("miss", { title: "Call bank" }),
      ],
      "plan",
    ),
    now,
  );
  assert.deepEqual(
    groups.map((group) => [group.id, group.rows.map((row) => row.key.slice(-4))]),
    [
      ["overdue", ["old"]],
      ["2026-10-21", [groups[1].rows[0].key.slice(-4), "wed"]],
      ["undated", ["none"]],
    ],
  );
  assert.equal(groups[1].rows[0].kind, "event");
  assert.equal(groups[1].rows[1].time, "6:00 PM");
});
