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

const URL_PATTERN = /https:\/\/[^\s<>"]+[^\s<>".,;:!?)]/g;
/** Escapes one line of a release email and turns its **bold** runs and https links into HTML. */
function inline(line: string): string {
  let html = "";
  let last = 0;
  for (const match of line.matchAll(URL_PATTERN)) {
    const url = escapeHtml(match[0]);
    html += `${escapeHtml(line.slice(last, match.index))}<a href="${url}" style="color:inherit;text-decoration:underline">${url.replace(/^https:\/\//, "")}</a>`;
    last = match.index + match[0].length;
  }
  return (html + escapeHtml(line.slice(last))).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

const IMAGE_BLOCK = /^!\[([^\]]*)\]\((https:\/\/[^\s()]+)\)$/;
const BUTTON_BLOCK = /^\[([^\]]+)\]\((https:\/\/[^\s()]+)\)$/;
const UPDATE_FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
// The email is dark everywhere: Gmail drops theme rules, so one inline theme is the only way
// every reader sees the same thing. The stylesheet only tightens the padding on phones.
const UPDATE_STYLE = `:root{color-scheme:dark;supported-color-schemes:dark}
a{color:inherit}
@media (max-width:620px){.db-pad{padding:28px 22px !important}.db-title{font-size:26px !important}}`;

/**
 * The email subscribers get when a version is published. `body` is plain text: blocks separated
 * by blank lines. A block of "- " lines is a list, a "## " line is a section heading, a line that
 * is only "[label](https://...)" is a button and one that is only "![alt](https://...)" is a
 * picture. A subject like "DayBoard 1.3.11: What changed" shows as a small label over a headline.
 * Every copy ends with why the person is getting it and their own unsubscribe link.
 */
