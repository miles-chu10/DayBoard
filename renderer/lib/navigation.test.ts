import assert from "node:assert/strict";
import test from "node:test";
import type { AppSettings } from "@main/shared-types";

import {
  NAV_ITEMS,
  moveSidebarView,
  navTargets,
  sidebarNav,
  sidebarOrderRows,
  sidebarRows,
  visibleNav,
} from "./navigation";

type Source = "tasks" | "reminders" | "mail" | "calendar";

function settings(overrides: {
  sources?: Partial<Record<Source, boolean>>;
  ai?: boolean;
  features?: Partial<Record<string, boolean>>;
}): AppSettings {
  const source = (id: Source) => ({
    enabled: overrides.sources?.[id] ?? true,
    color: "blue",
  });
  return {
    sources: {
      tasks: source("tasks"),
      reminders: source("reminders"),
      mail: source("mail"),
      calendar: source("calendar"),
    },
    ai: {
      enabled: overrides.ai ?? true,
      features: { assistant: true, weeklyReview: true, ...overrides.features },
    },
  } as unknown as AppSettings;
}

test("every view is listed once with a route", () => {
  const routes = NAV_ITEMS.map((item) => item.route);
  assert.equal(new Set(routes).size, routes.length);
  assert.equal(new Set(NAV_ITEMS.map((item) => item.id)).size, NAV_ITEMS.length);
});

test("turned-off sources and AI features leave the list", () => {
  const visible = visibleNav(
    settings({
      sources: { reminders: false },
      features: { weeklyReview: false },
    }),
  );
  assert.deepEqual(
    visible.map((item) => item.id),
    ["home", "agenda", "calendar", "mail", "tasks", "notes", "assistant"],
  );
});

test("with AI off only Home, the Agenda, sources and Notes remain", () => {
  assert.deepEqual(
    visibleNav(settings({ ai: false })).map((item) => item.id),
    ["home", "agenda", "calendar", "mail", "tasks", "reminders", "notes"],
  );
});

test("before settings load every source shows, AI views don't", () => {
  assert.deepEqual(
    visibleNav(undefined).map((item) => item.id),
    ["home", "agenda", "calendar", "mail", "tasks", "reminders", "notes"],
  );
});

test("the sidebar follows the saved order and leaves out hidden views; ⌘K keeps them", () => {
  const custom = {
    ...settings({}),
    general: {
      sidebar: {
        order: ["mail", "home", "notes", "agenda", "calendar", "tasks", "reminders"],
        hidden: ["agenda", "reminders"],
        counts: true,
      },
    },
  } as unknown as AppSettings;
  assert.deepEqual(
    visibleNav(custom).map((item) => item.id),
    ["mail", "home", "notes", "calendar", "tasks", "assistant", "review"],
  );
  assert.deepEqual(
    navTargets(custom).map((item) => item.id),
    ["mail", "home", "notes", "agenda", "calendar", "tasks", "reminders", "assistant", "review"],
  );
});

test("Calendar, Tasks and Reminders sit under the Agenda in their saved order", () => {
  const custom = {
    ...settings({}),
    general: {
      sidebar: {
        order: ["mail", "reminders", "home", "notes", "agenda", "calendar", "tasks"],
        hidden: [],
        counts: true,
      },
    },
  } as unknown as AppSettings;
  assert.deepEqual(
    sidebarRows(custom).map((row) => [row.item.id, row.nested]),
    [
      ["mail", false],
      ["home", false],
      ["notes", false],
      ["agenda", false],
      ["reminders", true],
      ["calendar", true],
      ["tasks", true],
    ],
  );
  // ⌃1–9 follow the rows as drawn, then the AI views.
  assert.deepEqual(
    sidebarNav(custom).map((item) => item.id),
    ["mail", "home", "notes", "agenda", "reminders", "calendar", "tasks", "assistant", "review"],
  );
});

test("with the Agenda hidden its sources are ordinary rows in the saved order", () => {
  const custom = {
    ...settings({ sources: { reminders: false } }),
    general: {
      sidebar: {
        order: ["home", "tasks", "agenda", "calendar", "mail", "reminders", "notes"],
        hidden: ["agenda"],
        counts: true,
      },
    },
  } as unknown as AppSettings;
  assert.deepEqual(
    sidebarRows(custom).map((row) => [row.item.id, row.nested]),
    [
      ["home", false],
      ["tasks", false],
      ["calendar", false],
      ["mail", false],
      ["notes", false],
    ],
  );
});

test("Settings lists the views as the sidebar draws them and moves a view past its own kind", () => {
  const order = ["home", "agenda", "calendar", "mail", "tasks", "reminders", "notes"] as const;
  assert.deepEqual(
    sidebarOrderRows(order, []).map((row) => [row.id, row.nested]),
    [
      ["home", false],
      ["agenda", false],
      ["calendar", true],
      ["tasks", true],
      ["reminders", true],
      ["mail", false],
      ["notes", false],
    ],
  );
  // Inbox passes the whole Agenda group in one press; a source moves among the sources.
  const inboxUp = moveSidebarView(order, [], "mail", -1);
  assert.deepEqual(
    sidebarOrderRows(inboxUp, []).map((row) => row.id),
    ["home", "mail", "agenda", "calendar", "tasks", "reminders", "notes"],
  );
  assert.deepEqual(
    sidebarOrderRows(moveSidebarView(order, [], "tasks", -1), []).map((row) => row.id),
    ["home", "agenda", "tasks", "calendar", "reminders", "mail", "notes"],
  );
  // Nowhere to go returns the same array, which is how the buttons know to disable.
  assert.equal(moveSidebarView(order, [], "home", -1), order);
  assert.equal(moveSidebarView(order, [], "reminders", 1), order);
  assert.equal(moveSidebarView(order, [], "notes", 1), order);
  // With the Agenda hidden the list is flat and a move is one place in the saved order.
  assert.deepEqual(
    sidebarOrderRows(order, ["agenda"]).map((row) => [row.id, row.nested]),
    order.map((id) => [id, false]),
  );
  assert.deepEqual(moveSidebarView(order, ["agenda"], "mail", 1), [
    "home",
    "agenda",
    "calendar",
    "tasks",
    "mail",
    "reminders",
    "notes",
  ]);
});
