#!/usr/bin/env node
// Announces a published DayBoard version to the update newsletter through the billing Worker's
// admin routes. The email is written from docs/release-notes-<version>.md. The admin token comes
// only from the environment, meant to be filled by 1Password:
//
//   export DAYBOARD_ADMIN_TOKEN="op://<vault>/<item>/credential" # a reference, not the token
//   export DAYBOARD_BILLING_ORIGIN="https://api.getdayboard.com"
//   op run -- node billing/scripts/update-email.mjs send 1.3.11 --recipients 34
//
// Sending emails real people. Run `draft`, `list` and `test` first, and `send` only with the
// owner's go-ahead for that version and that list.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const SITE = "https://getdayboard.com";
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}(-[a-z0-9.]{1,16})?$/;
const ERROR_CODE = /^[a-z_]{1,64}$/;
const USAGE = `Usage:
  update-email.mjs draft <version>                 Print the email. Contacts nothing.
  update-email.mjs list                            Print who it would go to, and how many.
  update-email.mjs test <version> --to <address>   Send one copy to one address.
  update-email.mjs send <version> --recipients N   Send it to every subscriber, once per version.
  update-email.mjs status <version>                Print how far a send has got.
  update-email.mjs unsubscribe <address>...        Take addresses off the list.

Options:
  --origin URL     Billing service origin (or DAYBOARD_BILLING_ORIGIN).
  --recipients N   Required for send: the count \`list\` printed. If the list has changed since,
                   nothing is sent.
  --file PATH      Use this text instead of the release notes. Its first line is
                   "Subject: ...", then a blank line, then the email. A line that is only
                   "[label](https://...)" becomes a button, "![alt](https://...)" a picture.
  --image URL      Show this picture under the download button, such as
                   https://getdayboard.com/assets/screens/light-menubar.png.

Environment:
  DAYBOARD_ADMIN_TOKEN     The Worker's ADMIN_TOKEN. Pass it with 1Password "op run".
  DAYBOARD_BILLING_ORIGIN  Used when --origin is absent.
`;

class UsageError extends Error {}

/**
 * Turns a version's release notes into the email: the title becomes the subject, wrapped lines
 * are joined, pull request numbers are dropped, and download and changelog links are added.
 */
