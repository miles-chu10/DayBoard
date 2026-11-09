import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, test } from "node:test";
import Stripe from "stripe";
import type { Env } from "../src/config.ts";
import { randomToken } from "../src/crypto.ts";
import { createWorker } from "../src/index.ts";
import { licenseMessage, mailer, type Send } from "../src/mail.ts";
import { LocalDb } from "./local-db.ts";

const origin = "https://billing.example.test";
const secret = "whsec_disposable_only";
const buyer = "Disposable.Buyer+dayboard@Example.test";
const sender = "DayBoard <license@mail.example.test>";
const keyPattern = /DAYB_[A-Za-z0-9_-]{43}/;
const realStripe = new Stripe("sk_test_disposable_only", {
  httpClient: Stripe.createFetchHttpClient(),
});
const dbs: LocalDb[] = [];
const logged: string[] = [];
const consoleError = console.error;
beforeEach(() => {
  logged.length = 0;
  console.error = (...values: unknown[]) => void logged.push(values.map(String).join(" "));
});
afterEach(() => {
  console.error = consoleError;
  for (const db of dbs.splice(0)) db.close();
});

interface Attempt {
  url: string;
  headers: Record<string, string>;
  body: {
    from: string;
    to: string[];
    reply_to: string;
    subject: string;
    text: string;
    html: string;
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
    STRIPE_WEBHOOK_SECRET: secret,
    ENCRYPTION_KEY: randomToken(),
    HASH_SECRET: randomToken(),
    ADMIN_TOKEN: randomToken(),
    RESEND_API_KEY: "re_disposable_only",
    MAIL_FROM: sender,
    ...overrides,
  };
  // provider: 0 accepts the email, a status answers with that error, "down" gives no response.
  const state = {
    paid: true,
    refunded: false,
    address: buyer as string | null,
    stripeDown: false,
    provider: 0 as number | "down",
  };
  const sessions = new Map<string, { id: string; client_reference_id: string }>();
  let sessionReads = 0;
  const fake = {
    webhooks: realStripe.webhooks,
    prices: {
      retrieve: async () => ({
        id: "price_TEST",
        active: true,
        type: "one_time",
        currency: "usd",
        product: "prod_TEST",
        livemode: false,
      }),
    },
    checkout: {
      sessions: {
        async create(params: { client_reference_id: string }) {
          const created = {
            id: `cs_test_disposable_${sessions.size + 1}`,
            client_reference_id: params.client_reference_id,
          };
          sessions.set(created.id, created);
          return { ...created, url: `https://checkout.stripe.test/${created.id}` };
        },
        async retrieve(sessionId: string) {
          sessionReads++;
          if (state.stripeDown) throw new Error(`transient Stripe error for ${state.address}`);
          const found = sessions.get(sessionId);
          if (!found) throw new Error("session missing");
          return {
            ...found,
            mode: "payment",
            status: "complete",
            payment_status: state.paid ? "paid" : "unpaid",
            livemode: false,
            payment_intent: `pi_${found.id}`,
            currency: "usd",
            amount_total: 500,
            customer_details: state.address === null ? null : { email: state.address },
          };
        },
        listLineItems: async () => ({
          has_more: false,
          data: [
            {
              quantity: 1,
              price: { id: "price_TEST", product: "prod_TEST", currency: "usd", livemode: false },
            },
          ],
        }),
      },
    },
    paymentIntents: {
      retrieve: async (paymentId: string) => ({
        id: paymentId,
        livemode: false,
        status: "succeeded",
        currency: "usd",
        amount_received: 500,
      }),
    },
    charges: {
      retrieve: async () => ({
        id: "ch_test_disposable",
        livemode: false,
        payment_intent: "pi_cs_test_disposable_1",
        amount: 500,
        amount_refunded: state.refunded ? 500 : 0,
      }),
    },
  } as unknown as Stripe;
  const attempts: Attempt[] = [];
  const send: Send = async (url, init) => {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, name) => (headers[name] = value));
    attempts.push({ url, headers, body: JSON.parse(String(init.body)) });
    if (state.provider === "down") throw new Error(`connection failed sending to ${buyer}`);
    if (state.provider)
      return Response.json(
        { statusCode: state.provider, name: "daily_quota_exceeded", message: `quota: ${buyer}` },
        { status: state.provider },
      );
    return Response.json({ id: "email_disposable" });
  };
  const worker = createWorker(() => fake, send);
  const call = (path: string, cookie: string, body?: unknown) =>
    worker.fetch(
      new Request(origin + path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Cookie: cookie,
          ...(body === undefined ? {} : { Origin: origin, "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      env,
    );
  /** A buyer opens /buy and starts checkout: the order exists and has a Checkout Session. */
  async function order() {
    const buy = await worker.fetch(new Request(origin + "/buy"), env);
    const page = await buy.text();
    const orderId = page.match(/data-order-id="([A-Za-z0-9_-]{32})"/)![1];
    const cookie = buy.headers.get("Set-Cookie")!.split(";")[0];
    assert.equal((await call("/v1/checkout", cookie, { orderId })).status, 200);
    const sessionId = `cs_test_disposable_${sessions.size}`;
    const claim = async () => {
      const response = await call("/v1/checkout/claim", cookie, { orderId });
      return {
        status: response.status,
        ...((await response.json()) as { licenseKey?: string; email?: string }),
      };
    };
    return { orderId, sessionId, page, claim };
  }
  async function signed(type: string, eventId: string, objectId: string) {
    const payload = JSON.stringify({
      id: eventId,
      object: "event",
      type,
      livemode: false,
      data: { object: { id: objectId } },
    });
    const signature = realStripe.webhooks.generateTestHeaderString({ payload, secret });
    return worker.fetch(
      new Request(origin + "/v1/stripe/webhook", {
        method: "POST",
        headers: { "Stripe-Signature": signature },
        body: payload,
      }),
      env,
    );
  }
  const email = (orderId: string) =>
    db.sql.prepare("SELECT * FROM license_emails WHERE order_id=?").get(orderId) as
      | {
          state: string;
          queued_at: number;
          next_at: number;
          attempts: number;
          sent_at: number | null;
        }
      | undefined;
  /** Makes every pending email due, as if the hold from its last attempt had passed. */
  const holdPassed = () => db.sql.exec("UPDATE license_emails SET next_at=0 WHERE state='pending'");
  /** Every value stored in D1, to prove what is and isn't kept. */
  const stored = () =>
    JSON.stringify(
      (
        db.sql.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {
          name: string;
        }[]
      ).map(({ name }) => db.sql.prepare(`SELECT * FROM "${name}"`).all()),
    );
  return {
    db,
    env,
    state,
    worker,
    attempts,
    order,
    signed,
    email,
    holdPassed,
    stored,
    cron: () => worker.scheduled({}, env),
    get sessionReads() {
      return sessionReads;
    },
  };
}

test("a paid order emails the buyer their key once, however often Stripe repeats the event", async () => {
  const f = setup({ SITE_ORIGIN: "https://site.example.test" });
  const { orderId, sessionId, claim } = await f.order();
  const responses = await Promise.all([
    f.signed("checkout.session.completed", "evt_paid", sessionId),
    f.signed("checkout.session.completed", "evt_paid", sessionId),
  ]);
  assert.deepEqual(
    responses.map((response) => response.status),
    [200, 200],
  );
  assert.equal((await f.signed("checkout.session.completed", "evt_paid", sessionId)).status, 200);
  assert.equal(
    (await f.signed("checkout.session.async_payment_succeeded", "evt_async", sessionId)).status,
    200,
  );
  await f.cron();

  assert.equal(f.attempts.length, 1);
  const [{ url, headers, body }] = f.attempts;
  const claimed = await claim();
  assert.equal(claimed.status, 200);
  assert.match(claimed.licenseKey!, keyPattern);
  assert.equal(claimed.email, "sent");
  assert.equal(url, "https://api.resend.com/emails");
  assert.equal(headers.authorization, "Bearer re_disposable_only");
  assert.equal(headers["content-type"], "application/json");
  // Resend rejects requests without a User-Agent, and Workers don't add one.
  assert.equal(headers["user-agent"], "dayboard-billing/1");
  const row = f.email(orderId)!;
  assert.equal(headers["idempotency-key"], `dayboard-license/${orderId}/${row.queued_at}`);
  assert.deepEqual(
    { from: body.from, to: body.to, reply_to: body.reply_to, subject: body.subject },
    {
      from: sender,
      to: [buyer],
      reply_to: "support@getdayboard.com",
      subject: "Your DayBoard Pro license key",
    },
  );
  assert.deepEqual(
    Object.keys(body).sort(),
    ["from", "html", "reply_to", "subject", "text", "to"],
    "no tracking, tags or other fields are requested",
  );
  for (const part of [body.text, body.html]) {
    assert.ok(part.includes(claimed.licenseKey!));
    assert.match(part, /up to 3 Macs/);
    assert.ok(part.includes("https://site.example.test/refund"));
    assert.ok(part.includes("support@getdayboard.com"));
  }
  assert.equal(row.state, "sent");
  assert.equal(row.attempts, 1);
  assert.ok(row.sent_at! >= row.queued_at);
  assert.deepEqual(logged, []);
});

test("neither the address nor the plaintext key is stored or logged, even when sending fails", async () => {
  for (const provider of [0, 429, "down"] as const) {
    const f = setup();
    f.state.provider = provider;
    const { sessionId, claim } = await f.order();
    assert.equal((await f.signed("checkout.session.completed", "evt_paid", sessionId)).status, 200);
    f.state.stripeDown = true;
    f.holdPassed();
    await f.cron();
    const { licenseKey } = await claim();
    for (const text of [f.stored(), logged.join("\n")]) {
      assert.ok(!text.toLowerCase().includes(buyer.toLowerCase()), String(provider));
      assert.ok(!text.includes(licenseKey!), String(provider));
    }
    assert.equal(f.attempts.length, 1);
  }
  assert.deepEqual(logged.slice(-4), [
    "License email not sent (429 daily_quota_exceeded); the scheduled retry will try again",
    "License email retry could not read its Checkout Session",
    "License email not sent (no response); the scheduled retry will try again",
    "License email retry could not read its Checkout Session",
  ]);
});

test("a provider outage never blocks the order: the key is ready and the schedule retries", async () => {
  const f = setup();
  f.state.provider = 500;
  const { orderId, sessionId, claim } = await f.order();
  assert.equal((await f.signed("checkout.session.completed", "evt_paid", sessionId)).status, 200);
  const claimed = await claim();
  assert.equal(claimed.status, 200);
  assert.match(claimed.licenseKey!, keyPattern);
  assert.equal(claimed.email, "pending");
  assert.deepEqual(
    { state: f.email(orderId)!.state, attempts: f.email(orderId)!.attempts },
    { state: "pending", attempts: 1 },
  );

  // The failed attempt holds the order, so neither a repeated event nor an early run resends.
  assert.equal((await f.signed("checkout.session.completed", "evt_paid", sessionId)).status, 200);
  await f.cron();
  assert.equal(f.attempts.length, 1);

  // Once the hold passes, each run tries again. The address comes from Stripe again.
  f.holdPassed();
  const readsBefore = f.sessionReads;
  await f.cron();
  assert.equal(f.sessionReads, readsBefore + 1);
  assert.deepEqual(
    { state: f.email(orderId)!.state, attempts: f.email(orderId)!.attempts },
    { state: "pending", attempts: 2 },
  );
  f.state.provider = 0;
  f.holdPassed();
  await f.cron();
  await f.cron();
  assert.equal(f.attempts.length, 3);
  assert.deepEqual(
    { state: f.email(orderId)!.state, attempts: f.email(orderId)!.attempts },
    { state: "sent", attempts: 3 },
  );
  // Every attempt for one queued email shares an idempotency key and an identical request, so a
  // reply lost after Resend accepted it can't lead to a second copy.
  assert.equal(new Set(f.attempts.map((attempt) => attempt.headers["idempotency-key"])).size, 1);
  assert.equal(new Set(f.attempts.map((attempt) => JSON.stringify(attempt.body))).size, 1);
  assert.deepEqual(f.attempts[2].body.to, [buyer]);
  assert.equal((await claim()).email, "sent");
});

test("the schedule gives up 48 hours after the key was issued", async () => {
  const f = setup();
  f.state.provider = 500;
  const { orderId, sessionId, claim } = await f.order();
  assert.equal((await f.signed("checkout.session.completed", "evt_paid", sessionId)).status, 200);
  f.state.provider = 0;
  const hours = (count: number) => Date.now() - count * 3600 * 1000;
  f.db.sql.prepare("UPDATE license_emails SET queued_at=?,next_at=0").run(hours(48) - 1000);
  await f.cron();
  assert.equal(f.attempts.length, 1);
  assert.equal(f.email(orderId)!.state, "failed");
  // The receipt page stops promising an email, and the key itself is unaffected.
  const claimed = await claim();
  assert.match(claimed.licenseKey!, keyPattern);
  assert.equal(claimed.email, undefined);

  f.db.sql
    .prepare("UPDATE license_emails SET state='pending',queued_at=?,next_at=0")
    .run(hours(47));
  await f.cron();
  assert.equal(f.attempts.length, 2);
  assert.equal(f.email(orderId)!.state, "sent");
});

test("a refund or dispute before the email is sent cancels it", async () => {
  const f = setup();
  f.state.provider = 500;
  const { orderId, sessionId } = await f.order();
  assert.equal((await f.signed("checkout.session.completed", "evt_paid", sessionId)).status, 200);
  f.state.refunded = true;
  assert.equal((await f.signed("charge.refunded", "evt_refund", "ch_test_disposable")).status, 200);
  f.state.provider = 0;
  f.holdPassed();
  // A repeated paid event and the schedule both leave the refunded order alone.
  assert.equal((await f.signed("checkout.session.completed", "evt_again", sessionId)).status, 200);
  await f.cron();
  assert.equal(f.attempts.length, 1);
  assert.equal(f.email(orderId)!.state, "skipped");
  assert.equal(
    f.db.sql.prepare("SELECT state FROM orders WHERE id=?").get(orderId)!.state,
    "revoked",
  );
});

test("an order refunded before its payment event gets no key and no email", async () => {
  const f = setup();
  const { orderId, sessionId } = await f.order();
  f.state.refunded = true;
  assert.equal((await f.signed("charge.refunded", "evt_refund", "ch_test_disposable")).status, 200);
  assert.equal((await f.signed("checkout.session.completed", "evt_paid", sessionId)).status, 200);
  await f.cron();
  assert.equal(f.attempts.length, 0);
  assert.equal(f.email(orderId), undefined);
});

test("an unpaid checkout sends nothing until the payment succeeds", async () => {
  const f = setup();
  const { orderId, sessionId } = await f.order();
  f.state.paid = false;
  assert.equal((await f.signed("checkout.session.completed", "evt_open", sessionId)).status, 200);
  await f.cron();
  assert.equal(f.attempts.length, 0);
  assert.equal(f.email(orderId), undefined);
  f.state.paid = true;
  assert.equal(
    (await f.signed("checkout.session.async_payment_succeeded", "evt_async", sessionId)).status,
    200,
  );
  assert.equal(f.attempts.length, 1);
  assert.equal(f.email(orderId)!.state, "sent");
});

test("a Checkout Session without a usable address is skipped, not retried", async () => {
  for (const address of [null, "", "not an address", "two@@example.test"]) {
    const f = setup();
    f.state.address = address;
    const { orderId, sessionId, claim } = await f.order();
    assert.equal((await f.signed("checkout.session.completed", "evt_paid", sessionId)).status, 200);
    f.holdPassed();
    await f.cron();
    assert.equal(f.attempts.length, 0, String(address));
    assert.equal(f.email(orderId)!.state, "skipped", String(address));
    const claimed = await claim();
    assert.match(claimed.licenseKey!, keyPattern);
    assert.equal(claimed.email, undefined);
  }
});

test("without both the API key and a valid sender, the email is off and checkout is unchanged", async () => {
  for (const overrides of [
    { RESEND_API_KEY: undefined, MAIL_FROM: undefined },
    { RESEND_API_KEY: undefined },
    { MAIL_FROM: undefined },
    { RESEND_API_KEY: "sk_test_not_a_resend_key" },
    { MAIL_FROM: "DayBoard" },
    { MAIL_FROM: "DayBoard <license@mail.example.test>\nBcc: other@example.test" },
    { MAIL_FROM: "<license@mail.example.test> <other@example.test>" },
  ] as Partial<Env>[]) {
    const f = setup(overrides);
    assert.equal(mailer(f.env), null);
    const { orderId, sessionId, page, claim } = await f.order();
    assert.doesNotMatch(page, /email the key/);
    assert.equal((await f.signed("checkout.session.completed", "evt_paid", sessionId)).status, 200);
    await f.cron();
    assert.equal(f.attempts.length, 0);
    assert.equal(f.email(orderId), undefined);
    assert.deepEqual(Object.keys(await claim()).sort(), ["licenseKey", "status"]);
    // A half-configured deployment says so in the log. A deployment without email stays quiet.
    assert.equal(logged.length, f.env.RESEND_API_KEY || f.env.MAIL_FROM ? 1 : 0);
    assert.equal(
      logged.every((line) => /^License email is off: /.test(line)),
      true,
    );
    logged.length = 0;
  }
  for (const from of ["license@mail.example.test", sender, "Miles & Co. <a.b+c@mail.example.test>"])
    assert.deepEqual(mailer({ RESEND_API_KEY: "re_x", MAIL_FROM: ` ${from} ` }), {
      apiKey: "re_x",
      from,
    });
});

test("pages mention the email only when it will be sent", async () => {
  const f = setup();
  const { page } = await f.order();
  assert.match(
    page,
    /your license key appears on the receipt page in this browser\. We also email the key to the address you use at checkout\.<\/small>/,
  );
  const receipt = await (await f.worker.fetch(new Request(origin + "/receipt"), f.env)).text();
  assert.match(
    receipt,
    /<p id="emailed" hidden>We're also emailing this key to the address you used at checkout\./,
  );
  const script = await (await f.worker.fetch(new Request(origin + "/receipt.js"), f.env)).text();
  assert.match(script, /document\.getElementById\('emailed'\)\.hidden=!claimed\.email;/);
});

test("the license service works without the email table, and the schedule tolerates its absence", async () => {
  const f = setup();
  f.db.sql.exec("DROP TABLE license_emails");
  const { sessionId, claim } = await f.order();
  assert.equal((await f.signed("checkout.session.completed", "evt_paid", sessionId)).status, 200);
  const claimed = await claim();
  assert.equal(claimed.status, 200);
  assert.match(claimed.licenseKey!, keyPattern);
  assert.equal(claimed.email, undefined);
  await f.cron();
  assert.equal(f.attempts.length, 0);
  assert.deepEqual(logged, ["License email could not be queued", "License email retry failed"]);
});

test("the schedule does nothing on a deployment without licensing or with Stripe unavailable", async () => {
  const unconfigured = setup({ STRIPE_SECRET_KEY: "" });
  await unconfigured.cron();
  assert.equal(unconfigured.sessionReads, 0);

  const f = setup();
  f.state.provider = 500;
  const { orderId, sessionId } = await f.order();
  assert.equal((await f.signed("checkout.session.completed", "evt_paid", sessionId)).status, 200);
  f.state.provider = 0;
  f.state.stripeDown = true;
  f.holdPassed();
  await f.cron();
  assert.equal(f.attempts.length, 1);
  assert.deepEqual(
    { state: f.email(orderId)!.state, attempts: f.email(orderId)!.attempts },
    { state: "pending", attempts: 1 },
  );
});

test("a run sends at most five emails and leaves the rest for the next one", async () => {
  const f = setup();
  f.state.provider = 500;
  for (let index = 1; index <= 7; index++) {
    const { sessionId } = await f.order();
    assert.equal(
      (await f.signed("checkout.session.completed", `evt_paid_${index}`, sessionId)).status,
      200,
    );
  }
  f.state.provider = 0;
  f.holdPassed();
  const states = () =>
    f.db.sql
      .prepare("SELECT state,COUNT(*) n FROM license_emails GROUP BY state ORDER BY state")
      .all()
      .map((row) => ({ ...row }));
  await f.cron();
  assert.deepEqual(states(), [
    { state: "pending", n: 2 },
    { state: "sent", n: 5 },
  ]);
  await f.cron();
  assert.deepEqual(states(), [{ state: "sent", n: 7 }]);
  assert.equal(new Set(f.attempts.slice(7).map((attempt) => attempt.body.text)).size, 7);
});

test("complimentary keys are never emailed", async () => {
  const f = setup();
  const issued = await f.worker.fetch(
    new Request(origin + "/v1/admin/comp-licenses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${f.env.ADMIN_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ label: "beta tester 1" }),
    }),
    f.env,
  );
  assert.equal(issued.status, 201);
  await f.cron();
  assert.equal(f.attempts.length, 0);
  assert.equal(f.db.sql.prepare("SELECT COUNT(*) n FROM license_emails").get()!.n, 0);
  assert.equal(f.db.sql.prepare("SELECT COUNT(*) n FROM licenses").get()!.n, 1);
});

test("support can queue the email again with the documented statement", async () => {
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  const statement = readme.match(/INSERT OR REPLACE INTO license_emails [^`"]+/)?.[0];
  assert.ok(statement, "the README gives the statement");
  const f = setup();
  const { orderId, sessionId, claim } = await f.order();
  assert.equal((await f.signed("checkout.session.completed", "evt_paid", sessionId)).status, 200);
  const first = f.email(orderId)!;
  // The first email went out more than a second ago, as any real request for another copy would.
  f.db.sql.prepare("UPDATE license_emails SET queued_at=queued_at-5000").run();
  f.db.sql.exec(statement.replace("<order id>", orderId));
  await f.cron();
  assert.equal(f.attempts.length, 2);
  const again = f.email(orderId)!;
  assert.deepEqual(
    { state: again.state, attempts: again.attempts },
    { state: "sent", attempts: 1 },
  );
  assert.notEqual(again.queued_at, first.queued_at - 5000);
  assert.equal(
    f.attempts[1].headers["idempotency-key"],
    `dayboard-license/${orderId}/${again.queued_at}`,
  );
  assert.notEqual(
    f.attempts[1].headers["idempotency-key"],
    f.attempts[0].headers["idempotency-key"],
  );
  assert.ok(f.attempts[1].body.text.includes((await claim()).licenseKey!));

  // The same statement works for an order issued while the email was off, and it never sends
  // for a refunded order.
  const off = setup({ RESEND_API_KEY: undefined });
  const later = await off.order();
  assert.equal(
    (await off.signed("checkout.session.completed", "evt_paid", later.sessionId)).status,
    200,
  );
  off.env.RESEND_API_KEY = "re_disposable_only";
  off.db.sql.exec(statement.replace("<order id>", later.orderId));
  off.state.refunded = true;
  off.db.sql.prepare("UPDATE orders SET state='revoked' WHERE id=?").run(later.orderId);
  await off.cron();
  assert.equal(off.attempts.length, 0);
  assert.equal(off.email(later.orderId)!.state, "skipped");
  off.db.sql.prepare("UPDATE orders SET state='ready' WHERE id=?").run(later.orderId);
  off.db.sql.exec(statement.replace("<order id>", later.orderId));
  await off.cron();
  assert.equal(off.attempts.length, 1);
  assert.deepEqual(off.attempts[0].body.to, [buyer]);
});

test("the message is the same every time, escapes its values and reads well as plain text", () => {
  const key = `DAYB_${"k".repeat(43)}`;
  const message = licenseMessage(key, { site: "https://getdayboard.com", activationLimit: 1 });
  assert.deepEqual(
    message,
    licenseMessage(key, { site: "https://getdayboard.com", activationLimit: 1 }),
  );
  assert.equal(
    message.text,
    [
      "Thanks for buying DayBoard Pro. Here is your license key:",
      key,
      [
        "Activate it:",
        "1. Open DayBoard and choose DayBoard → Settings… (or press ⌘,).",
        "2. Click the License tab.",
        "3. Paste your key into License key, then click Activate.",
      ].join("\n"),
      "Use the same key on up to 1 Mac. To move it, open Settings → License on the old Mac and click Deactivate this device.",
      "Keep this email: it's your copy of the key. Your payment receipt comes separately from Link, Stripe's checkout service.",
      "Questions, or a refund within 14 days? Reply to this email or write to support@getdayboard.com.\nRefund policy: https://getdayboard.com/refund",
      "DayBoard\nhttps://getdayboard.com",
    ].join("\n\n"),
  );
  assert.ok(message.html.includes(`>${key}</p>`));
  assert.doesNotMatch(message.html, /<script|<img|<link|\son[a-z]+=|http:\/\//);
  assert.deepEqual(
    [...message.html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]),
    ["mailto:support@getdayboard.com", "https://getdayboard.com/refund", "https://getdayboard.com"],
  );
  const escaped = licenseMessage('<b>"key"</b>', { site: 'https://a"b.test', activationLimit: 2 });
  assert.ok(escaped.html.includes("&#60;b&#62;&#34;key&#34;&#60;/b&#62;"));
  assert.ok(escaped.html.includes('href="https://a&#34;b.test/refund"'));
  assert.doesNotMatch(escaped.html, /<b>"key"/);
});
