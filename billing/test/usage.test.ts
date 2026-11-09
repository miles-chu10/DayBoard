import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, test } from "node:test";
import type Stripe from "stripe";
import type { Env } from "../src/config.ts";
import { randomToken } from "../src/crypto.ts";
import { createWorker } from "../src/index.ts";
import { USAGE_RETENTION_DAYS } from "../src/usage.ts";
import { LocalDb } from "./local-db.ts";

const origin = "https://billing.example.test";
const path = "/v1/usage/checkin";
const NOW = Date.UTC(2026, 10, 9, 18, 30);
const DAY_MS = 24 * 60 * 60 * 1000;
const dbs: LocalDb[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

function setup(overrides: Partial<Env> = {}) {
  const db = new LocalDb();
  dbs.push(db);
  const env: Env = {
    DB: db as unknown as D1Database,
    SERVICE_ORIGIN: origin,
    PRODUCT_ID: "prod_TEST",
    PRICE_ID: "price_TEST",
    PRICE_CURRENCY: "usd",
    ENVIRONMENT: "test",
    ACTIVATION_LIMIT: "3",
    STRIPE_SECRET_KEY: "sk_test_disposable_only",
    STRIPE_WEBHOOK_SECRET: "whsec_disposable_only",
    ENCRYPTION_KEY: randomToken(),
    HASH_SECRET: randomToken(),
    ...overrides,
  };
  // A check-in never involves Stripe, so any use of the client fails the test.
  const worker = createWorker(
    () =>
      new Proxy({} as Stripe, {
        get() {
          throw new Error("Stripe must not be used for check-ins");
        },
      }),
  );
  const send = (body: unknown, init: { method?: string; ip?: string; type?: string } = {}) =>
    worker.fetch(
      new Request(origin + path, {
        method: init.method ?? "POST",
        headers: {
          "CF-Connecting-IP": init.ip ?? "198.51.100.9",
          "Content-Type": init.type ?? "application/json",
        },
        body:
          init.method === "GET"
            ? undefined
            : typeof body === "string"
              ? body
              : JSON.stringify(body),
      }),
      env,
    );
  const rows = () =>
    db.sql
      .prepare("SELECT * FROM usage_checkins ORDER BY day, install_id")
      .all()
      .map((row) => ({ ...row })) as Array<Record<string, string>>;
  return { db, env, send, rows };
}

const checkIn = (overrides: Record<string, unknown> = {}) => ({
  installId: randomUUID(),
  appVersion: "1.3.0-beta.20",
  licenseState: "trial",
  ...overrides,
});

test("a check-in stores today's row with no IP address and answers 204", async (t) => {
  t.mock.method(Date, "now", () => NOW);
  const f = setup();
  const body = checkIn();
  const response = await f.send(body);
  assert.equal(response.status, 204);
  assert.equal(await response.text(), "");
  assert.equal(response.headers.get("Cache-Control"), "no-store, max-age=0");
  assert.deepEqual(f.rows(), [
    {
      install_id: body.installId,
      day: "2026-11-09",
      first_day: "2026-11-09",
      app_version: "1.3.0-beta.20",
      license_state: "trial",
    },
  ]);
  // The only other write is the rate-limit bucket, a keyed hash rather than the address.
  const buckets = f.db.sql.prepare("SELECT bucket FROM rate_limits").all() as Array<{
    bucket: string;
  }>;
  assert.equal(buckets.length, 1);
  assert.doesNotMatch(buckets[0].bucket, /198\.51\.100\.9/);
});

test("the same install the same day updates one row, and first_day carries forward", async (t) => {
  let now = NOW;
  t.mock.method(Date, "now", () => now);
  const f = setup();
  const installId = randomUUID();
  assert.equal((await f.send(checkIn({ installId }))).status, 204);
  assert.equal(
    (await f.send(checkIn({ installId, licenseState: "licensed", appVersion: "1.3.0" }))).status,
    204,
  );
  assert.deepEqual(
    f.rows().map((row) => [row.day, row.first_day, row.app_version, row.license_state]),
    [["2026-11-09", "2026-11-09", "1.3.0", "licensed"]],
  );
  now += 3 * DAY_MS;
  await f.send(checkIn({ installId, licenseState: "licensed", appVersion: "1.3.0" }));
  assert.deepEqual(
    f.rows().map((row) => [row.day, row.first_day]),
    [
      ["2026-11-09", "2026-11-09"],
      ["2026-11-12", "2026-11-09"],
    ],
  );
});

test("the day comes from the server clock, not the request", async (t) => {
  t.mock.method(Date, "now", () => NOW);
  const f = setup();
  const response = await f.send({ ...checkIn(), day: "2020-01-01" });
  assert.equal(response.status, 400);
  assert.equal(f.rows().length, 0);
});

test("anything but exactly the three valid fields is refused and stores nothing", async (t) => {
  t.mock.method(Date, "now", () => NOW);
  const f = setup();
  const bad: unknown[] = [
    {},
    [],
    null,
    checkIn({ installId: "not-a-uuid" }),
    checkIn({ installId: randomUUID().toUpperCase() }),
    checkIn({ installId: "6f1c9a52-1d2b-1c3d-8e4f-0123456789ab" }),
    checkIn({ appVersion: "" }),
    checkIn({ appVersion: "1.3" }),
    checkIn({ appVersion: "1.3.0-beta.20; DROP TABLE x" }),
    checkIn({ licenseState: "demo" }),
    checkIn({ licenseState: "disabled" }),
    checkIn({ email: "someone@example.test" }),
    checkIn({ licenseKey: "DAYB_x" }),
  ];
  for (const body of bad) {
    const response = await f.send(body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.deepEqual(await response.json(), { error: "invalid_checkin" });
  }
  for (const [body, type] of [
    ["not json", "application/json"],
    [JSON.stringify(checkIn()), "text/plain"],
    [JSON.stringify({ ...checkIn(), pad: "x".repeat(600) }), "application/json"],
  ]) {
    const response = await f.send(body, { type, ip: "203.0.113.5" });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "invalid_body" });
  }
  const get = await f.send(undefined, { method: "GET" });
  assert.equal(get.status, 405);
  assert.equal(f.rows().length, 0);
});

