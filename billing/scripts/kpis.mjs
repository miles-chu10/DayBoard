#!/usr/bin/env node
// Prints DayBoard's KPIs (active installs, funnel, revenue, licenses, downloads) as Markdown or
// JSON, for people and for agents such as Codex. Every call only reads. Credentials come only from
// the environment, meant to be filled by 1Password:
//
//   op run --env-file=<file with the variables below> -- node billing/scripts/kpis.mjs [--json]
//
// A section whose credentials are missing, or whose source fails, is reported as unavailable and
// the others still print.
import { parseArgs } from "node:util";

export const QUERIES = {
  summary:
    "SELECT active_today, active_7_days, active_30_days, new_30_days, pro_30_days, installs_seen, " +
    "(SELECT COUNT(DISTINCT install_id) FROM usage_checkins WHERE license_state IN ('trial', 'expired')) AS tried_ai, " +
    "(SELECT MIN(day) FROM usage_checkins) AS since FROM usage_summary",
  daily:
    "SELECT day, active_installs, new_installs, trial, trial_ended, pro FROM usage_daily " +
    "WHERE day >= date('now', '-29 days') ORDER BY day",
  versions: "SELECT app_version, installs_7_days FROM usage_versions",
  licenses:
    "SELECT k.kind, COUNT(x.id) AS licenses, COALESCE(SUM(x.acts > 0), 0) AS activated, " +
    "COALESCE(SUM(x.acts), 0) AS activations, COALESCE(SUM(x.revoked), 0) AS revoked " +
    "FROM (SELECT 'paid' AS kind UNION ALL SELECT 'comp') k LEFT JOIN (" +
    "SELECT l.id, CASE WHEN c.license_id IS NULL THEN 'paid' ELSE 'comp' END AS kind, " +
    "(SELECT COUNT(*) FROM activations a WHERE a.license_id = l.id) AS acts, " +
    "(c.revoked_at IS NOT NULL OR COALESCE(p.revoked, 0) = 1) AS revoked " +
    "FROM licenses l LEFT JOIN comp_licenses c ON c.license_id = l.id " +
    "LEFT JOIN payments p ON p.payment_intent_id = l.payment_intent_id " +
    "WHERE l.environment = 'live') x ON x.kind = k.kind GROUP BY k.kind ORDER BY k.kind DESC",
};

// Stripe Managed Payments: card processing 2.9% + $0.30 plus 3.5%. Stripe keeps fees on refunds.
const FEE_RATE = 0.029 + 0.035;
const FEE_FIXED = 0.3;
const STRIPE_PAGE_LIMIT = 10;
const DEFAULT_REPO = "miles-chu10/DayBoard";
const USAGE = `Usage: kpis.mjs [--json]

Environment (each section needs only its own):
  CLOUDFLARE_API_TOKEN       Cloudflare API token with D1 Read only.
  CLOUDFLARE_ACCOUNT_ID      Cloudflare account id.
  DAYBOARD_D1_DATABASE_ID    Id of the live billing D1 database.
  STRIPE_KPI_KEY             Stripe restricted key (rk_live_...) with read access to
                             Checkout Sessions and Refunds only.
  GITHUB_TOKEN               Optional. Raises GitHub's rate limit for release downloads.
  DAYBOARD_REPO              Optional. Defaults to ${DEFAULT_REPO}.
`;

class UsageError extends Error {}

const round2 = (n) => Math.round(n * 100) / 100;

function secret(env, name, { prefix } = {}) {
  const value = env[name] ?? "";
  if (!value) return null;
  if (value.startsWith("op://"))
    throw new UsageError(`${name} is a 1Password reference. Run this script through \`op run\`.`);
  if (prefix && !value.startsWith(prefix))
    throw new UsageError(`${name} must start with ${prefix}, a read-only restricted key.`);
  return value;
}

async function getJson(fetchImpl, url, init, what) {
  const res = await fetchImpl(url, init);
  let body;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const msg = body?.error?.message ?? body?.errors?.[0]?.message ?? body?.message ?? "";
    throw new Error(`${what} answered HTTP ${res.status}${msg ? `: ${msg}` : ""}`);
  }
  return body;
}

