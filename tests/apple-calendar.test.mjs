import assert from "node:assert/strict";
import test from "node:test";

import { fixtureImport } from "./fixture-imports.mjs";
import { loadTs } from "./helpers/load-ts.mjs";

const ids = await loadTs("shared/apple-calendar.ts");
const merge = await loadTs("main/services/calendar-merge.ts");

function event(overrides) {
  return {
    id: "e",
    title: "Event",
    start: "2026-11-20T17:00:00.000Z",
    end: "2026-11-20T18:00:00.000Z",
    allDay: false,
    location: null,
    description: null,
    htmlLink: null,
    meetLink: null,
    calendarId: "primary",
    calendarName: "Work",
    calendarColor: null,
    attendees: [],
    ...overrides,
  };
}

const complete = { complete: true, loaded: 0 };

test("Mac event IDs round-trip the occurrence and reject anything else", () => {
  const ref = {
    id: "ABC-123:é",
    occurrenceDate: "2026-11-20T17:00:00Z",
    start: "2026-11-20T17:00:00Z",
  };
  const encoded = ids.encodeAppleEventId(ref);
  assert.match(encoded, /^ek1\.[A-Za-z0-9_-]+$/);
  assert.deepEqual(ids.decodeAppleEventId(encoded), ref);
  assert.deepEqual(
    ids.decodeAppleEventId(ids.encodeAppleEventId({ id: "x", occurrenceDate: null, start: null })),
    { id: "x", occurrenceDate: null, start: null },
  );
  for (const bad of ["google-event-id", "ek1.", "ek1.!!!", `ek1.${btoa("[1,2,3]")}`])
    assert.equal(ids.decodeAppleEventId(bad), null, bad);
  assert.equal(ids.nativeCalendarId("apple:CAL-1"), "CAL-1");
  assert.equal(ids.isAppleCalendarId("primary"), false);
});

