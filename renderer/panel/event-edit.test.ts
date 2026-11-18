import assert from "node:assert/strict";
import test from "node:test";

import { eventDraft, eventFields, eventFieldsChanged, eventMovedBy } from "./event-edit";

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: "e1",
    title: "Design review",
    start: new Date(2026, 9, 20, 14, 0).toISOString(),
    end: new Date(2026, 9, 20, 15, 0).toISOString(),
    allDay: false,
    location: "Room 4",
    description: "<p>Agenda</p>",
    htmlLink: null,
    meetLink: null,
    calendarId: "primary",
    calendarName: "Calendar",
    calendarColor: null,
    attendees: [],
    ...overrides,
  };
}

test("an untouched event has nothing to save and no changed times", () => {
  const item = event();
  const fields = eventFields(item);
  assert.deepEqual(fields, {
    title: "Design review",
    location: "Room 4",
    allDay: false,
    start: "2026-10-20T14:00",
    end: "2026-10-20T15:00",
  });
  assert.equal(eventFieldsChanged(item, fields), false);
  assert.equal(eventDraft(item, fields)?.timesChanged, false);
});

test("a retitled event keeps its times and never sends a description", () => {
  const item = event();
  const draft = eventDraft(item, { ...eventFields(item), title: " Design sync " });
  assert.deepEqual(draft, {
    title: "Design sync",
    location: "Room 4",
    allDay: false,
    start: item.start,
    end: item.end,
    timesChanged: false,
  });
  assert.equal("description" in (draft ?? {}), false);
});

test("an empty title or an end before the start can't be saved", () => {
  const item = event();
  assert.equal(eventDraft(item, { ...eventFields(item), title: " " }), null);
  assert.equal(eventDraft(item, { ...eventFields(item), end: "2026-10-20T13:00" }), null);
});

test("moving a timed event a day keeps its clock time and length", () => {
  const item = event();
  assert.deepEqual(eventMovedBy(item, 1), {
    title: "Design review",
    location: "Room 4",
    allDay: false,
    start: new Date(2026, 9, 21, 14, 0).toISOString(),
    end: new Date(2026, 9, 21, 15, 0).toISOString(),
    timesChanged: true,
  });
});

test("moving an all-day event a day keeps its exclusive end one past the last day", () => {
  const item = event({ allDay: true, start: "2026-10-30", end: "2026-11-01" });
  assert.deepEqual(eventFields(item), {
    title: "Design review",
    location: "Room 4",
    allDay: true,
    start: "2026-10-30",
    end: "2026-10-31",
  });
  const moved = eventMovedBy(item, 1);
  assert.equal(moved?.start, "2026-10-31");
  assert.equal(moved?.end, "2026-11-02");
  assert.equal(moved?.timesChanged, true);
});
