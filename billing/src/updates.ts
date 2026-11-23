import { normalizeEmail, type WaitUntil } from "./beta.ts";
import { html } from "./checkout.ts";
import { siteOrigin, type Config, type Env } from "./config.ts";
import { error, json, limit, object, readBoundedText, readJson, securityHeaders } from "./http.ts";
import { mailer, sendMail, updateMessage, type Send } from "./mail.ts";
import {
  DEFAULT_SITE_ORIGIN,
  SUPPORT_EMAIL,
  resubscribedPage,
  unsubscribeConfirmPage,
  unsubscribeUnknownPage,
  unsubscribedPage,
} from "./pages.ts";

// The update newsletter: people sign up on the website, and each published version is announced
// to them once, by an email the owner sends through the admin routes. Every email carries the
// recipient's own unsubscribe link. Nothing here logs an address.

export const SUBSCRIBE_PATH = "/v1/updates/subscribe";
export const UNSUBSCRIBE_PATH = "/unsubscribe";

// An attempt holds its delivery this long, so a parallel run can't send a second copy. It is
// shorter than the 15-minute schedule, so each scheduled run retries what the last one left.
const ATTEMPT_HOLD_MS = 10 * 60 * 1000;
// Resend forgets idempotency keys after 24 hours. Stop before then rather than risk a duplicate.
const GIVE_UP_MS = 23 * 60 * 60 * 1000;
// Each email costs two D1 statements and a Resend request: stay well inside one invocation's
// limits. The scheduled run sends the rest, this many every 15 minutes.
const EMAILS_PER_RUN = 10;
// Resend accepts two requests a second, so sends are spaced out. Tests set the gap to zero.
export const pacing = { gapMs: 550 };
const LIST_MAX = 5000;
const SUBJECT_MAX = 150;
const BODY_MAX = 8000;
const tokenPattern = /^[a-f0-9]{32}$/;
const versionPattern = /^\d{1,4}\.\d{1,4}\.\d{1,4}(-[a-z0-9.]{1,16})?$/;

function newToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

// Who a mailing goes to: subscribed, and not on the older do-not-email list either.
const ACTIVE = `s.unsubscribed_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM email_suppressions x WHERE x.email=s.email)`;

/** POST from the website's signup form. Only the site's own origin may call it. */
export async function subscribe(request: Request, env: Env): Promise<Response> {
  const site = siteOrigin(env);
  const headers = {
    ...securityHeaders,
    "Content-Type": "application/json; charset=utf-8",
    "Cross-Origin-Resource-Policy": "cross-origin",
    Vary: "Origin",
    ...(site ? { "Access-Control-Allow-Origin": site } : {}),
  };
  const reply = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers });
  if (!site) return reply(503, { error: "signup_unconfigured" });
  if (request.headers.get("Origin") !== site) return reply(403, { error: "origin_not_allowed" });
  if (request.method === "OPTIONS")
    return new Response(null, {
      status: 204,
      headers: {
        ...headers,
        "Access-Control-Allow-Methods": "POST",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
      },
    });
  if (request.method !== "POST") return reply(405, { error: "method_not_allowed" });
  try {
    if (!(await limit(request, env, "updates:subscribe", 5)))
      return reply(429, { error: "rate_limited" });
    const body = await readJson(request, 1024).catch(() => null);
    if (!object(body) || (body.company !== undefined && typeof body.company !== "string"))
      return reply(400, { error: "invalid_body" });
    // A filled hidden field means a bot; answer as usual so it learns nothing.
    if (typeof body.company === "string" && body.company.trim()) return reply(200, { ok: true });
    const email = normalizeEmail(body.email);
    if (!email) return reply(400, { error: "invalid_email" });
    // New, existing and unsubscribed addresses get the same answer, so the form can't reveal who
    // is on the list. An address that unsubscribed stays unsubscribed: only its own link, or a
    // message to support, brings it back, so nobody else can re-add it.
    const inserted = await env.DB.prepare(
      `INSERT INTO update_subscribers (email,token,source,subscribed_at) VALUES (?,?,'site',?)
      ON CONFLICT(email) DO NOTHING`,
    )
      .bind(email, newToken(), Date.now())
      .run();
    if (!inserted.success) throw new Error("not saved");
    return reply(200, { ok: true });
  } catch {
    // Database errors can quote the address, so the log gets only a generic message.
    console.error("Update signup failed");
    return reply(503, { error: "service_unavailable" });
  }
}

/**
 * The unsubscribe link in every update email. GET asks to confirm, so a mail scanner that opens
 * links can't unsubscribe anyone. POST unsubscribes: from the page's button, or straight from a
 * mail app's own Unsubscribe button (RFC 8058 one-click). POST with action=resubscribe undoes it.
 */
