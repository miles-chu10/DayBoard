import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

const root = new URL("..", import.meta.url).pathname;
const bundle = await build({
  entryPoints: [path.join(root, "main/services/whats-new.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  logLevel: "silent",
});
const { parseWhatsNew, whatsNewDecision } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const base = { current: "1.3.14", demo: false };

test("the first launch after an update shows What's New once", () => {
  assert.deepEqual(whatsNewDecision({ ...base, seen: "1.3.13", onboarded: true }), {
    show: true,
    record: null,
  });
  assert.deepEqual(whatsNewDecision({ ...base, seen: "1.3.14", onboarded: true }), {
    show: false,
    record: null,
  });
});

test("an install from before the record existed counts as updated once it is onboarded", () => {
  assert.deepEqual(whatsNewDecision({ ...base, seen: null, onboarded: true }), {
    show: true,
    record: null,
  });
});

test("a new install gets the welcome and records its version instead", () => {
  assert.deepEqual(whatsNewDecision({ ...base, seen: null, onboarded: false }), {
    show: false,
    record: "1.3.14",
  });
  // A new install that saw an earlier version still sees the next update's notes.
  assert.equal(whatsNewDecision({ ...base, seen: "1.3.13", onboarded: false }).show, true);
});

test("demo mode never opens it on its own or writes a record", () => {
  assert.deepEqual(whatsNewDecision({ ...base, seen: null, onboarded: true, demo: true }), {
    show: false,
    record: null,
  });
});

test("the record keeps only a valid version", () => {
  assert.deepEqual(parseWhatsNew({ seenVersion: "1.3.13" }), { seenVersion: "1.3.13" });
  assert.deepEqual(parseWhatsNew({ seenVersion: "../../etc" }), { seenVersion: null });
  assert.deepEqual(parseWhatsNew(null), { seenVersion: null });
});
