// Gmail over IMAP and SMTP with an app password the user creates in their Google account. This
// keeps DayBoard off Google's restricted Gmail API scopes, whose verification needs a paid
// security assessment every year. IDs stay in the Gmail API's hex form, so saved snoozes,
// follow-ups and links keep working.

import { randomUUID } from "node:crypto";

import { ImapFlow, type FetchMessageObject, type MailboxLockObject } from "imapflow";
import nodemailer from "nodemailer";

import { logger } from "../platform/index.js";
import type { GmailAccountStatus, MailItem } from "../shared-types.js";
import {
  clearGmailCredentials,
  normalizeAppPassword,
  readGmailCredentials,
  saveGmailCredentials,
  type GmailCredentials,
} from "./gmail-account.js";
import { GoogleAuthError, getGoogleStatus } from "./google-auth.js";
import {
  buildMessage,
  recipientAddress,
  replySubject,
  type ComposedMessage,
} from "./mail-compose.js";
import type { SubscriptionMessage } from "./mail-subscriptions.js";
import {
  addressOf,
  cleanBody,
  decodePart,
  formatAddress,
  gmailDecimalId,
  gmailHexId,
  htmlToText,
  parseHeaders,
  snippetFrom,
  textPartOf,
  type BodyStructure,
  type TextPart,
} from "./mail-text.js";

const IMAP_HOST = "imap.gmail.com";
const SMTP_HOST = "smtp.gmail.com";
const IDLE_LOGOUT_MS = 60_000;
const SNIPPET_BYTES = 3000;
const BODY_BYTES = 512 * 1024;

/** Gmail said no to the saved password; cleared when a new one is saved. */
let rejected = false;

function notConnected(message = "Connect Gmail in Settings to see your email."): GoogleAuthError {
  return new GoogleAuthError("mail-not-connected", message);
}

function isAuthFailure(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { authenticationFailed?: boolean }).authenticationFailed === true
  );
}

/** The app password, only while it belongs to the signed-in Google account. */
async function activeCredentials(): Promise<GmailCredentials> {
  const google = await getGoogleStatus();
  if (!google.connected) throw new GoogleAuthError("not-connected", "Google isn't connected.");
  const credentials = await readGmailCredentials();
  if (!credentials || credentials.email.toLowerCase() !== google.email?.toLowerCase())
    throw notConnected();
  if (rejected)
    throw notConnected("Gmail stopped accepting DayBoard’s app password. Enter a new one.");
  return credentials;
}

export async function getGmailStatus(): Promise<GmailAccountStatus> {
  const [google, credentials] = await Promise.all([getGoogleStatus(), readGmailCredentials()]);
  const matches =
    google.connected &&
    !!credentials &&
    credentials.email.toLowerCase() === google.email?.toLowerCase();
  return {
    connected: matches && !rejected,
    email: matches ? credentials.email : null,
    rejected: matches && rejected,
  };
}

// ── Connection ──────────────────────────────────────────────────────────

interface Session {
  client: ImapFlow;
  credentials: GmailCredentials;
  allMail: string;
  drafts: string | null;
}

let session: Promise<Session> | null = null;
let current: ImapFlow | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let tail: Promise<unknown> = Promise.resolve();

function newClient(credentials: GmailCredentials): ImapFlow {
  const client = new ImapFlow({
    host: IMAP_HOST,
    port: 993,
    secure: true,
    auth: { user: credentials.email, pass: credentials.password },
    logger: false,
    disableAutoIdle: true,
  });
  // A dropped socket emits "error"; the next call reconnects, so it must not crash the app.
  client.on("error", (error: unknown) => logger.warn("gmail", "IMAP connection error", error));
  return client;
}

async function openSession(credentials: GmailCredentials): Promise<Session> {
  const client = newClient(credentials);
  try {
    await client.connect();
  } catch (error) {
    if (isAuthFailure(error)) {
      rejected = true;
      throw notConnected("Gmail stopped accepting DayBoard’s app password. Enter a new one.");
    }
    throw new Error("Couldn’t reach Gmail. Check your connection and try again.", {
      cause: error,
    });
  }
  const folders = await client.list();
  const allMail = folders.find((folder) => folder.specialUse === "\\All")?.path;
  if (!allMail) {
    await client.logout().catch(() => {});
    throw new Error(
      "Gmail’s All Mail folder isn’t available over IMAP. Turn on “Show in IMAP” for All Mail in Gmail’s Labels settings.",
    );
  }
  const drafts = folders.find((folder) => folder.specialUse === "\\Drafts")?.path ?? null;
  client.on("close", () => {
    if (current === client) dropSession();
  });
  current = client;
  return { client, credentials, allMail, drafts };
}