export async function unsubscribe(request: Request, env: Env): Promise<Response> {
  const site = siteOrigin(env) ?? DEFAULT_SITE_ORIGIN;
  const token = new URL(request.url).searchParams.get("t") ?? "";
  if (request.method !== "GET" && request.method !== "POST")
    return error(405, "method_not_allowed");
  if (!(await limit(request, env, "updates:unsubscribe", 30))) return error(429, "rate_limited");
  const known =
    tokenPattern.test(token) &&
    (await env.DB.prepare("SELECT 1 FROM update_subscribers WHERE token=?").bind(token).first());
  if (!known) return html(unsubscribeUnknownPage(site), {}, 404);
  if (request.method === "GET") return html(unsubscribeConfirmPage(site));
  const form = new URLSearchParams(await readBoundedText(request, 1024).catch(() => ""));
  if (form.get("action") === "resubscribe") {
    await env.DB.prepare("UPDATE update_subscribers SET unsubscribed_at=NULL WHERE token=?")
      .bind(token)
      .run();
    return html(resubscribedPage(site));
  }
  await env.DB.prepare(
    "UPDATE update_subscribers SET unsubscribed_at=? WHERE token=? AND unsubscribed_at IS NULL",
  )
    .bind(Date.now(), token)
    .run();
  return html(unsubscribedPage(site));
}

interface Due {
  version: string;
  email: string;
  token: string;
  subject: string;
  body: string;
  created_at: number;
}

function messageFor(env: Env, cfg: Config, row: Pick<Due, "token" | "subject" | "body">) {
  const unsubscribeUrl = `${cfg.origin}${UNSUBSCRIBE_PATH}?t=${row.token}`;
  return {
    message: updateMessage(row.subject, row.body, {
      site: siteOrigin(env) ?? DEFAULT_SITE_ORIGIN,
      unsubscribeUrl,
      postalAddress: env.UPDATES_POSTAL_ADDRESS?.trim() || undefined,
    }),
    // Mail apps show their own Unsubscribe button from these, and it works in one click.
    headers: {
      "List-Unsubscribe": `<${unsubscribeUrl}>, <mailto:${SUPPORT_EMAIL}?subject=Unsubscribe>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}

/** Sends the update emails that are due, a few per call. The Cron Trigger calls it too. */
export async function deliverUpdates(env: Env, cfg: Config, send: Send): Promise<void> {
  const mail = mailer(env);
  if (!mail) return;
  try {
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE update_deliveries SET state='skipped' WHERE state='pending' AND email NOT IN
          (SELECT s.email FROM update_subscribers s WHERE ${ACTIVE})`,
      ),
      env.DB.prepare(
        `UPDATE update_deliveries SET state='failed' WHERE state='pending' AND version IN
          (SELECT version FROM update_mailings WHERE created_at<=?)`,
      ).bind(now - GIVE_UP_MS),
    ]);
    const due = await env.DB.prepare(
      `SELECT d.version,d.email,s.token,m.subject,m.body,m.created_at FROM update_deliveries d
      JOIN update_subscribers s ON s.email=d.email JOIN update_mailings m ON m.version=d.version
      WHERE d.state='pending' AND d.next_at<=? ORDER BY d.next_at,d.email LIMIT ?`,
    )
      .bind(now, EMAILS_PER_RUN)
      .all<Due>();
    let first = true;
    for (const row of due.results) {
      const claimed = await env.DB.prepare(
        `UPDATE update_deliveries SET attempts=attempts+1,next_at=?
        WHERE version=? AND email=? AND state='pending' AND next_at<=? RETURNING attempts`,
      )
        .bind(now + ATTEMPT_HOLD_MS, row.version, row.email, now)
        .first();
      if (!claimed) continue;
      if (!first) await new Promise((resolve) => setTimeout(resolve, pacing.gapMs));
      first = false;
      const { message, headers } = messageFor(env, cfg, row);
      const failure = await sendMail(
        mail,
        send,
        row.email,
        message,
        `dayboard-update/${row.version}/${row.token}/${row.created_at}`,
        headers,
      );
      if (failure) {
        console.error(`Update email not sent (${failure}); the scheduled retry will try again`);
        // Over the provider's rate or daily limit: the rest would fail the same way.
        if (failure.startsWith("429")) break;
        continue;
      }
      await env.DB.prepare(
        `UPDATE update_deliveries SET state='sent',sent_at=?
        WHERE version=? AND email=? AND state='pending'`,
      )
        .bind(Date.now(), row.version, row.email)
        .run();
    }
  } catch {
    // The cause could quote an address, so the log gets only a generic message.
    console.error("Update email delivery failed");
  }
}

async function status(env: Env, version: string) {
  const mailing = await env.DB.prepare(
    "SELECT subject,created_at FROM update_mailings WHERE version=?",
  )
    .bind(version)
    .first<{ subject: string; created_at: number }>();
  if (!mailing) return null;
  const rows = await env.DB.prepare(
    "SELECT state,COUNT(*) AS n FROM update_deliveries WHERE version=? GROUP BY state",
  )
    .bind(version)
    .all<{ state: string; n: number }>();
  const counts = { pending: 0, sent: 0, failed: 0, skipped: 0 };
  for (const { state, n } of rows.results) if (state in counts) counts[state as "sent"] = n;
  return { version, subject: mailing.subject, createdAt: mailing.created_at, ...counts };
}