test("new events follow the setting, falling back to Google, then the Mac default", () => {
  assert.deepEqual(ids.newEventDestination("", true, "full-access"), { kind: "google" });
  assert.deepEqual(ids.newEventDestination("", false, "full-access"), {
    kind: "apple",
    calendarId: null,
  });
  assert.deepEqual(ids.newEventDestination("apple:home", true, "full-access"), {
    kind: "apple",
    calendarId: "apple:home",
  });
  assert.throws(() => ids.newEventDestination("google", false, "full-access"), /isn't connected/);
  assert.throws(() => ids.newEventDestination("", false, "denied"), /Connect Google or allow/);
  assert.throws(
    () => ids.newEventDestination("apple:home", true, "not-determined"),
    /needs access to your iCloud calendars/,
  );
});

test("a meeting seen through Google and the Calendar app shows once, as the Google copy", () => {
  const google = [
    event({ id: "g1", iCalUID: "uid-1", start: "2026-11-20T17:00:00.000Z" }),
    event({ id: "g2", start: "2026-11-20T09:00:00.000Z" }),
  ];
  const mac = [
    // Same occurrence, written with the Mac's offset: dropped.
    event({ id: "m1", iCalUID: "uid-1", start: "2026-11-20T09:00:00-08:00", provider: "apple" }),
    // Another occurrence of the same series: kept.
    event({ id: "m2", iCalUID: "uid-1", start: "2026-11-27T09:00:00-08:00", provider: "apple" }),
    // No UID: kept.
    event({ id: "m3", start: "2026-11-20T12:00:00.000Z", provider: "apple" }),
    event({ id: "m4", allDay: true, start: "2026-11-20", end: "2026-11-21", provider: "apple" }),
  ];
  const merged = merge.mergeCalendarEvents(google, mac);
  assert.deepEqual(
    merged.map((item) => item.id),
    ["m4", "g2", "m3", "g1", "m2"],
  );
});

test("Google keeps its reconnect states, and Mac calendars stand alone without Google", () => {
  const macItems = [event({ id: "m", provider: "apple" })];
  const mac = { kind: "ok", items: macItems, truncated: false };
  const off = { kind: "off" };

  // A connected account whose sign-in broke still asks to be reconnected.
  assert.deepEqual(
    merge.combineCalendarSources({ kind: "auth", reason: "not-connected" }, mac, true),
    { state: "not-connected" },
  );
  // No Google account: Mac calendars are the calendar.
  assert.deepEqual(
    merge.combineCalendarSources({ kind: "auth", reason: "not-connected" }, mac, false),
    { state: "ok", items: macItems, coverage: { complete: true, loaded: 1 } },
  );
  // Calendar permission left off on Google's screen: Mac calendars still show.
  assert.equal(
    merge.combineCalendarSources({ kind: "auth", reason: "not-granted" }, mac, true).state,
    "ok",
  );
  // Neither source: the Google state, as before.
  assert.deepEqual(
    merge.combineCalendarSources({ kind: "auth", reason: "not-connected" }, off, false),
    { state: "not-connected" },
  );
  // Mac calendars alone and their read failed: the calendar shows that error.
  const failure = new Error("helper crashed");
  assert.throws(
    () =>
      merge.combineCalendarSources(
        { kind: "auth", reason: "not-connected" },
        { kind: "error", error: failure },
        false,
      ),
    /helper crashed/,
  );
  // A Google failure that isn't about sign-in is rethrown.
  assert.throws(
    () => merge.combineCalendarSources({ kind: "error", error: failure }, mac, true),
    /helper crashed/,
  );
});

test("a Mac read problem marks Google's listing incomplete instead of hiding it", () => {
  const google = { kind: "ok", items: [event({ id: "g" })], coverage: complete };
  assert.deepEqual(merge.combineCalendarSources(google, { kind: "off" }, true), {
    state: "ok",
    items: google.items,
    coverage: complete,
  });
  const failed = merge.combineCalendarSources(
    google,
    { kind: "error", error: new Error("x") },
    true,
  );
  assert.equal(failed.state, "ok");
  assert.deepEqual(failed.items, google.items);
  assert.equal(failed.coverage.complete, false);
  const capped = merge.combineCalendarSources(
    google,
    { kind: "ok", items: [event({ id: "m", provider: "apple" })], truncated: true },
    true,
  );
  assert.deepEqual(capped.coverage, { complete: false, reason: "item-cap", loaded: 2 });
});

// ── Service: EventKit reads through a stubbed helper ─────────────────────────────────────

const platformStub = `
const state = () => globalThis.__appleCalendarFixture;
export const logger = { warn(...args) { state().warnings.push(args); }, error() {}, info() {} };
export const systemPreferences = { async openPrivacySettings(pane) { state().opened.push(pane); } };
export const reminders = {
  async eventStatus() { return state().access; },
  async requestEventAccess() { state().requested += 1; return "full-access"; },
  async getEventCalendars() { return state().calendars; },
  async getEvents(options) {
    state().queries.push(options);
    if (state().eventsFail) throw new Error("EventKit unavailable");
    return { events: state().events.filter((e) => options.calendarIds.includes(e.calendarId)), truncated: false };
  },
};
`;

function calendar(overrides) {
  return {
    id: "CAL",
    title: "Home",
    color: "#34c759",
    type: "caldav",
    source: "iCloud",
    sourceId: "src",
    entityTypes: ["event"],
    supportedAvailabilities: [],
    allowsContentModifications: true,
    isSubscribed: false,
    isImmutable: false,
    ...overrides,
  };
}

function nativeEvent(overrides) {
  return {
    id: "EV",
    occurrenceDate: "2026-11-20T17:00:00Z",
    startInstant: "2026-11-20T17:00:00Z",
    externalId: null,
    calendarId: "CAL",
    title: "Dentist",
    start: "2026-11-20T09:00:00-08:00",
    end: "2026-11-20T10:00:00-08:00",
    allDay: false,
    location: null,
    notes: null,
    url: null,
    recurring: false,
    attendees: [],
    hasAttendees: false,
    organizerIsSelf: false,
    selfStatus: null,
    ...overrides,
  };
}

async function service(state) {
  globalThis.__appleCalendarFixture = {
    access: "full-access",
    requested: 0,
    opened: [],
    warnings: [],
    queries: [],
    eventsFail: false,
    calendars: [],
    events: [],
    ...state,
  };
  return loadTs("main/services/apple-calendar.ts", [
    {
      name: "apple-calendar-fixture",
      setup(api) {
        api.onResolve({ filter: /.*/ }, (args) =>
          fixtureImport(args.path) === "dayboard:platform"
            ? { path: "dayboard:platform", namespace: "fixture" }
            : undefined,
        );
        api.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: platformStub,
          loader: "js",
        }));
      },
    },
  ]);
}

const range = { start: new Date("2026-11-20T08:00:00Z"), end: new Date("2026-11-21T08:00:00Z") };
const notConnected = Object.assign(new Error("not connected"), { reason: "not-connected" });

