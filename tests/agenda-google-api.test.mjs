import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { URL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

// Exercise the real adapter while replacing authentication and every HTTP request.
const output = await build({
  entryPoints: [new URL("../main/services/google-api.ts", import.meta.url).pathname],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
  plugins: [
    {
      name: "fake-auth",
      setup(api) {
        api.onResolve({ filter: /google-auth\.js$/ }, () => ({
          path: "fake-auth",
          namespace: "fixture",
        }));
        api.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents:
            'export class GoogleAuthError extends Error {} export async function getGoogleAccessToken(){return "fixture-token"}',
          loader: "js",
        }));
      },
    },
  ],
});
const adapter = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`
);
const json = (body, status = 200) =>
  new globalThis.Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
const originalFetch = globalThis.fetch;
// The calendar list is reused between reads; each test starts without one.
test.beforeEach(() => adapter.clearCalendarListCache?.());

test("Tasks paginates task lists and tasks, retaining list identity", async () => {
  const calls = [];
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    calls.push(url);
    if (url.pathname.endsWith("/@me/lists"))
      return json(
        url.searchParams.has("pageToken")
          ? { items: [{ id: "b", title: "B" }] }
          : { items: [{ id: "a", title: "A" }], nextPageToken: "lists-next" },
      );
    if (url.pathname.includes("/lists/a/"))
      return json(
        url.searchParams.has("pageToken")
          ? { items: [{ id: "two", title: "Second" }] }
          : { items: [{ id: "shared", title: "First" }], nextPageToken: "tasks-next" },
      );
    if (url.pathname.includes("/lists/b/"))
      return json({ items: [{ id: "shared", title: "Separate task" }] });
    throw new Error(`Unexpected fixture request ${url.pathname}`);
  };
  try {
    const result = await adapter.listTasksWithCoverage();
    assert.equal(result.items.length, 3);
    assert.equal(result.coverage.complete, true);
    assert.deepEqual(
      result.items.filter((x) => x.id === "shared").map((x) => x.listId),
      ["a", "b"],
    );
    assert.ok(calls.some((x) => x.searchParams.get("pageToken") === "lists-next"));
    assert.ok(calls.some((x) => x.searchParams.get("pageToken") === "tasks-next"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Tasks marks capped data partial rather than claiming a complete total", async () => {
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    if (url.pathname.endsWith("/@me/lists")) return json({ items: [{ id: "a", title: "A" }] });
    return json({
      items: Array.from({ length: 100 }, (_, i) => ({
        id: `${url.searchParams.get("pageToken") ?? "first"}-${i}`,
        title: `Fixture ${i}`,
      })),
      nextPageToken: "more",
    });
  };
  try {
    const result = await adapter.listTasksWithCoverage();
    assert.equal(result.items.length, 200);
    assert.equal(result.coverage.complete, false);
    assert.equal(result.coverage.reason, "item-cap");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Calendar access limited to primary is explicitly incomplete for planning", async () => {
  globalThis.fetch = async (input) =>
    new URL(input).pathname.endsWith("/calendarList")
      ? json({ error: { message: "fixture permission" } }, 403)
      : json({ items: [] });
  try {
    const result = await adapter.listEventsBetweenWithCoverage(
      new Date("2027-01-01"),
      new Date("2027-01-02"),
      {},
    );
    assert.equal(result.coverage.complete, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("A calendar block uses a stable event ID and recovers a confirmed conflict", async () => {
  const id = "12345678-1234-4234-8234-123456789abc";
  const eventId = `da${id.replace(/-/g, "")}`;
  let creates = 0;
  let persisted;
  globalThis.fetch = async (input, options) => {
    const url = new URL(input);
    if (options.method === "POST") {
      creates++;
      const body = JSON.parse(options.body);
      assert.equal(body.id, eventId);
      assert.equal(body.extendedProperties.private.workDashboardAgendaRequestId, id);
      if (persisted) return json({ error: { message: "duplicate" } }, 409);
      persisted = { id: eventId, extendedProperties: body.extendedProperties };
      return json(persisted);
    }
    assert.ok(url.pathname.endsWith(`/${eventId}`));
    return json(persisted);
  };
  try {
    const input = {
      title: "Fixture",
      date: "2027-01-01",
      startTime: "09:00",
      endTime: "09:30",
      timeZone: "America/Los_Angeles",
    };
    assert.deepEqual(await adapter.createAgendaEvent(input, id), { id: eventId });
    assert.deepEqual(await adapter.createAgendaEvent(input, id), { id: eventId });
    assert.equal(creates, 2);
    assert.deepEqual(await adapter.findAgendaEvent(id, new Date("2027-01-01")), { id: eventId });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("treats a non-primary invitation as mine even beyond the 20-attendee cap", async () => {
  const attendees = Array.from({ length: 30 }, (_, index) => ({
    email: index === 24 ? "miles@example.com" : `person${index}@example.com`,
    responseStatus: "accepted",
  }));
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    if (url.pathname.endsWith("/calendarList"))
      return json({
        items: [
          { id: "miles@example.com", summary: "Miles", primary: true, selected: true },
          { id: "team@group.calendar.google.com", summary: "Team", selected: true },
        ],
      });
    if (url.pathname.includes("team%40group"))
      return json({
        items: [
          {
            id: "team-event",
            iCalUID: "planning@google.com",
            summary: "Planning",
            start: { dateTime: "2027-01-01T10:00:00Z" },
            end: { dateTime: "2027-01-01T11:00:00Z" },
            attendees,
          },
        ],
      });
    return json({
      items: [
        {
          id: "declined-event",
          summary: "Optional sync",
          start: { dateTime: "2027-01-01T12:00:00Z" },
          end: { dateTime: "2027-01-01T12:30:00Z" },
          attendees: [
            { email: "miles@example.com", self: true, responseStatus: "declined" },
            { email: "sam@example.com", responseStatus: "accepted" },
          ],
        },
      ],
    });
  };
  try {
    const { items } = await adapter.listEventsBetweenWithCoverage(
      new Date("2027-01-01"),
      new Date("2027-01-02"),
      {},
      "Miles@Example.com",
    );
    const team = items.find((event) => event.id === "team-event");
    assert.equal(team.selfInvited, true);
    assert.equal(team.primaryCalendar, false);
    assert.equal(team.iCalUID, "planning@google.com");
    assert.equal(team.attendees.length, 20);
    const declined = items.find((event) => event.id === "declined-event");
    assert.equal(declined.primaryCalendar, true);
    assert.equal(declined.selfResponse, "declined");
    assert.equal(declined.selfInvited, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// Google's own error bodies for the two kinds of 403 a calendar list request can get.
const quota403 = (headers = { "retry-after": "0.001" }) =>
  new globalThis.Response(
    JSON.stringify({
      error: {
        code: 403,
        message:
          "Quota exceeded for quota metric 'Queries' and limit 'Queries per minute per user' of service 'calendar-json.googleapis.com'.",
        errors: [{ domain: "usageLimits", reason: "rateLimitExceeded" }],
        status: "PERMISSION_DENIED",
      },
    }),
    { status: 403, headers: { "content-type": "application/json", ...headers } },
  );
const scope403 = () =>
  json(
    {
      error: {
        code: 403,
        message: "Request had insufficient authentication scopes.",
        errors: [{ domain: "global", reason: "insufficientPermissions" }],
        status: "PERMISSION_DENIED",
      },
    },
    403,
  );
const twoCalendars = () =>
  json({
    items: [
      { id: "primary-id", summary: "Me", primary: true },
      { id: "work", summary: "Work", selected: true },
    ],
  });
const isList = (input) => new URL(input).pathname.endsWith("/calendarList");

test("A quota 403 on the calendar list is reported as Google being busy, not as missing access", async () => {
  let listCalls = 0;
  globalThis.fetch = async (input) => {
    if (!isList(input)) return json({ items: [] });
    listCalls++;
    return quota403();
  };
  try {
    await assert.rejects(adapter.listCalendars(), (error) => {
      assert.equal(error.status, 403);
      assert.equal(error.reason, "rateLimitExceeded");
      assert.equal(error.rateLimited, true);
      assert.match(error.message, /^Google is busy right now\. Try again in a minute\./);
      assert.match(error.message, /Queries per minute per user/);
      return true;
    });
    assert.equal(listCalls, 4, "retried with backoff before giving up");
    await assert.rejects(
      adapter.listEventsBetweenWithCoverage(new Date("2027-01-01"), new Date("2027-01-02"), {}),
      /Google is busy/,
      "events must not silently fall back to the primary calendar",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

for (const reason of ["userRateLimitExceeded", "quotaExceeded"]) {
  test(`A 403 with reason ${reason} is treated as a rate limit`, async () => {
    globalThis.fetch = async () =>
      new globalThis.Response(
        JSON.stringify({ error: { message: "limit", errors: [{ reason }] } }),
        { status: 403, headers: { "retry-after": "0.001" } },
      );
    try {
      await assert.rejects(adapter.listCalendars(), (error) => error.rateLimited === true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}

test("A brief quota 403 is retried and the full calendar list comes back", async () => {
  let listCalls = 0;
  globalThis.fetch = async (input) => {
    if (!isList(input)) return json({ items: [] });
    return ++listCalls === 1 ? quota403() : twoCalendars();
  };
  try {
    const result = await adapter.listCalendars();
    assert.equal(result.limited, false);
    assert.deepEqual(
      result.calendars.map((calendar) => calendar.id),
      ["primary-id", "work"],
    );
    assert.equal(listCalls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("A missing-scope 403 on the calendar list still means primary calendar only", async () => {
  globalThis.fetch = async (input) => (isList(input) ? scope403() : json({ items: [] }));
  try {
    const result = await adapter.listCalendars();
    assert.equal(result.limited, true);
    assert.deepEqual(
      result.calendars.map((calendar) => calendar.id),
      ["primary"],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Calendar reads in a burst share one calendar list request", async () => {
  const requests = [];
  globalThis.fetch = async (input) => {
    requests.push(new URL(input).pathname);
    return isList(input) ? twoCalendars() : json({ items: [] });
  };
  try {
    const range = [new Date("2027-01-01"), new Date("2027-01-02"), {}];
    await Promise.all([
      adapter.listCalendars(),
      adapter.listEventsBetweenWithCoverage(...range),
      adapter.listEventsBetweenWithCoverage(...range),
      adapter.listEventsBetweenWithCoverage(...range),
    ]);
    await adapter.listEventsBetweenWithCoverage(...range);
    assert.equal(requests.filter((path) => path.endsWith("/calendarList")).length, 1);
    assert.equal(requests.filter((path) => path.endsWith("/events")).length, 8);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("The known calendars are kept when a later list refresh hits the quota", async () => {
  const originalNow = Date.now;
  let throttled = false;
  const eventCalendars = [];
  globalThis.fetch = async (input) => {
    if (isList(input)) return throttled ? quota403() : twoCalendars();
    eventCalendars.push(decodeURIComponent(new URL(input).pathname.split("/").at(-2)));
    return json({ items: [] });
  };
  try {
    assert.equal((await adapter.listCalendars()).calendars.length, 2);
    throttled = true;
    const later = originalNow() + 5 * 60_000;
    Date.now = () => later;
    const list = await adapter.listCalendars();
    assert.equal(list.limited, false);
    assert.equal(list.calendars.length, 2);
    const events = await adapter.listEventsBetweenWithCoverage(
      new Date("2027-01-01"),
      new Date("2027-01-02"),
      {},
    );
    assert.equal(events.coverage.complete, true);
    assert.deepEqual(eventCalendars.sort(), ["primary-id", "work"]);
  } finally {
    Date.now = originalNow;
    globalThis.fetch = originalFetch;
  }
});

test("The calendar list is forgotten on an account change and refreshed after a minute", async () => {
  const originalNow = Date.now;
  let listCalls = 0;
  globalThis.fetch = async (input) => {
    if (isList(input)) listCalls++;
    return isList(input) ? twoCalendars() : json({ items: [] });
  };
  try {
    await adapter.listCalendars();
    await adapter.listCalendars();
    assert.equal(listCalls, 1);
    adapter.clearCalendarListCache();
    await adapter.listCalendars();
    assert.equal(listCalls, 2);
    const later = originalNow() + 61_000;
    Date.now = () => later;
    await adapter.listCalendars();
    assert.equal(listCalls, 3);
  } finally {
    Date.now = originalNow;
    globalThis.fetch = originalFetch;
  }
});