async function d1Query(fetchImpl, cf, sql) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(cf.account)}/d1/database/${encodeURIComponent(cf.database)}/query`;
  const body = await getJson(
    fetchImpl,
    url,
    {
      method: "POST",
      headers: { authorization: `Bearer ${cf.token}`, "content-type": "application/json" },
      body: JSON.stringify({ sql }),
    },
    "Cloudflare D1",
  );
  const result = Array.isArray(body?.result) ? body.result[0] : null;
  if (!body?.success || !result || result.success === false || !Array.isArray(result.results))
    throw new Error(`Cloudflare D1 query failed: ${body?.errors?.[0]?.message ?? "no results"}`);
  return result.results;
}

async function stripeList(fetchImpl, key, path) {
  const rows = [];
  let after;
  for (let page = 0; page < STRIPE_PAGE_LIMIT; page++) {
    const url = new URL(`https://api.stripe.com/v1/${path}`);
    url.searchParams.set("limit", "100");
    if (after) url.searchParams.set("starting_after", after);
    const body = await getJson(
      fetchImpl,
      url,
      { headers: { authorization: `Bearer ${key}` } },
      "Stripe",
    );
    rows.push(...body.data);
    if (!body.has_more || !body.data.length) return { rows, truncated: false };
    after = body.data.at(-1).id;
  }
  return { rows, truncated: true };
}

export function summarizeReleases(releases) {
  return releases
    .filter((r) => !r.draft)
    .map((r) => {
      const sum = (test) =>
        r.assets.filter((a) => test(a.name)).reduce((n, a) => n + a.download_count, 0);
      return {
        release: r.tag_name.replace(/^v/, ""),
        published: r.published_at,
        prerelease: r.prerelease,
        dmg_downloads: sum((n) => n.endsWith(".dmg")),
        zip_downloads: sum((n) => n.endsWith("-mac.zip")),
        update_checks: sum((n) => n === "latest-mac.yml"),
      };
    });
}

export function summarizeMoney(sessions, refunds) {
  const paid = sessions.filter((s) => s.payment_status === "paid");
  const gross = paid.reduce((n, s) => n + (s.amount_total ?? 0), 0) / 100;
  const refunded =
    refunds.filter((r) => r.status === "succeeded").reduce((n, r) => n + r.amount, 0) / 100;
  const fees = gross * FEE_RATE + paid.length * FEE_FIXED;
  return {
    checkouts_started: sessions.length,
    paid_sales: paid.length,
    gross_usd: round2(gross),
    refunds_usd: round2(refunded),
    fees_est_usd: round2(fees),
    net_est_usd: round2(gross - refunded - fees),
  };
}

export function funnel({ releases, usage, money, licenses }) {
  const paidLicenses = licenses?.find((l) => l.kind === "paid");
  const steps = [
    ["dmg_downloads", releases?.reduce((n, r) => n + r.dmg_downloads, 0)],
    ["installs_seen", usage?.installs_seen],
    ["started_ai_trial", usage?.tried_ai],
    ["checkout_started", money?.checkouts_started],
    ["paid", money?.paid_sales],
    ["paid_license_activated", paidLicenses?.activated],
  ];
  return steps.map(([step, count], i) => {
    const prev = i ? steps[i - 1][1] : undefined;
    const value = count == null ? null : Number(count);
    return {
      step,
      count: value,
      of_previous: value != null && prev ? round2(value / Number(prev)) : null,
    };
  });
}

async function section(fn) {
  try {
    const value = await fn();
    return value === null ? { status: "not_configured" } : { status: "ok", ...value };
  } catch (error) {
    if (error instanceof UsageError) throw error;
    return { status: "error", message: error instanceof Error ? error.message : String(error) };
  }
}

export async function collectKpis({
  env = process.env,
  fetch: fetchImpl = fetch,
  now = new Date(),
} = {}) {
  const cfToken = secret(env, "CLOUDFLARE_API_TOKEN");
  const cf =
    cfToken && env.CLOUDFLARE_ACCOUNT_ID && env.DAYBOARD_D1_DATABASE_ID
      ? {
          token: cfToken,
          account: env.CLOUDFLARE_ACCOUNT_ID,
          database: env.DAYBOARD_D1_DATABASE_ID,
        }
      : null;
  const stripeKey = secret(env, "STRIPE_KPI_KEY", { prefix: "rk_" });
  const ghToken = secret(env, "GITHUB_TOKEN");
  const repo = env.DAYBOARD_REPO || DEFAULT_REPO;

  const [usage, licenses, money, downloads] = await Promise.all([
    section(async () => {
      if (!cf) return null;
      const [summary, daily, versions] = await Promise.all(
        [QUERIES.summary, QUERIES.daily, QUERIES.versions].map((q) => d1Query(fetchImpl, cf, q)),
      );
      return { summary: summary[0] ?? null, daily, versions };
    }),
    section(async () => (cf ? { rows: await d1Query(fetchImpl, cf, QUERIES.licenses) } : null)),
    section(async () => {
      if (!stripeKey) return null;
      const [sessions, refunds] = await Promise.all([
        stripeList(fetchImpl, stripeKey, "checkout/sessions"),
        stripeList(fetchImpl, stripeKey, "refunds"),
      ]);
      return {
        ...summarizeMoney(sessions.rows, refunds.rows),
        truncated: sessions.truncated || refunds.truncated,
      };
    }),
    section(async () => {
      const headers = { accept: "application/vnd.github+json", "user-agent": "dayboard-kpis" };
      if (ghToken) headers.authorization = `Bearer ${ghToken}`;
      const releases = await getJson(
        fetchImpl,
        `https://api.github.com/repos/${repo}/releases?per_page=100`,
        { headers },
        "GitHub",
      );
      return { releases: summarizeReleases(releases) };
    }),
  ]);

  return {
    generated_at: now.toISOString(),
    notes: [
      "Active installs come from the app's anonymous daily check-in (UTC days); official builds only, users can turn it off.",
      "Counts include the owner's and QA installs and downloads.",
      "Revenue is live mode; fees are estimated at 2.9% + $0.30 + 3.5% per sale.",
    ],
    usage,
    licenses,
    money,
    downloads,
    funnel: funnel({
      releases: downloads.status === "ok" ? downloads.releases : null,
      usage: usage.status === "ok" ? usage.summary : null,
      money: money.status === "ok" ? money : null,
      licenses: licenses.status === "ok" ? licenses.rows : null,
    }),
  };
}

