import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-expect-error The script is plain JavaScript with no type declarations.
import { QUERIES, collectKpis, toMarkdown } from "../scripts/kpis.mjs";
import { LocalDb } from "./local-db.ts";

type Init = { method?: string; headers?: Record<string, string>; body?: string };

function seed(db: LocalDb) {
  const now = Date.now();
  const insert = db.sql.prepare("INSERT INTO usage_checkins VALUES (?,?,?,?,?)");
  const today = new Date().toISOString().slice(0, 10);
  insert.run("00000000-0000-4000-8000-000000000001", today, today, "1.3.2", "trial");
  insert.run("00000000-0000-4000-8000-000000000002", today, today, "1.3.2", "licensed");
  db.sql.exec(`
    INSERT INTO orders (id, capability_hash, capability_expires_at, state, created_at) VALUES ('o1', 'h1', ${now}, 'ready', ${now});
    INSERT INTO payments (payment_intent_id, revoked, updated_at) VALUES ('pi_1', 0, ${now});
    INSERT INTO licenses (id, order_id, payment_intent_id, issuer, product_id, environment, key_hash, key_ciphertext, key_iv, created_at)
      VALUES ('l1', 'o1', 'pi_1', 'dayboard', 'prod_x', 'live', 'kh1', 'c', 'iv', ${now});
    INSERT INTO activations (instance_id, license_id, installation_id, instance_name, created_at) VALUES ('i1', 'l1', 'inst1', 'Mac', ${now});
  `);
}

function fakeFetch(db: LocalDb, calls: string[]) {
  return async (input: string | URL, init: Init = {}) => {
    const url = new URL(String(input));
    calls.push(`${init.method ?? "GET"} ${url.hostname}${url.pathname}`);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    if (url.hostname === "api.cloudflare.com") {
      assert.equal(init.headers?.authorization, "Bearer cf-token");
      const { sql } = JSON.parse(init.body ?? "{}");
      assert.ok(Object.values(QUERIES).includes(sql), "only the script's own queries run");
      return json({
        success: true,
        result: [{ success: true, results: db.sql.prepare(sql).all() }],
      });
    }
    if (url.hostname === "api.stripe.com") {
      assert.equal(init.headers?.authorization, "Bearer rk_live_test");
      if (url.pathname.endsWith("/checkout/sessions"))
        return json({
          has_more: false,
          data: [
            { id: "cs_1", payment_status: "paid", amount_total: 500 },
            { id: "cs_2", payment_status: "unpaid", amount_total: 500 },
          ],
        });
      return json({ has_more: false, data: [] });
    }
    if (url.hostname === "api.github.com")
      return json([
        {
          tag_name: "v1.3.2",
          published_at: "2026-11-12T21:17:34Z",
          prerelease: false,
          draft: false,
          assets: [
            { name: "DayBoard-1.3.2-arm64.dmg", download_count: 4 },
            { name: "DayBoard-1.3.2-arm64.dmg.blockmap", download_count: 1 },
            { name: "DayBoard-1.3.2-arm64-mac.zip", download_count: 3 },
            { name: "latest-mac.yml", download_count: 13 },
          ],
        },
      ]);
    return json({ message: "unexpected" }, 404);
  };
}

const env = {
  CLOUDFLARE_API_TOKEN: "cf-token",
  CLOUDFLARE_ACCOUNT_ID: "acct",
  DAYBOARD_D1_DATABASE_ID: "db",
  STRIPE_KPI_KEY: "rk_live_test",
};

test("collects every section with read-only calls", async () => {
  const db = new LocalDb();
  try {
    seed(db);
    const calls: string[] = [];
    const k = await collectKpis({ env, fetch: fakeFetch(db, calls) });
    assert.ok(calls.every((c) => c.startsWith("GET ") || c.includes("/d1/database/db/query")));
    assert.equal(k.usage.status, "ok");
    assert.equal(k.usage.summary.active_today, 2);
    assert.equal(k.usage.summary.tried_ai, 1);
    assert.deepEqual(
      k.licenses.rows.map((r: { kind: string; licenses: number; activated: number }) => [
        r.kind,
        r.licenses,
        r.activated,
      ]),
      [
        ["paid", 1, 1],
        ["comp", 0, 0],
      ],
    );
    assert.equal(k.money.paid_sales, 1);
    assert.equal(k.money.gross_usd, 5);
    assert.equal(k.money.fees_est_usd, 0.62);
    assert.equal(k.money.net_est_usd, 4.38);
    assert.deepEqual(k.downloads.releases[0], {
      release: "1.3.2",
      published: "2026-11-12T21:17:34Z",
      prerelease: false,
      dmg_downloads: 4,
      zip_downloads: 3,
      update_checks: 13,
    });
    assert.deepEqual(
      k.funnel.map((f: { count: number }) => f.count),
      [4, 2, 1, 2, 1, 1],
    );
    const md = toMarkdown(k);
    assert.match(md, /\| paid \| 1 \| 50% \|/);
    assert.match(md, /est\. net \$4\.38/);
  } finally {
    db.close();
  }
});

test("reports missing credentials and failures per section", async () => {
  const k = await collectKpis({
    env: {},
    fetch: async () => new Response(JSON.stringify({ message: "rate limited" }), { status: 403 }),
  });
  assert.equal(k.usage.status, "not_configured");
  assert.equal(k.money.status, "not_configured");
  assert.equal(k.downloads.status, "error");
  assert.match(k.downloads.message, /HTTP 403: rate limited/);
  assert.ok(k.funnel.every((f: { count: number | null }) => f.count === null));
  assert.match(toMarkdown(k), /Not configured/);
});

test("refuses unresolved 1Password references and secret Stripe keys", async () => {
  await assert.rejects(
    collectKpis({ env: { STRIPE_KPI_KEY: "op://Personal/x/credential" } }),
    /1Password reference/,
  );
  await assert.rejects(collectKpis({ env: { STRIPE_KPI_KEY: "sk_live_abc" } }), /restricted key/);
});
