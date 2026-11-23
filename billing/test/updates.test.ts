// @ts-expect-error The script is plain JavaScript with no type declarations.
import { draftFromNotes } from "../scripts/update-email.mjs";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, test } from "node:test";
import type Stripe from "stripe";
import type { Env } from "../src/config.ts";
import { randomToken } from "../src/crypto.ts";
import { createWorker } from "../src/index.ts";
import type { Send } from "../src/mail.ts";
import { pacing } from "../src/updates.ts";
import { LocalDb } from "./local-db.ts";

const origin = "https://billing.example.test";
const site = "https://site.example.test";
const sender = "DayBoard <updates@mail.example.test>";
const subscribePath = "/v1/updates/subscribe";
const dbs: LocalDb[] = [];
const logged: string[] = [];
const consoleError = console.error;
beforeEach(() => {
  pacing.gapMs = 0;
  logged.length = 0;
  console.error = (...values: unknown[]) => void logged.push(values.map(String).join(" "));
});
afterEach(() => {
  console.error = consoleError;
  for (const db of dbs.splice(0)) db.close();
});

interface Sent {
  headers: Record<string, string>;
  body: {
    from: string;
    to: string[];
    subject: string;
    text: string;
    html: string;
    headers: Record<string, string>;
  };
}

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
    ADMIN_TOKEN: randomToken(),
    SITE_ORIGIN: site,
    RESEND_API_KEY: "re_disposable_only",
    MAIL_FROM: sender,
    ...overrides,
  };
  // The newsletter never involves a payment, so any use of the Stripe client fails the test.
  const stripe = new Proxy({}, { get: () => assert.fail("Stripe must not be used") }) as Stripe;
  const sent: Sent[] = [];
  // 0 accepts the email; a status answers with that error.
  const provider = { status: 0 };
  const send: Send = async (_url, init) => {
    if (provider.status)
      return Response.json({ name: "rate_limit_exceeded" }, { status: provider.status });
    sent.push({
      headers: Object.fromEntries(
        Object.entries(init.headers as Record<string, string>).map(([name, value]) => [
          name.toLowerCase(),
          value,
        ]),
      ),
      body: JSON.parse(String(init.body)),
    });
    return Response.json({ id: "email_1" });
  };
  const worker = createWorker(() => stripe, send);
  const call = (path: string, init: RequestInit = {}, ip = "203.0.113.7") =>
    worker.fetch(
      new Request(`${origin}${path}`, {
        ...init,
        headers: { "CF-Connecting-IP": ip, ...(init.headers as Record<string, string>) },
      }),
      env,
    );
  const signup = (email: unknown, extra: Record<string, unknown> = {}, ip?: string) =>
    call(
      subscribePath,
      {
        method: "POST",
        headers: { Origin: site, "Content-Type": "application/json" },
        body: JSON.stringify({ email, ...extra }),
      },
      ip,
    );
  const admin = (action: string, body?: unknown, token = env.ADMIN_TOKEN) =>
    call(`/v1/admin/updates/${action}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const rows = <T>(query: string) => db.sql.prepare(query).all() as T[];
  const token = (email: string) =>
    (
      db.sql.prepare("SELECT token FROM update_subscribers WHERE email=?").get(email) as {
        token: string;
      }
    ).token;
  const add = (...emails: string[]) => {
    for (const email of emails)
      db.sql
        .prepare(
          "INSERT INTO update_subscribers (email,token,source,subscribed_at) VALUES (?,lower(hex(randomblob(16))),'site',1)",
        )
        .run(email);
  };
  return {
    db,
    env,
    sent,
    provider,
    call,
    signup,
    admin,
    rows,
    token,
    add,
    cron: () => worker.scheduled({}, env),
  };
}

const draft = {
  version: "1.3.11",
  subject: "DayBoard 1.3.11: A new menu bar",
  text: "DayBoard 1.3.11 is out.\n\n## New\n\n- **Day line** in the menu bar\n- iCloud calendars\n\nDownload: https://site.example.test/download\n\n[Get DayBoard](https://site.example.test/download)\n\n![The day line](https://site.example.test/assets/shot.png)",
};

test("the migration starts the list from the waitlist, without unsubscribed or test addresses", () => {
  const dir = new URL("../migrations/", import.meta.url);
  const files = readdirSync(dir)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  const db = new DatabaseSync(":memory:");
  const last = "0009_update_subscribers.sql";
  for (const file of files.filter((name) => name < last))
    db.exec(readFileSync(new URL(file, dir), "utf8"));
  const insert = db.prepare(
    "INSERT INTO beta_signups (email,created_at,classification) VALUES (?,?,?)",
  );
  insert.run("kept@example.test", 1000, "reviewed");
  insert.run("new@example.test", 2000, "unreviewed");
  insert.run("left@example.test", 3000, "reviewed");
  insert.run("bot@example.test", 4000, "likely_test");
  db.prepare(
    "INSERT INTO email_suppressions (email,requested_at,recorded_at,reason,source_ref) VALUES (?,1,1,'unsubscribe','test')",
  ).run("left@example.test");
  db.exec(readFileSync(new URL(last, dir), "utf8"));
  const seeded = db
    .prepare(
      "SELECT email,source,subscribed_at,unsubscribed_at,token FROM update_subscribers ORDER BY email",
    )
    .all() as { email: string; source: string; subscribed_at: number; token: string }[];
  assert.deepEqual(
    seeded.map((row) => [row.email, row.source, row.subscribed_at]),
    [
      ["kept@example.test", "waitlist", 1000],
      ["new@example.test", "waitlist", 2000],
    ],
  );
  assert.match(seeded[0].token, /^[a-f0-9]{32}$/);
  assert.notEqual(seeded[0].token, seeded[1].token);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM beta_signups").get() as { n: number }).n, 4);
  db.close();
});

test("the website form adds an address once and answers the same for a repeat", async () => {
  const { signup, rows, call } = setup();
  const first = await signup(" Visitor@Example.test ");
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { ok: true });
  assert.equal(first.headers.get("Access-Control-Allow-Origin"), site);
  const again = await signup("visitor@example.test");
  assert.deepEqual([again.status, await again.json()], [200, { ok: true }]);
  const stored = rows<{ email: string; source: string; token: string; unsubscribed_at: null }>(
    "SELECT email,source,token,unsubscribed_at FROM update_subscribers",
  );
  assert.equal(stored.length, 1);
  assert.deepEqual(
    [stored[0].email, stored[0].source, stored[0].unsubscribed_at],
    ["visitor@example.test", "site", null],
  );
  assert.match(stored[0].token, /^[a-f0-9]{32}$/);

  const preflight = await call(subscribePath, { method: "OPTIONS", headers: { Origin: site } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("Access-Control-Allow-Methods"), "POST");
});

test("the form refuses other origins, bad input and too many tries, and ignores bots", async () => {
  const { signup, call, rows } = setup();
  const elsewhere = await call(subscribePath, {
    method: "POST",
    headers: { Origin: "https://elsewhere.example.test", "Content-Type": "application/json" },
    body: JSON.stringify({ email: "visitor@example.test" }),
  });
  assert.equal(elsewhere.status, 403);
  assert.equal(
    (await call(subscribePath, { method: "GET", headers: { Origin: site } })).status,
    405,
  );
  for (const bad of ["nobody", "", 7, "two@@example.test"]) {
    const answer = await signup(bad, {}, "203.0.113.8");
    assert.deepEqual([answer.status, await answer.json()], [400, { error: "invalid_email" }]);
  }
  const bot = await signup("bot@example.test", { company: "Acme" }, "203.0.113.9");
  assert.deepEqual([bot.status, await bot.json()], [200, { ok: true }]);
  assert.equal(rows("SELECT 1 FROM update_subscribers").length, 0);

  for (let i = 0; i < 5; i++)
    assert.equal((await signup(`v${i}@example.test`, {}, "203.0.113.10")).status, 200);
  assert.equal((await signup("v6@example.test", {}, "203.0.113.10")).status, 429);
  assert.equal(rows("SELECT 1 FROM update_subscribers").length, 5);
  assert.deepEqual(logged, []);
});

test("signup is off without a configured website origin", async () => {
  const { signup } = setup({ SITE_ORIGIN: undefined });
  assert.equal((await signup("visitor@example.test")).status, 503);
});

test("opening the unsubscribe link only asks; the button and one-click posts unsubscribe", async () => {
  const { add, token, call, rows, signup } = setup();
  add("reader@example.test", "other@example.test");
  const link = `/unsubscribe?t=${token("reader@example.test")}`;
  const state = () =>
    rows<{ email: string; unsubscribed_at: number | null }>(
      "SELECT email,unsubscribed_at FROM update_subscribers ORDER BY email",
    ).map((row) => [row.email, row.unsubscribed_at !== null]);

  const page = await call(link);
  assert.equal(page.status, 200);
  assert.match(
    await page.text(),
    /<form method="post"><button type="submit">Unsubscribe<\/button>/,
  );
  assert.deepEqual(state(), [
    ["other@example.test", false],
    ["reader@example.test", false],
  ]);

  // What a mail app sends for its own Unsubscribe button (RFC 8058).
  const oneClick = await call(link, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "List-Unsubscribe=One-Click",
  });
  assert.equal(oneClick.status, 200);
  assert.match(await oneClick.text(), /You're unsubscribed\./);
  assert.deepEqual(state(), [
    ["other@example.test", false],
    ["reader@example.test", true],
  ]);

  // Signing up again on the website doesn't bring an unsubscribed address back.
  assert.deepEqual(await (await signup("reader@example.test")).json(), { ok: true });
  assert.equal(state()[1][1], true);

  const back = await call(link, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "action=resubscribe",
  });
  assert.match(await back.text(), /You're subscribed again\./);
  assert.equal(state()[1][1], false);

  for (const bad of ["/unsubscribe", "/unsubscribe?t=nope", `/unsubscribe?t=${"0".repeat(32)}`]) {
    const answer = await call(bad, { method: "POST" });
    assert.equal(answer.status, 404);
    assert.match(await answer.text(), /This link doesn't work\./);
  }
  assert.equal((await call(link, { method: "DELETE" })).status, 405);
});

test("the admin routes need the admin token", async () => {
  const { admin, sent } = setup();
  assert.equal((await admin("subscribers", undefined, "wrong".repeat(8))).status, 401);
  assert.equal(
    (await admin("mailings", { ...draft, recipients: 0 }, "wrong".repeat(8))).status,
    401,
  );
  assert.equal(sent.length, 0);
  const off = setup({ ADMIN_TOKEN: undefined });
  assert.equal((await off.admin("subscribers", undefined, "x".repeat(40))).status, 503);
});

test("a version is announced once, to exactly the list the owner looked at", async () => {
  const { add, admin, sent, db, token, rows, call } = setup();
  add("a@example.test", "b@example.test", "gone@example.test", "blocked@example.test");
  assert.deepEqual(await (await admin("unsubscribe", { email: "Gone@Example.test" })).json(), {
    unsubscribed: true,
  });
  db.sql
    .prepare(
      "INSERT INTO email_suppressions (email,requested_at,recorded_at,reason,source_ref) VALUES (?,1,1,'unsubscribe','test')",
    )
    .run("blocked@example.test");

  const list = (await (await admin("subscribers")).json()) as {
    recipients: number;
    subscribers: { email: string }[];
  };
  assert.equal(list.recipients, 2);
  assert.deepEqual(
    list.subscribers.map((row) => row.email),
    ["a@example.test", "b@example.test"],
  );

  // The list grew or shrank since the owner looked: nothing is sent.
  const stale = await admin("mailings", { ...draft, recipients: 3 });
  assert.deepEqual(
    [stale.status, await stale.json()],
    [409, { error: "recipient_count_changed", recipients: 2 }],
  );
  assert.equal(sent.length, 0);
  assert.equal(rows("SELECT 1 FROM update_mailings").length, 0);

  const done = await admin("mailings", { ...draft, recipients: 2 });
  assert.equal(done.status, 201);
  const result = (await done.json()) as Record<string, unknown>;
  assert.deepEqual(
    [result.version, result.sent, result.pending, result.failed, result.skipped],
    ["1.3.11", 2, 0, 0, 0],
  );
  assert.deepEqual(sent.map((mail) => mail.body.to[0]).sort(), [
    "a@example.test",
    "b@example.test",
  ]);

  const mail = sent.find((one) => one.body.to[0] === "a@example.test")!;
  const link = `${origin}/unsubscribe?t=${token("a@example.test")}`;
  assert.equal(mail.body.from, sender);
  assert.equal(mail.body.subject, draft.subject);
  assert.equal(
    mail.body.headers["List-Unsubscribe"],
    `<${link}>, <mailto:support@getdayboard.com?subject=Unsubscribe>`,
  );
  assert.equal(mail.body.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  assert.match(mail.headers["idempotency-key"], /^dayboard-update\/1\.3\.11\/[a-f0-9]{32}\/\d+$/);
  assert.ok(mail.body.text.includes(`Unsubscribe: ${link}`));
  assert.ok(mail.body.text.includes("- Day line in the menu bar"));
  // The plain-text part spells a button out as a link and leaves the picture out.
  assert.ok(mail.body.text.includes("Get DayBoard: https://site.example.test/download"));
  assert.ok(!mail.body.text.includes("shot.png"));
  const { html } = mail.body;
  assert.match(html, new RegExp(`<a href="${link.replaceAll("?", "\\?")}"[^>]*>Unsubscribe</a>`));
  // The subject splits at ": " into a label over the headline.
  assert.match(
    html,
    /<p class="db-soft"[^>]*>DayBoard 1\.3\.11<\/p><h1 [^>]*>A new menu bar<\/h1>/,
  );
  assert.match(html, /<td class="db-ink"[^>]*><strong>Day line<\/strong> in the menu bar<\/td>/);
  assert.match(html, /<h2 [^>]*>New<\/h2>/);
  assert.match(
    html,
    /<a href="https:\/\/site\.example\.test\/download" style="[^"]*">site\.example\.test\/download<\/a>/,
  );
  assert.match(
    html,
    /<a class="db-button" href="https:\/\/site\.example\.test\/download"[^>]*>Get DayBoard<\/a>/,
  );
  assert.match(
    html,
    /<img src="https:\/\/site\.example\.test\/assets\/shot\.png" alt="The day line" width="300"/,
  );
  // Nothing in it runs, and every picture and link is HTTPS.
  assert.doesNotMatch(html, /<script|\son[a-z]+=|(?:src|href)="(?!https:\/\/)/);
  // Each person gets their own link, and it works.
  const other = sent.find((one) => one.body.to[0] === "b@example.test")!;
  assert.ok(!other.body.text.includes(token("a@example.test")));
  assert.equal(
    (await call(`/unsubscribe?t=${token("a@example.test")}`, { method: "POST" })).status,
    200,
  );

  const repeat = await admin("mailings", { ...draft, recipients: 1 });
  assert.equal(repeat.status, 409);
  assert.equal(((await repeat.json()) as { error: string }).error, "already_announced");
  assert.equal(sent.length, 2);

  const progress = await admin("mailings?version=1.3.11");
  assert.equal(((await progress.json()) as { sent: number }).sent, 2);
  assert.equal((await admin("mailings?version=9.9.9")).status, 404);
  assert.deepEqual(logged, []);
});

test("a long list goes out a few at a time, and people who unsubscribe meanwhile are skipped", async () => {
  const { add, admin, sent, cron, db, rows } = setup();
  const everyone = Array.from(
    { length: 23 },
    (_, i) => `r${String(i).padStart(2, "0")}@example.test`,
  );
  add(...everyone);
  const first = await admin("mailings", { ...draft, recipients: 23 });
  assert.equal(((await first.json()) as { sent: number }).sent, 10);
  db.sql
    .prepare("UPDATE update_subscribers SET unsubscribed_at=5 WHERE email=?")
    .run("r22@example.test");
  await cron();
  assert.equal(sent.length, 20);
  await cron();
  await cron();
  assert.equal(sent.length, 22);
  assert.equal(new Set(sent.map((mail) => mail.body.to[0])).size, 22);
  assert.ok(!sent.some((mail) => mail.body.to[0] === "r22@example.test"));
  assert.deepEqual(
    rows<{ state: string; n: number }>(
      "SELECT state,COUNT(*) AS n FROM update_deliveries GROUP BY state ORDER BY state",
    ).map((row) => [row.state, row.n]),
    [
      ["sent", 22],
      ["skipped", 1],
    ],
  );
});

test("a refused email is retried later, and given up after 23 hours", async () => {
  const { add, admin, sent, cron, provider, db, rows } = setup();
  add("a@example.test", "b@example.test");
  provider.status = 429;
  const queued = await admin("mailings", { ...draft, recipients: 2 });
  assert.deepEqual(
    [queued.status, ((await queued.json()) as { pending: number }).pending],
    [201, 2],
  );
  // The provider said slow down, so the run stopped after the first try.
  assert.deepEqual(
    rows<{ attempts: number }>("SELECT attempts FROM update_deliveries ORDER BY email").map(
      (row) => row.attempts,
    ),
    [1, 0],
  );
  assert.deepEqual(logged, [
    "Update email not sent (429 rate_limit_exceeded); the scheduled retry will try again",
  ]);

  provider.status = 0;
  await cron();
  // The first is held for ten minutes after its attempt; the other goes now.
  assert.deepEqual(
    sent.map((mail) => mail.body.to[0]),
    ["b@example.test"],
  );
  db.sql.exec("UPDATE update_deliveries SET next_at=0 WHERE state='pending'");
  await cron();
  assert.deepEqual(
    sent.map((mail) => mail.body.to[0]),
    ["b@example.test", "a@example.test"],
  );

  add("late@example.test");
  provider.status = 500;
  await admin("mailings", { ...draft, version: "1.3.12", recipients: 3 });
  db.sql
    .prepare("UPDATE update_mailings SET created_at=? WHERE version='1.3.12'")
    .run(Date.now() - 23 * 60 * 60 * 1000);
  db.sql.exec("UPDATE update_deliveries SET next_at=0 WHERE state='pending'");
  provider.status = 0;
  await cron();
  assert.equal(sent.length, 2);
  assert.deepEqual(
    rows<{ state: string }>(
      "SELECT DISTINCT state FROM update_deliveries WHERE version='1.3.12'",
    ).map((row) => row.state),
    ["failed"],
  );
});

test("a test copy goes to one address only, and bad drafts are refused", async () => {
  const { add, admin, sent, rows, token } = setup();
  add("a@example.test", "b@example.test");
  const { version: _version, ...message } = draft;
  const test = await admin("test", { ...message, to: "owner@example.test" });
  assert.deepEqual([test.status, await test.json()], [200, { sent: true }]);
  assert.deepEqual(
    sent.map((mail) => mail.body.to),
    [["owner@example.test"]],
  );
  assert.ok(sent[0].body.text.includes(`${origin}/unsubscribe?t=preview`));
  await admin("test", { ...message, to: "a@example.test" });
  assert.ok(sent[1].body.text.includes(token("a@example.test")));
  assert.equal(rows("SELECT 1 FROM update_mailings").length, 0);

  for (const bad of [
    { ...draft, recipients: 2, version: "latest" },
    { ...draft, recipients: 2, subject: "" },
    { ...draft, recipients: 2, subject: "two\nlines" },
    { ...draft, recipients: 2, text: "x".repeat(8001) },
    { ...draft, recipients: "2" },
  ])
    assert.ok([400, 409].includes((await admin("mailings", bad)).status), JSON.stringify(bad));
  assert.equal(sent.length, 2);
  assert.equal(rows("SELECT 1 FROM update_mailings").length, 0);

  const off = setup({ RESEND_API_KEY: undefined });
  off.add("a@example.test");
  const answer = await off.admin("mailings", { ...draft, recipients: 1 });
  assert.deepEqual([answer.status, await answer.json()], [409, { error: "mail_unconfigured" }]);
});

test("an update email can carry a postal address", async () => {
  const { add, admin, sent } = setup({ UPDATES_POSTAL_ADDRESS: " 1 Example St, Sampletown " });
  add("a@example.test");
  await admin("mailings", { ...draft, recipients: 1 });
  assert.ok(
    sent[0].body.text.endsWith("DayBoard\nhttps://site.example.test\n1 Example St, Sampletown"),
  );
  assert.ok(sent[0].body.html.includes("<br>1 Example St, Sampletown</p>"));
});

test("the release notes become the email: subject from the title, no pull request numbers, links added", () => {
  const notes = [
    "# DayBoard 9.9.9 — A calmer menu bar",
    "",
    "DayBoard 9.9.9 redraws the menu bar panel",
    "so today fits on one screen.",
    "",
    "## Added",
    "",
    "- **Day line.** One line for the whole day,",
    "  with what's next (#164).",
    "- Quick capture (#164, #170).",
    "",
  ].join("\r\n");
  const draft = draftFromNotes("9.9.9", notes, "https://site.example.test");
  assert.equal(draft.subject, "DayBoard 9.9.9: A calmer menu bar");
  assert.equal(
    draft.text,
    [
      "DayBoard 9.9.9 redraws the menu bar panel so today fits on one screen.",
      "[Download DayBoard 9.9.9](https://site.example.test/download)",
      "## Added",
      "- **Day line.** One line for the whole day, with what's next.\n- Quick capture.",
      "If you already have DayBoard, it will offer the update.\nEverything that changed: https://site.example.test/changelog",
    ].join("\n\n"),
  );
  assert.equal(draftFromNotes("9.9.9", "No title here.").subject, "DayBoard 9.9.9 is out");
  // --image puts a picture right under the button.
  assert.equal(
    draftFromNotes(
      "9.9.9",
      notes,
      "https://site.example.test",
      "https://site.example.test/a.png",
    ).text.split("\n\n")[2],
    "![DayBoard 9.9.9](https://site.example.test/a.png)",
  );
});
