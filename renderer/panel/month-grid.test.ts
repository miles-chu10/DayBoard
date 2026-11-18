import assert from "node:assert/strict";
import test from "node:test";

import { buildAgenda } from "../lib/agenda";
import { MONTH_GRID_DAYS, dayMarks, monthGrid, monthOf, shiftMonth } from "./month-grid";

test("a month grid is six Sunday-first weeks that contain the whole month", () => {
  const grid = monthGrid("2026-11");
  assert.equal(grid.start, "2026-11-01");
  assert.equal(grid.weeks.length, 6);
  assert.equal(grid.weeks.flat().length, MONTH_GRID_DAYS);
  assert.equal(grid.weeks.flat().filter((cell) => cell.inMonth).length, 30);
  assert.deepEqual(grid.weeks[5][6], { date: "2026-12-12", day: 12, inMonth: false });

  const october = monthGrid("2026-10");
  assert.equal(october.start, "2026-09-27");
  assert.deepEqual(october.weeks[0][4], { date: "2026-10-01", day: 1, inMonth: true });
  assert.equal(october.weeks.flat().filter((cell) => cell.inMonth).length, 31);
});

test("months step across year ends", () => {
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftMonth("2026-11", 0), "2026-11");
  assert.equal(monthOf("2026-11-18"), "2026-11");
});

test("day marks say which days hold events and open to-dos", () => {
  const todo = {
    key: "t",
    source: "tasks" as const,
    title: "Todo",
    notes: null,
    dueDate: "2026-10-22",
    dueTime: null,
    listTitle: "List",
    completed: false,
    completedAt: null,
  };
  const marks = dayMarks(
    buildAgenda({
      events: [
        {
          id: "e",
          title: "Event",
          start: "2026-10-21",
          end: "2026-10-22",
          allDay: true,
          location: null,
          description: null,
          htmlLink: null,
          meetLink: null,
          calendarId: "primary",
          calendarName: "Calendar",
          calendarColor: null,
          attendees: [],
        },
      ],
      todos: [todo, { ...todo, key: "done", dueDate: "2026-10-23", completed: true }],
      startDate: "2026-10-20",
      days: 4,
      now: new Date(2026, 9, 20, 12, 0),
    }),
  );
  assert.deepEqual(
    [...marks.entries()],
    [
      ["2026-10-20", { events: false, todos: false }],
      ["2026-10-21", { events: true, todos: false }],
      ["2026-10-22", { events: false, todos: true }],
      ["2026-10-23", { events: false, todos: false }],
    ],
  );
});