function dropSession(): void {
  const closing = session;
  session = null;
  current = null;
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  void closing?.then((open) => open.client.logout()).catch(() => {});
}

async function sessionFor(credentials: GmailCredentials): Promise<Session> {
  if (session) {
    const open = await session.catch(() => null);
    if (
      open?.client.usable &&
      open.credentials.email === credentials.email &&
      open.credentials.password === credentials.password
    )
      return open;
    dropSession();
  }
  const opening = openSession(credentials);
  session = opening;
  opening.catch(() => {
    if (session === opening) session = null;
  });
  return opening;
}

/**
 * Runs one Gmail operation on the shared IMAP connection, one at a time. A read retries once on
 * a fresh connection, since Gmail drops sockets that sat idle or crossed a network change.
 */
function withGmail<T>(
  mode: "read" | "write",
  run: (session: Session, lock: MailboxLockObject) => Promise<T>,
): Promise<T> {
  const attempt = async (retry: boolean): Promise<T> => {
    const credentials = await activeCredentials();
    const open = await sessionFor(credentials);
    if (idleTimer) clearTimeout(idleTimer);
    try {
      const lock = await open.client.getMailboxLock(open.allMail, { readOnly: mode === "read" });
      try {
        return await run(open, lock);
      } finally {
        lock.release();
      }
    } catch (error) {
      if (error instanceof GoogleAuthError) throw error;
      if (!open.client.usable) {
        dropSession();
        if (retry) return attempt(false);
      }
      throw error;
    } finally {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(dropSession, IDLE_LOGOUT_MS);
    }
  };
  const queued = tail.then(
    () => attempt(mode === "read"),
    () => attempt(mode === "read"),
  );
  tail = queued.catch(() => undefined);
  return queued;
}

// ── Connecting ──────────────────────────────────────────────────────────

/** Checks the app password with Gmail before saving it for the signed-in Google account. */
export async function connectGmail(appPassword: string): Promise<void> {
  const password = normalizeAppPassword(appPassword);
  const google = await getGoogleStatus();
  if (!google.connected || !google.email)
    throw new Error("Sign in with Google first, then connect Gmail.");
  const credentials = { email: google.email, password };
  const client = newClient(credentials);
  try {
    await client.connect();
  } catch (error) {
    if (isAuthFailure(error))
      throw new Error(
        `Gmail didn’t accept that app password for ${google.email}. Check that you created it while signed in to that account.`,
      );
    throw new Error("Couldn’t reach Gmail. Check your connection and try again.", {
      cause: error,
    });
  }
  await client.logout().catch(() => {});
  dropSession();
  await saveGmailCredentials(credentials);
  rejected = false;
}

export async function disconnectGmail(): Promise<void> {
  dropSession();
  rejected = false;
  await clearGmailCredentials();
}

// ── Reading ─────────────────────────────────────────────────────────────

async function searchUids(client: ImapFlow, query: object, max: number): Promise<number[]> {
  const uids = (await client.search(query, { uid: true })) || [];
  return uids.sort((a, b) => b - a).slice(0, max);
}

async function uidFor(client: ImapFlow, id: string): Promise<number> {
  const decimal = gmailDecimalId(id);
  const uid = decimal ? (await searchUids(client, { emailId: decimal }, 1))[0] : undefined;
  if (!uid) throw new Error("That email is no longer in Gmail.");
  return uid;
}

function internalTime(message: FetchMessageObject): number {
  const date = message.internalDate;
  return date instanceof Date ? date.getTime() : date ? Date.parse(date) || 0 : 0;
}

/** The start of each message's text, with one FETCH per distinct MIME section. */
async function snippets(
  client: ImapFlow,
  parts: Map<number, TextPart>,
): Promise<Map<number, string>> {
  const byKey = new Map<string, number[]>();
  for (const [uid, part] of parts) byKey.set(part.key, [...(byKey.get(part.key) ?? []), uid]);
  const result = new Map<number, string>();
  for (const [key, uids] of byKey) {
    for await (const message of client.fetch(
      uids.join(","),
      { uid: true, bodyParts: [{ key, maxLength: SNIPPET_BYTES }] },
      { uid: true },
    )) {
      const raw = message.bodyParts?.values().next().value;
      const part = parts.get(message.uid);
      if (!raw || !part) continue;
      result.set(message.uid, snippetFrom(decodePart(raw, part, !!message.binaryParts?.size)));
    }
  }
  return result;
}