test("one address gets 20 check-ins a minute", async (t) => {
  t.mock.method(Date, "now", () => NOW);
  const f = setup();
  for (let i = 0; i < 20; i++) assert.equal((await f.send(checkIn())).status, 204);
  const limited = await f.send(checkIn());
  assert.equal(limited.status, 429);
  assert.deepEqual(await limited.json(), { error: "rate_limited" });
  assert.equal((await f.send(checkIn(), { ip: "203.0.113.20" })).status, 204);
  assert.equal(f.rows().length, 21);
});

test(`rows older than ${USAGE_RETENTION_DAYS} days are deleted on the next check-in`, async (t) => {
  let now = NOW;
  t.mock.method(Date, "now", () => now);
  const f = setup();
  const old = randomUUID();
  await f.send(checkIn({ installId: old }));
  now += USAGE_RETENTION_DAYS * DAY_MS;
  await f.send(checkIn());
  assert.equal(
    f.rows().filter((row) => row.install_id === old).length,
    1,
    "exactly at the limit stays",
  );
  now += DAY_MS;
  await f.send(checkIn());
  assert.equal(f.rows().filter((row) => row.install_id === old).length, 0);
});

test("unconfigured or wrong-origin services refuse check-ins", async () => {
  const f = setup({ STRIPE_SECRET_KEY: "" });
  const response = await f.send(checkIn());
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "service_unconfigured" });
  const g = setup({ SERVICE_ORIGIN: "https://elsewhere.example.test" });
  assert.equal((await g.send(checkIn())).status, 403);
  assert.equal(f.rows().length + g.rows().length, 0);
});

