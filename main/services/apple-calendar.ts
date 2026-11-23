// Calendars from the Mac's Calendar app (iCloud, Exchange, CalDAV, subscribed and local), read and
// written through the bundled EventKit helper that already serves Apple Reminders. DayBoard never
// sees an Apple password: macOS grants calendar access to the app, separately from Reminders.

import { logger, reminders, systemPreferences } from "../platform/index.js";
import type { CalendarInfo, NativeCalendarEvent } from "../platform/reminders.js";

import type {
  CalendarEventItem,
  CreateEventInput,
  MacCalendarInfo,
  MacCalendarsResult,
  RemindersAccess,
  SourceCoverage,
  SourceResult,
} from "../shared-types.js";
import {
  combineCalendarSources,
  type GoogleAuthReason,
  type GoogleCalendarOutcome,
  type MacCalendarOutcome,
} from "./calendar-merge.js";
import type { UpdateEventInput } from "../../shared/item-edits.js";
import {
  APPLE_CALENDAR_PREFIX,
  appleCalendarKey,
  decodeAppleEventId,
  encodeAppleEventId,
  isAppleCalendarId,
  nativeCalendarId,
} from "../../shared/apple-calendar.js";

export { isAppleCalendarId } from "../../shared/apple-calendar.js";

const EVENT_LIMIT = 1000;
const JOIN_HOST =
  /(^|\.)(zoom\.us|meet\.google\.com|teams\.microsoft\.com|teams\.live\.com|webex\.com|whereby\.com)$/i;

export interface AppleEventList {
  items: CalendarEventItem[];
  truncated: boolean;
}

/** Calendar access, or "unknown" when the helper can't tell. Never throws, so accounts still load. */
export async function getCalendarAccess(): Promise<RemindersAccess> {
  try {
    return await reminders.eventStatus();
  } catch (error) {
    logger.warn("calendar", "Could not read Calendar access", error);
    return "unknown";
  }
}

export async function requestCalendarAccess(): Promise<RemindersAccess> {
  const status = await reminders.eventStatus();
  return status === "not-determined" ? reminders.requestEventAccess() : status;
}

export async function openCalendarPrivacySettings(): Promise<void> {
  await systemPreferences.openPrivacySettings("calendars");
}

/**
 * Calendar.app can hold the same Google account DayBoard reads directly. Those calendars start
 * hidden so meetings don't show twice; events are also matched by their shared iCalendar UID.
 */
export function looksLikeGoogle(calendar: CalendarInfo, googleEmail: string | null): boolean {
  if (calendar.type !== "caldav") return false;
  const source = calendar.source?.trim().toLowerCase() ?? "";
  const email = googleEmail?.trim().toLowerCase() ?? "";
  return (
    (email !== "" && (source === email || calendar.title.trim().toLowerCase() === email)) ||
    /\b(google|gmail)\b/.test(source)
  );
}

function writable(calendar: CalendarInfo): boolean {
  return (
    calendar.allowsContentModifications &&
    !calendar.isSubscribed &&
    !calendar.isImmutable &&
    calendar.type !== "birthday" &&
    calendar.type !== "subscription"
  );
}

function toInfo(calendar: CalendarInfo, googleEmail: string | null): MacCalendarInfo {
  const google = looksLikeGoogle(calendar, googleEmail);
  return {
    id: appleCalendarKey(calendar.id),
    name: calendar.title || "Calendar",
    color: calendar.color,
    account: calendar.source,
    // A Google account starts hidden only when DayBoard already shows Google Calendar itself.
    defaultVisible: !(google && googleEmail) && calendar.type !== "birthday",
    writable: writable(calendar),
    google,
  };
}

export async function listMacCalendars(googleEmail: string | null): Promise<MacCalendarInfo[]> {
  const calendars = await reminders.getEventCalendars();
  return calendars
    .filter((calendar) => calendar.entityTypes.includes("event"))
    .map((calendar) => toInfo(calendar, googleEmail))
    .sort(
      (a, b) =>
        Number(a.google) - Number(b.google) ||
        (a.account ?? "").localeCompare(b.account ?? "") ||
        a.name.localeCompare(b.name),
    );
}

