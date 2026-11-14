import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient, QueryObserver } from "@tanstack/query-core";

import { clearAccountScopedQueries, refreshMeetingNotes } from "./account-scoped-queries";

test("an account change drops every cached meeting-notes query", () => {
  const client = new QueryClient();
  client.setQueryData(["meetings", "notes", "google:a", "primary", "e1"], { text: "A's notes" });
  client.setQueryData(["meetings", "snapshot-notes", "google:a", []], { "primary/e1": {} });
  client.setQueryData(["meetings", "notes-status"], { provider: null });
  client.setQueryData(["tasks"], { state: "ok", items: [] });
  // The dashboard keeps unobserved queries for a day, so these no longer expire within minutes.
  client.setQueryData(["mail-body", "m1"], { html: "A's message" });
  client.setQueryData(["mail-related", "e1"], [{ id: "m1" }]);
  client.setQueryData(["mail-subscriptions"], { senders: [] });
  client.setQueryData(["item-lists", "tasks"], [{ id: "A's list" }]);
  clearAccountScopedQueries(client);
  for (const key of [
    ["mail-body", "m1"],
    ["mail-related", "e1"],
    ["mail-subscriptions"],
    ["item-lists", "tasks"],
  ])
    assert.equal(client.getQueryData(key), undefined, key[0]);
  assert.equal(client.getQueryData(["meetings", "notes", "google:a", "primary", "e1"]), undefined);
  assert.equal(client.getQueryData(["meetings", "snapshot-notes", "google:a", []]), undefined);
  assert.equal(client.getQueryData(["meetings", "notes-status"]), undefined);
  assert.deepEqual(client.getQueryData(["tasks"]), { state: "ok", items: [] });
});

test("a notes import refreshes two windows and Assistant snapshots without stale read restoration", async () => {
  const clients = [new QueryClient(), new QueryClient()];
  const keys = [
    ["meetings", "notes", "account", "primary", "e1"],
    ["meetings", "snapshot-notes", "account", []],
  ];
  const late: (() => void)[] = [];
  const pending: Promise<unknown>[] = [];
  const unsubscribers: (() => void)[] = [];
  let imported = false;
  try {
    for (const client of clients) {
      client.setQueryData(["tasks"], "keep tasks");
      for (const queryKey of keys) {
        const queryFn = () =>
          imported
            ? Promise.resolve("new complete notes")
            : new Promise<string>((resolve) => late.push(() => resolve("stale notes")));
        client.setQueryData(queryKey, "previous notes");
        const observer = new QueryObserver(client, { queryKey, queryFn, staleTime: Infinity });
        unsubscribers.push(observer.subscribe(() => {}));
        pending.push(client.fetchQuery({ queryKey, queryFn, staleTime: 0 }).catch(() => undefined));
      }
    }
    assert.equal(late.length, 4);
    imported = true;
    await Promise.all(clients.map(refreshMeetingNotes));
    for (const release of late) release();
    await Promise.all(pending);
    for (const client of clients) {
      for (const queryKey of keys)
        assert.equal(client.getQueryData(queryKey), "new complete notes");
      assert.equal(client.getQueryData(["tasks"]), "keep tasks");
    }
  } finally {
    for (const unsubscribe of unsubscribers) unsubscribe();
    for (const client of clients) client.clear();
  }
});
