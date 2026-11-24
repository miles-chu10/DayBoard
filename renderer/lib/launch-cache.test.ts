import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient, QueryObserver } from "@tanstack/query-core";
import type { AccountsStatus } from "@main/shared-types";

const store = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
  },
});

const {
  LAUNCH_CACHE_KEY,
  LAUNCH_CACHE_MAX_AGE_MS,
  buildLaunchSnapshot,
  clearLaunchCache,
  hydrateLaunchCache,
  launchCacheOwner,
  savedCopyStatus,
  savedCopyTime,
  startLaunchCacheWriter,
} = await import("./launch-cache");

function accounts(google: string | null, gmail: string | null = google): AccountsStatus {
  return {
    google: {
      hasCredentials: true,
      connected: google !== null,
      email: google,
      clientIdHint: null,
      missingAccess: [],
    },
    gmail: { connected: gmail !== null, email: gmail, rejected: false },
    reminders: "full-access",
    calendar: "full-access",
  };
}

const NOW = Date.now();
const FETCHED = new Date(NOW - 30 * 60_000).toISOString();
const tasks = { state: "ok", items: [{ id: "t1", title: "Ship 1.3.14" }], refreshedAt: FETCHED };
const mail = { state: "ok", items: [{ id: "m1", subject: "Hi" }], refreshedAt: FETCHED };

function saveSnapshot(owner: string, sources: Record<string, unknown>, savedAt = FETCHED) {
  store.set(LAUNCH_CACHE_KEY, JSON.stringify({ version: 1, owner, savedAt, sources }));
}

test.beforeEach(() => store.clear());

test("the owner is the connected account; an unknown address means nothing is cached", () => {
  assert.equal(
    launchCacheOwner(accounts("Alex@Example.com")),
    "google:alex@example.com|gmail:alex@example.com",
  );
  assert.equal(launchCacheOwner(accounts(null)), "google:|gmail:");
  const unknown = accounts("a@example.com");
  unknown.google.email = null;
  assert.equal(launchCacheOwner(unknown), null);
  assert.equal(launchCacheOwner(undefined), null);
});

test("a relaunch seeds the last listings as stale saved copies for the same account", () => {
  const owner = launchCacheOwner(accounts("a@example.com"))!;
  saveSnapshot(owner, { tasks, mail });
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: 120_000 } } });
  assert.deepEqual(hydrateLaunchCache(client, accounts("a@example.com"), NOW), ["tasks", "mail"]);
  assert.deepEqual(client.getQueryData(["tasks"]), { ...tasks, savedCopy: true });
  const state = client.getQueryState(["tasks"])!;
  assert.equal(state.dataUpdatedAt, Date.parse(FETCHED));
  // Stale on arrival, so the view refetches as soon as it mounts.
  const observer = new QueryObserver(client, { queryKey: ["tasks"], staleTime: 120_000 });
  assert.equal(observer.getCurrentResult().isStale, true);
});

test("a relaunch seconds after the last fetch still refreshes at once", () => {
  const owner = launchCacheOwner(accounts("a@example.com"))!;
  const justNow = new Date(NOW - 5_000).toISOString();
  saveSnapshot(owner, { tasks: { ...tasks, refreshedAt: justNow } }, justNow);
  const client = new QueryClient();
  assert.deepEqual(hydrateLaunchCache(client, accounts("a@example.com"), NOW), ["tasks"]);
  const observer = new QueryObserver(client, { queryKey: ["tasks"], staleTime: 120_000 });
  assert.equal(observer.getCurrentResult().isStale, true);
});

test("another account, a signed-out Google or an old snapshot shows nothing and is deleted", () => {
  const owner = launchCacheOwner(accounts("a@example.com"))!;
  for (const [status, now] of [
    [accounts("b@example.com"), NOW],
    [accounts(null), NOW],
    [accounts("a@example.com", null), NOW],
  ] as const) {
    saveSnapshot(owner, { tasks });
    const client = new QueryClient();
    assert.deepEqual(hydrateLaunchCache(client, status, now), []);
    assert.equal(client.getQueryData(["tasks"]), undefined);
    assert.equal(store.has(LAUNCH_CACHE_KEY), false);
  }
  saveSnapshot(owner, { tasks });
  const client = new QueryClient();
  const tooLate = Date.parse(FETCHED) + LAUNCH_CACHE_MAX_AGE_MS + 1;
  assert.deepEqual(hydrateLaunchCache(client, accounts("a@example.com"), tooLate), []);
});

