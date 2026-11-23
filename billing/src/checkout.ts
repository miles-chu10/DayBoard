import type Stripe from "stripe";
import { ORDER_ACCESS_DAYS, siteOrigin, type Config, type Env } from "./config.ts";
import { decrypt, hash, randomToken } from "./crypto.ts";
import { assets } from "./assets.ts";
import { error, json, limit, readJson, sameOrigin, securityHeaders } from "./http.ts";
import { licenseEmailStatus } from "./license-email.ts";
import { mailer } from "./mail.ts";
import {
  DEFAULT_SITE_ORIGIN,
  busyPage,
  buyPage,
  receiptPage,
  buyScript,
  receiptScript,
  type PageContext,
} from "./pages.ts";

interface Order {
  id: string;
  session_id: string | null;
  state: "pending" | "ready" | "failed" | "revoked";
  capability_expires_at: number;
}
const orderIdPattern = /^[A-Za-z0-9_-]{32}$/;
// Where a buyer clicked "Get DayBoard Pro" (`/buy?from=download-page`). Kept on the Checkout
// Session's metadata so sales can be counted per upsell; never shown or stored elsewhere.
const sourcePattern = /^[a-z0-9-]{1,32}$/;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const capabilityAge = ORDER_ACCESS_DAYS * 86400;
function cookieName(orderId: string): string {
  return `__Host-dayboard-order-${orderId}`;
}
function cookie(request: Request, orderId: string): string | null {
  const name = `${cookieName(orderId)}=`;
  const pair = request.headers
    .get("Cookie")
    ?.split(/;\s*/)
    .find((part) => part.startsWith(name));
  const value = pair?.slice(name.length) ?? null;
  return value && tokenPattern.test(value) ? value : null;
}
function setCookie(orderId: string, token: string): string {
  return `${cookieName(orderId)}=${token}; Path=/; Max-Age=${capabilityAge}; Secure; HttpOnly; SameSite=Lax`;
}
async function currentOrder(request: Request, env: Env, orderId: string): Promise<Order | null> {
  const token = cookie(request, orderId);
  if (!token) return null;
  return env.DB.prepare(
    "SELECT id,session_id,state,capability_expires_at FROM orders WHERE id=? AND capability_hash=? AND capability_expires_at>?",
  )
    .bind(orderId, await hash(token, env.HASH_SECRET), Date.now())
    .first<Order>();
}
export function html(markup: string, headers: HeadersInit = {}, status = 200): Response {
  return new Response(markup, {
    status,
    headers: {
      ...securityHeaders,
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy":
        "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; font-src 'self'; img-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      ...headers,
    },
  });
}
function script(code: string): Response {
  return new Response(code, {
    headers: {
      ...securityHeaders,
      "Content-Type": "text/javascript; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}
// The pages' typeface and icon. They never change between deploys of one version, so browsers may
// keep them for a day; everything else this Worker serves stays uncached.
function asset({ type, body }: (typeof assets)[string]): Response {
  return new Response(body(), {
    headers: {
      ...securityHeaders,
      "Cache-Control": "public, max-age=86400",
      "Content-Type": type,
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}
function sourceParam(value: string | null): string | undefined {
  return value !== null && sourcePattern.test(value) ? value : undefined;
}
function checkoutFromBody(value: unknown): { orderId: string; source?: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { orderId, source, ...rest } = value as Record<string, unknown>;
  if (Object.keys(rest).length || typeof orderId !== "string" || !orderIdPattern.test(orderId))
    return null;
  if (source === undefined) return { orderId };
  return typeof source === "string" && sourcePattern.test(source) ? { orderId, source } : null;
}
function pageContext(env: Env, cfg: Config): PageContext {
  return {
    site: siteOrigin(env) ?? DEFAULT_SITE_ORIGIN,
    activationLimit: cfg.activationLimit,
    emailsKey: mailer(env) !== null,
  };
}
function receiptUrl(cfg: Config, orderId: string): string {
  return `${cfg.origin}/receipt?order=${orderId}`;
}

export async function checkout(
  request: Request,
  env: Env,
  cfg: Config,
  stripe: Stripe,
): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/buy") {
    if (!(await limit(request, env, "checkout:buy", 30)))
      return html(busyPage(pageContext(env, cfg)), {}, 429);
    const orderId = randomToken(24);
    const token = randomToken();
    return html(
      buyPage(orderId, pageContext(env, cfg), sourceParam(url.searchParams.get("from"))),
      {
        "Set-Cookie": setCookie(orderId, token),
      },
    );
  }
  if (request.method === "GET" && url.pathname === "/receipt")
    return html(receiptPage(pageContext(env, cfg)));
  if (request.method === "GET" && assets[url.pathname]) return asset(assets[url.pathname]);
  if (request.method === "GET" && url.pathname === "/buy.js") return script(buyScript);
  if (request.method === "GET" && url.pathname === "/receipt.js") return script(receiptScript);
  if (url.pathname === "/v1/checkout" && request.method === "POST") {
    if (!sameOrigin(request, cfg)) return error(403, "origin_mismatch");
    if (!(await limit(request, env, "checkout:create", 10))) return error(429, "rate_limited");
    let body: unknown;
    try {
      body = await readJson(request, 256);
    } catch {
      return error(400, "invalid_body");
    }
    const parsed = checkoutFromBody(body);
    if (!parsed) return error(400, "invalid_body");
    const { orderId, source } = parsed;
    const token = cookie(request, orderId);
    if (!token) return error(401, "claim_required");
    const capHash = await hash(token, env.HASH_SECRET);
    const now = Date.now();
    await env.DB.prepare(
      "INSERT OR IGNORE INTO orders (id,capability_hash,capability_expires_at,created_at) VALUES (?,?,?,?)",
    )
      .bind(orderId, capHash, now + capabilityAge * 1000, now)
      .run();
    const order = await currentOrder(request, env, orderId);
    if (!order) return error(401, "claim_required");
    if (order.state !== "pending") return json({ url: receiptUrl(cfg, orderId) });
    try {
      const price = await stripe.prices.retrieve(cfg.priceId);
      if (
        !price.active ||
        price.type !== "one_time" ||
        price.currency !== cfg.currency ||
        price.product !== cfg.productId ||
        price.livemode !== (cfg.environment === "live")
      )
        return error(503, "price_configuration_invalid");
      let session: Stripe.Checkout.Session;
      if (order.session_id) session = await stripe.checkout.sessions.retrieve(order.session_id);
      else {
        session = await stripe.checkout.sessions.create(
          {
            mode: "payment",
            client_reference_id: orderId,
            line_items: [{ price: cfg.priceId, quantity: 1 }],
            success_url: receiptUrl(cfg, orderId),
            cancel_url: source ? `${cfg.origin}/buy?from=${source}` : `${cfg.origin}/buy`,
            integration_identifier: "dayboard_ynevvaow",
            metadata: source ? { order_id: orderId, source } : { order_id: orderId },
            // Stripe is merchant of record: it calculates and remits sales tax/VAT/GST.
            managed_payments: { enabled: true },
          },
          { idempotencyKey: `dayboard-checkout-${orderId}` },
        );
        await env.DB.prepare("UPDATE orders SET session_id=? WHERE id=? AND session_id IS NULL")
          .bind(session.id, orderId)
          .run();
      }
      if (!session.url || session.status === "expired") {
        await env.DB.prepare("UPDATE orders SET state='failed' WHERE id=? AND state='pending'")
          .bind(orderId)
          .run();
        return json({ url: receiptUrl(cfg, orderId) });
      }
      return json({ url: session.url });
    } catch {
      return error(503, "checkout_temporarily_unavailable");
    }
  }
  if (url.pathname === "/v1/checkout/status" && request.method === "GET") {
    if (!(await limit(request, env, "checkout:status", 60))) return error(429, "rate_limited");
    const orderId = url.searchParams.get("order");
    if (!orderId || !orderIdPattern.test(orderId)) return error(400, "invalid_order");
    const order = await currentOrder(request, env, orderId);
    if (!order) return error(401, "claim_required");
    return json({ state: order.state });
  }
  if (url.pathname === "/v1/checkout/claim" && request.method === "POST") {
    if (!sameOrigin(request, cfg)) return error(403, "origin_mismatch");
    if (!(await limit(request, env, "checkout:claim", 20))) return error(429, "rate_limited");
    let body: unknown;
    try {
      body = await readJson(request, 256);
    } catch {
      return error(400, "invalid_body");
    }
    const parsed = checkoutFromBody(body);
    if (!parsed || parsed.source !== undefined) return error(400, "invalid_body");
    const { orderId } = parsed;
    const order = await currentOrder(request, env, orderId);
    if (!order) return error(401, "claim_required");
    if (order.state !== "ready") return error(409, order.state);
    const row = await env.DB.prepare(`SELECT l.key_ciphertext,l.key_iv,p.revoked FROM licenses l
      JOIN payments p ON p.payment_intent_id=l.payment_intent_id
      WHERE l.order_id=? AND l.issuer=? AND l.product_id=? AND l.environment=?`)
      .bind(order.id, cfg.origin, cfg.productId, cfg.environment)
      .first<{ key_ciphertext: string; key_iv: string; revoked: number }>();
    if (!row || row.revoked) return error(409, "revoked");
    const email = await licenseEmailStatus(env, order.id);
    return json({
      licenseKey: await decrypt(row.key_ciphertext, row.key_iv, env.ENCRYPTION_KEY),
      ...(email ? { email } : {}),
    });
  }
  return error(404, "not_found");
}
