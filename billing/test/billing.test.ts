import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { afterEach, test } from "node:test";
import Stripe from "stripe";
import { createWorker } from "../src/index.ts";
import { randomToken } from "../src/crypto.ts";
import type { Env } from "../src/config.ts";
import { LocalDb } from "./local-db.ts";
import { buyScript, receiptScript } from "../src/pages.ts";

const origin = "https://billing.example.test";
const secret = "whsec_disposable_only";
const adminToken = randomToken();
const realStripe = new Stripe("sk_test_disposable_only", {
  httpClient: Stripe.createFetchHttpClient(),
});
const dbs: LocalDb[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

function setup() {
  const db = new LocalDb();
  dbs.push(db);
  const env: Env = {
    DB: db as unknown as D1Database,
    SERVICE_ORIGIN: origin,
    PRODUCT_ID: "prod_TEST",
    PRICE_ID: "price_TEST",
    PRICE_CURRENCY: "usd",
    ENVIRONMENT: "test",
    ACTIVATION_LIMIT: "2",
    STRIPE_SECRET_KEY: "sk_test_disposable_only",
    STRIPE_WEBHOOK_SECRET: secret,
    ENCRYPTION_KEY: randomToken(),
    HASH_SECRET: randomToken(),
    ADMIN_TOKEN: adminToken,
  };
  const state = {
    priceOk: true,
    paid: true,
    paymentOk: true,
    mode: true,
    productOk: true,
    refund: 0,
    throwStripe: false,
    chargeCurrency: "usd",
    paymentCurrency: "",
  };
  const session = {
    id: "cs_test_disposable",
    mode: "payment",
    status: "complete",
    payment_status: "paid",
    livemode: false,
    client_reference_id: "",
    payment_intent: "pi_test_disposable",
    currency: "usd",
    amount_total: 3000,
    url: "https://checkout.stripe.test/disposable",
  };
  const sessions = new Map<string, typeof session>();
  const idsByCookie = new Map<string, string>();
  let lastOrderId = "";
  let creates = 0;
  const createParams: Record<string, unknown>[] = [];
  const fake = {
    webhooks: realStripe.webhooks,
    prices: {
      async retrieve() {
        if (state.throwStripe) throw new Error("transient Stripe error");
        return {
          id: "price_TEST",
          active: state.priceOk,
          type: "one_time",
          currency: "usd",
          product: "prod_TEST",
          livemode: false,
        };
      },
    },
    checkout: {
      sessions: {
        async create(params: { client_reference_id: string }) {
          if (state.throwStripe) throw new Error("transient Stripe error");
          creates++;
          createParams.push(params);
          const created =
            creates === 1
              ? session
              : {
                  ...session,
                  id: `cs_test_disposable_${creates}`,
                  payment_intent: `pi_test_disposable_${creates}`,
                  url: `https://checkout.stripe.test/disposable_${creates}`,
                };
          created.client_reference_id = params.client_reference_id;
          sessions.set(created.id, created);
          return created;
        },
        async retrieve(sessionId: string) {
          if (state.throwStripe) throw new Error("transient Stripe error");
          const found = sessions.get(sessionId);
          if (!found) throw new Error("session missing");
          return {
            ...found,
            currency: state.chargeCurrency,
            payment_status: state.paid ? "paid" : "unpaid",
            livemode: !state.mode,
          };
        },
        async listLineItems() {
          if (state.throwStripe) throw new Error("transient Stripe error");
          return {
            has_more: false,
            data: [
              {
                quantity: 1,
                price: {
                  id: "price_TEST",
                  product: state.productOk ? "prod_TEST" : "prod_OTHER",
                  currency: "usd",
                  livemode: false,
                },
              },
            ],
          };
        },
      },
    },
    paymentIntents: {
      async retrieve() {
        if (state.throwStripe) throw new Error("transient Stripe error");
        return {
          id: "pi_test_disposable",
          livemode: false,
          status: state.paymentOk ? "succeeded" : "requires_payment_method",
          currency: state.paymentCurrency || state.chargeCurrency,
          amount_received: 3000,
        };
      },
    },
    charges: {
      async retrieve() {
        return {
          id: "ch_test_disposable",
          livemode: false,
          payment_intent: "pi_test_disposable",
          amount: 3000,
          amount_refunded: state.refund,
        };
      },
    },
    disputes: {
      async retrieve() {
        return { id: "dp_test_disposable", livemode: false, charge: "ch_test_disposable" };
      },
    },
  } as unknown as Stripe;
  const worker = createWorker(() => fake);
  async function call(
    path: string,
    method = "GET",
    cookie = "",
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    const explicitBody = body !== undefined;
    if (path === "/v1/checkout/status") path += `?order=${idsByCookie.get(cookie) ?? lastOrderId}`;
    if (path === "/v1/checkout/claim" && body === undefined)
      body = { orderId: idsByCookie.get(cookie) ?? lastOrderId };
    const request = new Request(origin + path, {
      method,
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(explicitBody ? { Origin: origin } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return worker.fetch(request, env);
  }
  async function newOrder() {
    const buy = await call("/buy");
    assert.equal(buy.status, 200);
    const html = await buy.text();
    const orderId = html.match(/data-order-id="([A-Za-z0-9_-]{32})"/)?.[1];
    assert.ok(orderId);
    const cookie = buy.headers.get("Set-Cookie")!.split(";")[0];
    assert.match(cookie, new RegExp(`^__Host-dayboard-order-${orderId}=`));
    idsByCookie.set(cookie, orderId);
    lastOrderId = orderId;
    const response = await call("/v1/checkout", "POST", cookie, { orderId });
    assert.equal(response.status, 200);
    return { cookie, orderId, response };
  }
  async function order() {
    return (await newOrder()).cookie;
  }
  async function signed(type: string, eventId: string, objectId = "cs_test_disposable") {
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
  return {
    db,
    env,
    state,
    session,
    sessions,
    call,
    order,
    newOrder,
    signed,
    createParams,
    get creates() {
      return creates;
    },
  };
}

async function fulfilled() {
  const fixture = setup();
  const cookie = await fixture.order();
  assert.equal((await fixture.signed("checkout.session.completed", "evt_paid")).status, 200);
  const claim = await fixture.call("/v1/checkout/claim", "POST", cookie, undefined, {
    Origin: origin,
  });
  assert.equal(claim.status, 200);
  const { licenseKey } = (await claim.json()) as { licenseKey: string };
  return { ...fixture, cookie, licenseKey };
}

test("raw signature failure and wrong environment reject without writes", async () => {
  const f = setup();
  await f.order();
  const bad = await f.call("/v1/stripe/webhook", "POST", "", undefined, {
    "Stripe-Signature": "bad",
  });
  assert.equal(bad.status, 400);
  const payload = JSON.stringify({
    id: "evt_live",
    object: "event",
    type: "checkout.session.completed",
    livemode: true,
    data: { object: { id: f.session.id } },
  });
  const sig = realStripe.webhooks.generateTestHeaderString({ payload, secret });
  assert.equal(
    (
      await createWorker(() => realStripe).fetch(
        new Request(origin + "/v1/stripe/webhook", {
          method: "POST",
          headers: { "Stripe-Signature": sig },
          body: payload,
        }),
        f.env,
      )
    ).status,
    400,
  );
  assert.equal(f.db.sql.prepare("SELECT COUNT(*) n FROM licenses").get()!.n, 0);
});

test("authoritative paid, product, and mode checks", async () => {
  for (const failure of ["paymentOk", "mode", "productOk"] as const) {
    const f = setup();
    await f.order();
    f.state[failure] = false;
    assert.equal((await f.signed("checkout.session.completed", `evt_${failure}`)).status, 503);
    assert.equal(f.db.sql.prepare("SELECT COUNT(*) n FROM licenses").get()!.n, 0);
  }
});

test("checkout uses Managed Payments and accepts a buyer paying in a local currency", async () => {
  const f = setup();
  await f.order();
  assert.deepEqual(f.createParams[0].managed_payments, { enabled: true });
  assert.equal("automatic_tax" in f.createParams[0], false);
  assert.equal("payment_method_types" in f.createParams[0], false);
  f.state.chargeCurrency = "eur";
  assert.equal((await f.signed("checkout.session.completed", "evt_local")).status, 200);
  assert.equal(f.db.sql.prepare("SELECT COUNT(*) n FROM licenses").get()!.n, 1);
});

test("a payment in a different currency than its session mints no key", async () => {
  const f = setup();
  await f.order();
  f.state.chargeCurrency = "eur";
  f.state.paymentCurrency = "usd";
  assert.equal((await f.signed("checkout.session.completed", "evt_mismatch")).status, 503);
  assert.equal(f.db.sql.prepare("SELECT COUNT(*) n FROM licenses").get()!.n, 0);
});

test("duplicate concurrent webhook and lost reply mint one key; unauthorized claims fail", async () => {
  const f = setup();
  const cookie = await f.order();
  const responses = await Promise.all([
    f.signed("checkout.session.completed", "evt_one"),
    f.signed("checkout.session.completed", "evt_one"),
  ]);
  assert.deepEqual(
    responses.map((r) => r.status),
    [200, 200],
  );
  assert.equal(f.db.sql.prepare("SELECT COUNT(*) n FROM licenses").get()!.n, 1);
  assert.equal(
    (await f.call("/v1/checkout/claim", "POST", "", undefined, { Origin: origin })).status,
    401,
  );
  assert.equal(
    (
      await f.call("/v1/checkout/claim", "POST", "dayboard_order=" + randomToken(), undefined, {
        Origin: origin,
      })
    ).status,
    401,
  );
  assert.equal((await f.call("/v1/checkout/claim", "POST", cookie)).status, 403);
  const first = await f.call("/v1/checkout/claim", "POST", cookie, undefined, { Origin: origin });
  const second = await f.call("/v1/checkout/claim", "POST", cookie, undefined, { Origin: origin });
  assert.equal(
    ((await first.json()) as { licenseKey: string }).licenseKey,
    ((await second.json()) as { licenseKey: string }).licenseKey,
  );
});

test("full refund before paid is monotonic; partial refund retains access", async () => {
  const f = setup();
  const cookie = await f.order();
  f.state.refund = 3000;
  assert.equal((await f.signed("charge.refunded", "evt_refund", "ch_test_disposable")).status, 200);
  assert.equal((await f.signed("checkout.session.completed", "evt_paid_after_refund")).status, 200);
  assert.equal(
    ((await (await f.call("/v1/checkout/status", "GET", cookie)).json()) as { state: string })
      .state,
    "revoked",
  );
  assert.equal(f.db.sql.prepare("SELECT COUNT(*) n FROM licenses").get()!.n, 0);
  const g = await fulfilled();
  g.state.refund = 1000;
  assert.equal(
    (await g.signed("charge.refunded", "evt_partial", "ch_test_disposable")).status,
    200,
  );
  assert.equal(
    (await g.call("/v1/checkout/claim", "POST", g.cookie, undefined, { Origin: origin })).status,
    200,
  );
  assert.equal(
    (await g.signed("charge.dispute.created", "evt_dispute", "dp_test_disposable")).status,
    200,
  );
  assert.equal(
    (await g.call("/v1/checkout/claim", "POST", g.cookie, undefined, { Origin: origin })).status,
    409,
  );
});

test("activation retries, cap, validation binding, deactivation, revocation", async () => {
  const f = await fulfilled();
  const install1 = crypto.randomUUID(),
    install2 = crypto.randomUUID(),
    install3 = crypto.randomUUID();
  const activate = (installationId: string) =>
    f.call("/v1/licenses/activate", "POST", "", {
      licenseKey: f.licenseKey,
      installationId,
      instanceName: "Test Mac",
    });
  const [a, b] = await Promise.all([activate(install1), activate(install1)]);
  const ar = (await a.json()) as { activated: boolean; created: boolean; instanceId: string };
  const br = (await b.json()) as { activated: boolean; created: boolean; instanceId: string };
  assert.equal(ar.instanceId, br.instanceId);
  assert.equal(Number(ar.created) + Number(br.created), 1);
  assert.equal(
    ((await (await activate(install2)).json()) as { activated: boolean }).activated,
    true,
  );
  assert.equal(
    ((await (await activate(install3)).json()) as { error: string }).error,
    "activation_limit",
  );
  const validation = await f.call("/v1/licenses/validate", "POST", "", {
    licenseKey: f.licenseKey,
    instanceId: ar.instanceId,
  });
  assert.deepEqual(((await validation.json()) as { meta: unknown }).meta, {
    issuer: origin,
    productId: "prod_TEST",
    environment: "test",
  });
  assert.equal(
    (
      (await (
        await f.call("/v1/licenses/deactivate", "POST", "", {
          licenseKey: f.licenseKey,
          instanceId: ar.instanceId,
        })
      ).json()) as { deactivated: boolean }
    ).deactivated,
    true,
  );
  assert.equal(
    (
      (await (
        await f.call("/v1/licenses/deactivate", "POST", "", {
          licenseKey: f.licenseKey,
          instanceId: ar.instanceId,
        })
      ).json()) as { deactivated: boolean }
    ).deactivated,
    true,
  );
  assert.equal(
    ((await (await activate(install3)).json()) as { activated: boolean }).activated,
    true,
  );
  f.state.refund = 3000;
  await f.signed("charge.refunded", "evt_later_refund", "ch_test_disposable");
  assert.equal(
    (
      (await (
        await f.call("/v1/licenses/validate", "POST", "", { licenseKey: f.licenseKey })
      ).json()) as { error: string }
    ).error,
    "revoked",
  );
});

test("transient Stripe failure and SQL rollback retry safely", async () => {
  const f = setup();
  f.state.throwStripe = true;
  const buy = await f.call("/buy");
  const orderId = (await buy.text()).match(/data-order-id="([A-Za-z0-9_-]{32})"/)![1];
  const cookie = buy.headers.get("Set-Cookie")!.split(";")[0];
  const initial = await f.call("/v1/checkout", "POST", cookie, { orderId });
  assert.equal(initial.status, 503);
  assert.equal(f.db.sql.prepare("SELECT COUNT(*) n FROM orders").get()!.n, 1);
  f.state.throwStripe = false;
  assert.equal((await f.call("/v1/checkout", "POST", cookie, { orderId })).status, 200);
  f.db.failAtBatchStatement = 3;
  assert.equal((await f.signed("checkout.session.completed", "evt_sql_fail")).status, 503);
  assert.equal(f.db.sql.prepare("SELECT COUNT(*) n FROM payments").get()!.n, 0);
  assert.equal(f.db.sql.prepare("SELECT COUNT(*) n FROM licenses").get()!.n, 0);
  f.db.failAtBatchStatement = 0;
  assert.equal((await f.signed("checkout.session.completed", "evt_sql_fail")).status, 200);
  assert.equal(f.db.sql.prepare("SELECT COUNT(*) n FROM licenses").get()!.n, 1);
});

test("different installations racing respect the configured cap", async () => {
  const f = await fulfilled();
  const attempts = await Promise.all(
    Array.from({ length: 5 }, () =>
      f.call("/v1/licenses/activate", "POST", "", {
        licenseKey: f.licenseKey,
        installationId: crypto.randomUUID(),
        instanceName: "Disposable Mac",
      }),
    ),
  );
  const outcomes = await Promise.all(
    attempts.map((response) => response.json() as Promise<{ activated: boolean }>),
  );
  assert.equal(outcomes.filter((result) => result.activated).length, 2);
  assert.equal(f.db.sql.prepare("SELECT COUNT(*) n FROM activations").get()!.n, 2);
});

test("origin checks, bounded bodies, and receipt never disclose a key", async () => {
  const f = setup();
  const buy = await f.call("/buy");
  const html = await buy.text();
  assert.equal(buy.headers.get("Cache-Control"), "no-store, max-age=0");
  assert.match(html, /DayBoard/);
  assert.equal(
    (await f.call("/v1/checkout", "POST", "", undefined, { Origin: "https://other.example" }))
      .status,
    403,
  );
  assert.equal(
    (
      await f.call(
        "/v1/checkout",
        "POST",
        "",
        { orderId: html.match(/data-order-id="([A-Za-z0-9_-]{32})"/)![1] },
        { Origin: origin, "Content-Length": "9999" },
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await f.call(
        "/v1/checkout/status?order=" + html.match(/data-order-id="([A-Za-z0-9_-]{32})"/)![1],
      )
    ).status,
    401,
  );
  assert.equal((await f.call("/receipt")).headers.get("Referrer-Policy"), "no-referrer");
  assert.doesNotMatch(await (await f.call("/receipt")).text(), /DAYB_[A-Za-z0-9_-]{43}/);
});

test("restricted Stripe keys match mode and unpaid completion waits for async success", async () => {
  const f = setup();
  f.env.STRIPE_SECRET_KEY = "rk_test_disposable_only";
  const cookie = await f.order();
  f.state.paid = false;
  assert.equal((await f.signed("checkout.session.completed", "evt_pending")).status, 200);
  assert.equal(f.db.sql.prepare("SELECT COUNT(*) n FROM licenses").get()!.n, 0);
  assert.equal(
    ((await (await f.call("/v1/checkout/status", "GET", cookie)).json()) as { state: string })
      .state,
    "pending",
  );
  f.state.paid = true;
  assert.equal(
    (await f.signed("checkout.session.async_payment_succeeded", "evt_async_paid")).status,
    200,
  );
  assert.equal(f.db.sql.prepare("SELECT COUNT(*) n FROM licenses").get()!.n, 1);
});

test("webhook API outage is retried and async failure stays non-entitled", async () => {
  const f = setup();
  const cookie = await f.order();
  f.state.throwStripe = true;
  assert.equal((await f.signed("checkout.session.completed", "evt_api_retry")).status, 503);
  assert.equal(f.db.sql.prepare("SELECT COUNT(*) n FROM licenses").get()!.n, 0);
  f.state.throwStripe = false;
  assert.equal((await f.signed("checkout.session.completed", "evt_api_retry")).status, 200);
  const g = setup();
  const gcookie = await g.order();
  g.state.paid = false;
  assert.equal((await g.signed("checkout.session.async_payment_failed", "evt_failed")).status, 200);
  assert.equal(
    ((await (await g.call("/v1/checkout/status", "GET", gcookie)).json()) as { state: string })
      .state,
    "failed",
  );
  assert.equal(g.db.sql.prepare("SELECT COUNT(*) n FROM licenses").get()!.n, 0);
  assert.equal((await f.call("/v1/checkout/status", "GET", cookie)).status, 200);
});

test("issued license remains bound to original product and environment", async () => {
  const f = await fulfilled();
  f.env.PRODUCT_ID = "prod_OTHER";
  const response = await f.call("/v1/licenses/validate", "POST", "", { licenseKey: f.licenseKey });
  assert.equal(((await response.json()) as { error: string }).error, "invalid_license");
  assert.equal(
    (await f.call("/v1/checkout/claim", "POST", f.cookie, undefined, { Origin: origin })).status,
    409,
  );
});

test("two checkout tabs keep independent claim cookies and receipt selectors", async () => {
  const f = setup();
  const [page1, page2] = await Promise.all([f.call("/buy"), f.call("/buy")]);
  const [html1, html2] = await Promise.all([page1.text(), page2.text()]);
  const id1 = html1.match(/data-order-id="([A-Za-z0-9_-]{32})"/)![1];
  const id2 = html2.match(/data-order-id="([A-Za-z0-9_-]{32})"/)![1];
  const cookie1 = page1.headers.get("Set-Cookie")!.split(";")[0];
  const cookie2 = page2.headers.get("Set-Cookie")!.split(";")[0];
  assert.notEqual(id1, id2);
  assert.notEqual(cookie1.split("=")[0], cookie2.split("=")[0]);
  const bothCookies = `${cookie1}; ${cookie2}`;
  const [checkout1, checkout2] = await Promise.all([
    f.call("/v1/checkout", "POST", bothCookies, { orderId: id1 }),
    f.call("/v1/checkout", "POST", bothCookies, { orderId: id2 }),
  ]);
  assert.deepEqual([checkout1.status, checkout2.status], [200, 200]);
  assert.equal(f.creates, 2);
  const session1 = [...f.sessions.values()].find((item) => item.client_reference_id === id1)!;
  assert.equal(
    (await f.signed("checkout.session.completed", "evt_first_tab", session1.id)).status,
    200,
  );
  const status1 = await f.call(`/v1/checkout/status?order=${id1}`, "GET", bothCookies);
  const status2 = await f.call(`/v1/checkout/status?order=${id2}`, "GET", bothCookies);
  assert.equal(((await status1.json()) as { state: string }).state, "ready");
  assert.equal(((await status2.json()) as { state: string }).state, "pending");
  assert.equal((await f.call(`/v1/checkout/status?order=${id1}`, "GET", cookie2)).status, 401);
  assert.equal((await f.call("/v1/checkout/claim", "POST", cookie2, { orderId: id1 })).status, 401);
  assert.equal(
    (await f.call("/v1/checkout/claim", "POST", bothCookies, { orderId: id1 })).status,
    200,
  );
  assert.equal(
    (await f.call("/v1/checkout/claim", "POST", bothCookies, { orderId: id2 })).status,
    409,
  );
});

test("lost checkout response reuses order and Session", async () => {
  const f = setup();
  const first = await f.newOrder();
  assert.equal(f.creates, 1);
  const second = await f.call("/v1/checkout", "POST", first.cookie, { orderId: first.orderId });
  assert.equal(second.status, 200);
  assert.equal(
    ((await first.response.json()) as { url: string }).url,
    ((await second.json()) as { url: string }).url,
  );
  assert.equal(f.creates, 1);
  assert.equal(f.db.sql.prepare("SELECT COUNT(*) n FROM orders").get()!.n, 1);
});

test("failed and expired receipts link to a fresh checkout while old orders remain accessible", async () => {
  const f = setup();
  const failed = await f.newOrder();
  f.state.paid = false;
  assert.equal(
    (await f.signed("checkout.session.async_payment_failed", "evt_first_failed")).status,
    200,
  );
  assert.equal(
    (
      (await (
        await f.call(`/v1/checkout/status?order=${failed.orderId}`, "GET", failed.cookie)
      ).json()) as { state: string }
    ).state,
    "failed",
  );
  const receipt = await f.call(`/receipt?order=${failed.orderId}`);
  assert.match(await receipt.text(), /id="retry" href="\/buy"/);
  const retry = await f.newOrder();
  assert.notEqual(retry.orderId, failed.orderId);
  assert.equal(f.creates, 2);
  assert.equal(
    (
      (await (
        await f.call(`/v1/checkout/status?order=${failed.orderId}`, "GET", failed.cookie)
      ).json()) as { state: string }
    ).state,
    "failed",
  );
  const expiring = f.sessions.get("cs_test_disposable_2")!;
  expiring.status = "expired";
  const old = await f.call("/v1/checkout", "POST", retry.cookie, { orderId: retry.orderId });
  assert.equal(
    ((await old.json()) as { url: string }).url,
    `${origin}/receipt?order=${retry.orderId}`,
  );
  assert.equal(
    (
      (await (
        await f.call(`/v1/checkout/status?order=${retry.orderId}`, "GET", retry.cookie)
      ).json()) as { state: string }
    ).state,
    "failed",
  );
  const afterExpiry = await f.newOrder();
  assert.notEqual(afterExpiry.orderId, retry.orderId);
  assert.equal(f.creates, 3);
});

test("paid and comp licenses share the cap but keep separate revocation", async () => {
  const f = await fulfilled();
  const admin = (path: string, body: unknown) =>
    f.call(path, "POST", "", body, { Authorization: `Bearer ${adminToken}` });
  const issued = await admin("/v1/admin/comp-licenses", { label: "beta tester 1" });
  assert.equal(issued.status, 201);
  const comp = (await issued.json()) as { licenseId: string; licenseKey: string };
  const paidId = String(
    f.db.sql
      .prepare("SELECT id FROM licenses WHERE id NOT IN (SELECT license_id FROM comp_licenses)")
      .get()!.id,
  );
  // The admin route revokes only comp licenses. Paid ones follow Stripe refunds and disputes.
  assert.equal((await admin("/v1/admin/comp-licenses/revoke", { licenseId: paidId })).status, 404);
  const outcomes = async (licenseKey: string) => {
    const results = [];
    for (let i = 0; i < 3; i++) {
      const response = await f.call("/v1/licenses/activate", "POST", "", {
        licenseKey,
        installationId: crypto.randomUUID(),
        instanceName: "Test Mac",
      });
      results.push(((await response.json()) as { error?: string }).error ?? "activated");
    }
    return results;
  };
  assert.deepEqual(await outcomes(f.licenseKey), ["activated", "activated", "activation_limit"]);
  assert.deepEqual(await outcomes(comp.licenseKey), ["activated", "activated", "activation_limit"]);
  const validate = async (licenseKey: string) =>
    (await (await f.call("/v1/licenses/validate", "POST", "", { licenseKey })).json()) as {
      valid: boolean;
      error?: string;
    };
  // A refund revokes the paid key only.
  f.state.refund = 3000;
  assert.equal(
    (await f.signed("charge.refunded", "evt_mixed_refund", "ch_test_disposable")).status,
    200,
  );
  assert.deepEqual(await validate(f.licenseKey), { valid: false, error: "revoked" });
  assert.equal((await validate(comp.licenseKey)).valid, true);
  // Revoking the comp key gives the same answer and leaves the paid tombstone's reason alone.
  assert.equal(
    (await admin("/v1/admin/comp-licenses/revoke", { licenseId: comp.licenseId })).status,
    200,
  );
  assert.deepEqual(await validate(comp.licenseKey), { valid: false, error: "revoked" });
  assert.deepEqual(
    f.db.sql
      .prepare("SELECT payment_intent_id, reason FROM payments ORDER BY payment_intent_id")
      .all()
      .map((row) => [row.payment_intent_id, row.reason]),
    [
      [`comp_${comp.licenseId}`, "comp_revoked"],
      ["pi_test_disposable", "full_refund"],
    ],
  );
});

test("served browser scripts parse as JavaScript", () => {
  assert.doesNotThrow(() => new Function(buyScript));
  assert.doesNotThrow(() => new Function(receiptScript));
});

const supportLink = /<a href="mailto:support@getdayboard\.com">support@getdayboard\.com<\/a>/;

// Runs the served receipt script against a minimal page: the claim succeeds, then the buyer
// clicks Copy license. `clipboard` is what navigator.clipboard.writeText does in that browser.
async function receiptCopy(clipboard: () => Promise<void>, execCommand: () => boolean) {
  const order = "A".repeat(32);
  const ids = ["title", "message", "wait", "license", "key", "copy", "copied", "emailed"];
  const nodes = Object.fromEntries(
    ids.map((id) => [id, { id, textContent: "", hidden: true } as Record<string, unknown>]),
  );
  nodes.download = { id: "download" };
  nodes.message.textContent = "Your payment may take a moment to confirm.";
  let selected: unknown = null;
  const page = {
    title: "",
    getElementById: (id: string) => nodes[id],
    createRange: () => ({ selectNodeContents: (node: unknown) => (selected = node) }),
    execCommand,
  };
  const fetched = async (url: string) =>
    new Response(
      JSON.stringify(
        url.startsWith("/v1/checkout/status")
          ? { state: "ready" }
          : { licenseKey: "DAYB_fixture", email: "sent" },
      ),
    );
  new Function("document", "location", "fetch", "navigator", "getSelection", receiptScript)(
    page,
    { href: `${origin}/receipt?order=${order}` },
    fetched,
    { clipboard: { writeText: clipboard } },
    () => ({ removeAllRanges() {}, addRange() {} }),
  );
  for (let turn = 0; turn < 20 && nodes.license.hidden; turn++)
    await new Promise((resolve) => setImmediate(resolve));
  assert.equal(nodes.license.hidden, false);
  assert.equal(nodes.wait.hidden, true);
  await (nodes.copy.onclick as () => Promise<void>)();
  return { nodes, selected: () => selected };
}

test("a blocked copy selects the key and says so beside the buttons, not in the status line", async () => {
  const blocked = await receiptCopy(
    () => Promise.reject(new Error("blocked")),
    () => false,
  );
  assert.equal(
    blocked.nodes.copied.textContent,
    "This browser blocked copying. Your key is selected: press ⌘C to copy it, or use Download license.",
  );
  assert.equal(blocked.selected(), blocked.nodes.key);
  // The status line above the key keeps the order's state; the old message pointed "above".
  assert.equal(blocked.nodes.message.textContent, "Payment confirmed. Your license key is below.");
  assert.doesNotMatch(receiptScript, /Copy is unavailable|license above/);

  // The older copy command still works where the Clipboard API is refused.
  const legacy = await receiptCopy(
    () => Promise.reject(new Error("blocked")),
    () => true,
  );
  assert.equal(legacy.nodes.copied.textContent, "License copied.");

  const copiedKeys: string[] = [];
  const allowed = await receiptCopy(
    async (...args: unknown[]) => void copiedKeys.push(String(args[0])),
    () => false,
  );
  assert.deepEqual(copiedKeys, ["DAYB_fixture"]);
  assert.equal(allowed.nodes.copied.textContent, "License copied.");
  assert.equal(allowed.nodes.copy.textContent, "Copied");
  assert.equal(allowed.selected(), null);

  const html = await (await setup().call("/receipt")).text();
  assert.match(
    html,
    /Download license<\/button><\/div><p id="copied" role="status" aria-live="polite"><\/p>/,
  );
});

test("pages take their typeface and icon from this Worker and nothing from other origins", async () => {
  const f = setup();
  for (const path of ["/buy", "/receipt"]) {
    const page = await f.call(path);
    assert.match(
      page.headers.get("Content-Security-Policy")!,
      /^default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; font-src 'self'; img-src 'self'; connect-src 'self';/,
    );
    const html = await page.text();
    assert.match(html, /src:url\("\/fonts\/hanken-grotesk\.woff2"\) format\("woff2"\)/);
    assert.match(html, /<img src="\/icon\.png" alt="" width="34" height="34">DayBoard<\/a>/);
    assert.doesNotMatch(
      html,
      /url\((?!"\/fonts\/)|@import|<link(?! rel="icon" href="\/icon\.png">)/,
    );
  }
  for (const [path, type, signature] of [
    ["/fonts/hanken-grotesk.woff2", "font/woff2", "wOF2"],
    ["/icon.png", "image/png", "\x89PNG"],
  ] as const) {
    const asset = await f.call(path);
    assert.equal(asset.status, 200, path);
    assert.equal(asset.headers.get("Content-Type"), type);
    assert.equal(asset.headers.get("Cache-Control"), "public, max-age=86400");
    assert.equal(asset.headers.get("X-Content-Type-Options"), "nosniff");
    assert.equal(asset.headers.get("Set-Cookie"), null);
    const body = Buffer.from(await asset.arrayBuffer());
    assert.equal(body.subarray(0, 4).toString("latin1"), signature);
    // The same bytes the website serves.
    const source = path === "/icon.png" ? "website/assets/icon-96.png" : `website/assets${path}`;
    assert.ok(body.equals(await readFile(new URL(`../../${source}`, import.meta.url))), path);
  }
  assert.equal((await f.call("/fonts/other.woff2")).status, 404);
});

test("buy page states the offer, terms and support before checkout", async () => {
  const f = setup();
  f.env.ACTIVATION_LIMIT = "3";
  f.env.SITE_ORIGIN = "https://site.example.test";
  const buy = await f.call("/buy");
  assert.equal(buy.status, 200);
  const html = await buy.text();
  const beforeCheckout = html.slice(0, html.indexOf('id="buy"'));
  for (const copy of [
    /\$5 once \(launch price\)/,
    /The launch price ends December 31, 2026 at 11:59 PM PST\. After that, DayBoard Pro is \$9\./,
    /Unlocks DayBoard's AI features\./,
    /Use on up to 3 Macs/,
    /14-day refunds\./,
    /href="https:\/\/site\.example\.test\/pricing"/,
    /href="https:\/\/site\.example\.test\/refund"/,
    supportLink,
  ])
    assert.match(beforeCheckout, copy);
  assert.match(
    buy.headers.get("Content-Security-Policy")!,
    /default-src 'none'; script-src 'self';/,
  );
  assert.doesNotMatch(html, /\son[a-z]+=|<script>|https?:\/\/(?!site\.example\.test\/)/);
});

test("page links use the configured website, fall back to the public one, and stay escaped", async () => {
  const f = setup();
  for (const [site, expected] of [
    [undefined, "https://getdayboard.com"],
    ["http://site.example.test", "https://getdayboard.com"],
    ["https://site.example.test/", "https://getdayboard.com"],
    ['https://a"b.example.test', "https://a&#34;b.example.test"],
  ] as const) {
    f.env.SITE_ORIGIN = site;
    const buy = await (await f.call("/buy")).text();
    assert.ok(buy.includes(`href="${expected}/pricing"`), site);
    assert.ok(buy.includes(`href="${expected}/refund"`), site);
    assert.ok((await (await f.call("/receipt")).text()).includes(`href="${expected}/refund"`));
  }
  f.env.ACTIVATION_LIMIT = "1";
  assert.match(await (await f.call("/buy")).text(), /Use on up to 1 Mac<\/strong>/);
});

test("receipt page gives the app's activation steps, the 7-day browser limit and support", async () => {
  const f = setup();
  f.env.ACTIVATION_LIMIT = "3";
  const buy = await f.call("/buy");
  // The page's 7 days is the order cookie's lifetime.
  assert.match(buy.headers.get("Set-Cookie")!, /; Max-Age=604800;/);
  const receipt = await f.call("/receipt");
  const html = await receipt.text();
  for (const copy of [
    /<strong>Copy or download your license key now\.<\/strong> This page works only in this browser, and only for 7 days after you started checkout\./,
    /<button id="copy" type="button">Copy license<\/button>/,
    /<button id="download" class="secondary" type="button">Download license<\/button>/,
    /choose <strong>DayBoard → Settings…<\/strong> \(or press <kbd>⌘,<\/kbd>\)/,
    /Click the <strong>License<\/strong> tab\./,
    /Paste your key into <strong>License key<\/strong>, then click <strong>Activate<\/strong>\./,
    /Use the same key on up to 3 Macs\./,
    /click <strong>Deactivate this device<\/strong>/,
    supportLink,
    /href="https:\/\/getdayboard\.com\/refund"/,
  ])
    assert.match(html, copy);
  assert.match(
    receipt.headers.get("Content-Security-Policy")!,
    /default-src 'none'; script-src 'self';/,
  );
  assert.doesNotMatch(html, /\son[a-z]+=|<script>/);

  // Those labels are the desktop app's own: its menu, Settings tab, field and buttons.
  const app = (path: string) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");
  const [menu, tabs, tab] = await Promise.all([
    app("main/window.ts"),
    app("renderer/settings/settings-view.tsx"),
    app("renderer/settings/license-tab.tsx"),
  ]);
  assert.match(
    menu,
    /label: "DayBoard",\s*submenu:[\s\S]*?label: "Settings…",\s*accelerator: "Command\+,"/,
  );
  assert.match(tabs, /<TabsTrigger value="license">License<\/TabsTrigger>/);
  assert.match(tab, /<Field label="License key">/);
  assert.match(tab, /"Activating…" : "Activate"/);
  assert.match(tab, /"Deactivate this device"/);
});

test("every receipt dead end, buy error and rate-limited buy page points to support", async () => {
  const shown = [...receiptScript.matchAll(/show\('([^']+)','([^']+)'\)/g)];
  for (const heading of ["Order access unavailable", "License unavailable", "Payment incomplete"]) {
    const messages = shown.filter((match) => match[1] === heading).map((match) => match[2]);
    assert.ok(messages.length > 0, heading);
    for (const message of messages) assert.match(message, /email support/i, heading);
  }
  assert.match(receiptScript, /for 7 days\. Email support/);
  assert.match(
    buyScript,
    /Checkout could not open\. Reload this page and try again, or email support\./,
  );

  const f = setup();
  let response = await f.call("/buy");
  for (let attempt = 1; attempt <= 30; attempt++) response = await f.call("/buy");
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Content-Type"), "text/html; charset=utf-8");
  assert.equal(response.headers.get("Set-Cookie"), null);
  const busy = await response.text();
  assert.match(busy, /Too many checkout attempts/);
  assert.match(busy, supportLink);
});
