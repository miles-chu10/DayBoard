import type { CalendarEventItem } from "@main/shared-types";

import {
  dateTimeInputToIso,
  eventEditorFields,
  eventTimesAreValid,
  eventTimesChanged,
  localDateTimeInput,
  nextCalendarDate,
} from "../lib/item-editor-form";

export interface EventFields {
  title: string;
  location: string;
  allDay: boolean;
  /** A `datetime-local` value for a timed event; YYYY-MM-DD for an all-day one. */
  start: string;
  /** Inclusive end date for an all-day event. */
  end: string;
}

export interface EventDraft {
  title: string;
  location: string;
  allDay: boolean;
  /** RFC 3339 for a timed event; YYYY-MM-DD for an all-day one. */
  start: string;
  /** Exclusive end date for an all-day event. */
  end: string;
  timesChanged: boolean;
}

export function eventFields(event: CalendarEventItem): EventFields {
  const { title, location, allDay, start, end } = eventEditorFields(event);
  return { title, location, allDay, start, end };
}

/** The update for an event's edited fields, or null while the title or times can't be saved. */
export function eventDraft(event: CalendarEventItem, fields: EventFields): EventDraft | null {
  if (!fields.title.trim() || !eventTimesAreValid(fields)) return null;
  return {
    title: fields.title.trim(),
    location: fields.location,
    allDay: fields.allDay,
    start: fields.allDay ? fields.start : dateTimeInputToIso(fields.start),
    end: fields.allDay ? nextCalendarDate(fields.end) : dateTimeInputToIso(fields.end),
    timesChanged: eventTimesChanged(event, fields),
  };
}

export function eventFieldsChanged(event: CalendarEventItem, fields: EventFields): boolean {
  const original = eventFields(event);
  return (
    fields.title.trim() !== original.title ||
    fields.location !== original.location ||
    eventTimesChanged(event, fields)
  );
}

function shiftLocal(value: string, days: number): string {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return localDateTimeInput(date.toISOString());
}

function shiftDate(value: string, days: number): string {
  let date = value;
  for (let step = 0; step < days; step += 1) date = nextCalendarDate(date);
  return date;
}

/** The same event `days` later, at the same local clock time. */
export function eventMovedBy(event: CalendarEventItem, days: number): EventDraft | null {
  const fields = eventFields(event);
  return eventDraft(event, {
    ...fields,
    start: fields.allDay ? shiftDate(fields.start, days) : shiftLocal(fields.start, days),
    end: fields.allDay ? shiftDate(fields.end, days) : shiftLocal(fields.end, days),
  });
}