function joinLink(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && JOIN_HOST.test(parsed.hostname) ? url : null;
  } catch {
    return null;
  }
}

export function appleEventToItem(
  event: NativeCalendarEvent,
  calendar: MacCalendarInfo,
  fullDescription = false,
): CalendarEventItem {
  const notes = event.notes?.trim() || null;
  return {
    id: encodeAppleEventId({
      id: event.id,
      occurrenceDate: event.occurrenceDate,
      start: event.startInstant,
    }),
    title: event.title.trim() || "(No title)",
    start: event.start,
    end: event.end,
    allDay: event.allDay,
    location: event.location?.trim() || null,
    description: notes && !fullDescription ? notes.slice(0, 600) : notes,
    htmlLink: null,
    meetLink: joinLink(event.url),
    calendarId: calendar.id,
    calendarName: calendar.name,
    calendarColor: calendar.color,
    attendees: event.attendees.slice(0, 20),
    primaryCalendar: false,
    // A personal event with nobody invited is the user's own; otherwise they must be on it.
    selfInvited: !event.hasAttendees || event.organizerIsSelf || event.selfStatus !== null,
    selfResponse: event.selfStatus,
    ...(event.externalId ? { iCalUID: event.externalId } : {}),
    provider: "apple",
    ...(calendar.writable ? {} : { readOnly: true }),
  };
}

/** Events on the Mac calendars that are shown, between two instants. */
export async function listAppleEventsBetween(
  start: Date,
  end: Date,
  visibility: Record<string, boolean>,
  googleEmail: string | null,
): Promise<AppleEventList> {
  const calendars = await listMacCalendars(googleEmail);
  const shown = calendars.filter((calendar) => visibility[calendar.id] ?? calendar.defaultVisible);
  if (shown.length === 0) return { items: [], truncated: false };
  const byNativeId = new Map(shown.map((calendar) => [nativeCalendarId(calendar.id), calendar]));
  const result = await reminders.getEvents({
    start: start.toISOString(),
    end: end.toISOString(),
    calendarIds: [...byNativeId.keys()],
    limit: EVENT_LIMIT,
  });
  const items = result.events.flatMap((event) => {
    const calendar = byNativeId.get(event.calendarId);
    return calendar && event.id ? [appleEventToItem(event, calendar)] : [];
  });
  return { items, truncated: result.truncated };
}

/** Mac calendars and the access state, for Settings. Empty until access is granted. */
export async function getMacCalendars(googleEmail: string | null): Promise<MacCalendarsResult> {
  const access = await getCalendarAccess();
  return {
    access,
    calendars: access === "full-access" ? await listMacCalendars(googleEmail) : [],
  };
}

/** The Mac side of a calendar listing; failures are logged and reported, never thrown. */
export async function macCalendarOutcome(
  start: Date,
  end: Date,
  visibility: Record<string, boolean>,
  googleEmail: string | null,
): Promise<MacCalendarOutcome> {
  try {
    if ((await getCalendarAccess()) !== "full-access") return { kind: "off" };
    const { items, truncated } = await listAppleEventsBetween(start, end, visibility, googleEmail);
    return { kind: "ok", items, truncated };
  } catch (error) {
    logger.warn("calendar", "Could not read Mac calendars", error);
    return { kind: "error", error };
  }
}

export interface CalendarListingOptions {
  start: Date;
  end: Date;
  visibility: Record<string, boolean>;
  googleEmail: string | null;
  googleConnected: boolean;
  /** Loads the Google side; passed in so this module never signs in to Google itself. */
  google: () => Promise<{ items: CalendarEventItem[]; coverage: SourceCoverage }>;
  /** The Google sign-in state an error stands for, or null for any other failure. */
  authReason: (error: unknown) => GoogleAuthReason | null;
}

