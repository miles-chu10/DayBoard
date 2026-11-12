import { normalizeEmail } from "./beta.ts";
import type { Env } from "./config.ts";
import {
  ACTIVATION_STEPS,
  REFUND_DAYS,
  SUPPORT_EMAIL,
  escapeHtml,
  moveKeyNote,
  type PageContext,
} from "./pages.ts";

export interface Mailer {
  apiKey: string;
  from: string;
}
/** The outbound HTTP call, so tests can stand in for the provider. */
export type Send = (url: string, init: RequestInit) => Promise<Response>;

const RESEND_URL = "https://api.resend.com/emails";
const SENDER = /^(?:[A-Za-z0-9][A-Za-z0-9 .'&-]{0,62} <([^<>\s]+)>|([^<>\s]+))$/;

/**
 * The license email is on only when both the Resend API key and a valid sender are configured:
 * `MAIL_FROM` is an address, or `Name <address>`. Anything else leaves the email off, and
 * checkout and the receipt page work as they do without it.
 */
export function mailer(env: Pick<Env, "RESEND_API_KEY" | "MAIL_FROM">): Mailer | null {
  const from = env.MAIL_FROM?.trim() ?? "";
  const match = SENDER.exec(from);
  if (!env.RESEND_API_KEY?.startsWith("re_") || !normalizeEmail(match?.[1] ?? match?.[2]))
    return null;
  return { apiKey: env.RESEND_API_KEY, from };
}

export interface Message {
  subject: string;
  text: string;
  html: string;
}

const plain = (html: string) => html.replace(/<[^>]+>/g, "");

/** The email a buyer gets with their key. The same key and settings always give the same text. */
export function licenseMessage(
  licenseKey: string,
  { site, activationLimit }: Pick<PageContext, "site" | "activationLimit">,
): Message {
  const subject = "Your DayBoard Pro license key";
  const intro = "Thanks for buying DayBoard Pro. Here is your license key:";
  const keep =
    "Keep this email: it's your copy of the key. Your payment receipt comes separately from Link, Stripe's checkout service.";
  const help = `Questions, or a refund within ${REFUND_DAYS} days? Reply to this email or write to`;
  const text = [
    intro,
    licenseKey,
    ["Activate it:", ...ACTIVATION_STEPS.map((step, index) => `${index + 1}. ${plain(step)}`)].join(
      "\n",
    ),
    plain(moveKeyNote(activationLimit)),
    keep,
    `${help} ${SUPPORT_EMAIL}.\nRefund policy: ${site}/refund`,
    `DayBoard\n${site}`,
  ].join("\n\n");
  const p = "margin:0 0 16px";
  const muted = "margin:24px 0 0;color:#5b6472;font-size:14px";
  const origin = escapeHtml(site);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${subject}</title></head><body style="margin:0;padding:24px;background:#ffffff;color:#1b1f24;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.55"><div style="max-width:560px;margin:0 auto"><p style="margin:0 0 24px;color:#5b6472;font-size:13px;letter-spacing:.08em;text-transform:uppercase">DayBoard</p><h1 style="margin:0 0 16px;font-size:24px;line-height:1.2">${subject}</h1><p style="${p}">${intro}</p><p style="margin:0 0 24px;padding:14px 16px;background:#f3f4f6;border:1px solid #d1d5db;border-radius:6px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:15px;overflow-wrap:anywhere;word-break:break-all">${escapeHtml(licenseKey)}</p><h2 style="margin:0 0 8px;font-size:18px">Activate it</h2><ol style="margin:0 0 16px;padding-left:22px">${ACTIVATION_STEPS.map((step) => `<li>${step}</li>`).join("")}</ol><p style="${p}">${moveKeyNote(activationLimit)}</p><p style="${p}">${keep}</p><p style="${muted}">${help} <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>. See the <a href="${origin}/refund">refund policy</a>.</p><p style="${muted}"><a href="${origin}">${origin.replace(/^https:\/\//, "")}</a></p></div></body></html>`;
  return { subject, text, html };
}

/**
 * Sends one email through Resend. Returns null when Resend accepted it, otherwise a short reason
 * that is safe to log: an HTTP status and Resend's error name, never the address or the message.
 * The idempotency key makes a repeat of the same request within 24 hours send nothing new.
 */
export async function sendMail(
  mail: Mailer,
  send: Send,
  to: string,
  message: Message,
  idempotencyKey: string,
): Promise<string | null> {
  let response: Response;
  try {
    response = await send(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${mail.apiKey}`,
        "Content-Type": "application/json",
        // Resend answers 403 to requests without a User-Agent, and Workers send none by default.
        "User-Agent": "dayboard-billing/1",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({ from: mail.from, to: [to], reply_to: SUPPORT_EMAIL, ...message }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    return "no response";
  }
  const body: unknown = await response.json().catch(() => null);
  if (response.ok) return null;
  const name = (body as { name?: unknown } | null)?.name;
  return `${response.status}${typeof name === "string" && /^[a-z_]{1,48}$/.test(name) ? ` ${name}` : ""}`;
}
