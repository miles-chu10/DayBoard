import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadTs } from "./helpers/load-ts.mjs";

const { createUsageCheckIn } = await loadTs("main/services/usage-checkin.ts");
const { isUsageCheckIn } = await loadTs("shared/usage-checkin.ts");

const API = "https://api.example.test";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function fixture(t, overrides = {}) {
  const dir = await mkdtemp(join(tmpdir(), "dayboard-checkin-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const statePath = join(dir, "usage-checkin.json");
  const requests = [];
  const state = {
    enabled: true,
    licenseState: "trial",
    now: new Date("2026-11-09T23:30:00Z"),
    reply: () => new Response(null, { status: 204 }),
  };
  const checkIn = createUsageCheckIn({
    apiUrl: API,
    appVersion: "1.3.0-beta.20",
    statePath,
    isEnabled: async () => state.enabled,
    licenseState: async () => state.licenseState,
    now: () => state.now,
    fetch: async (url, init) => {
      requests.push({ url, init, body: JSON.parse(init.body) });
      return state.reply();
    },
    ...overrides,
  });
  const saved = async () => JSON.parse(await readFile(statePath, "utf8"));
  return { checkIn, requests, state, statePath, saved };
}

test("sends exactly the install ID, version and license state, once per UTC day", async (t) => {
  const f = await fixture(t);
  assert.equal(await f.checkIn.runOnce(), "sent");
  assert.equal(f.requests.length, 1);
  const [{ url, init, body }] = f.requests;
  assert.equal(url, `${API}/v1/usage/checkin`);
  assert.equal(init.method, "POST");
  assert.deepEqual(init.headers, { "Content-Type": "application/json" });
  assert.deepEqual(Object.keys(body).sort(), ["appVersion", "installId", "licenseState"]);
  assert.match(body.installId, UUID_V4);
  assert.equal(body.appVersion, "1.3.0-beta.20");
  assert.equal(body.licenseState, "trial");
  assert.ok(isUsageCheckIn(body), "the app's body passes the service's own check");
  assert.deepEqual(await f.saved(), { installId: body.installId, lastDay: "2026-11-09" });
  assert.equal(await f.checkIn.lastSentDay(), "2026-11-09");

  // Later the same UTC day: nothing is sent.
  f.state.now = new Date("2026-11-09T23:59:59Z");
  assert.equal(await f.checkIn.runOnce(), "already-sent");
  assert.equal(f.requests.length, 1);

  // The next UTC day sends again with the same ID and the current state.
  f.state.now = new Date("2026-11-10T00:00:01Z");
  f.state.licenseState = "licensed";
  assert.equal(await f.checkIn.runOnce(), "sent");
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[1].body.installId, body.installId);
  assert.equal(f.requests[1].body.licenseState, "licensed");
});

test("turned off, nothing is sent and nothing is written", async (t) => {
  const f = await fixture(t);
  f.state.enabled = false;
  assert.equal(await f.checkIn.runOnce(), "off");
  assert.equal(f.requests.length, 0);
  await assert.rejects(readFile(f.statePath), { code: "ENOENT" });
  assert.equal(await f.checkIn.lastSentDay(), null);
});

test("a failed check-in keeps the ID and retries on the next look", async (t) => {
  const f = await fixture(t);
  f.state.reply = () => new Response('{"error":"service_unavailable"}', { status: 503 });
  assert.equal(await f.checkIn.runOnce(), "failed");
  const { installId, lastDay } = await f.saved();
  assert.match(installId, UUID_V4);
  assert.equal(lastDay, null);

  f.state.reply = () => {
    throw new TypeError("fetch failed");
  };
  assert.equal(await f.checkIn.runOnce(), "failed");

  f.state.reply = () => new Response(null, { status: 204 });
  assert.equal(await f.checkIn.runOnce(), "sent");
  assert.deepEqual(
    f.requests.map((request) => request.body.installId),
    [installId, installId, installId],
  );
  assert.deepEqual(await f.saved(), { installId, lastDay: "2026-11-09" });
});

test("states the service doesn't take are never sent", async (t) => {
  const f = await fixture(t);
  for (const state of ["demo", "disabled", "unconfigured", ""]) {
    f.state.licenseState = state;
    assert.equal(await f.checkIn.runOnce(), "failed");
  }
  f.state.licenseState = "unreadable";
  assert.equal(await f.checkIn.runOnce(), "sent");
  assert.deepEqual(
    f.requests.map((request) => request.body.licenseState),
    ["unreadable"],
  );
});

test("a damaged state file gets a fresh ID instead of failing", async (t) => {
  const f = await fixture(t);
  await writeFile(f.statePath, '{"installId":"not-an-id"');
  assert.equal(await f.checkIn.runOnce(), "sent");
  assert.match(f.requests[0].body.installId, UUID_V4);
  await writeFile(f.statePath, '{"installId":"MAC-SERIAL","lastDay":"2026-11-09"}');
  assert.equal(await f.checkIn.runOnce(), "sent");
  assert.match(f.requests[1].body.installId, UUID_V4);
});

test("overlapping looks share one request", async (t) => {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const f = await fixture(t);
  f.state.reply = () => gate.then(() => new Response(null, { status: 204 }));
  const results = Promise.all([f.checkIn.runOnce(), f.checkIn.runOnce(), f.checkIn.runOnce()]);
  await new Promise((resolve) => setTimeout(resolve, 20));
  release();
  assert.deepEqual(await results, ["sent", "sent", "sent"]);
  assert.equal(f.requests.length, 1);
});

test("start looks shortly after launch and then on an interval, and stop ends it", async (t) => {
  const f = await fixture(t, { firstDelayMs: 5, intervalMs: 15 });
  const stop = f.checkIn.start();
  await new Promise((resolve) => setTimeout(resolve, 60));
  stop();
  // The first look sends; later looks the same day send nothing more.
  assert.equal(f.requests.length, 1);
  const count = f.requests.length;
  f.state.now = new Date("2026-11-11T00:00:00Z");
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(f.requests.length, count, "no looks after stop");
});

test("only official licensed releases check in, it defaults on, and Settings can turn it off", async () => {
  const [handler, index, store, view, settingsUi, privacy] = await Promise.all(
    [
      "../main/handlers/usage.ts",
      "../main/index.ts",
      "../main/services/settings-store.ts",
      "../renderer/settings/settings-view.tsx",
      "../renderer/settings/usage-settings.tsx",
      "../website/privacy.html",
    ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
  );
  assert.match(
    handler,
    /!isAppStoreBuild &&\s*process\.env\.DAYBOARD_RELEASE === "1" &&\s*!isLicenseGatingDisabled\(\) &&\s*product\s*\?/,
  );
  assert.match(
    handler,
    /isEnabled: async \(\) => !isDemoMode\(\) && \(await getSettings\(\)\)\.privacy\.usageCheckIn/,
  );
  assert.match(handler, /ipcMain\.handle\(\s*"usage:checkInStatus"/);
  assert.match(index, /const usageCheckIn = registerUsageCheckIn\(\);/);
  assert.match(index, /updates\.startAutomatic\(\);\s*usageCheckIn\.start\(\);/);
  assert.match(store, /privacy: \{ usageCheckIn: true \}/);
  assert.match(view, /<FeedbackSettings \/>\s*<UsageCheckInSettings \/>/);
  assert.match(settingsUi, /draft\.privacy\.usageCheckIn = checked/);
  assert.match(settingsUi, /privacy\.html#checkin/);
  assert.match(privacy, /<li id="checkin">/);
  assert.match(privacy, /Turn it off in Settings &gt; Updates/);
  assert.doesNotMatch(privacy, /The app has no analytics, advertising or tracking/);
});
