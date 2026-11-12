import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { afterEach, test } from "node:test";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { normalizeEmail } from "../src/beta.ts";
import type { Env } from "../src/config.ts";
import { randomToken } from "../src/crypto.ts";
import { createWorker } from "../src/index.ts";
import { LocalDb } from "./local-db.ts";

const service = "https://billing.example.test";
const site = "https://dayboard.example.test";
const waitlist = `${service}/v1/waitlist`;
const legacy = `${service}/v1/beta-signup`;
const dbs: LocalDb[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

test("normalizes and validates waitlist email addresses", () => {
  assert.equal(normalizeEmail("  Alex.Rivera+beta@Example.COM "), "alex.rivera+beta@example.com");
  for (const bad of [
    "",
    "alex",
    "@example.com",
    "alex@",
    "alex@example",
    "a@b@example.com",
    "alex..r@example.com",
    ".alex@example.com",
    "alex @example.com",
    "alex@-example.com",
    `${"a".repeat(65)}@example.com`,
    `a@${"b".repeat(250)}.com`,
    42,
    null,
  ])
    assert.equal(normalizeEmail(bad), null, String(bad));
});

test("suppressed and test addresses never reach the mailing or waitlist views", () => {
  const db = new LocalDb();
  dbs.push(db);
  const insert = db.sql.prepare(
    "INSERT INTO beta_signups (email, created_at, classification) VALUES (?, ?, ?)",
  );
  insert.run("ana@example.com", 1_000, "reviewed");
  insert.run("bo@example.com", 2_000, "unreviewed");
  insert.run("left@example.com", 3_000, "reviewed");
  insert.run("probe@example.com", 4_000, "likely_test");
  db.sql
    .prepare(
      "INSERT INTO email_suppressions (email, requested_at, recorded_at, reason, source_ref) VALUES (?, 1, 2, 'unsubscribe', 'reply')",
    )
    .run("left@example.com");
  const column = (query: string) =>
    db.sql
      .prepare(query)
      .all()
      .map((row) => String((row as { email: string }).email));
  assert.deepEqual(column("SELECT email FROM dayboard_mailing_recipients ORDER BY email"), [
    "ana@example.com",
    "bo@example.com",
  ]);
  assert.deepEqual(column("SELECT email FROM waitlist_signups"), [
    "probe@example.com",
    "bo@example.com",
    "ana@example.com",
  ]);
  for (const bad of ["Left@Example.com", " left2@example.com"])
    assert.throws(() =>
      db.sql
        .prepare(
          "INSERT INTO email_suppressions (email, requested_at, recorded_at, reason, source_ref) VALUES (?, 1, 2, 'unsubscribe', 'reply')",
        )
        .run(bad),
    );
  assert.throws(() =>
    db.sql
      .prepare(
        "INSERT INTO email_suppressions (email, requested_at, recorded_at, reason, source_ref) VALUES ('x@example.com', 1, 2, 'bounce', 'reply')",
      )
      .run(),
  );
});

test("both waitlist routes are closed: 410 for every request, nothing stored or sent", async () => {
  const db = new LocalDb();
  dbs.push(db);
  db.sql
    .prepare("INSERT INTO beta_signups (email, created_at) VALUES (?, ?)")
    .run("kept@example.com", 1_000);
  const env = {
    DB: db as unknown as D1Database,
    SERVICE_ORIGIN: service,
    HASH_SECRET: randomToken(),
    SITE_ORIGIN: site,
  } as Env;
  const worker = createWorker(
    () => {
      throw new Error("Stripe must not be used by the closed waitlist");
    },
    () => {
      throw new Error("the closed waitlist must not send anything");
    },
  );
  for (const url of [waitlist, legacy, "https://other.example.test/v1/waitlist"])
    for (const init of [
      { method: "POST", body: JSON.stringify({ email: "new@example.com", company: "" }) },
      { method: "OPTIONS" },
      { method: "GET" },
    ]) {
      const response = await worker.fetch(
        new Request(url, {
          ...init,
          headers: { Origin: site, "Content-Type": "application/json" },
        }),
        env,
      );
      assert.equal(response.status, 410, `${init.method} ${url}`);
      assert.deepEqual(await response.json(), { error: "waitlist_closed" });
      assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
      assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
    }
  // Earlier signups are kept, and no attempt was rate-limited or stored.
  assert.deepEqual(
    db.sql
      .prepare("SELECT email FROM beta_signups")
      .all()
      .map((row) => String(row.email)),
    ["kept@example.com"],
  );
  assert.equal(Number(db.sql.prepare("SELECT COUNT(*) AS n FROM rate_limits").get()!.n), 0);
  // Without any database or secret the answer is the same.
  const bare = await worker.fetch(new Request(waitlist, { method: "POST" }), {} as Env);
  assert.equal(bare.status, 410);
});

test("real Worker and D1 answer 410 on both waitlist routes and store nothing", async () => {
  const bundle = await build({
    entryPoints: [new URL("../src/index.ts", import.meta.url).pathname],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    write: false,
  });
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: bundle.outputFiles[0].text,
      compatibilityDate: "2026-09-22",
      compatibilityFlags: ["nodejs_compat"],
      cf: false,
      d1Databases: ["DB"],
      d1Persist: false,
      bindings: {
        SERVICE_ORIGIN: service,
        HASH_SECRET: randomToken(),
        SITE_ORIGIN: site,
      },
      outboundService: () => {
        throw new Error("the closed waitlist must not make outbound requests");
      },
    }),
  );
  try {
    const db = await mf.getD1Database("DB");
    const dir = new URL("../migrations/", import.meta.url);
    for (const file of (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort()) {
      const sql = await readFile(new URL(file, dir), "utf8");
      await db.batch(
        sql
          .split(";")
          .map((statement) => statement.trim())
          .filter(Boolean)
          .map((statement) => db.prepare(statement)),
      );
    }
    for (const url of [waitlist, legacy])
      for (const method of ["OPTIONS", "POST"]) {
        const response = await mf.dispatchFetch(url, {
          method,
          headers: { Origin: site, "Content-Type": "application/json" },
          body: method === "POST" ? JSON.stringify({ email: "priya@example.com" }) : undefined,
        });
        assert.equal(response.status, 410, `${method} ${url}`);
        assert.deepEqual(await response.json(), { error: "waitlist_closed" });
      }
    const stored = await db
      .prepare("SELECT COUNT(*) AS n FROM beta_signups")
      .first<{ n: number }>();
    assert.equal(Number(stored?.n), 0);
  } finally {
    await mf.dispose();
  }
});
