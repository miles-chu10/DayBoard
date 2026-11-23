import assert from "node:assert/strict";
import test from "node:test";
import type { SourceResult } from "@main/shared-types";

import { connectionStatus } from "./connection-status";

const google = { connected: true, email: "ada@example.com" };
const ok: SourceResult<unknown> = { state: "ok", items: [] };

test("a working Google account reads Connected, with Reminders called out when off", () => {
  const status = connectionStatus({ google, googleSources: [ok, ok], remindersOk: true });
  assert.deepEqual(status, {
    label: "Connected",
    googleDetail: "Google: ada@example.com",
    tone: "ok",
  });
  assert.equal(
    connectionStatus({ google, googleSources: [ok], remindersOk: false }).label,
    "Connected · Reminders off",
  );
});

test("a saved sign-in that Google no longer accepts asks for sign-in instead of Connected", () => {
  const status = connectionStatus({
    google,
    googleSources: [ok, { state: "not-connected" }],
    remindersOk: true,
  });
  assert.equal(status.label, "Google needs sign-in");
  assert.equal(status.tone, "attention");
  assert.match(status.googleDetail, /ada@example\.com, sign in again/);
});

test("a permission left off at Google asks for permission; sign-in problems come first", () => {
  const notGranted = { state: "not-granted" } as const;
  assert.equal(
    connectionStatus({ google, googleSources: [notGranted, ok], remindersOk: true }).label,
    "Google needs permission",
  );
  assert.equal(
    connectionStatus({
      google,
      googleSources: [notGranted, { state: "not-connected" }],
      remindersOk: true,
    }).label,
    "Google needs sign-in",
  );
});

test("sources that are off or still loading don't raise a warning", () => {
  const status = connectionStatus({
    google,
    googleSources: [undefined, { state: "disabled" }],
    remindersOk: true,
  });
  assert.equal(status.label, "Connected");
});

test("no Google account reads not connected", () => {
  for (const account of [undefined, { connected: false, email: null }]) {
    const status = connectionStatus({ google: account, googleSources: [], remindersOk: true });
    assert.equal(status.label, "Google not connected");
    assert.equal(status.tone, "off");
  }
});
