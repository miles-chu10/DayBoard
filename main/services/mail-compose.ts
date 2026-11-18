/** Composing RFC 5322 messages to send over SMTP or save as Gmail drafts. Electron-free. */

export const MAX_RECIPIENTS = 50;
export const MAX_BODY = 200_000;
const MAX_SUBJECT = 900;

const ADDRESS = /^[^\s@<>(),;:"[\]\\]+@[^\s@<>(),;:"[\]\\]+\.[^\s@<>(),;:"[\]\\]+$/;

function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

export function encodeHeaderValue(value: string): string {
  const clean = oneLine(value);
  return /^[\x20-\x7e]*$/.test(clean)
    ? clean
    : `=?UTF-8?B?${Buffer.from(clean, "utf8").toString("base64")}?=`;
}

/**
 * Splits "a@x.com, Sam <s@y.com>" into header-safe recipients, or throws naming the bad one.
 * Display names keep only printable characters; addresses must look like user@domain.tld.
 */
export function parseRecipients(value: string, field: string): string[] {
  const parts = value
    .split(/[,;\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length > MAX_RECIPIENTS)
    throw new Error(`${field}: at most ${MAX_RECIPIENTS} recipients`);
  return parts.map((part) => {
    const named = part.match(/^(.*?)<([^<>]+)>$/);
    const address = (named ? named[2] : part).trim();
    if (!ADDRESS.test(address)) throw new Error(`${field}: “${part}” isn't an email address`);
    const name = named ? named[1].replace(/["\\]/g, "").trim() : "";
    if (!name) return address;
    // ASCII names are quoted; others become an encoded word, which must not sit inside quotes.
    const display = /^[\x20-\x7e]*$/.test(name) ? `"${name}"` : encodeHeaderValue(name);
    return `${display} <${address}>`;
  });
}

export interface ComposedMessage {
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
}

/** Headers DayBoard adds itself, because SMTP and IMAP don't fill them in the way Gmail's API did. */
export interface MessageOrigin {
  from: string;
  date: Date;
  messageId: string;
}

/** A plain-text UTF-8 message with CRLF line endings. */
export function buildMessage(message: ComposedMessage, origin: MessageOrigin): string {
  if (!message.to.length) throw new Error("Add at least one recipient");
  if (message.body.length > MAX_BODY) throw new Error("The message is too long to send");
  const lines = [
    `From: ${oneLine(origin.from)}`,
    `Date: ${origin.date.toUTCString()}`,
    `Message-ID: ${oneLine(origin.messageId)}`,
    `To: ${message.to.join(", ")}`,
    ...(message.cc?.length ? [`Cc: ${message.cc.join(", ")}`] : []),
    `Subject: ${encodeHeaderValue(message.subject.slice(0, MAX_SUBJECT))}`,
    ...(message.inReplyTo
      ? [
          `In-Reply-To: ${oneLine(message.inReplyTo)}`,
          `References: ${oneLine(message.references || message.inReplyTo)}`,
        ]
      : []),
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    // Base64 keeps every line under SMTP's 998-byte limit, however long a paragraph is.
    "Content-Transfer-Encoding: base64",
    "",
    ...(Buffer.from(message.body.replace(/\r?\n/g, "\r\n"), "utf8")
      .toString("base64")
      .match(/.{1,76}/g) ?? []),
  ];
  return lines.join("\r\n");
}

/** The bare address of a recipient from `parseRecipients`, for the SMTP envelope. */
export function recipientAddress(recipient: string): string {
  return (recipient.match(/<([^<>]+)>\s*$/)?.[1] ?? recipient).trim();
}

export function replySubject(subject: string): string {
  return /^re:/i.test(subject.trim()) ? subject.trim() : `Re: ${subject.trim()}`;
}