test("iCloud events list without Google, writable state and occurrence identity intact", async () => {
  const calendars = [
    calendar({ id: "HOME" }),
    calendar({ id: "HOLIDAYS", title: "US Holidays", type: "subscription", isSubscribed: true }),
    calendar({
      id: "BDAY",
      title: "Birthdays",
      type: "birthday",
      allowsContentModifications: false,
    }),
  ];
  const events = [
    nativeEvent({ id: "A", calendarId: "HOME", url: "https://zoom.us/j/1" }),
    nativeEvent({
      id: "B",
      calendarId: "HOLIDAYS",
      title: "Holiday",
      allDay: true,
      start: "2026-11-20",
      end: "2026-11-21",
    }),
    nativeEvent({ id: "C", calendarId: "BDAY", title: "Birthday" }),
  ];
  const apple = await service({ calendars, events });
  const result = await apple.listCalendarEvents({
    ...range,
    visibility: {},
    googleEmail: null,
    googleConnected: false,
    google: async () => {
      throw notConnected;
    },
    authReason: (error) => error.reason ?? null,
  });
  assert.equal(result.state, "ok");
  // Birthdays start hidden, so only Home and the subscribed calendar are asked for.
  assert.deepEqual(globalThis.__appleCalendarFixture.queries[0].calendarIds, ["HOME", "HOLIDAYS"]);
  const byTitle = Object.fromEntries(result.items.map((item) => [item.title, item]));
  assert.equal(byTitle.Dentist.calendarId, "apple:HOME");
  assert.equal(byTitle.Dentist.provider, "apple");
  assert.equal(byTitle.Dentist.meetLink, "https://zoom.us/j/1");
  assert.equal(byTitle.Dentist.readOnly, undefined);
  assert.equal(byTitle.Holiday.readOnly, true);
  assert.deepEqual(ids.decodeAppleEventId(byTitle.Dentist.id), {
    id: "A",
    occurrenceDate: "2026-11-20T17:00:00Z",
    start: "2026-11-20T17:00:00Z",
  });
});

test("a calendar switched off is never read, and a Google account in Calendar starts hidden", async () => {
  const calendars = [
    calendar({ id: "HOME" }),
    calendar({ id: "WORK", title: "Work" }),
    calendar({ id: "GMAIL", title: "me@example.com", source: "me@example.com" }),
  ];
  const apple = await service({ calendars });
  const listed = await apple.getMacCalendars("me@example.com");
  assert.equal(listed.access, "full-access");
  assert.deepEqual(
    listed.calendars.map((item) => [item.id, item.defaultVisible, item.google]),
    [
      ["apple:HOME", true, false],
      ["apple:WORK", true, false],
      ["apple:GMAIL", false, true],
    ],
  );
  await apple.listCalendarEvents({
    ...range,
    visibility: { "apple:WORK": false },
    googleEmail: "me@example.com",
    googleConnected: true,
    google: async () => ({ items: [], coverage: complete }),
    authReason: () => null,
  });
  assert.deepEqual(globalThis.__appleCalendarFixture.queries[0].calendarIds, ["HOME"]);
});

test("without calendar access, nothing is read and Settings lists no calendars", async () => {
  const apple = await service({ access: "not-determined", calendars: [calendar({})] });
  assert.deepEqual(await apple.getMacCalendars(null), { access: "not-determined", calendars: [] });
  const result = await apple.listCalendarEvents({
    ...range,
    visibility: {},
    googleEmail: null,
    googleConnected: false,
    google: async () => {
      throw notConnected;
    },
    authReason: (error) => error.reason ?? null,
  });
  assert.deepEqual(result, { state: "not-connected" });
  assert.equal(globalThis.__appleCalendarFixture.queries.length, 0);
  assert.equal(await apple.requestCalendarAccess(), "full-access");
  assert.equal(globalThis.__appleCalendarFixture.requested, 1);
});

test("a helper that can't report Calendar access leaves Google's calendar as it was", async () => {
  const apple = await service({ calendars: [calendar({})] });
  globalThis.__appleCalendarFixture.access = Promise.reject(new Error("helper missing"));
  globalThis.__appleCalendarFixture.access.catch(() => {});
  assert.equal(await apple.getCalendarAccess(), "unknown");
  const google = { items: [event({ id: "g" })], coverage: complete };
  const result = await apple.listCalendarEvents({
    ...range,
    visibility: {},
    googleEmail: "me@example.com",
    googleConnected: true,
    google: async () => google,
    authReason: () => null,
  });
  assert.deepEqual(result, { state: "ok", ...google });
  assert.equal(globalThis.__appleCalendarFixture.queries.length, 0);
});

test("read-only Mac calendars refuse edits before EventKit is asked to change anything", async () => {
  const apple = await service({
    calendars: [calendar({ id: "HOLIDAYS", type: "subscription", isSubscribed: true })],
  });
  const eventId = ids.encodeAppleEventId({ id: "B", occurrenceDate: null, start: null });
  await assert.rejects(apple.deleteAppleEvent("apple:HOLIDAYS", eventId), /read-only/);
  await assert.rejects(apple.deleteAppleEvent("primary", eventId), /not an iCloud Calendar event/);
});