async function listMessages(query: string, max: number): Promise<MailItem[]> {
  return withGmail("read", async ({ client }) => {
    const uids = await searchUids(client, { gmraw: query }, max);
    if (!uids.length) return [];
    const messages: FetchMessageObject[] = [];
    for await (const message of client.fetch(
      uids.join(","),
      {
        uid: true,
        envelope: true,
        flags: true,
        threadId: true,
        internalDate: true,
        bodyStructure: true,
      },
      { uid: true },
    ))
      messages.push(message);
    const parts = new Map<number, TextPart>();
    for (const message of messages) {
      const part = textPartOf(message.bodyStructure as BodyStructure | undefined);
      if (part) parts.set(message.uid, part);
    }
    const previews = await snippets(client, parts);
    return messages
      .filter((message) => message.emailId)
      .sort((a, b) => internalTime(b) - internalTime(a))
      .map((message) => {
        const from = addressOf(message.envelope?.from);
        return {
          id: gmailHexId(message.emailId!),
          threadId: message.threadId ? gmailHexId(message.threadId) : gmailHexId(message.emailId!),
          from: from.name,
          fromEmail: from.email,
          subject: message.envelope?.subject?.trim() || "(no subject)",
          snippet: previews.get(message.uid) ?? "",
          date: new Date(internalTime(message) || Date.now()).toISOString(),
          unread: !message.flags?.has("\\Seen"),
        };
      });
  });
}

export function listInbox(max: number): Promise<MailItem[]> {
  return listMessages("in:inbox", max);
}