test("the views count active, new, Pro and version installs", () => {
  const db = new LocalDb();
  dbs.push(db);
  const today = db.sql.prepare("SELECT date('now') AS d").get()!.d as string;
  const daysAgo = (n: number) =>
    db.sql.prepare(`SELECT date('now', '-${n} days') AS d`).get()!.d as string;
  const insert = db.sql.prepare("INSERT INTO usage_checkins VALUES (?,?,?,?,?)");
  const [a, b, c] = [randomUUID(), randomUUID(), randomUUID()];
  insert.run(a, daysAgo(40), daysAgo(40), "1.3.0-beta.19", "trial");
  insert.run(a, today, daysAgo(40), "1.3.0", "licensed");
  insert.run(b, daysAgo(3), daysAgo(3), "1.3.0-beta.19", "expired");
  insert.run(c, today, today, "1.3.0", "trial");
  assert.deepEqual(
    { ...(db.sql.prepare("SELECT * FROM usage_summary").get() as object) },
    {
      active_today: 2,
      active_7_days: 3,
      active_30_days: 3,
      new_30_days: 2,
      pro_30_days: 1,
      installs_seen: 3,
    },
  );
  assert.deepEqual(
    { ...(db.sql.prepare("SELECT * FROM usage_daily LIMIT 1").get() as object) },
    {
      day: today,
      active_installs: 2,
      new_installs: 1,
      trial: 1,
      trial_ended: 0,
      pro: 1,
      license_problem: 0,
    },
  );
  assert.deepEqual(
    db.sql
      .prepare("SELECT * FROM usage_versions")
      .all()
      .map((row) => ({ ...row })),
    [
      { app_version: "1.3.0", installs_7_days: 2 },
      { app_version: "1.3.0-beta.19", installs_7_days: 1 },
    ],
  );
  assert.throws(() => insert.run(randomUUID(), today, "2026-13-01", "1.3.0", "trial"), /CHECK/);
  assert.throws(() => insert.run(randomUUID(), today, today, "1.3.0", "demo"), /CHECK/);
});

test("migration 0007 applies to a database holding rows in every table and changes none", () => {
  const dir = new URL("../migrations/", import.meta.url);
  const files = readdirSync(dir)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  const usage = "0007_usage_checkins.sql";
  assert.ok(files.includes(usage));
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  for (const file of files.filter((name) => name < usage))
    db.exec(readFileSync(new URL(file, dir), "utf8"));
  db.exec(`
    INSERT INTO orders VALUES ('o1', 'cap1', 1, 'cs_1', 'pi_1', 'ready', 1);
    INSERT INTO payments VALUES ('pi_1', 0, NULL, 1);
    INSERT INTO licenses VALUES ('l1', 'o1', 'pi_1', 'https://a.test', 'prod_A', 'live', 'h1', 'c1', 'i1', 1);
    INSERT INTO activations VALUES ('a1', 'l1', 'inst1', 'Mac', 1);
    INSERT INTO comp_licenses (license_id, label, created_at) VALUES ('l1', 'note', 5);
    INSERT INTO webhook_events VALUES ('evt_1', 'checkout.session.completed', 1);
    INSERT INTO rate_limits VALUES ('bucket', 1, 1);
    INSERT INTO beta_signups (email, created_at) VALUES ('first@example.test', 1790225517612);
    INSERT INTO email_suppressions VALUES ('first@example.test', 1, 1, 'unsubscribe', 'ref');
  `);
  const tables = [
    "orders",
    "payments",
    "licenses",
    "activations",
    "comp_licenses",
    "webhook_events",
    "rate_limits",
    "beta_signups",
    "email_suppressions",
  ];
  const snapshot = () =>
    Object.fromEntries(
      tables.map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()]),
    );
  const schema = () => db.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY name").all();
  const before = snapshot();
  const schemaBefore = schema();
  db.exec(readFileSync(new URL(usage, dir), "utf8"));
  assert.deepEqual(snapshot(), before);
  assert.deepEqual(
    schema().filter((entry) => !String(entry.name).startsWith("usage_")),
    schemaBefore,
  );
  db.close();
});
