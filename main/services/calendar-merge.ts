// Combines Google Calendar and Mac Calendar (EventKit) events into one calendar listing.
// Pure: callers load each source and pass the outcome, so the rules are testable without either.

import type { CalendarEventItem, SourceCoverage, SourceResult } from "../shared-types.js";

export type GoogleAuthReason =
  | "needs-setup"
  | "not-connected"
  | "not-granted"
  | "mail-not-connected";

export type GoogleCalendarOutcome =
  | { kind: "ok"; items: CalendarEventItem[]; coverage: SourceCoverage }
  | { kind: "auth"; reason: GoogleAuthReason }
  | { kind: "error"; error: unknown };

export type MacCalendarOutcome =
  /** Calendar access is granted and the shown Mac calendars were read. */
  | { kind: "ok"; items: CalendarEventItem[]; truncated: boolean }
  /** No Mac calendar access, so this source adds nothing. */
  | { kind: "off" }
  | { kind: "error"; error: unknown };

function startMs(event: CalendarEventItem): number {
  if (!event.allDay) return new Date(event.start).getTime();
  const [y, m, d] = event.start.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}

/** One meeting seen through both Google and a Google account added to the Calendar app. */
function sameOccurrence(a: CalendarEventItem, b: CalendarEventItem): boolean {
  return (
    Boolean(a.iCalUID) &&
    a.iCalUID === b.iCalUID &&
    a.allDay === b.allDay &&
    (a.allDay ? a.start === b.start : startMs(a) === startMs(b))
  );
}

/** Google copies win; a Mac copy of the same occurrence is dropped. Sorted by start. */
export function mergeCalendarEvents(
  google: CalendarEventItem[],
  mac: CalendarEventItem[],
): CalendarEventItem[] {
  const byUid = new Map<string, CalendarEventItem[]>();
  for (const event of google) {
    if (!event.iCalUID) continue;
    byUid.set(event.iCalUID, [...(byUid.get(event.iCalUID) ?? []), event]);
  }
  const unique = mac.filter(
    (event) =>
      !event.iCalUID || !(byUid.get(event.iCalUID) ?? []).some((g) => sameOccurrence(g, event)),
  );
  return [...google, ...unique].sort((a, b) => startMs(a) - startMs(b));
}

/**
 * The calendar source's result. Google keeps its own setup and reconnect states while an account
 * is connected, so a broken sign-in still asks to be fixed. Without a Google account, or when its
 * calendar permission was left off, Mac calendars alone make a working calendar, and a Mac read
 * failure then surfaces as the calendar's error. A non-auth Google failure is rethrown, as before
 * Mac calendars existed.
 */
export function combineCalendarSources(
  google: GoogleCalendarOutcome,
  mac: MacCalendarOutcome,
  googleConnected: boolean,
): SourceResult<CalendarEventItem> {
  if (google.kind === "error") throw google.error;
  if (google.kind === "auth") {
    const googleOptional =
      !googleConnected || google.reason === "not-granted" || google.reason === "needs-setup";
    if (googleOptional && mac.kind === "error") throw mac.error;
    if (!googleOptional || mac.kind !== "ok") return { state: google.reason };
    return {
      state: "ok",
      items: mergeCalendarEvents([], mac.items),
      coverage: {
        complete: !mac.truncated,
        ...(mac.truncated ? { reason: "item-cap" as const } : {}),
        loaded: mac.items.length,
      },
    };
  }
  if (mac.kind === "off") return { state: "ok", items: google.items, coverage: google.coverage };
  const macItems = mac.kind === "ok" ? mac.items : [];
  const items = mergeCalendarEvents(google.items, macItems);
  const macComplete = mac.kind === "ok" && !mac.truncated;
  return {
    state: "ok",
    items,
    coverage: {
      complete: google.coverage.complete && macComplete,
      ...(google.coverage.reason
        ? { reason: google.coverage.reason }
        : mac.kind === "ok" && mac.truncated
          ? { reason: "item-cap" as const }
          : {}),
      loaded: items.length,
    },
  };
}