/** Recent mail involving any of the given people, or mentioning the keywords when there are none. */
export function searchRelatedMail(emails: string[], keywords: string): Promise<MailItem[]> {
  const people = emails
    .map((email) => email.replace(/["()\s]/g, ""))
    .filter((email) => email.includes("@"));
  const terms = keywords.replace(/["()]/g, " ").trim();
  const query = people.length
    ? `(${people.map((email) => `from:${email} OR to:${email}`).join(" OR ")}) newer_than:60d`
    : terms
      ? `"${terms}" newer_than:60d`
      : "";
  return query ? listMessages(query, 8) : Promise.resolve([]);
}

async function streamText(content: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of content) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks).toString("utf8");
}

export function getMessageBody(id: string): Promise<string> {
  return withGmail("read", async ({ client }) => {
    const uid = await uidFor(client, id);
    const message = await client.fetchOne(
      String(uid),
      { uid: true, bodyStructure: true },
      { uid: true },
    );
    const part = message ? textPartOf(message.bodyStructure as BodyStructure | undefined) : null;
    if (!part) return "";
    // download() removes the transfer encoding and converts the charset to UTF-8.
    const download = await client.download(String(uid), part.key, {
      uid: true,
      maxBytes: BODY_BYTES,
    });
    if (!download.content) return "";
    const text = await streamText(download.content);
    return cleanBody(part.html ? htmlToText(text) : text);
  });
}

export interface ReplyContext {
  /** Reply-To, else From, ready for a To header. */
  to: string;
  subject: string;
  messageId: string;
  references: string;
  threadId: string;
}

async function replyContext(client: ImapFlow, uid: number): Promise<ReplyContext> {
  const message = await client.fetchOne(
    String(uid),
    { uid: true, envelope: true, threadId: true, headers: ["references"] },
    { uid: true },
  );
  if (!message) throw new Error("That email is no longer in Gmail.");
  const envelope = message.envelope;
  const replyTo = envelope?.replyTo?.length ? envelope.replyTo : envelope?.from;
  const messageId = envelope?.messageId?.replace(/[\r\n]+/g, "") ?? "";
  const references = parseHeaders(message.headers).get("references") ?? "";
  return {
    to: formatAddress(addressOf(replyTo)),
    subject: envelope?.subject ?? "",
    messageId,
    references: [references.replace(/[\r\n]+/g, " "), messageId].filter(Boolean).join(" "),
    threadId: message.threadId ? gmailHexId(message.threadId) : "",
  };
}

/** The headers a reply to `id` needs to thread in Gmail and the recipient's client. */
export function getReplyContext(id: string): Promise<ReplyContext> {
  return withGmail("read", async ({ client }) => replyContext(client, await uidFor(client, id)));
}

/** The last 90 days of received mail with its list headers, for the subscriptions manager. */
export function listSubscriptionMessages(max = 300): Promise<SubscriptionMessage[]> {
  return withGmail("read", async ({ client }) => {
    const uids = await searchUids(
      client,
      { gmraw: "newer_than:90d -in:sent -in:chats -in:drafts" },
      max,
    );
    if (!uids.length) return [];
    const result: SubscriptionMessage[] = [];
    for await (const message of client.fetch(
      uids.join(","),
      {
        uid: true,
        envelope: true,
        flags: true,
        internalDate: true,
        headers: ["list-unsubscribe", "list-unsubscribe-post"],
      },
      { uid: true },
    )) {
      const from = addressOf(message.envelope?.from);
      const headers = parseHeaders(message.headers);
      result.push({
        from: from.name,
        fromEmail: from.email,
        listUnsubscribe: headers.get("list-unsubscribe") ?? "",
        listUnsubscribePost: headers.get("list-unsubscribe-post") ?? "",
        unread: !message.flags?.has("\\Seen"),
        date: internalTime(message),
      });
    }
    return result;
  });
}

/** True when someone other than `userEmail` wrote in the thread after `after` (ms). */
export function threadHasReplyAfter(
  threadId: string,
  after: number,
  userEmail: string | null,
): Promise<boolean> {
  return withGmail("read", async ({ client }) => {
    const decimal = gmailDecimalId(threadId);
    if (!decimal) return false;
    const uids = await searchUids(client, { threadId: decimal }, 200);
    if (!uids.length) return false;
    const me = userEmail?.toLowerCase() ?? null;
    for await (const message of client.fetch(
      uids.join(","),
      { uid: true, envelope: true, labels: true, internalDate: true },
      { uid: true },
    )) {
      if (
        internalTime(message) > after &&
        !message.labels?.has("\\Sent") &&
        addressOf(message.envelope?.from).email.toLowerCase() !== me
      )
        return true;
    }
    return false;
  });
}

// ── Changing ────────────────────────────────────────────────────────────

/**
 * Applies Gmail API label changes over IMAP. Only the two DayBoard uses exist here: INBOX is the
 * \Inbox label, and UNREAD is the absence of the \Seen flag.
 */
export function modifyMessage(
  id: string,
  removeLabelIds: string[],
  addLabelIds: string[] = [],
): Promise<void> {
  for (const label of [...removeLabelIds, ...addLabelIds])
    if (label !== "INBOX" && label !== "UNREAD")
      throw new Error(`Gmail label ${label} isn't supported`);
  return withGmail("write", async ({ client }) => {
    const uid = String(await uidFor(client, id));
    const options = { uid: true };
    if (addLabelIds.includes("INBOX"))
      await client.messageFlagsAdd(uid, ["\\Inbox"], { ...options, useLabels: true });
    if (removeLabelIds.includes("INBOX"))
      await client.messageFlagsRemove(uid, ["\\Inbox"], { ...options, useLabels: true });
    if (addLabelIds.includes("UNREAD")) await client.messageFlagsRemove(uid, ["\\Seen"], options);
    if (removeLabelIds.includes("UNREAD")) await client.messageFlagsAdd(uid, ["\\Seen"], options);
  });
}

function newMessageId(email: string): string {
  return `<${randomUUID()}@${email.split("@")[1] || "dayboard.app"}>`;
}

export function createReplyDraft(id: string, body: string): Promise<{ draftId: string }> {
  return withGmail("read", async ({ client, credentials, drafts }) => {
    if (!drafts)
      throw new Error(
        "Gmail’s Drafts folder isn’t available over IMAP. Turn on “Show in IMAP” for Drafts in Gmail’s Labels settings.",
      );
    const context = await replyContext(client, await uidFor(client, id));
    const messageId = newMessageId(credentials.email);
    const message = buildMessage(
      {
        to: [context.to],
        subject: replySubject(context.subject),
        body,
        inReplyTo: context.messageId || undefined,
        references: context.references || undefined,
      },
      { from: credentials.email, date: new Date(), messageId },
    );
    await client.append(drafts, message, ["\\Draft", "\\Seen"]);
    return { draftId: messageId };
  });
}

/** Sends over Gmail's SMTP server, which files the message in Sent and threads it by its headers. */
export async function sendMail(message: ComposedMessage): Promise<void> {
  const credentials = await activeCredentials();
  const transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: 465,
    secure: true,
    auth: { user: credentials.email, pass: credentials.password },
  });
  try {
    await transport.sendMail({
      envelope: {
        from: credentials.email,
        to: [...message.to, ...(message.cc ?? [])].map(recipientAddress),
      },
      raw: buildMessage(message, {
        from: credentials.email,
        date: new Date(),
        messageId: newMessageId(credentials.email),
      }),
    });
  } catch (error) {
    if ((error as { code?: string }).code === "EAUTH") {
      rejected = true;
      throw notConnected("Gmail stopped accepting DayBoard’s app password. Enter a new one.");
    }
    throw error;
  } finally {
    transport.close();
  }
}