test("a listing re-saved while offline keeps its real fetch time and still expires", () => {
  const owner = launchCacheOwner(accounts("a@example.com"))!;
  const old = new Date(NOW - LAUNCH_CACHE_MAX_AGE_MS - 60_000).toISOString();
  saveSnapshot(owner, { tasks: { ...tasks, refreshedAt: old }, mail });
  const client = new QueryClient();
  assert.deepEqual(hydrateLaunchCache(client, accounts("a@example.com"), NOW), ["mail"]);
});

test("malformed or foreign storage is ignored", () => {
  const client = new QueryClient();
  store.set(LAUNCH_CACHE_KEY, "{not json");
  assert.deepEqual(hydrateLaunchCache(client, accounts("a@example.com"), NOW), []);
  store.set(
    LAUNCH_CACHE_KEY,
    JSON.stringify({ version: 1, owner: "x", savedAt: FETCHED, sources: { tokens: tasks } }),
  );
  assert.deepEqual(hydrateLaunchCache(client, accounts("a@example.com"), NOW), []);
});

test("a snapshot keeps only source listings, without failed-refresh or saved-copy marks", () => {
  const client = new QueryClient();
  client.setQueryData(["tasks"], { ...tasks, refreshError: "offline", savedCopy: true });
  client.setQueryData(["reminders"], { state: "disabled" });
  client.setQueryData(["mail-body", "m1"], { html: "secret body" });
  client.setQueryData(["accounts"], accounts("a@example.com"));
  const snapshot = buildLaunchSnapshot(client, "owner", new Date(NOW));
  assert.deepEqual(snapshot.sources, { tasks });
  assert.equal(JSON.stringify(snapshot).includes("secret body"), false);
  assert.equal(JSON.stringify(snapshot).includes("alex"), false);
});

test("the writer saves after a fetch, for the signed-in account only", async () => {
  const client = new QueryClient();
  client.setQueryData(["accounts"], accounts("a@example.com"));
  const stop = startLaunchCacheWriter(client, ["accounts"]);
  try {
    await client.fetchQuery({ queryKey: ["tasks"], queryFn: async () => tasks });
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const saved = JSON.parse(store.get(LAUNCH_CACHE_KEY)!);
    assert.equal(saved.owner, "google:a@example.com|gmail:a@example.com");
    assert.deepEqual(saved.sources, { tasks });

    // An account change clears it; nothing is written while the account is unknown.
    clearLaunchCache();
    client.removeQueries({ queryKey: ["accounts"] });
    await client.fetchQuery({ queryKey: ["mail"], queryFn: async () => mail, staleTime: 0 });
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    assert.equal(store.has(LAUNCH_CACHE_KEY), false);
  } finally {
    stop();
  }
});

test("the notice covers saved copies only: refreshing, then failed, then gone", () => {
  const saved = { ...tasks, savedCopy: true as const };
  assert.equal(
    savedCopyStatus([{ data: tasks as never, isFetching: false, isError: false }]),
    null,
  );
  assert.deepEqual(
    savedCopyStatus([
      { data: saved as never, isFetching: true, isError: false },
      {
        data: { ...mail, savedCopy: true, refreshedAt: "2026-01-01T09:00:00.000Z" } as never,
        isFetching: false,
        isError: false,
      },
    ]),
    { since: "2026-01-01T09:00:00.000Z", refreshing: true, failed: false },
  );
  assert.deepEqual(
    savedCopyStatus([
      { data: { ...saved, refreshError: "offline" } as never, isFetching: false, isError: false },
    ]),
    { since: FETCHED, refreshing: false, failed: true },
  );
  const now = new Date(2026, 10, 24, 12, 0);
  assert.doesNotMatch(savedCopyTime(new Date(2026, 10, 24, 9, 41).toISOString(), now), /Nov/);
  assert.match(savedCopyTime(new Date(2026, 10, 22, 21, 41).toISOString(), now), /^Nov 22, /);
});