export function draftFromNotes(version, notes, site = SITE, image = "") {
  const blocks = notes
    .replaceAll("\r\n", "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  const title = blocks[0]?.startsWith("# ") ? blocks.shift().slice(2).trim() : "";
  const [name, ...rest] = title.split(/\s+[—–-]\s+/);
  const headline = rest.join(" - ");
  const subject = headline ? `${name}: ${headline}` : name || `DayBoard ${version} is out`;
  const tidy = (text) =>
    text
      .replace(/\s+\((#\d+(, )?)+\)/g, "")
      .replace(/\s+/g, " ")
      .trim();
  const body = blocks.map((block) => {
    if (!block.startsWith("- ")) return tidy(block.replace(/^#{2,} /, "## "));
    // A list: each "- " starts an item, and indented lines continue the one before.
    const items = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("- ")) items.push(line.slice(2));
      else items[items.length - 1] += ` ${line}`;
    }
    return items.map((item) => `- ${tidy(item)}`).join("\n");
  });
  // The download button and the picture sit right under the opening paragraph.
  const top = [`[Download DayBoard ${version}](${site}/download)`];
  if (image) top.push(`![DayBoard ${version}](${image})`);
  body.splice(body[0] && !/^(## |- )/.test(body[0]) ? 1 : 0, 0, ...top);
  body.push(
    `If you already have DayBoard, it will offer the update.\nEverything that changed: ${site}/changelog`,
  );
  return { subject, text: body.join("\n\n") };
}

async function draft(version, file, image) {
  if (file) {
    const [first, ...rest] = (await readFile(file, "utf8")).replaceAll("\r\n", "\n").split("\n");
    const subject = /^Subject: (.+)$/.exec(first)?.[1].trim();
    if (!subject || rest[0] !== "")
      throw new UsageError('--file must start with "Subject: ..." and a blank line.');
    return { subject, text: rest.join("\n").trim() };
  }
  const path = fileURLToPath(new URL(`../../docs/release-notes-${version}.md`, import.meta.url));
  let notes;
  try {
    notes = await readFile(path, "utf8");
  } catch {
    throw new UsageError(`No docs/release-notes-${version}.md. Write it first, or pass --file.`);
  }
  return draftFromNotes(version, notes, SITE, image);
}

function serviceOrigin(value) {
  if (!value) throw new UsageError("Set --origin or DAYBOARD_BILLING_ORIGIN.");
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new UsageError("The billing origin is not a URL.");
  }
  // Plain HTTP only reaches this machine, for local testing. Anything else needs HTTPS.
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    url.origin !== value ||
    url.username ||
    url.password ||
    !(url.protocol === "https:" || (url.protocol === "http:" && loopback))
  )
    throw new UsageError("The billing origin must be an HTTPS origin with no path or slash.");
  return url.origin;
}

function adminToken(env) {
  const token = env.DAYBOARD_ADMIN_TOKEN ?? "";
  if (token.startsWith("op://"))
    throw new UsageError(
      "DAYBOARD_ADMIN_TOKEN is a 1Password reference, not the token. Run this script through `op run -- node ...` so 1Password fills it in.",
    );
  if (token.length < 32)
    throw new UsageError("DAYBOARD_ADMIN_TOKEN is missing or shorter than 32 characters.");
  return token;
}

async function call(origin, token, method, action, body) {
  let response;
  try {
    response = await fetch(`${origin}/v1/admin/updates/${action}`, {
      method,
      // Never let a redirect carry the token somewhere else.
      redirect: "error",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    return { status: 0, data: null };
  }
  let data = null;
  try {
    data = await response.json();
  } catch {
    // A non-JSON answer is reported by status alone.
  }
  return { status: response.status, data };
}

function describe({ status, data }) {
  if (status === 0) return "the request failed before the service answered";
  const code = typeof data?.error === "string" && ERROR_CODE.test(data.error) ? data.error : "";
  return `HTTP ${status}${code ? ` ${code}` : ""}`;
}

const progress = (data) =>
  `${data.version}: ${data.sent} sent, ${data.pending} waiting, ${data.failed} failed, ${data.skipped} skipped (unsubscribed).`;

async function main(argv, env, log) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      origin: { type: "string" },
      recipients: { type: "string" },
      to: { type: "string" },
      file: { type: "string" },
      image: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command, ...rest] = positionals;
  if (values.help || !command) {
    log.out(USAGE);
    return values.help ? 0 : 2;
  }
  if (!["draft", "list", "test", "send", "status", "unsubscribe"].includes(command))
    throw new UsageError(`Unknown command "${command}".`);
  const versioned = ["draft", "test", "send", "status"].includes(command);
  if (versioned && (rest.length !== 1 || !VERSION.test(rest[0])))
    throw new UsageError(`${command} needs one version, such as 1.3.11.`);
  if (command === "list" && rest.length) throw new UsageError("list takes no arguments.");
  if (command === "unsubscribe" && !rest.length)
    throw new UsageError("unsubscribe needs an address.");
  if (command === "test" && !values.to) throw new UsageError("test needs --to <address>.");
  if (command === "send" && !/^[1-9][0-9]*$/.test(values.recipients ?? ""))
    throw new UsageError("send needs --recipients N, the count `list` printed.");
  if (values.image && !/^https:\/\/[^\s()]+$/.test(values.image))
    throw new UsageError("--image must be an https URL.");
  const [version] = rest;

  const message = ["draft", "test", "send"].includes(command)
    ? await draft(version, values.file, values.image)
    : null;
  if (command === "draft") {
    log.out(`Subject: ${message.subject}\n\n${message.text}`);
    log.out("\n(Each copy ends with why the person gets it and their own unsubscribe link.)");
    return 0;
  }
  const origin = serviceOrigin(values.origin ?? env.DAYBOARD_BILLING_ORIGIN);
  const token = adminToken(env);

  if (command === "list") {
    const result = await call(origin, token, "GET", "subscribers");
    if (result.status !== 200 || !Array.isArray(result.data?.subscribers)) {
      log.error(`Could not read the list: ${describe(result)}.`);
      return 1;
    }
    for (const { email, source } of result.data.subscribers) log.out(`${email}\t${source}`);
    log.out(`${result.data.recipients} recipients`);
    return 0;
  }
  if (command === "unsubscribe") {
    let failed = 0;
    for (const email of rest) {
      const result = await call(origin, token, "POST", "unsubscribe", { email });
      if (result.status === 200 && result.data?.unsubscribed === true)
        log.out(`Unsubscribed ${email}`);
      else {
        failed++;
        log.error(`Could not unsubscribe ${email}: ${describe(result)}.`);
      }
    }
    return failed ? 1 : 0;
  }
  if (command === "status") {
    const result = await call(origin, token, "GET", `mailings?version=${version}`);
    if (result.status === 404) log.out(`${version} has not been announced.`);
    else if (result.status === 200) log.out(progress(result.data));
    else log.error(`Could not read the status: ${describe(result)}.`);
    return result.status === 200 || result.status === 404 ? 0 : 1;
  }
  if (command === "test") {
    const result = await call(origin, token, "POST", "test", { ...message, to: values.to });
    if (result.status === 200 && result.data?.sent === true) {
      log.out(`Sent a test copy of "${message.subject}" to ${values.to}.`);
      return 0;
    }
    log.error(`The test copy was not sent: ${describe(result)}.`);
    return 1;
  }
  const result = await call(origin, token, "POST", "mailings", {
    version,
    ...message,
    recipients: Number(values.recipients),
  });
  if (result.status === 201) {
    log.out(`Announced. ${progress(result.data)}`);
    log.out("The rest go out over the next hour. Check with: update-email.mjs status " + version);
    return 0;
  }
  if (result.data?.error === "recipient_count_changed")
    log.error(
      `Nothing was sent: the list now has ${result.data.recipients} recipients, not ${values.recipients}. Run list again.`,
    );
  else if (result.data?.error === "already_announced")
    log.error(`Nothing was sent: ${version} was already announced. ${progress(result.data)}`);
  else log.error(`Nothing was sent: ${describe(result)}.`);
  return 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const log = { out: (line) => console.log(line), error: (line) => console.error(line) };
  try {
    process.exitCode = await main(process.argv.slice(2), process.env, log);
  } catch (cause) {
    if (cause instanceof UsageError || String(cause?.code).startsWith("ERR_PARSE_ARGS")) {
      log.error(cause.message);
      log.error("Run with --help for usage.");
      process.exitCode = 2;
    } else {
      // Only the error code: no message that could quote the token or an address.
      log.error(`update-email failed: ${cause?.code ?? cause?.name ?? "unknown error"}`);
      process.exitCode = 1;
    }
  }
}