export function updateMessage(
  subject: string,
  body: string,
  {
    site,
    unsubscribeUrl,
    postalAddress,
  }: { site: string; unsubscribeUrl: string; postalAddress?: string },
): Message {
  const blocks = body
    .replaceAll("\r\n", "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  const host = site.replace(/^https:\/\//, "");
  const why = `You're getting this because you signed up for DayBoard updates at ${host}.`;
  const text = [
    ...blocks.flatMap((block) => {
      if (IMAGE_BLOCK.test(block)) return [];
      const button = BUTTON_BLOCK.exec(block);
      if (button) return [`${button[1]}: ${button[2]}`];
      return [block.replace(/^## /, "").replaceAll("**", "")];
    }),
    `${why}\nUnsubscribe: ${unsubscribeUrl}`,
    ["DayBoard", site, ...(postalAddress ? [postalAddress] : [])].join("\n"),
  ].join("\n\n");

  const split = subject.indexOf(": ");
  const label = split > 0 ? subject.slice(0, split) : "New release";
  const title = split > 0 ? subject.slice(split + 2) : subject;
  let lead = true;
  let buttons = 0;
  const parts = blocks.map((block, index) => {
    const lines = block.split("\n");
    const image = IMAGE_BLOCK.exec(block);
    if (image)
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px"><tr><td class="db-sunk" align="center" style="padding:24px 16px 0;background:#100f0d;border-radius:14px"><img src="${escapeHtml(image[2])}" alt="${escapeHtml(image[1])}" width="300" style="display:block;width:100%;max-width:300px;height:auto;border:0;border-radius:12px 12px 0 0"></td></tr></table>`;
    const button = BUTTON_BLOCK.exec(block);
    if (button) {
      const primary = buttons++ === 0;
      return `<p style="margin:0 0 28px"><a class="${primary ? "db-button" : "db-button-quiet"}" href="${escapeHtml(button[2])}" style="display:inline-block;padding:13px 24px;border:1px solid ${primary ? "#f1ebdf" : "#3d3a33"};border-radius:12px;background:${primary ? "#f1ebdf" : "#1d1c19"};color:${primary ? "#151412" : "#f1ebdf"};font-size:16px;font-weight:600;line-height:1.2;text-decoration:none">${escapeHtml(button[1])}</a></p>`;
    }
    if (lines.every((line) => line.startsWith("- ")))
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 12px">${lines.map((line) => `<tr><td width="20" valign="top" style="padding:9px 0 0"><div class="db-dot" style="width:6px;height:6px;border-radius:3px;background:#8f887a;font-size:0;line-height:0">&nbsp;</div></td><td class="db-ink" valign="top" style="padding:0 0 14px;color:#f1ebdf;font-size:15px;line-height:1.6">${inline(line.slice(2))}</td></tr>`).join("")}</table>`;
    if (lines.length === 1 && block.startsWith("## "))
      return `<h2 class="db-soft db-rule" style="margin:8px 0 18px;padding:24px 0 0;border-top:1px solid #2c2a25;color:#b3aa9a;font-size:12px;font-weight:600;letter-spacing:.1em;line-height:1.3;text-transform:uppercase">${inline(block.slice(3))}</h2>`;
    const content = lines.map(inline).join("<br>");
    if (lead && index === 0) {
      lead = false;
      return `<p class="db-soft" style="margin:0 0 28px;color:#b3aa9a;font-size:17px;line-height:1.6">${content}</p>`;
    }
    return `<p class="db-ink" style="margin:0 0 16px;color:#f1ebdf;font-size:15px;line-height:1.6">${content}</p>`;
  });
  const origin = escapeHtml(site);
  const small = "margin:0 0 8px;color:#b3aa9a;font-size:13px;line-height:1.6";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"><title>${escapeHtml(subject)}</title><style>${UPDATE_STYLE}</style></head><body class="db-paper" style="margin:0;padding:0;background:#151412;font-family:${UPDATE_FONT}"><table role="presentation" class="db-paper" width="100%" cellpadding="0" cellspacing="0" style="background:#151412"><tr><td align="center" style="padding:32px 12px 40px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;font-family:${UPDATE_FONT};text-align:left"><tr><td style="padding:0 8px 20px"><a href="${origin}" style="text-decoration:none"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td valign="middle" style="padding:0 10px 0 0"><img src="${origin}/assets/icon-96.png" alt="" width="32" height="32" style="display:block;border:0;border-radius:8px"></td><td class="db-ink" valign="middle" style="color:#f1ebdf;font-size:18px;font-weight:700;letter-spacing:-.01em">DayBoard</td></tr></table></a></td></tr><tr><td class="db-card db-pad" style="padding:40px 44px 28px;background:#1d1c19;border:1px solid #2c2a25;border-radius:20px"><p class="db-soft" style="margin:0 0 12px;color:#b3aa9a;font-size:12px;font-weight:600;letter-spacing:.1em;line-height:1.3;text-transform:uppercase">${escapeHtml(label)}</p><h1 class="db-ink db-title" style="margin:0 0 16px;color:#f1ebdf;font-size:32px;font-weight:700;letter-spacing:-.02em;line-height:1.15">${escapeHtml(title)}</h1>${parts.join("")}</td></tr><tr><td style="padding:24px 8px 0"><p class="db-soft" style="${small}">${escapeHtml(why)} <a href="${escapeHtml(unsubscribeUrl)}" style="color:inherit;text-decoration:underline">Unsubscribe</a>.</p><p class="db-soft" style="${small}"><a href="${origin}" style="color:inherit;text-decoration:underline">${escapeHtml(host)}</a>${postalAddress ? `<br>${escapeHtml(postalAddress)}` : ""}</p></td></tr></table></td></tr></table></body></html>`;
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
  headers?: Record<string, string>,
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
      body: JSON.stringify({
        from: mail.from,
        to: [to],
        reply_to: SUPPORT_EMAIL,
        ...message,
        ...(headers ? { headers } : {}),
      }),
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
