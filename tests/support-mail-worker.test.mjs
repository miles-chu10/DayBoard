import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import worker, {
  firePayload,
  isAutomated,
  startFeedbackCheck,
} from "../support-mail-worker/worker.js";

const root = join(import.meta.dirname, "..");

// Like the Headers on an incoming message, but without the WHATWG checks, so a test can pass the
// raw values a hostile sender might put in a header.
function rawHeaders(values) {
  const map = new Map(Object.entries(values).map(([name, value]) => [name.toLowerCase(), value]));
  return { get: (name) => map.get(name.toLowerCase()) ?? null };
}

function fakeMessage(headers = {}, from = "user@example.com") {
  const calls = [];
  return {
    calls,
    from,
    to: "support@getdayboard.com",
    headers: rawHeaders({
      "Message-ID": "<abc@example.com>",
      Subject: "DayBoard feedback (1.3.10)",
      ...headers,
    }),
    async forward(to) {
      calls.push(["forward", to]);
    },
    setReject(reason) {
      calls.push(["reject", reason]);
    },
  };
}

const env = {
  FORWARD_TO: "inbox@example.com",
  FEEDBACK_TASK_ID: "trig_test",
  FEEDBACK_TASK_TOKEN: "token-value",
};

async function withFetch(impl, run) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

test("forwards first, then starts the feedback task once with only the message id and subject", async () => {
  const message = fakeMessage();
  const requests = [];
  await withFetch(
    async (url, init) => {
      message.calls.push(["fire"]);
      requests.push({ url, init });
      return new Response('{"type":"routine_fire"}', { status: 200 });
    },
    () => worker.email(message, env),
  );

  assert.deepEqual(message.calls, [["forward", "inbox@example.com"], ["fire"]]);
  assert.equal(requests.length, 1);
  const [{ url, init }] = requests;
  assert.equal(url, "https://api.anthropic.com/v1/claude_code/routines/trig_test/fire");
  assert.equal(init.method, "POST");
  assert.equal(init.headers.Authorization, "Bearer token-value");
  assert.equal(init.headers["anthropic-beta"], "experimental-cc-routine-2026-04-01");
  assert.equal(init.headers["anthropic-version"], "2023-06-01");
  const body = JSON.parse(init.body);
  assert.deepEqual(Object.keys(body), ["text"]);
  assert.match(body.text, /Message-ID: <abc@example\.com>/);
  assert.match(body.text, /Subject: DayBoard feedback \(1\.3\.10\)/);
  assert.doesNotMatch(body.text, /user@example\.com/, "the sender stays out of the payload");
});

test("a failed or hung start never throws after the forward", async () => {
  for (const impl of [
    async () => new Response("nope", { status: 401 }),
    async () => {
      throw new TypeError("network down");
    },
  ]) {
    const message = fakeMessage();
    await withFetch(impl, () => worker.email(message, env));
    assert.deepEqual(message.calls, [["forward", "inbox@example.com"]]);
  }
  assert.equal(
    await startFeedbackCheck(fakeMessage(), env, async () => new Response("", { status: 429 })),
    "failed",
  );
});

test("without the task secrets it still forwards and makes no request", async () => {
  const message = fakeMessage();
  let fired = false;
  await withFetch(
    async () => {
      fired = true;
      return new Response("");
    },
    () => worker.email(message, { FORWARD_TO: "inbox@example.com" }),
  );
  assert.deepEqual(message.calls, [["forward", "inbox@example.com"]]);
  assert.equal(fired, false);
});

test("without a forwarding address it bounces instead of dropping the message", async () => {
  const message = fakeMessage();
  await withFetch(
    async () => assert.fail("must not start the task"),
    () => worker.email(message, { ...env, FORWARD_TO: "" }),
  );
  assert.equal(message.calls.length, 1);
  assert.equal(message.calls[0][0], "reject");
});

test("bounces, auto-replies and list mail are forwarded but don't start the task", async () => {
  const automated = [
    fakeMessage({}, "MAILER-DAEMON@mx.example.com"),
    fakeMessage({}, "noreply@example.com"),
    fakeMessage({ "Auto-Submitted": "auto-replied" }),
    fakeMessage({ Precedence: "bulk" }),
    fakeMessage({ "List-Unsubscribe": "<mailto:x@example.com>" }),
    fakeMessage({ "List-Id": "news.example.com" }),
    fakeMessage({ "X-Autoreply": "yes" }),
  ];
  for (const message of automated) {
    assert.equal(isAutomated(message), true, message.from);
    await withFetch(
      async () => assert.fail("must not start the task"),
      () => worker.email(message, env),
    );
    assert.deepEqual(message.calls, [["forward", "inbox@example.com"]]);
  }
  assert.equal(isAutomated(fakeMessage({ "Auto-Submitted": "no" })), false);
  assert.equal(isAutomated(fakeMessage()), false);
});

test("the payload stays on its own lines and is bounded", () => {
  const text = firePayload(
    fakeMessage({ Subject: `Hello\r\nBcc: x@example.com ${"a".repeat(500)}`, "Message-ID": "" }),
  );
  const lines = text.split("\n");
  assert.equal(lines.length, 3);
  assert.equal(lines[1], "Message-ID: (none)");
  assert.ok(lines[2].length <= "Subject: ".length + 200);
  assert.doesNotMatch(lines[2], /[\r\n]/);
});

test("the Worker config keeps the forwarding address and task secrets out of the repo", () => {
  const text = readFileSync(join(root, "support-mail-worker", "wrangler.jsonc"), "utf8");
  const config = JSON.parse(text.replace(/^\s*\/\/.*$/gm, "").replace(/,(\s*[}\]])/g, "$1"));
  assert.equal(config.name, "dayboard-support-mail");
  assert.equal(config.main, "worker.js");
  assert.equal(config.vars, undefined);
  assert.equal(config.workers_dev, false);
  assert.doesNotMatch(text, /@gmail\.com|trig_|sk-ant-/);
});