const pacific = (iso) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));

function unavailable(s) {
  return s.status === "not_configured"
    ? "_Not configured (credentials missing)._"
    : `_Unavailable: ${s.message}_`;
}

export function toMarkdown(k) {
  const out = [`# DayBoard KPIs`, ``, `Generated ${pacific(k.generated_at)} Pacific.`, ``];
  out.push(`## Funnel (all time)`, ``, `| Step | Count | Of previous |`, `|---|---:|---:|`);
  for (const f of k.funnel)
    out.push(
      `| ${f.step} | ${f.count ?? "n/a"} | ${f.of_previous == null ? "" : `${Math.round(f.of_previous * 100)}%`} |`,
    );
  out.push(``, `## Active installs`, ``);
  if (k.usage.status === "ok" && k.usage.summary) {
    const s = k.usage.summary;
    out.push(
      `- Today: ${s.active_today}, last 7 days: ${s.active_7_days}, last 30 days: ${s.active_30_days}`,
      `- New in 30 days: ${s.new_30_days}, Pro in 30 days: ${s.pro_30_days}, installs seen since ${s.since}: ${s.installs_seen}`,
      ``,
      `| Version | Installs (7 days) |`,
      `|---|---:|`,
      ...k.usage.versions.map((v) => `| ${v.app_version} | ${v.installs_7_days} |`),
    );
  } else out.push(unavailable(k.usage));
  out.push(``, `## Revenue (live)`, ``);
  if (k.money.status === "ok") {
    const m = k.money;
    out.push(
      `- Checkouts started: ${m.checkouts_started}, paid sales: ${m.paid_sales}`,
      `- Gross $${m.gross_usd.toFixed(2)}, refunds $${m.refunds_usd.toFixed(2)}, est. fees $${m.fees_est_usd.toFixed(2)}, est. net $${m.net_est_usd.toFixed(2)}`,
    );
    if (m.truncated)
      out.push(`- Only the most recent ${STRIPE_PAGE_LIMIT * 100} records were read.`);
  } else out.push(unavailable(k.money));
  out.push(``, `## Licenses (live)`, ``);
  if (k.licenses.status === "ok")
    out.push(
      `| Kind | Licenses | Activated | Macs | Revoked |`,
      `|---|---:|---:|---:|---:|`,
      ...k.licenses.rows.map(
        (r) => `| ${r.kind} | ${r.licenses} | ${r.activated} | ${r.activations} | ${r.revoked} |`,
      ),
    );
  else out.push(unavailable(k.licenses));
  out.push(``, `## Downloads by release`, ``);
  if (k.downloads.status === "ok")
    out.push(
      `| Release | Published | DMG | ZIP | Update checks |`,
      `|---|---|---:|---:|---:|`,
      ...k.downloads.releases.map(
        (r) =>
          `| ${r.release} | ${pacific(r.published)} | ${r.dmg_downloads} | ${r.zip_downloads} | ${r.update_checks} |`,
      ),
    );
  else out.push(unavailable(k.downloads));
  out.push(``, `## Notes`, ``, ...k.notes.map((n) => `- ${n}`), ``);
  return out.join("\n");
}

async function main() {
  const { values } = parseArgs({
    options: { json: { type: "boolean" }, help: { type: "boolean" } },
  });
  if (values.help) {
    process.stdout.write(USAGE);
    return;
  }
  const kpis = await collectKpis();
  process.stdout.write(values.json ? `${JSON.stringify(kpis, null, 2)}\n` : toMarkdown(kpis));
}

if (import.meta.url === `file://${process.argv[1]}`)
  main().catch((error) => {
    process.stderr.write(`${error instanceof UsageError ? error.message : error}\n`);
    if (error instanceof UsageError) process.stderr.write(USAGE);
    process.exitCode = 1;
  });
