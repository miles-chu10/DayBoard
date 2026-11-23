// Identifiers for Mac Calendar (EventKit) calendars and events, shared by main and the renderer.

export const APPLE_CALENDAR_PREFIX = "apple:";
const EVENT_PREFIX = "ek1.";

export function isAppleCalendarId(calendarId: string): boolean {
  return calendarId.startsWith(APPLE_CALENDAR_PREFIX);
}

export function appleCalendarKey(nativeId: string): string {
  return `${APPLE_CALENDAR_PREFIX}${nativeId}`;
}

export function nativeCalendarId(calendarId: string): string {
  return isAppleCalendarId(calendarId)
    ? calendarId.slice(APPLE_CALENDAR_PREFIX.length)
    : calendarId;
}

export interface AppleEventRef {
  id: string;
  occurrenceDate: string | null;
  start: string | null;
}

function toBase64Url(text: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64Url(value: string): string {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

/** One opaque event ID that also names the occurrence of a recurring event. */
export function encodeAppleEventId(ref: AppleEventRef): string {
  return EVENT_PREFIX + toBase64Url(JSON.stringify([ref.id, ref.occurrenceDate, ref.start]));
}

export function decodeAppleEventId(eventId: string): AppleEventRef | null {
  if (!eventId.startsWith(EVENT_PREFIX)) return null;
  try {
    const value: unknown = JSON.parse(fromBase64Url(eventId.slice(EVENT_PREFIX.length)));
    if (!Array.isArray(value) || value.length !== 3) return null;
    const [id, occurrenceDate, start] = value;
    if (typeof id !== "string" || !id) return null;
    if (occurrenceDate !== null && typeof occurrenceDate !== "string") return null;
    if (start !== null && typeof start !== "string") return null;
    return { id, occurrenceDate, start };
  } catch {
    return null;
  }
}

/** Where a new event goes: Google's primary calendar, or a Mac calendar (null: Calendar's default). */
export type NewEventDestination = { kind: "google" } | { kind: "apple"; calendarId: string | null };

/**
 * Resolves the "New events go to" setting. "" picks Google Calendar when it is connected, otherwise
 * the Mac's default calendar. Throws a readable error when the chosen place is unavailable.
 */
export function newEventDestination(
  choice: string,
  googleConnected: boolean,
  macAccess: string | undefined,
): NewEventDestination {
  const mac = macAccess === "full-access";
  if (choice === "google" || (choice === "" && googleConnected)) {
    if (!googleConnected)
      throw new Error("New events go to Google Calendar, but Google isn't connected.");
    return { kind: "google" };
  }
  if (!mac)
    throw new Error(
      choice === ""
        ? "Connect Google or allow access to your iCloud calendars to add events."
        : "DayBoard needs access to your iCloud calendars to add this event.",
    );
  return { kind: "apple", calendarId: isAppleCalendarId(choice) ? choice : null };
}