/** Google Calendar and Mac calendar events between two instants, as one calendar source. */
export async function listCalendarEvents(
  options: CalendarListingOptions,
): Promise<SourceResult<CalendarEventItem>> {
  const [google, mac] = await Promise.all([
    options.google().then(
      (result): GoogleCalendarOutcome => ({ kind: "ok", ...result }),
      (error: unknown): GoogleCalendarOutcome => {
        const reason = options.authReason(error);
        return reason ? { kind: "auth", reason } : { kind: "error", error };
      },
    ),
    macCalendarOutcome(options.start, options.end, options.visibility, options.googleEmail),
  ]);
  return combineCalendarSources(google, mac, options.googleConnected);
}

async function calendarFor(calendarId: string, googleEmail: string | null = null) {
  const calendars = await listMacCalendars(googleEmail);
  const calendar = calendars.find((candidate) => candidate.id === calendarId);
  if (!calendar) throw new Error("This iCloud calendar is no longer available.");
  return calendar;
}

function refFor(calendarId: string, eventId: string) {
  const ref = decodeAppleEventId(eventId);
  if (!isAppleCalendarId(calendarId) || !ref)
    throw new Error("This is not an iCloud Calendar event.");
  return ref;
}

/** Loads one event or occurrence with its full notes, for the editor. */
export async function getAppleEventForEditing(
  calendarId: string,
  eventId: string,
): Promise<CalendarEventItem> {
  const ref = refFor(calendarId, eventId);
  const [calendar, event] = await Promise.all([calendarFor(calendarId), reminders.getEvent(ref)]);
  return appleEventToItem(event, calendar, true);
}

/** Edits one event, or only the chosen occurrence of a recurring event. */
export async function updateAppleEvent(input: UpdateEventInput): Promise<CalendarEventItem> {
  const ref = refFor(input.calendarId, input.eventId);
  const calendar = await calendarFor(input.calendarId);
  if (!calendar.writable) throw new Error("This iCloud calendar is read-only.");
  const updated = await reminders.updateEvent(ref, {
    title: input.title,
    ...(input.description === undefined ? {} : { notes: input.description }),
    location: input.location,
    ...(input.timesChanged
      ? {
          times: input.allDay
            ? { allDay: true as const, start: input.start, end: input.end }
            : {
                allDay: false as const,
                start: input.start,
                end: input.end,
                timeZone: input.timeZone,
              },
        }
      : {}),
  });
  return appleEventToItem(updated, calendar);
}

/** Deletes one event, or only the chosen occurrence of a recurring event. */
export async function deleteAppleEvent(calendarId: string, eventId: string): Promise<void> {
  const ref = refFor(calendarId, eventId);
  const calendar = await calendarFor(calendarId);
  if (!calendar.writable) throw new Error("This iCloud calendar is read-only.");
  await reminders.deleteEvent(ref);
}

function addHour(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const total = Math.min(h * 60 + m + 60, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function nextDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/**
 * Creates an event on a Mac calendar, or on Calendar's default calendar when `calendarId` is
 * omitted. Returns its identity, so Quick Capture can undo exactly this event.
 */
export async function createAppleEvent(
  input: CreateEventInput,
  calendarId?: string,
): Promise<{ calendarId: string; eventId: string }> {
  if (input.startTime && input.endTime && input.endTime <= input.startTime)
    throw new Error("The event's end time must be after its start time.");
  const created = await reminders.createEvent({
    title: input.title,
    notes: input.notes || undefined,
    ...(calendarId ? { calendarId: nativeCalendarId(calendarId) } : {}),
    times: input.startTime
      ? {
          allDay: false,
          start: {
            kind: "date-time",
            dateTime: `${input.date}T${input.startTime}:00`,
            timeZone: input.timeZone,
          },
          end: {
            kind: "date-time",
            dateTime: `${input.date}T${input.endTime ?? addHour(input.startTime)}:00`,
            timeZone: input.timeZone,
          },
          timeZone: input.timeZone,
        }
      : { allDay: true, start: input.date, end: nextDate(input.date) },
  });
  return {
    calendarId: `${APPLE_CALENDAR_PREFIX}${created.calendarId}`,
    eventId: encodeAppleEventId({
      id: created.id,
      occurrenceDate: created.occurrenceDate,
      start: created.startInstant,
    }),
  };
}
