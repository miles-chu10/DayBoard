import type Stripe from "stripe";
import { normalizeEmail } from "./beta.ts";
import { siteOrigin, type Config, type Env } from "./config.ts";
import { decrypt } from "./crypto.ts";
import { licenseMessage, mailer, sendMail, type Mailer, type Send } from "./mail.ts";
import { DEFAULT_SITE_ORIGIN } from "./pages.ts";

// Emails each buyer their license key once the key is issued. Everything here is a side effect of
// a paid order: a failure is logged without the address or the key and never fails the webhook,
// the receipt page or a license check. The address is read from the order's Stripe Checkout
// Session for each attempt and is never written to D1.

// An attempt holds the order this long, so a parallel delivery can't send a second copy. It is
// shorter than the 15-minute schedule, so each scheduled run retries what the last one left.
const ATTEMPT_HOLD_MS = 10 * 60 * 1000;
const GIVE_UP_MS = 48 * 60 * 60 * 1000;
// Each order costs a Stripe request and a Resend request: stay well inside one invocation's limits.
const ORDERS_PER_RUN = 5;

/**
 * Records that a ready order is owed its email. Returns the mailer when the row exists (a repeat
 * webhook finds it already there), or null when the email is off or the row can't be written.
 */
export async function queueLicenseEmail(env: Env, orderId: string): Promise<Mailer | null> {
  const mail = mailer(env);
  if (!mail) {
    if (env.RESEND_API_KEY || env.MAIL_FROM)
      console.error("License email is off: RESEND_API_KEY or MAIL_FROM is missing or invalid");
    return null;
  }
  try {
    const now = Date.now();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO license_emails (order_id,state,queued_at,next_at)
      SELECT id,'pending',?,? FROM orders WHERE id=? AND state='ready'`,
    )
      .bind(now, now, orderId)
      .run();
    return mail;
  } catch {
    console.error("License email could not be queued");
    return null;
  }
}

/**
 * Sends a queued order's email to the address from its Checkout Session. Only one of several
 * parallel calls sends: the first claims the attempt and the others find nothing due.
 */
export async function deliverLicenseEmail(
  env: Env,
  cfg: Config,
  mail: Mailer,
  send: Send,
  orderId: string,
  address: unknown,
): Promise<void> {
  try {
    const now = Date.now();
    const claimed = await env.DB.prepare(
      `UPDATE license_emails SET attempts=attempts+1,next_at=?
      WHERE order_id=? AND state='pending' AND next_at<=?
      AND EXISTS (SELECT 1 FROM orders WHERE id=license_emails.order_id AND state='ready')
      RETURNING queued_at`,
    )
      .bind(now + ATTEMPT_HOLD_MS, orderId, now)
      .first<{ queued_at: number }>();
    if (!claimed) return;
    // Checked like a waitlist address, but sent as Stripe gave it rather than lowercased.
    const to = typeof address === "string" && normalizeEmail(address) ? address.trim() : null;
    if (!to) {
      await env.DB.prepare(
        "UPDATE license_emails SET state='skipped' WHERE order_id=? AND state='pending'",
      )
        .bind(orderId)
        .run();
      return;
    }
    const license = await env.DB.prepare(
      `SELECT l.key_ciphertext,l.key_iv FROM licenses l
      JOIN payments p ON p.payment_intent_id=l.payment_intent_id
      WHERE l.order_id=? AND l.issuer=? AND l.product_id=? AND l.environment=? AND p.revoked=0`,
    )
      .bind(orderId, cfg.origin, cfg.productId, cfg.environment)
      .first<{ key_ciphertext: string; key_iv: string }>();
    if (!license) return;
    const failure = await sendMail(
      mail,
      send,
      to,
      licenseMessage(await decrypt(license.key_ciphertext, license.key_iv, env.ENCRYPTION_KEY), {
        site: siteOrigin(env) ?? DEFAULT_SITE_ORIGIN,
        activationLimit: cfg.activationLimit,
      }),
      `dayboard-license/${orderId}/${claimed.queued_at}`,
    );
    if (failure) {
      console.error(`License email not sent (${failure}); the scheduled retry will try again`);
      return;
    }
    await env.DB.prepare(
      "UPDATE license_emails SET state='sent',sent_at=? WHERE order_id=? AND state='pending'",
    )
      .bind(Date.now(), orderId)
      .run();
  } catch {
    // The cause could quote the address or the key, so the log gets only a generic message.
    console.error("License email delivery failed");
  }
}

/** The scheduled run: closes out emails that are no longer owed, then retries the ones due. */
export async function retryLicenseEmails(
  env: Env,
  cfg: Config,
  stripe: Stripe,
  send: Send,
): Promise<void> {
  const mail = mailer(env);
  if (!mail) return;
  try {
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE license_emails SET state='skipped' WHERE state='pending'
        AND order_id IN (SELECT id FROM orders WHERE state<>?)`,
      ).bind("ready"),
      env.DB.prepare(
        "UPDATE license_emails SET state='failed' WHERE state='pending' AND queued_at<?",
      ).bind(now - GIVE_UP_MS),
    ]);
    const due = await env.DB.prepare(
      `SELECT e.order_id,o.session_id FROM license_emails e JOIN orders o ON o.id=e.order_id
      WHERE e.state='pending' AND e.next_at<=? AND o.state='ready' AND o.session_id IS NOT NULL
      ORDER BY e.next_at LIMIT ?`,
    )
      .bind(now, ORDERS_PER_RUN)
      .all<{ order_id: string; session_id: string }>();
    for (const { order_id: orderId, session_id: sessionId } of due.results) {
      let address: unknown;
      try {
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        if (session.client_reference_id !== orderId) throw new Error("session_mismatch");
        address = session.customer_details?.email;
      } catch {
        // Stripe may be briefly unavailable: leave the order for the next run.
        console.error("License email retry could not read its Checkout Session");
        continue;
      }
      await deliverLicenseEmail(env, cfg, mail, send, orderId, address);
    }
  } catch {
    console.error("License email retry failed");
  }
}

/** For the receipt page: whether this order's key is being emailed or already was. */
export async function licenseEmailStatus(
  env: Env,
  orderId: string,
): Promise<"pending" | "sent" | null> {
  try {
    const row = await env.DB.prepare("SELECT state FROM license_emails WHERE order_id=?")
      .bind(orderId)
      .first<{ state: string }>();
    return row?.state === "pending" || row?.state === "sent" ? row.state : null;
  } catch {
    return null;
  }
}