function content(body: Record<string, unknown>): { subject: string; text: string } | null {
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!subject || subject.length > SUBJECT_MAX || /[\r\n]/.test(subject)) return null;
  if (!text || text.length > BODY_MAX) return null;
  return { subject, text };
}

/**
 * Owner-only routes under /v1/admin/updates/, reached after the admin token check:
 *   GET  subscribers          who the next update email would go to
 *   POST unsubscribe {email}  take an address off the list, as its own link would
 *   POST test {to,subject,text}  send one copy to one address, to read before sending to all
 *   POST mailings {version,subject,text,recipients}  announce a version to every subscriber, once
 *   GET  mailings?version=    how far a mailing has got
 */
export async function adminUpdates(
  request: Request,
  env: Env,
  cfg: Config,
  send: Send,
  ctx?: WaitUntil,
): Promise<Response> {
  const url = new URL(request.url);
  const action = url.pathname.slice("/v1/admin/updates/".length);
  const method = request.method;
  if (action === "subscribers") {
    if (method !== "GET") return error(405, "method_not_allowed");
    const rows = await env.DB.prepare(
      `SELECT s.email,s.source,s.subscribed_at FROM update_subscribers s WHERE ${ACTIVE}
      ORDER BY s.subscribed_at,s.email LIMIT ?`,
    )
      .bind(LIST_MAX)
      .all<{ email: string; source: string; subscribed_at: number }>();
    return json({
      recipients: rows.results.length,
      subscribers: rows.results.map((row) => ({
        email: row.email,
        source: row.source,
        subscribedAt: row.subscribed_at,
      })),
    });
  }
  if (action === "mailings" && method === "GET") {
    const found = await status(env, url.searchParams.get("version") ?? "");
    return found ? json(found) : error(404, "not_found");
  }
  if (!["unsubscribe", "test", "mailings"].includes(action)) return error(404, "not_found");
  if (method !== "POST") return error(405, "method_not_allowed");
  const body = await readJson(request, 16384).catch(() => null);
  if (!object(body)) return error(400, "invalid_body");

  if (action === "unsubscribe") {
    const email = normalizeEmail(body.email);
    if (!email) return error(400, "invalid_email");
    // Also covers an address that never signed up: the row keeps it off the list from now on.
    await env.DB.prepare(
      `INSERT INTO update_subscribers (email,token,source,subscribed_at,unsubscribed_at)
      VALUES (?,?,'site',?,?) ON CONFLICT(email) DO UPDATE SET
      unsubscribed_at=COALESCE(update_subscribers.unsubscribed_at,excluded.unsubscribed_at)`,
    )
      .bind(email, newToken(), Date.now(), Date.now())
      .run();
    return json({ unsubscribed: true });
  }

  const mail = mailer(env);
  if (!mail) return error(409, "mail_unconfigured");
  const draft = content(body);
  if (!draft) return error(400, "invalid_message");

  if (action === "test") {
    const to = normalizeEmail(body.to);
    if (!to) return error(400, "invalid_email");
    const row = await env.DB.prepare("SELECT token FROM update_subscribers WHERE email=?")
      .bind(to)
      .first<{ token: string }>();
    const { message, headers } = messageFor(env, cfg, {
      token: row?.token ?? "preview",
      subject: draft.subject,
      body: draft.text,
    });
    const key = `dayboard-update-test/${newToken()}`;
    const failure = await sendMail(mail, send, to, message, key, headers);
    return failure ? json({ error: "not_sent", reason: failure }, 502) : json({ sent: true });
  }

  const version = typeof body.version === "string" ? body.version : "";
  if (!versionPattern.test(version)) return error(400, "invalid_version");
  const existing = await status(env, version);
  if (existing) return json({ error: "already_announced", ...existing }, 409);
  // The owner approves a list of a known size. If it changed since they looked, send nothing.
  const active = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM update_subscribers s WHERE ${ACTIVE}`,
  ).first<{ n: number }>();
  const recipients = active?.n ?? 0;
  if (body.recipients !== recipients || recipients === 0)
    return json({ error: "recipient_count_changed", recipients }, 409);
  const now = Date.now();
  try {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO update_mailings (version,subject,body,created_at) VALUES (?,?,?,?)",
      ).bind(version, draft.subject, draft.text, now),
      env.DB.prepare(
        `INSERT INTO update_deliveries (version,email,state,next_at)
        SELECT ?,s.email,'pending',? FROM update_subscribers s WHERE ${ACTIVE}`,
      ).bind(version, now),
    ]);
  } catch {
    // Two sends of one version at once: the first holds the version, this one sends nothing.
    const raced = await status(env, version);
    if (raced) return json({ error: "already_announced", ...raced }, 409);
    throw new Error("mailing not saved");
  }
  // The first few go now; the scheduled run sends the rest and retries any that fail.
  const sending = deliverUpdates(env, cfg, send);
  if (ctx) ctx.waitUntil(sending);
  else await sending;
  return json(await status(env, version), 201);
}
