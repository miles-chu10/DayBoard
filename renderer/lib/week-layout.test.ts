process.env.TZ = "America/Los_Angeles";

import assert from "node:assert/strict";
import test from "node:test";

import type { CalendarEventItem } from "@main/shared-types";

import { layoutDay } from "./week-layout";

const event = (id: string, start: string, end: string) =>
  ({ id, title: id, start, end }) as unknown as CalendarEventItem;

const place = (date: string, start: string, end: string) => {
  const [item] = layoutDay([event("e", start, end)], date);
  return [item.top, item.height];
};

test("events sit at their clock time on an ordinary day", () => {
  assert.deepEqual(
    place("2026-06-10", "2026-06-10T09:00:00-07:00", "2026-06-10T10:30:00-07:00"),
    [9, 1.5],
  );
});

test("the day clocks go forward, afternoon events still line up with the hour labels", () => {
  // 8 March 2026 has 23 hours in Los Angeles; 3 PM is 14 elapsed hours after midnight.
  assert.deepEqual(
    place("2026-03-08", "2026-03-08T15:00:00-07:00", "2026-03-08T16:00:00-07:00"),
    [15, 1],
  );
  assert.deepEqual(
    place("2026-03-08", "2026-03-08T23:00:00-07:00", "2026-03-09T00:00:00-07:00"),
    [23, 1],
  );
});

test("the day clocks go back, events are not pushed an hour down", () => {
  // 1 November 2026 has 25 hours in Los Angeles.
  assert.deepEqual(
    place("2026-11-01", "2026-11-01T09:00:00-08:00", "2026-11-01T10:00:00-08:00"),
    [9, 1],
  );
  // The grid ends at midnight, not an hour after it.
  assert.deepEqual(
    place("2026-11-01", "2026-11-01T22:00:00-08:00", "2026-11-02T03:00:00-08:00"),
    [22, 2],
  );
});

test("overnight events are clipped to the day and overlapping ones share the width", () => {
  assert.deepEqual(
    place("2026-06-10", "2026-06-09T22:00:00-07:00", "2026-06-10T01:00:00-07:00"),
    [0, 1],
  );
  const lanes = layoutDay(
    [
      event("a", "2026-06-10T09:00:00-07:00", "2026-06-10T10:00:00-07:00"),
      event("b", "2026-06-10T09:30:00-07:00", "2026-06-10T10:30:00-07:00"),
      event("c", "2026-06-10T11:00:00-07:00", "2026-06-10T12:00:00-07:00"),
    ],
    "2026-06-10",
  ).map((item) => [item.event.id, item.lane, item.lanes]);
  assert.deepEqual(lanes, [
    ["a", 0, 2],
    ["b", 1, 2],
    ["c", 0, 1],
  ]);
});
